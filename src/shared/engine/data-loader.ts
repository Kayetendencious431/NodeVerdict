import type { TracingEvent } from '../types';
import { isOtelExport, convertOtelToTracingEvents } from './otel-adapter';
import { decodeNdv } from './ndv-codec';

/**
 * Unified trace data loader.
 * Accepts a plain NodeVerdict TracingEvent[] JSON, an OpenTelemetry export JSON
 * (OTLP/JSON, flat spans, or jaeger-style), or a .ndv binary buffer, and
 * normalizes all of them into TracingEvent[]. Throws on malformed input.
 */

function stripBom(content: string): string {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}

export type TraceFormat = 'nodeverdict' | 'otel' | 'ndv';

export function detectTraceFormat(content: string): TraceFormat {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripBom(content));
  } catch {
    throw new Error('File is not valid JSON');
  }

  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.format === 'string' && obj.format === 'ndv') return 'ndv';
    if (isOtelExport(obj)) return 'otel';
  }
  return 'nodeverdict';
}

function isEventArray(value: unknown): value is TracingEvent[] {
  if (!Array.isArray(value)) return false;
  if (value.length === 0) return true;
  const first = value[0] as TracingEvent | undefined;
  return !!first && typeof first === 'object'
    && typeof first.channel === 'string'
    && typeof first.eventType === 'string'
    && typeof first.timestamp === 'number';
}

/** Parses trace content into TracingEvent[] regardless of source format. */
export function loadTracingData(content: string): TracingEvent[] {
  const cleaned = stripBom(content);
  const format = detectTraceFormat(cleaned);

  if (format === 'ndv') {
    throw new Error('This file uses the .ndv format which requires binary decoding. Please use the .ndv file upload option.');
  }

  const parsed = JSON.parse(cleaned) as unknown;

  if (format === 'otel') {
    return convertOtelToTracingEvents(parsed as Record<string, unknown>);
  }

  if (!isEventArray(parsed)) {
    throw new Error('Unrecognized trace format. Expected a TracingEvent[] array or an OpenTelemetry export.');
  }
  return parsed;
}

/** Decodes a .ndv binary buffer into tracing events. */
export function loadNdvBuffer(buffer: ArrayBuffer): TracingEvent[] {
  return decodeNdv(buffer);
}

/** Convenience: analyze any supported trace source in one call. */
export async function loadAndAnalyzeTrace(
  content: string,
): Promise<{ events: TracingEvent[]; format: TraceFormat }> {
  const events = loadTracingData(content);
  const format = events.length > 0 && isOtelExport(JSON.parse(stripBom(content))) ? 'otel' : 'nodeverdict';
  return { events, format };
}
