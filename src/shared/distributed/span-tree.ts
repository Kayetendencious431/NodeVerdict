import type { TracingEvent } from '../types';
import { analyzeTracingEvents } from '../engine/tracing-parser';
import type { DistSpan, DistTrace } from './types';

/**
 * Distributed span reconstruction.
 *
 * Rebuilds per-trace span trees from the flat event model using the OTel
 * correlation fields the adapter preserved in each span's context:
 *   traceId / spanId (operationId) / parentSpanId / serviceName / kind.
 *
 * Also implements logical-clock (Lamport-style) correction: hosts have
 * millisecond-scale wall-clock drift, so a child span may start *before* its
 * parent. We re-anchor each child subtree so causality holds, while
 * preserving intra-host durations (which are measured on a single clock and
 * are trustworthy).
 */

/** Minimum gap a child must keep after its parent to preserve causality. */
export const MIN_DELTA_MS = 0.001;

export function extractServiceName(context: Record<string, unknown>): string {
  if (typeof context.serviceName === 'string' && context.serviceName) return context.serviceName;
  if (typeof context['service.name'] === 'string' && context['service.name']) return context['service.name'];
  return 'unknown';
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** Converts paired operations into flat DistSpans (not yet linked into trees). */
export function operationsToSpans(events: TracingEvent[]): DistSpan[] {
  const analysis = analyzeTracingEvents(events);
  const spans: DistSpan[] = [];

  for (const op of analysis.operations) {
    const context = op.start.context;
    const traceId = String(context.traceId ?? 'untraced');
    const spanId = String(op.operationId ?? `${op.channel}:${op.start.timestamp}`);
    const parentSpanId = context.parentSpanId !== undefined ? String(context.parentSpanId) : undefined;
    const errorEvent = op.status === 'error' ? op.error : undefined;
    const kind = toNumber(context.kind);
    const errorMessage =
      (errorEvent?.error && typeof errorEvent.error === 'object'
        ? String((errorEvent.error as { message?: unknown }).message ?? '')
        : '') || undefined;

    spans.push({
      traceId,
      spanId,
      parentSpanId,
      serviceName: extractServiceName(context),
      name: op.channel,
      kind,
      startTime: op.start.timestamp,
      endTime: op.start.timestamp + Math.max(0, op.duration),
      duration: Math.max(0, op.duration),
      error: op.status === 'error',
      errorMessage,
      attributes: context,
      children: [],
      depth: 0,
    });
  }
  return spans;
}

/** Links flat spans into per-trace trees using parentSpanId (scoped per trace). */
export function linkSpans(spans: DistSpan[]): DistSpan[] {
  // Index by (traceId, spanId): span IDs are only guaranteed unique within a trace.
  const byTrace = new Map<string, Map<string, DistSpan>>();
  for (const s of spans) {
    let m = byTrace.get(s.traceId);
    if (!m) {
      m = new Map();
      byTrace.set(s.traceId, m);
    }
    if (!m.has(s.spanId)) m.set(s.spanId, s);
  }

  for (const s of spans) {
    const m = byTrace.get(s.traceId);
    if (s.parentSpanId && m && m.has(s.parentSpanId)) {
      const parent = m.get(s.parentSpanId)!;
      if (parent !== s) {
        parent.children.push(s);
        s.depth = parent.depth + 1;
      }
    }
  }

  for (const s of spans) {
    s.children.sort((a, b) => a.startTime - b.startTime);
  }

  const roots = spans.filter(s => {
    if (!s.parentSpanId || s.parentSpanId === s.spanId) return true;
    const m = byTrace.get(s.traceId);
    return !m || !m.has(s.parentSpanId);
  });

  // Depths must be recomputed from the roots: during linking, a parent's own
  // depth may not be final yet when its children are attached.
  function assignDepth(span: DistSpan, depth: number) {
    span.depth = depth;
    for (const c of span.children) assignDepth(c, depth + 1);
  }
  for (const r of roots) assignDepth(r, 0);

  return roots;
}

/**
 * Corrects cross-host clock skew within a single trace using a logical clock.
 * Each child subtree is shifted so it never starts before its parent (plus a
 * small epsilon); durations are preserved because they are measured on one
 * host clock. Returns a new trace (does not mutate the input).
 */
export function correctClockSkew(trace: DistTrace): DistTrace {
  let skewCorrectionMs = 0;

  function visit(span: DistSpan): DistSpan {
    const child: DistSpan = {
      ...span,
      children: [],
      attributes: { ...span.attributes },
    };
    for (const c of span.children) child.children.push(visit(c));
    return child;
  }

  const roots = trace.roots.map(r => visit(r));

  function anchorParent(span: DistSpan, parentAdjustedStart: number | undefined) {
    // Reference the already-corrected start if present, so the pass is idempotent.
    const base = span.adjustedStart ?? span.startTime;
    const minStart = parentAdjustedStart !== undefined ? parentAdjustedStart + MIN_DELTA_MS : base;
    const adjStart = Math.max(base, minStart);
    const shift = adjStart - base;
    if (shift > 0) skewCorrectionMs += shift;
    span.adjustedStart = adjStart;
    span.adjustedEnd = adjStart + span.duration;
    for (const c of span.children) anchorParent(c, adjStart);
  }

  for (const r of roots) anchorParent(r, undefined);

  // Re-sort children by corrected start time now that adjustments are final.
  for (const s of collectFlattened(roots)) {
    s.children.sort((a, b) => (a.adjustedStart ?? a.startTime) - (b.adjustedStart ?? b.startTime));
  }

  const flat = collectFlattened(roots);
  const start = Math.min(...flat.map(s => s.adjustedStart ?? s.startTime));
  const end = Math.max(...flat.map(s => s.adjustedEnd ?? s.endTime));

  return {
    traceId: trace.traceId,
    roots,
    spans: flat,
    startTime: start,
    endTime: end,
    skewCorrectionMs,
    corrected: skewCorrectionMs > 0,
  };
}

function collectFlattened(roots: DistSpan[]): DistSpan[] {
  const out: DistSpan[] = [];
  const stack = [...roots];
  while (stack.length) {
    const s = stack.pop()!;
    out.push(s);
    stack.push(...s.children);
  }
  return out;
}

/**
 * Builds clock-corrected distributed traces from a flat event list.
 * Accepts any source the unified loader produces (NodeVerdict JSON, OTel, .ndv).
 */
export function buildDistributedTraces(events: TracingEvent[]): DistTrace[] {
  const spans = operationsToSpans(events);
  const roots = linkSpans(spans);
  const byTrace = new Map<string, DistSpan[]>();
  for (const r of roots) {
    const list = byTrace.get(r.traceId) ?? [];
    list.push(r);
    byTrace.set(r.traceId, list);
  }

  const traces: DistTrace[] = [];
  for (const [traceId, traceRoots] of byTrace) {
    const pre = {
      traceId,
      roots: traceRoots,
      spans: collectFlattened(traceRoots),
      startTime: Math.min(...traceRoots.map(r => r.startTime)),
      endTime: Math.max(...collectFlattened(traceRoots).map(s => s.endTime)),
      skewCorrectionMs: 0,
      corrected: false,
    };
    traces.push(correctClockSkew(pre));
  }

  return traces.sort((a, b) => a.startTime - b.startTime);
}
