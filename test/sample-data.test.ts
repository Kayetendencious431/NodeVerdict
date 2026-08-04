import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { analyzeDifferential } from '../src/shared/differential';
import { buildDistributedTraces } from '../src/shared/distributed/span-tree';
import { buildTopology } from '../src/shared/distributed/topology';
import { loadTracingData, parseGcLog, parseMemoryTimeline, calculateGrowthRate } from '../src/shared/engine';
import type { TracingEvent } from '../src/shared/types';

describe('differential debug sample pairs', () => {
  const cases: Array<[string, string, string[], number, boolean]> = [
    ['differential-timeout-normal', 'differential-timeout-fault', ['event-missing', 'error-introduced'], 2, true],
    ['differential-pool-normal', 'differential-pool-fault', ['event-missing', 'error-introduced'], 2, true],
    ['differential-cache-normal', 'differential-cache-fault', ['event-missing', 'event-value-change'], 5, false],
  ];

  for (const [normal, fault, kinds, minDivergences, hasError] of cases) {
    it(`analyzes ${normal} vs ${fault}`, () => {
      const n = JSON.parse(readFileSync(`examples/${normal}.json`, 'utf8')) as TracingEvent[];
      const f = JSON.parse(readFileSync(`examples/${fault}.json`, 'utf8')) as TracingEvent[];
      const a = analyzeDifferential(n, f);
      expect(a.divergences.length).toBeGreaterThanOrEqual(minDivergences);
      expect(a.divergences[0].cause.role).toBe('cause');
      const foundKinds = new Set(a.divergences.map(d => d.eventDiff.kind));
      for (const k of kinds) expect(foundKinds.has(k)).toBe(true);
      if (hasError) {
        expect(a.divergences.some(d => d.eventDiff.fault?.error)).toBe(true);
      }
    });
  }
});

describe('otel cascade-failure sample', () => {
  it('flags the payment-gateway as the faulty service', () => {
    const content = readFileSync('examples/otel-cascade-failure.json', 'utf8');
    const events = loadTracingData(content);
    const graph = buildTopology(buildDistributedTraces(events));
    expect(graph.traces).toBe(2);
    expect(graph.nodes).toHaveLength(12);
    const payment = graph.nodes.find(n => n.serviceName === 'payment-gateway')!;
    expect(payment.errorCount).toBe(1);
    expect(payment.health).toBe('faulty');
    expect(graph.nodes.find(n => n.serviceName === 'recommendation')!.health).toBe('warning');
  });
});

describe('gc memory-leak sample', () => {
  it('shows escalating major GCs and unmanaged growth', () => {
    const a = parseGcLog(readFileSync('examples/gc-memory-leak.log', 'utf8'));
    expect(a.totalGcs).toBeGreaterThan(100);
    expect(a.majorGcCount).toBeGreaterThanOrEqual(6);
    expect(a.externalUnmanaged).toBe(true);
    expect(a.avgMajorPauseMs).toBeGreaterThan(a.avgMinorPauseMs);
  });
});

describe('memory timeline leak sample', () => {
  it('flags abnormal growth', () => {
    const timeline = parseMemoryTimeline(readFileSync('examples/memory-timeline-leak.json', 'utf8'));
    const rate = calculateGrowthRate(timeline);
    expect(timeline.snapshots.length).toBeGreaterThan(40);
    expect(rate.flagged).toBe(true);
    expect(rate.rssGrowthRateMs).toBeGreaterThan(2);
  });
});
