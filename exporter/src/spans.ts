import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';
import { SpanStatusCode } from '@opentelemetry/api';

/**
 * NodeVerdict event shape — mirrors the browser viewer's TracingEvent.
 */
export interface TracingEvent {
  channel: string;
  eventType: 'start' | 'end' | 'asyncStart' | 'asyncEnd' | 'error';
  context: Record<string, unknown>;
  timestamp: number;
  duration?: number;
  error?: { message: string; stack?: string; name?: string };
  operationId?: string;
}

type HrTime = [seconds: number, nanos: number];

function toMs(t: Date | HrTime): number {
  if (Array.isArray(t)) return t[0] * 1000 + t[1] / 1e6;
  return t.getTime();
}

function attributeValue(v: unknown): unknown {
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object' && 'toString' in v) {
    return String((v as { toString(): string }).toString());
  }
  return v;
}

/**
 * Converts OTel spans into NodeVerdict TracingEvent[] (start/end/error pairs),
 * the format consumed by the browser Trace Viewer, Event Viewer, Validator,
 * AI-RCA, and the performance-gate CLI.
 */
export function spansToNodeVerdictEvents(spans: ReadableSpan[]): TracingEvent[] {
  const events: TracingEvent[] = [];

  for (const span of spans) {
    const channel = (span.attributes['nodeverdict.channel'] as string | undefined) ?? span.name;
    const operationId = span.spanContext().spanId ?? span.name;
    const parentSpanId = span.parentSpanId;
    const start = toMs(span.startTime);
    const end = toMs(span.endTime);
    const duration = end > start ? end - start : 0;
    const isError = span.status.code === SpanStatusCode.ERROR;

    const context: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(span.attributes)) {
      context[key] = attributeValue(value);
    }
    context.traceId = span.spanContext().traceId;
    context.spanId = span.spanContext().spanId;
    if (parentSpanId) context.parentSpanId = parentSpanId;
    if (span.status.message) context.statusMessage = span.status.message;

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
        error: {
          name: 'OTel error',
          message: span.status.message ?? 'OTel span ended with error status',
        },
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
  }

  return events.sort((a, b) => a.timestamp - b.timestamp);
}

/** Serializes events into the standard NodeVerdict TracingEvent[] JSON. */
export function eventsToJson(events: TracingEvent[]): string {
  return JSON.stringify(events, null, 2);
}

/** Serializes events into a compact OTLP/JSON trace export the browser auto-detects. */
export function eventsToOtlpJson(events: TracingEvent[], serviceName = 'node-app'): string {
  const grouped = new Map<string, TracingEvent[]>();
  for (const e of events) {
    const ch = e.channel;
    if (!grouped.has(ch)) grouped.set(ch, []);
    grouped.get(ch)!.push(e);
  }

  const spans = events.map(e => {
    const startNano = BigInt(Math.round(e.timestamp)) * 1000000n;
    const endNano = e.duration !== undefined
      ? startNano + BigInt(Math.round(e.duration)) * 1000000n
      : startNano;
    const attributes = Object.entries(e.context)
      .filter(([, v]) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
      .map(([key, value]) => ({
        key,
        value: typeof value === 'number'
          ? { doubleValue: value }
          : typeof value === 'boolean'
            ? { boolValue: value }
            : { stringValue: String(value) },
      }));
    attributes.push({ key: 'nodeverdict.channel', value: { stringValue: e.channel } });

    return {
      traceId: (e.context.traceId as string) ?? '0'.repeat(32),
      spanId: (e.operationId ?? '0'.repeat(16)).padEnd(16, '0').slice(0, 16),
      parentSpanId: (e.context.parentSpanId as string | undefined) ?? '',
      name: e.channel,
      kind: 1,
      startTimeUnixNano: startNano.toString(),
      endTimeUnixNano: endNano.toString(),
      attributes,
      status: e.eventType === 'error'
        ? { code: 2, message: e.error?.message ?? 'error' }
        : { code: 1 },
      events: [],
    };
  });

  return JSON.stringify({
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: serviceName } },
          ],
        },
        scopeSpans: [
          {
            scope: { name: 'nodeverdict-exporter', version: '1.0.0' },
            spans,
          },
        ],
      },
    ],
  });
}
