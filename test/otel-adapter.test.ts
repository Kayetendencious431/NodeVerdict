import { describe, it, expect } from 'vitest';
import { isOtelExport, convertOtelToTracingEvents, loadOtelTraceJson } from '../src/shared/engine';

const EPOCH_MS = 1_700_000_000_000; // 2023-11-14 epoch millis
const nano = (msOffset: number): string => String((EPOCH_MS + msOffset) * 1e6);
const micro = (msOffset: number): number => (EPOCH_MS + msOffset) * 1e3;

describe('otel-adapter', () => {
  it('recognizes OTLP resourceSpans export', () => {
    const otel = { resourceSpans: [{ scopeSpans: [] }] };
    expect(isOtelExport(otel)).toBe(true);
  });

  it('recognizes a flat spans array', () => {
    expect(isOtelExport({ spans: [] })).toBe(true);
  });

  it('recognizes jaeger-style data', () => {
    expect(isOtelExport({ data: [{ spans: [] }] })).toBe(true);
  });

  it('rejects non-otel objects', () => {
    expect(isOtelExport({ foo: 1 })).toBe(false);
    expect(isOtelExport([1, 2])).toBe(false);
  });

  it('converts an OTLP span into start+end events', () => {
    const events = convertOtelToTracingEvents({
      resourceSpans: [{
        scopeSpans: [{
          spans: [{
            traceId: 't1',
            spanId: 's1',
            parentSpanId: 'root',
            name: 'GET /users',
            kind: 2,
            startTimeUnixNano: nano(0),
            endTimeUnixNano: nano(60),
            attributes: [{ key: 'http.method', value: { stringValue: 'GET' } }],
            status: { code: 1 },
          }],
        }],
      }],
    });
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      channel: 'GET /users',
      eventType: 'start',
      duration: 60,
      operationId: 's1',
    });
    expect(events[0].timestamp).toBeCloseTo(EPOCH_MS, 0);
    expect(events[0].context).toMatchObject({
      traceId: 't1',
      parentSpanId: 'root',
      kind: 2,
      'http.method': 'GET',
    });
    expect(events[1]).toMatchObject({ eventType: 'end' });
    expect(events[1].timestamp).toBeCloseTo(EPOCH_MS + 60, 0);
  });

  it('emits an error event for a failed span', () => {
    const events = convertOtelToTracingEvents({
      resourceSpans: [{
        scopeSpans: [{
          spans: [{
            name: 'db.call',
            startTimeUnixNano: nano(0),
            endTimeUnixNano: nano(20),
            status: { code: 2, message: 'connection refused' },
          }],
        }],
      }],
    });
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ eventType: 'error' });
    expect(events[1].timestamp).toBeCloseTo(EPOCH_MS + 20, 0);
    expect(events[1].error).toMatchObject({ message: 'connection refused' });
  });

  it('converts jaeger-style microsecond timing', () => {
    const events = convertOtelToTracingEvents({
      data: [{
        traceID: 'abc',
        spans: [{
          spanID: 'j1',
          operationName: 'SELECT * FROM orders',
          startTime: micro(0),     // epoch microseconds
          duration: 250_000,       // 250ms
          tags: [{ key: 'sql.query', value: 'select', type: 'string' }],
        }],
      }],
    });
    expect(events[0]).toMatchObject({ channel: 'SELECT * FROM orders', duration: 250 });
    expect(events[0].timestamp).toBeCloseTo(EPOCH_MS, 0);
    expect(events[1]).toMatchObject({ eventType: 'end' });
    expect(events[1].timestamp).toBeCloseTo(EPOCH_MS + 250, 0);
  });

  it('sorts converted events chronologically', () => {
    const events = convertOtelToTracingEvents({
      spans: [
        { name: 'later', startTimeUnixNano: nano(200), endTimeUnixNano: nano(210) },
        { name: 'earlier', startTimeUnixNano: nano(50), endTimeUnixNano: nano(60) },
      ],
    });
    expect(events[0].channel).toBe('earlier');
    expect(events[0].timestamp).toBeCloseTo(EPOCH_MS + 50, 0);
  });

  it('loadOtelTraceJson throws for non-otel JSON', () => {
    expect(() => loadOtelTraceJson('{"not":"otel"}')).toThrow(/Not an OpenTelemetry/);
  });
});
