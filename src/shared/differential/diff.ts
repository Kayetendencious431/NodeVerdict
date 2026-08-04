import type { TracingEvent } from '../types';
import type { AlignedPair, DivergenceKind, EventDiff, StackDiff, ValueDiff } from './types';
import { canonicalizeValue } from './fingerprint';

/**
 * Three-level diff for a single aligned pair (or unpaired event):
 *   1. event level  — what kind of divergence (inserted/missing/value/error/stack)
 *   2. stack level  — line-by-line diff of error stack traces
 *   3. variable level — per-key context value differences (added/removed/changed)
 */

/** Split an error stack into normalized lines (trim, drop blank). */
function stackLines(error: { stack?: string } | undefined): string[] {
  if (!error?.stack) return [];
  return error.stack.split('\n').map(l => l.trim()).filter(l => l.length > 0);
}

/** Line-level stack diff; returns frames where the two stacks differ. */
export function diffStacks(normal?: TracingEvent, fault?: TracingEvent): StackDiff[] {
  const a = stackLines(normal?.error);
  const b = stackLines(fault?.error);
  const maxLen = Math.max(a.length, b.length);
  const out: StackDiff[] = [];
  for (let i = 0; i < maxLen; i++) {
    const before = a[i];
    const after = b[i];
    if (before === after) continue;
    out.push({ level: i, before, after });
  }
  return out;
}

/** Deep-ish equality used to decide whether a value "changed". */
function valuesEqual(a: unknown, b: unknown): boolean {
  return canonicalizeValue(a) === canonicalizeValue(b);
}

/** Per-key context diff between two events. */
export function diffContext(normal?: TracingEvent, fault?: TracingEvent): ValueDiff[] {
  const out: ValueDiff[] = [];
  const a = normal?.context ?? {};
  const b = fault?.context ?? {};
  const keys = new Set<string>([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const hasA = Object.prototype.hasOwnProperty.call(a, key);
    const hasB = Object.prototype.hasOwnProperty.call(b, key);
    if (hasA && !hasB) {
      out.push({ key, before: a[key], change: 'removed' });
    } else if (!hasA && hasB) {
      out.push({ key, after: b[key], change: 'added' });
    } else if (!valuesEqual(a[key], b[key])) {
      out.push({ key, before: a[key], after: b[key], change: 'changed' });
    }
  }
  return out;
}

/** Classify a single aligned pair into a divergence kind. */
export function classifyPair(pair: AlignedPair): DivergenceKind {
  if (pair.fault?.error && !pair.normal?.error) return 'error-introduced';
  if (pair.kind === 'insert') return 'event-inserted';
  if (pair.kind === 'delete') return 'event-missing';
  if (pair.kind === 'substitute') {
    const stacks = diffStacks(pair.normal, pair.fault);
    if (stacks.length > 0) return 'stack-change';
    return 'event-value-change';
  }
  return 'event-value-change';
}

/** Build a full EventDiff for one aligned pair. */
export function diffPair(pair: AlignedPair): EventDiff {
  const valueDiffs = diffContext(pair.normal, pair.fault);
  const stackDiffs = diffStacks(pair.normal, pair.fault);
  const kind = classifyPair(pair);
  return {
    kind,
    normalIndex: pair.normalIndex,
    faultIndex: pair.faultIndex,
    normal: pair.normal,
    fault: pair.fault,
    valueDiffs,
    stackDiffs,
    significance: significanceOf(kind, valueDiffs.length, stackDiffs.length),
  };
}

/** Heuristic 0..1 significance score for a divergence kind. */
export function significanceOf(kind: DivergenceKind, valueCount = 0, stackCount = 0): number {
  switch (kind) {
    case 'error-introduced':
      return 1;
    case 'stack-change':
      return 0.9;
    case 'event-missing':
    case 'event-inserted':
      return 0.8;
    case 'event-value-change': {
      // Few trivial value changes are low-significance; many or structural ones matter.
      if (valueCount >= 3) return 0.7;
      if (valueCount === 0 && stackCount === 0) return 0.3;
      return 0.5;
    }
    case 'channel-sequence':
      return 0.75;
    default:
      return 0.5;
  }
}
