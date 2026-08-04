import type { TracingEvent } from '../types';

/**
 * Fingerprinting / normalization for differential debugging.
 *
 * Two executions of the same code produce near-identical event streams except
 * for timestamp drift (GC pauses, timer jitter) and run-specific identifiers.
 * `fingerprintEvent` produces a structural signature that ignores those, so
 * the alignment can line up events that only differ by timing.
 */

/** Context keys that are inherently run-specific and ignored by default. */
export const DEFAULT_IGNORE_KEYS = new Set<string>([
  'timestamp',
  'time',
  'now',
  'hrtime',
  'monotonicTime',
  'requestId',
  'request.id',
  'traceId',
  'trace.id',
  'spanId',
  'span.id',
  'sessionId',
  'correlationId',
]);

/**
 * Canonicalize a context value to a stable string. Objects/arrays are sorted
 * by key and nested values are stringified deterministically. Numbers get a
 * precision cap so 0.30000000000000004 and 0.3 compare equal.
 */
export function canonicalizeValue(value: unknown, depth = 0): string {
  if (depth > 8) return '[deep]';
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'undefined') return 'undefined';
  if (t === 'boolean' || t === 'string') return `${t}:${JSON.stringify(value)}`;
  if (t === 'number') {
    if (Number.isNaN(value as number)) return 'number:NaN';
    if (!Number.isFinite(value as number)) return `number:${String(value)}`;
    const rounded = Math.round((value as number) * 1e4) / 1e4;
    return `number:${rounded}`;
  }
  if (Array.isArray(value)) {
    return `array:[${value.map(v => canonicalizeValue(v, depth + 1)).join(',')}]`;
  }
  if (t === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const inner = keys.map(k => `${JSON.stringify(k)}:${canonicalizeValue(obj[k], depth + 1)}`).join(',');
    return `object:{${inner}}`;
  }
  return `${t}:${String(value)}`;
}

/**
 * Canonicalize a whole event context into a deterministic key-value string,
 * dropping ignored (run-specific) keys.
 */
export function canonicalizeContext(context: Record<string, unknown> | undefined, ignoreKeys?: Set<string>): string {
  if (!context || typeof context !== 'object') return '{}';
  const keys = Object.keys(context).sort();
  const parts: string[] = [];
  for (const key of keys) {
    if (ignoreKeys?.has(key)) continue;
    const value = context[key];
    if (value === undefined || value === null) continue;
    parts.push(`${JSON.stringify(key)}:${canonicalizeValue(value)}`);
  }
  return parts.length ? `{${parts.join(',')}}` : '{}';
}

/**
 * Structural signature of an event: channel + eventType. Two events can only
 * be aligned when these match (they represent the same code location).
 */
export function signatureOf(event: TracingEvent): string {
  return `${event.channel}|${event.eventType}`;
}

/**
 * Full fingerprint: channel + eventType + canonicalized context. Timing and
 * run-specific fields are excluded so that identical work across two runs
 * produces identical fingerprints.
 */
export function fingerprintEvent(event: TracingEvent, ignoreKeys?: Set<string>): string {
  const ctx = canonicalizeContext(event.context, ignoreKeys ?? DEFAULT_IGNORE_KEYS);
  return `${event.channel}|${event.eventType}|${ctx}`;
}

/** Stable sort of a trace by timestamp, ties broken by channel name. */
export function sortByTime(events: TracingEvent[]): TracingEvent[] {
  return [...events].sort((a, b) =>
    a.timestamp - b.timestamp || a.channel.localeCompare(b.channel));
}

export interface NormalizedEvent {
  /** Original event (timestamp preserved for display). */
  event: TracingEvent;
  /** Time delta from the first event in the trace (ms). */
  relTime: number;
  signature: string;
  fingerprint: string;
}

/**
 * Normalize a raw trace: validate, sort by time, drop events with no channel,
 * and precompute relative time + fingerprints for the whole sequence.
 */
export function normalizeTrace(events: TracingEvent[], ignoreKeys?: Set<string>): NormalizedEvent[] {
  const ignore = ignoreKeys ?? DEFAULT_IGNORE_KEYS;
  const valid = events
    .filter(e => e && typeof e.channel === 'string' && e.channel !== '' && typeof e.timestamp === 'number')
    .sort((a, b) => a.timestamp - b.timestamp || a.channel.localeCompare(b.channel));
  if (valid.length === 0) return [];
  const t0 = valid[0].timestamp;
  return valid.map(event => ({
    event,
    relTime: event.timestamp - t0,
    signature: signatureOf(event),
    fingerprint: fingerprintEvent(event, ignore),
  }));
}
