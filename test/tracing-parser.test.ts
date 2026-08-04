import { describe, it, expect } from 'vitest';
import { analyzeTracingEvents } from '../src/shared/engine';
import type { TracingEvent } from '../src/shared/types';

function ev(channel: string, eventType: TracingEvent['eventType'], timestamp: number, operationId: string, extra: Partial<TracingEvent> = {}): TracingEvent {
  return { channel, eventType, context: {}, timestamp, operationId, ...extra };
}

describe('analyzeTracingEvents', () => {
  it('pairs start/end events into a successful operation with the correct duration', () => {
    const events = [
      ev('http', 'start', 100, 'req-1'),
      ev('http', 'end', 150, 'req-1'),
    ];
    const analysis = analyzeTracingEvents(events);
    expect(analysis.totalEvents).toBe(2);
    expect(analysis.totalOperations).toBe(1);
    expect(analysis.operations[0]).toMatchObject({ channel: 'http', duration: 50, status: 'success' });
    expect(analysis.errorRate).toBe(0);
  });

  it('marks error ops and computes the error rate', () => {
    const events = [
      ev('mysql2', 'start', 0, 'a'),
      ev('mysql2', 'error', 10, 'a', { error: { message: 'timeout' } }),
      ev('mysql2', 'start', 20, 'b'),
      ev('mysql2', 'end', 30, 'b'),
    ];
    const analysis = analyzeTracingEvents(events);
    expect(analysis.totalOperations).toBe(2);
    expect(analysis.operations[0].status).toBe('error');
    expect(analysis.operations[1].status).toBe('success');
    expect(analysis.errorRate).toBeCloseTo(0.5);
    expect(analysis.channelStats[0].errorCount).toBe(1);
  });

  it('keeps orphan end/error events as incomplete', () => {
    const events = [ev('redis', 'end', 5, 'ghost')];
    const analysis = analyzeTracingEvents(events);
    expect(analysis.operations[0].status).toBe('incomplete');
    expect(analysis.operations[0].duration).toBe(0);
  });

  it('keeps unmatched start events as incomplete', () => {
    const events = [ev('fs', 'start', 0, 'open-file')];
    const analysis = analyzeTracingEvents(events);
    expect(analysis.operations[0].status).toBe('incomplete');
  });

  it('computes correct percentiles', () => {
    const events: TracingEvent[] = [];
    for (let i = 0; i < 10; i++) {
      const start = i * 200;
      events.push(ev('db', 'start', start, `op-${i}`));
      events.push(ev('db', 'end', start + 10 + i * 10, `op-${i}`)); // durations 10..100
    }
    const analysis = analyzeTracingEvents(events);
    const stats = analysis.channelStats[0];
    expect(stats.p50Duration).toBe(50);
    expect(stats.p95Duration).toBe(100);
    expect(stats.p99Duration).toBe(100);
    expect(stats.minDuration).toBe(10);
    expect(stats.maxDuration).toBe(100);
    expect(stats.totalOperations).toBe(10);
  });

  it('sorts events chronologically and reports the time range', () => {
    const events = [
      ev('a', 'start', 300, 'x'),
      ev('b', 'start', 100, 'y'),
      ev('a', 'end', 400, 'x'),
    ];
    const analysis = analyzeTracingEvents(events);
    expect(analysis.events.map(e => e.timestamp)).toEqual([100, 300, 400]);
    expect(analysis.timeRange).toEqual({ start: 100, end: 400 });
  });

  it('handles an empty event list without throwing', () => {
    const analysis = analyzeTracingEvents([]);
    expect(analysis.totalEvents).toBe(0);
    expect(analysis.totalOperations).toBe(0);
    expect(analysis.channels).toEqual([]);
    expect(analysis.errorRate).toBe(0);
  });
});
