import { analyzeTracingEvents, buildWaterfall, loadTracingData, loadNdvBuffer } from '../engine';
import type { TracingEvent, TraceSpan } from '../types';

/**
 * CI/CD performance gate.
 * "Rules as code": a trace is evaluated against a set of rules with thresholds,
 * producing a machine-readable result (exit code 0 = pass, 1 = fail) plus a
 * human-readable report. Used by the `node-verdict check` CLI and reused by the
 * browser UI.
 */

export interface GateRule {
  id: string;
  description: string;
  status: 'pass' | 'fail' | 'skipped';
  actual: number;
  threshold: number;
  unit: string;
  detail?: string;
}

export interface GateConfig {
  /** Maximum acceptable P99 operation latency in ms. */
  p99MaxMs: number;
  /** Maximum sibling same-type SQL queries under one parent before flagging N+1. */
  n1SqlMaxCount: number;
  /** Maximum acceptable event loop delay in ms (rule skips when no data present). */
  eventLoopDelayMaxMs: number;
}

export interface GateMetrics {
  p99LatencyMs: number;
  n1SqlInstances: { parentChannel: string; parentId: string; queries: number }[];
  eventLoopDelayP99Ms: number | null;
  totalOperations: number;
  totalEvents: number;
  errorRate: number;
}

export interface GateResult {
  passed: boolean;
  config: GateConfig;
  metrics: GateMetrics;
  rules: GateRule[];
}

export const defaultGateConfig: GateConfig = {
  p99MaxMs: 500,
  n1SqlMaxCount: 3,
  eventLoopDelayMaxMs: 20,
};

const SQL_CHANNEL_RE = /(mysql|pg|postgres|sqlite|mssql|query|knex|sequelize)/i;
const EVENT_LOOP_CHANNEL_RE = /event[\s-]?loop/i;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function flattenSpans(spans: TraceSpan[], depth: number): { span: TraceSpan; depth: number }[] {
  const out: { span: TraceSpan; depth: number }[] = [];
  for (const s of spans) {
    out.push({ span: s, depth });
    out.push(...flattenSpans(s.children, depth + 1));
  }
  return out;
}

/** Computes raw gate metrics from parsed tracing events. */
export function computeGateMetrics(events: TracingEvent[]): GateMetrics {
  const analysis = analyzeTracingEvents(events);
  const spans = buildWaterfall(analysis.operations, analysis.events);

  const durations = analysis.operations
    .filter(o => o.duration > 0)
    .map(o => o.duration)
    .sort((a, b) => a - b);
  const p99LatencyMs = percentile(durations, 99);

  // N+1 detection: a parent span with >= threshold same-type SQL children.
  const n1SqlInstances: GateMetrics['n1SqlInstances'] = [];
  for (const { span } of flattenSpans(spans, 0)) {
    const sqlChildren = span.children.filter(c => SQL_CHANNEL_RE.test(c.channel));
    const byType = new Map<string, number>();
    for (const c of sqlChildren) {
      const key = c.channel.toLowerCase();
      byType.set(key, (byType.get(key) ?? 0) + 1);
    }
    for (const [type, count] of byType) {
      if (count >= defaultGateConfig.n1SqlMaxCount) {
        n1SqlInstances.push({ parentChannel: span.channel, parentId: span.operationId, queries: count });
      }
    }
  }

  // Event loop delay from channels reporting latency in context.
  const delays: number[] = [];
  for (const e of events) {
    if (!EVENT_LOOP_CHANNEL_RE.test(e.channel)) continue;
    const latency = e.context?.latency ?? e.context?.delay ?? e.context?.lag;
    if (typeof latency === 'number' && latency > 0) delays.push(latency);
  }
  const eventLoopDelayP99Ms = delays.length > 0 ? percentile(delays.sort((a, b) => a - b), 99) : null;

  return {
    p99LatencyMs,
    n1SqlInstances,
    eventLoopDelayP99Ms,
    totalOperations: analysis.totalOperations,
    totalEvents: analysis.totalEvents,
    errorRate: analysis.errorRate,
  };
}

/** Evaluates metrics against the gate rules. */
export function evaluateGate(metrics: GateMetrics, config: Partial<GateConfig> = {}): GateResult {
  const cfg: GateConfig = { ...defaultGateConfig, ...config };
  const rules: GateRule[] = [];

  rules.push({
    id: 'p99-latency',
    description: 'P99 latency',
    status: metrics.p99LatencyMs <= cfg.p99MaxMs ? 'pass' : 'fail',
    actual: metrics.p99LatencyMs,
    threshold: cfg.p99MaxMs,
    unit: 'ms',
  });

  const n1Count = metrics.n1SqlInstances.length;
  rules.push({
    id: 'n1-sql',
    description: 'N+1 SQL query pattern',
    status: n1Count === 0 ? 'pass' : 'fail',
    actual: n1Count,
    threshold: 0,
    unit: 'instances',
    detail: n1Count > 0
      ? metrics.n1SqlInstances.map(i => `${i.parentChannel} (${i.queries} queries)`).join(', ')
      : undefined,
  });

  if (metrics.eventLoopDelayP99Ms === null) {
    rules.push({
      id: 'event-loop-delay',
      description: 'Event loop delay',
      status: 'skipped',
      actual: 0,
      threshold: cfg.eventLoopDelayMaxMs,
      unit: 'ms',
      detail: 'No event-loop channel data in trace',
    });
  } else {
    rules.push({
      id: 'event-loop-delay',
      description: 'Event loop delay',
      status: metrics.eventLoopDelayP99Ms <= cfg.eventLoopDelayMaxMs ? 'pass' : 'fail',
      actual: metrics.eventLoopDelayP99Ms,
      threshold: cfg.eventLoopDelayMaxMs,
      unit: 'ms',
    });
  }

  return {
    passed: rules.every(r => r.status === 'pass' || r.status === 'skipped'),
    config: cfg,
    metrics,
    rules,
  };
}

/** One-call entry point: parse a trace source (JSON events / OTel JSON / .ndv) and evaluate. */
export function evaluateTraceGate(content: string | ArrayBuffer, config?: Partial<GateConfig>): GateResult {
  const events = typeof content === 'string' ? loadTracingData(content) : loadNdvBuffer(content);
  const metrics = computeGateMetrics(events);
  return evaluateGate(metrics, config);
}

/** Formats a gate result as a human-readable markdown report. */
export function formatGateReport(result: GateResult, sourceName?: string): string {
  const lines: string[] = [];
  lines.push(`# NodeVerdict Performance Gate${sourceName ? ` — ${sourceName}` : ''}`);
  lines.push('');
  lines.push(`**Result: ${result.passed ? 'PASS' : 'FAIL'}**`);
  lines.push('');
  lines.push('| Rule | Status | Actual | Threshold |');
  lines.push('|---|---|---|---|');
  for (const r of result.rules) {
    const status = r.status === 'pass' ? '✅ pass' : r.status === 'fail' ? '❌ fail' : '⏭ skip';
    lines.push(`| ${r.description} | ${status} | ${r.actual.toLocaleString()}${r.unit} | ${r.threshold.toLocaleString()}${r.unit} |`);
  }
  lines.push('');
  lines.push(`Trace: ${result.metrics.totalEvents} events, ${result.metrics.totalOperations} operations, error rate ${(result.metrics.errorRate * 100).toFixed(2)}%.`);
  if (result.metrics.n1SqlInstances.length > 0) {
    lines.push('');
    lines.push('N+1 SQL suspects:');
    for (const n1 of result.metrics.n1SqlInstances) {
      lines.push(`- ${n1.parentChannel} (${n1.parentId}): ${n1.queries} sequential SQL queries`);
    }
  }
  return lines.join('\n');
}
