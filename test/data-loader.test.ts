import { describe, it, expect } from 'vitest';
import {
  detectTraceFormat,
  loadTracingData,
  loadNdvBuffer,
  loadAndAnalyzeTrace,
} from '../src/shared/engine';
import { encodeNdv } from '../src/shared/engine';
import type { TracingEvent } from '../src/shared/types';

const EVENTS: TracingEvent[] = [
  { channel: 'http:request', eventType: 'start', context: {}, timestamp: 0, operationId: 'a' },
  { channel: 'http:request', eventType: 'end', context: {}, timestamp: 5, duration: 5, operationId: 'a' },
];

const OTEL = JSON.stringify({
  resourceSpans: [{
    scopeSpans: [{
      spans: [{ name: 'svc', startTimeUnixNano: '1000000', endTimeUnixNano: '2000000' }],
    }],
  }],
});

describe('data-loader', () => {
  it('detects the NodeVerdict event array format', () => {
    expect(detectTraceFormat(JSON.stringify(EVENTS))).toBe('nodeverdict');
  });

  it('detects the OTel export format', () => {
    expect(detectTraceFormat(OTEL)).toBe('otel');
  });

  it('detects the .ndv format marker', () => {
    expect(detectTraceFormat('{"format":"ndv"}')).toBe('ndv');
  });

  it('throws a friendly error on invalid JSON', () => {
    expect(() => detectTraceFormat('{nope')).toThrow('File is not valid JSON');
  });

  it('strips a UTF-8 BOM before parsing', () => {
    const bom = '\uFEFF' + JSON.stringify(EVENTS);
    expect(detectTraceFormat(bom)).toBe('nodeverdict');
    expect(loadTracingData(bom)).toEqual(EVENTS);
  });

  it('loads a plain event array', () => {
    expect(loadTracingData(JSON.stringify(EVENTS))).toEqual(EVENTS);
  });

  it('loads and converts OTel JSON', () => {
    const events = loadTracingData(OTEL);
    expect(events).toHaveLength(2);
    expect(events[0].eventType).toBe('start');
  });

  it('rejects .ndv JSON input with a pointer to the binary importer', () => {
    expect(() => loadTracingData('{"format":"ndv"}')).toThrow(/\.ndv importer/);
  });

  it('rejects malformed arrays', () => {
    expect(() => loadTracingData('[{"foo":1}]')).toThrow('Unrecognized trace format');
  });

  it('loads a .ndv binary buffer', () => {
    const buffer = encodeNdv(EVENTS);
    expect(loadNdvBuffer(buffer.buffer as ArrayBuffer)).toEqual(EVENTS);
  });

  it('loadAndAnalyzeTrace returns events and format', async () => {
    const result = await loadAndAnalyzeTrace(JSON.stringify(EVENTS));
    expect(result.format).toBe('nodeverdict');
    expect(result.events).toEqual(EVENTS);
  });
});
