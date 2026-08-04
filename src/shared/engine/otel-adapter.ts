import type { TracingEvent } from '../types';

/**
 * OpenTelemetry JSON adapter.
 * Converts OTLP/JSON trace export data into NodeVerdict's internal TracingEvent
 * format so every existing feature (event viewer, trace viewer, validator,
 * report, AI-RCA) can consume standard OTel data without a Jaeger backend.
 *
 * Supported shapes:
 *  1. resourceSpans[{resource, scopeSpans[{scope, spans[]}]}]  (standard OTLP/JSON)
 *  2. flat `spans` array  (some exporters)
 *  3. jaeger-style { data: [{ traceID, spans: [...] }] }
 */

interface OtlpSpan {
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  name?: string;
  kind?: number;
  startTimeUnixNano?: string | number;
  endTimeUnixNano?: string | number;
  /** jaeger-style fields */
  operationName?: string;
  startTime?: number;
  duration?: number;
  attributes?: { key: string; value: { stringValue?: string; intValue?: string; doubleValue?: number; boolValue?: boolean; arrayValue?: { values: unknown[] } } }[];
  status?: { code?: number; message?: string };
  events?: { name?: string; attributes?: unknown }[];
}

/** A group of spans plus the service (or process) they belong to. */
interface SpanGroup {
  serviceName?: string;
  spans: OtlpSpan[];
}

/** Extracts `service.name` from an OTLP resource or a jaeger process. */
function extractServiceName(resource?: { attributes?: { key: string; value: { stringValue?: string } }[] }): string | undefined {
  const found = resource?.attributes?.find(a => a.key === 'service.name');
  return found?.value?.stringValue;
}

/**
 * Converts a raw epoch timestamp to milliseconds using a magnitude heuristic.
 * Epoch nanos (~1.7e18), micros (~1.7e15) and millis (~1.7e12) are cleanly
 * separated by two orders of magnitude for dates between 1970 and ~2287:
 *   >= 1e16 → nanoseconds, >= 1e13 → microseconds, otherwise milliseconds.
 */
function timeToMs(value: string | number | undefined): number {
  if (value === undefined || value === '') return 0;
  const n = typeof value === 'string' ? Number(value) : value;
  if (n === 0) return 0;
  if (n >= 1e16) return n / 1e6;
  if (n >= 1e13) return n / 1e3;
  return n;
}

function attrValue(v: { stringValue?: string; intValue?: string; doubleValue?: number; boolValue?: boolean }): string {
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.intValue !== undefined) return v.intValue;
  if (v.doubleValue !== undefined) return String(v.doubleValue);
  if (v.boolValue !== undefined) return String(v.boolValue);
  return '';
}

function findAttr(attrs: OtlpSpan['attributes'], key: string): string {
  const found = attrs?.find(a => a.key === key);
  return found ? attrValue(found.value) : '';
}

function spanToEvents(span: OtlpSpan, serviceName?: string): TracingEvent[] {
  const channel = findAttr(span.attributes ?? [], 'nodeverdict.channel') || span.name || span.operationName || 'otel.span';
  const operationId = span.spanId || span.name || span.operationName || `otel:${Math.random().toString(36).slice(2)}`;
  const parentSpanId = span.parentSpanId;

  // OTLP uses start/end nanos; jaeger uses startTime + duration in micros.
  let start = timeToMs(span.startTimeUnixNano);
  let end = timeToMs(span.endTimeUnixNano);
  let duration = end > start ? end - start : 0;
  if (span.duration !== undefined && span.duration > 0) {
    const jaegerStart = timeToMs(span.startTime);
    duration = span.duration / 1e3;
    start = jaegerStart;
    end = jaegerStart + duration;
  }

  const statusCode = span.status?.code ?? 1;
  const isError = statusCode === 2;

  const context: Record<string, unknown> = {};
  for (const a of span.attributes ?? []) {
    context[a.key] = attrValue(a.value);
  }
  if (parentSpanId) context.parentSpanId = parentSpanId;
  context.traceId = span.traceId;
  context.kind = span.kind;
  context.statusMessage = span.status?.message;
  if (serviceName) context.serviceName = serviceName;

  const events: TracingEvent[] = [];
  events.push({
    channel,
    eventType: 'start',
    context,
    timestamp: start,
    duration,
    operationId,
  });
  if (isError) {
    events.push({
      channel,
      eventType: 'error',
      context,
      timestamp: end,
      duration,
      operationId,
      error: { name: span.status?.message ?? 'OTel error', message: span.status?.message ?? 'OTel error' },
    });
  } else {
    events.push({
      channel,
      eventType: 'end',
      context,
      timestamp: end,
      duration,
      operationId,
    });
  }
  return events;
}

function extractOtlpGroups(obj: Record<string, unknown>): SpanGroup[] {
  const groups: SpanGroup[] = [];

  // Standard OTLP/JSON: resourceSpans[{ resource, scopeSpans[{ spans[] }] }]
  const resourceSpans = obj.resourceSpans as { resource?: { attributes?: { key: string; value: { stringValue?: string } }[] }; scopeSpans?: { spans?: OtlpSpan[] }[] }[] | undefined;
  if (Array.isArray(resourceSpans)) {
    for (const rs of resourceSpans) {
      const serviceName = extractServiceName(rs.resource);
      for (const ss of rs.scopeSpans ?? []) {
        const spans = ss.spans ?? [];
        if (spans.length === 0) continue;
        groups.push({ serviceName, spans });
      }
    }
    return groups;
  }

  // Flat spans array
  if (Array.isArray(obj.spans)) return [{ spans: obj.spans as OtlpSpan[] }];

  // Jaeger-style { data: [{ traceID, process: { serviceName }, spans: [...] }] }
  const data = obj.data as { process?: { serviceName?: string }; spans?: OtlpSpan[] }[] | undefined;
  if (Array.isArray(data)) {
    for (const d of data) {
      const spans = d.spans ?? [];
      if (spans.length === 0) continue;
      groups.push({ serviceName: d.process?.serviceName, spans });
    }
  }
  return groups;
}

export function isOtelExport(obj: unknown): boolean {
  if (!obj || typeof obj !== 'object') return false;
  const o = obj as Record<string, unknown>;
  return Array.isArray(o.resourceSpans) || Array.isArray(o.spans)
    || (Array.isArray(o.data) && typeof (o.data[0] as { spans?: unknown })?.spans !== 'undefined');
}

/** Converts an OTel JSON export object into TracingEvent[]. */
export function convertOtelToTracingEvents(obj: Record<string, unknown>): TracingEvent[] {
  const groups = extractOtlpGroups(obj);
  const events: TracingEvent[] = [];
  for (const group of groups) {
    for (const span of group.spans) events.push(...spanToEvents(span, group.serviceName));
  }
  // Sort by timestamp for a stable, chronological feed
  return events.sort((a, b) => a.timestamp - b.timestamp);
}

export function loadOtelTraceJson(content: string): TracingEvent[] {
  const parsed = JSON.parse(content) as unknown;
  if (!isOtelExport(parsed)) {
    throw new Error('Not an OpenTelemetry trace export JSON');
  }
  return convertOtelToTracingEvents(parsed as Record<string, unknown>);
}
