import { describe, it, expect } from 'vitest';
import { encodeNdv, decodeNdv, decodeNdvFromArrayBuffer, NdvError } from '../src/shared/engine';
import type { TracingEvent } from '../src/shared/types';

function roundTrip(events: TracingEvent[]): TracingEvent[] {
  return decodeNdv(encodeNdv(events));
}

describe('.ndv codec', () => {
  it('round-trips all event types with full fields', () => {
    const events: TracingEvent[] = [
      {
        channel: 'mysql2:query',
        eventType: 'start',
        context: { sql: 'SELECT * FROM users', user: 'admin' },
        timestamp: 1000.5,
        duration: 12.25,
        operationId: 'op-001',
      },
      {
        channel: 'mysql2:query',
        eventType: 'end',
        context: {},
        timestamp: 1012.75,
        duration: 12.25,
        operationId: 'op-001',
      },
      {
        channel: 'redis:get',
        eventType: 'asyncStart',
        context: { key: 'session:1' },
        timestamp: 2000,
        operationId: 'op-002',
      },
      {
        channel: 'redis:get',
        eventType: 'asyncEnd',
        context: {},
        timestamp: 2005,
        operationId: 'op-002',
      },
      {
        channel: 'http:request',
        eventType: 'error',
        context: { status: '500' },
        timestamp: 3000,
        duration: 150,
        operationId: 'op-003',
        error: { name: 'TimeoutError', message: 'request timed out' },
      },
    ];
    const decoded = roundTrip(events);
    expect(decoded).toEqual(events);
  });

  it('serializes the error as "name: message" and drops the stack trace', () => {
    const events: TracingEvent[] = [
      {
        channel: 'http:request',
        eventType: 'error',
        context: {},
        timestamp: 1,
        error: { name: 'TimeoutError', message: 'request timed out', stack: 'at line 1' },
      },
    ];
    const decoded = roundTrip(events);
    expect(decoded[0].error).toEqual({ name: 'TimeoutError', message: 'request timed out' });
  });

  it('round-trips an empty array', () => {
    expect(roundTrip([])).toEqual([]);
  });

  it('round-trips events without optional fields', () => {
    const events: TracingEvent[] = [
      { channel: 'fs:open', eventType: 'start', context: {}, timestamp: 42 },
    ];
    expect(roundTrip(events)).toEqual(events);
  });

  it('is smaller than the JSON equivalent', () => {
    const events: TracingEvent[] = [];
    for (let i = 0; i < 50; i++) {
      events.push({ channel: 'db:query', eventType: 'start', context: { sql: `SELECT ${i}` }, timestamp: i, operationId: `op-${i}` });
      events.push({ channel: 'db:query', eventType: 'end', context: {}, timestamp: i + 10, duration: 10, operationId: `op-${i}` });
    }
    const binary = encodeNdv(events);
    const json = new TextEncoder().encode(JSON.stringify(events));
    expect(binary.byteLength).toBeLessThan(json.byteLength);
  });

  it('decodes from an ArrayBuffer and DataView', () => {
    const events: TracingEvent[] = [
      { channel: 'x', eventType: 'start', context: {}, timestamp: 1 },
    ];
    const bytes = encodeNdv(events);
    expect(decodeNdvFromArrayBuffer(bytes.buffer)).toEqual(events);
    expect(decodeNdv(new DataView(bytes.buffer.slice(0)))).toEqual(events);
  });

  it('rejects invalid magic bytes', () => {
    const buf = new Uint8Array(64).fill(0);
    buf[0] = 0x4e; buf[1] = 0x44; buf[2] = 0x58; // NDX
    expect(() => decodeNdv(buf)).toThrow(NdvError);
    expect(() => decodeNdv(buf)).toThrow(/bad magic/);
  });

  it('rejects a truncated header', () => {
    expect(() => decodeNdv(new Uint8Array(4))).toThrow(/Truncated .ndv header/);
  });

  it('rejects an unsupported version', () => {
    const bytes = new Uint8Array(16);
    bytes[0] = 0x4e; bytes[1] = 0x44; bytes[2] = 0x56; bytes[3] = 99;
    expect(() => decodeNdv(bytes)).toThrow(/Unsupported .ndv version/);
  });
});
