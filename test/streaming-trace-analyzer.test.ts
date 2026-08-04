import { describe, it, expect } from 'vitest';
import { IncrementalJsonParser, StreamingTraceAnalyzer } from '../src/shared/streaming';
import { analyzeTracingEvents } from '../src/shared/engine';
import type { TracingEvent } from '../src/shared/types';

function ev(
  channel: string,
  eventType: TracingEvent['eventType'],
  timestamp: number,
  operationId?: string,
  extra: Partial<TracingEvent> = {},
): TracingEvent {
  return { channel, eventType, context: { k: 1 }, timestamp, operationId, ...extra };
}

function buildDataset(): TracingEvent[] {
  const raw: TracingEvent[] = [
    ev('express:request', 'start', 100, 'r1'),
    ev('mysql2:query', 'start', 101, 'q1'),
    ev('mysql2:query', 'end', 131, 'q1'),
    ev('ioredis:set', 'start', 102, 's1'),
    ev('ioredis:set', 'end', 112, 's1'),
    ev('express:request', 'end', 140, 'r1'),

    ev('express:request', 'start', 200, 'r2'),
    ev('mysql2:query', 'start', 201, 'q2'),
    ev('mysql2:query', 'error', 291, 'q2', { error: { message: 'deadlock', name: 'Error' } }),
    ev('express:request', 'end', 300, 'r2'),

    // orphan end (no matching start)
    ev('kafka:produce', 'end', 400, 'orphan-end'),
    // orphan error
    ev('kafka:consume', 'error', 410, 'orphan-error', { error: { message: 'boom' } }),
    // incomplete start (never ends)
    ev('http:fetch', 'start', 500, 'stuck'),
    // async events (not paired)
    ev('mysql2:query', 'asyncStart', 600, 'async-1'),
    ev('mysql2:query', 'asyncEnd', 610, 'async-1'),
  ];
  return [...raw].sort((a, b) => a.timestamp - b.timestamp);
}

describe('StreamingTraceAnalyzer parity with analyzeTracingEvents', () => {
  it('produces identical aggregates to the synchronous pipeline', () => {
    const events = buildDataset();
    const sync = analyzeTracingEvents(events);

    const analyzer = new StreamingTraceAnalyzer({ maxEvents: 1000, maxOperations: 1000 });
    for (const e of events) analyzer.feed(e);
    const { analysis, meta } = analyzer.finish();

    expect(meta.truncated).toBe(false);
    expect(analysis.totalEvents).toBe(sync.totalEvents);
    expect(analysis.totalOperations).toBe(sync.totalOperations);
    expect(analysis.errorRate).toBeCloseTo(sync.errorRate, 10);
    expect(analysis.channels).toEqual(sync.channels);
    expect(analysis.timeRange).toEqual(sync.timeRange);

    const stat = (a: typeof sync.channelStats, ch: string) => a.find(s => s.channel === ch)!;
    for (const cs of sync.channelStats) {
      const mine = stat(analysis.channelStats, cs.channel);
      expect(mine.totalOperations).toBe(cs.totalOperations);
      expect(mine.successCount).toBe(cs.successCount);
      expect(mine.errorCount).toBe(cs.errorCount);
      expect(mine.incompleteCount).toBe(cs.incompleteCount);
      expect(mine.avgDuration).toBeCloseTo(cs.avgDuration, 10);
      expect(mine.p50Duration).toBe(cs.p50Duration);
      expect(mine.p95Duration).toBe(cs.p95Duration);
      expect(mine.p99Duration).toBe(cs.p99Duration);
      expect(mine.minDuration).toBe(cs.minDuration);
      expect(mine.maxDuration).toBe(cs.maxDuration);
    }
  });

  it('retains full event arrays when below the caps', () => {
    const events = buildDataset();
    const analyzer = new StreamingTraceAnalyzer({ maxEvents: 1000, maxOperations: 1000 });
    for (const e of events) analyzer.feed(e);
    const { analysis, meta } = analyzer.finish();
    expect(analysis.events).toHaveLength(events.length);
    expect(analysis.operations.length).toBe(analysis.totalOperations);
    expect(meta.truncated).toBe(false);
  });

  it('caps retention but keeps aggregates exact for huge inputs', () => {
    const events: TracingEvent[] = [];
    for (let i = 0; i < 500; i++) {
      events.push(ev('ch', 'start', i * 2, `o${i}`));
      events.push(ev('ch', 'end', i * 2 + 10, `o${i}`));
    }
    const analyzer = new StreamingTraceAnalyzer({ maxEvents: 50, maxOperations: 50 });
    for (const e of events) analyzer.feed(e);
    const { analysis, meta } = analyzer.finish();

    expect(meta.truncated).toBe(true);
    expect(analysis.totalEvents).toBe(1000);
    expect(analysis.totalOperations).toBe(500);
    expect(analysis.events.length).toBeLessThanOrEqual(50);
    expect(analysis.operations.length).toBeLessThanOrEqual(50);
    expect(analysis.channelStats[0].totalOperations).toBe(500);
    expect(analysis.channelStats[0].errorCount).toBe(0);
  });

  it('counts invalid events as skipped', () => {
    const analyzer = new StreamingTraceAnalyzer();
    expect(analyzer.feed({ channel: '', eventType: 'start', context: {}, timestamp: 1 })).toBe(false);
    expect(analyzer.feed({ channel: 'x', eventType: 'bogus', context: {}, timestamp: 1 })).toBe(false);
    expect(analyzer.feed({ channel: 'x', eventType: 'start', context: {}, timestamp: Number.NaN })).toBe(false);
    const { meta } = analyzer.finish();
    expect(meta.invalid).toBe(3);
    expect(meta.eventsSeen).toBe(0);
  });

  it('reports cumulative progress', () => {
    const seen: number[] = [];
    const analyzer = new StreamingTraceAnalyzer({ progressEvery: 4, onProgress: p => seen.push(p.eventsSeen) });
    for (let i = 0; i < 10; i++) {
      analyzer.feed(ev('ch', 'start', i, `o${i}`));
    }
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[seen.length - 1]).toBeGreaterThanOrEqual(4);
  });
});

describe('worker byte-stream decode path (raw bytes + TextDecoder stream:true)', () => {
  it('handles UTF-8 split across arbitrary byte boundaries and matches sync', () => {
    const events = buildDataset();
    const sync = analyzeTracingEvents(events);
    // Serialize to UTF-8 JSON with multibyte content.
    events[0].context = { msg: '你好世界 🚀' };
    const text = JSON.stringify(events);
    const bytes = new TextEncoder().encode(text);

    const decoder = new TextDecoder();
    const parser = new IncrementalJsonParser();
    const analyzer = new StreamingTraceAnalyzer({ maxEvents: 1000, maxOperations: 1000 });

    // Feed in 3-byte slices to force mid-code-point splits.
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
      out += decoder.decode(bytes.subarray(i, i + 3), { stream: true });
      parser.push(out);
      out = '';
      let v: string | null;
      while ((v = parser.next()) !== null) analyzer.feed(JSON.parse(v) as TracingEvent);
    }
    parser.push(decoder.decode());

    const { analysis } = analyzer.finish(bytes.length);
    expect(analysis.totalEvents).toBe(sync.totalEvents);
    expect(analysis.totalOperations).toBe(sync.totalOperations);
    expect(analysis.errorRate).toBeCloseTo(sync.errorRate, 10);
    // The first event's context survived multibyte decoding.
    expect(analysis.events[0].context.msg).toBe('你好世界 🚀');
  });
});
