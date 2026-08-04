import { describe, it, expect } from 'vitest';
import {
  defaultGateConfig,
  computeGateMetrics,
  evaluateGate,
  evaluateTraceGate,
  formatGateReport,
} from '../src/shared/gate/performance-gate';
import { encodeNdv } from '../src/shared/engine';
import type { TracingEvent } from '../src/shared/types';

function ev(channel: string, eventType: TracingEvent['eventType'], timestamp: number, operationId: string, extra: Partial<TracingEvent> = {}): TracingEvent {
  return { channel, eventType, context: {}, timestamp, operationId, ...extra };
}

/** 10 ops with durations 10..100 ms across three channels. */
function latencyEvents(): TracingEvent[] {
  const events: TracingEvent[] = [];
  for (let i = 0; i < 10; i++) {
    const start = i * 200;
    const dur = 10 + i * 10;
    events.push(ev('db:query', 'start', start, `op-${i}`));
    events.push(ev('db:query', 'end', start + dur, `op-${i}`, { duration: dur }));
  }
  return events;
}

describe('performance-gate', () => {
  it('exposes sensible defaults', () => {
    expect(defaultGateConfig).toEqual({ p99MaxMs: 500, n1SqlMaxCount: 3, eventLoopDelayMaxMs: 20 });
  });

  it('passes when P99 latency is within the threshold', () => {
    const result = evaluateGate(computeGateMetrics(latencyEvents()), { p99MaxMs: 100 });
    expect(result.passed).toBe(true);
    const rule = result.rules.find(r => r.id === 'p99-latency')!;
    expect(rule.status).toBe('pass');
    expect(rule.actual).toBe(100);
  });

  it('fails when P99 latency exceeds the threshold', () => {
    const result = evaluateGate(computeGateMetrics(latencyEvents()), { p99MaxMs: 50 });
    expect(result.passed).toBe(false);
    expect(result.rules.find(r => r.id === 'p99-latency')!.status).toBe('fail');
  });

  it('flags an N+1 pattern of same-type SQL children', () => {
    const events: TracingEvent[] = [
      ev('express:request', 'start', 0, 'root'),
      ...Array.from({ length: 5 }, (_, i) => [
        ev('mysql2:query', 'start', 10 + i * 10, `q${i}`),
        ev('mysql2:query', 'end', 60 + i * 10, `q${i}`),
      ]).flat(),
      ev('express:request', 'end', 500, 'root'),
    ];
    const metrics = computeGateMetrics(events);
    expect(metrics.n1SqlInstances).toHaveLength(1);
    expect(metrics.n1SqlInstances[0]).toMatchObject({ parentChannel: 'express:request', queries: 5 });

    const result = evaluateGate(metrics, { n1SqlMaxCount: 3 });
    expect(result.passed).toBe(false);
    expect(result.rules.find(r => r.id === 'n1-sql')!.status).toBe('fail');
  });

  it('respects a raised n1SqlMaxCount threshold', () => {
    const events: TracingEvent[] = [
      ev('express:request', 'start', 0, 'root'),
      ...Array.from({ length: 5 }, (_, i) => [
        ev('mysql2:query', 'start', 10 + i * 10, `q${i}`),
        ev('mysql2:query', 'end', 60 + i * 10, `q${i}`),
      ]).flat(),
      ev('express:request', 'end', 500, 'root'),
    ];
    const result = evaluateGate(computeGateMetrics(events, { n1SqlMaxCount: 6 }), { n1SqlMaxCount: 6 });
    expect(result.rules.find(r => r.id === 'n1-sql')!.status).toBe('pass');
  });

  it('skips the event-loop rule when no event-loop data exists', () => {
    const result = evaluateGate(computeGateMetrics(latencyEvents()));
    const rule = result.rules.find(r => r.id === 'event-loop-delay')!;
    expect(rule.status).toBe('skipped');
  });

  it('evaluates event-loop delay from channel latency context', () => {
    const events: TracingEvent[] = [];
    for (let i = 0; i < 10; i++) {
      events.push(ev('node:event-loop-delay', 'start', i, `el-${i}`, { context: { latency: 1 + i } }));
      events.push(ev('node:event-loop-delay', 'end', i + 1, `el-${i}`, { context: { latency: 1 + i } }));
    }
    const metrics = computeGateMetrics(events);
    expect(metrics.eventLoopDelayP99Ms).toBe(10);
    expect(evaluateGate(metrics, { eventLoopDelayMaxMs: 20 }).passed).toBe(true);
    expect(evaluateGate(metrics, { eventLoopDelayMaxMs: 5 }).passed).toBe(false);
  });

  it('evaluateTraceGate accepts JSON strings and .ndv buffers', () => {
    const json = JSON.stringify(latencyEvents());
    expect(evaluateTraceGate(json, { p99MaxMs: 100 }).passed).toBe(true);

    const buffer = encodeNdv(latencyEvents()).buffer as ArrayBuffer;
    const result = evaluateTraceGate(buffer, { p99MaxMs: 100 });
    expect(result.passed).toBe(true);
    expect(result.metrics.totalOperations).toBe(10);
  });

  it('formatGateReport includes the verdict and rule table', () => {
    const result = evaluateTraceGate(JSON.stringify(latencyEvents()), { p99MaxMs: 100 });
    const report = formatGateReport(result, 'trace.json');
    expect(report).toContain('# NodeVerdict Performance Gate');
    expect(report).toContain('trace.json');
    expect(report).toContain('**Result: PASS**');
    expect(report).toContain('| Rule | Status | Actual | Threshold |');
    expect(report).toContain('P99 latency');
  });
});
