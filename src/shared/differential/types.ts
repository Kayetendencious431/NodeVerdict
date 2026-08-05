/**
 * Differential Debug domain types.
 *
 * Compares two execution traces of the same code path (a "normal" run and a
 * "fault" run), aligns them, and locates the first divergence point plus the
 * event/stack/variable differences around it. Mirrors the distributed engine
 * layout: types / fingerprint / align / diff / divergence / report.
 */

import type { TracingEvent } from '../types';
import type { RegressionOptions, RegressionScore } from './regression-types';

/** One element of the alignment: a matched pair or an unpaired event. */
export interface AlignedPair {
  /** Index into the normal trace (-1 when the fault event has no normal counterpart). */
  normalIndex: number;
  /** Index into the fault trace (-1 when the normal event has no fault counterpart). */
  faultIndex: number;
  /** Edit kind of this element. */
  kind: 'match' | 'substitute' | 'insert' | 'delete';
  /** Pairwise cost used by the alignment (0 = structurally identical). */
  distance: number;
  normal?: TracingEvent;
  fault?: TracingEvent;
}

/** Result of aligning the two traces. */
export interface Alignment {
  pairs: AlignedPair[];
  /** Normalized similarity 0..1 (1 = structurally identical). */
  similarity: number;
  /** Number of insert + delete + substitute edits. */
  editDistance: number;
  /** Cumulative alignment cost. */
  cost: number;
  /** Number of exact-match pairs. */
  matches: number;
  /** Wall-clock time spent aligning, ms. */
  alignTimeMs: number;
}

/** What kind of difference a divergence represents. */
export type DivergenceKind =
  | 'event-value-change'
  | 'event-inserted'
  | 'event-missing'
  | 'error-introduced'
  | 'stack-change'
  | 'channel-sequence';

/** A single variable-level difference inside one event pair. */
export interface ValueDiff {
  key: string;
  before?: unknown;
  after?: unknown;
  change: 'added' | 'removed' | 'changed';
}

/** A single stack-frame difference (line-level) between two error stacks. */
export interface StackDiff {
  /** Frame index from the top of the stack. */
  level: number;
  before?: string;
  after?: string;
}

/** Event-level diff for one aligned pair. */
export interface EventDiff {
  kind: DivergenceKind;
  normalIndex: number;
  faultIndex: number;
  normal?: TracingEvent;
  fault?: TracingEvent;
  valueDiffs: ValueDiff[];
  stackDiffs: StackDiff[];
  /** How significant this single divergence is, 0..1. */
  significance: number;
}

/** Is the divergence a root cause or a downstream symptom? */
export interface CauseClassification {
  role: 'cause' | 'effect' | 'ambiguous';
  reason: string;
}

/** A localized divergence point between the two executions. */
export interface DivergencePoint {
  /** 1-based ordering of divergence points along the aligned trace. */
  order: number;
  eventDiff: EventDiff;
  cause: CauseClassification;
  /** Confidence that this is the real first divergence, 0..1. */
  confidence: number;
  /** 0..1 significance. */
  significance: number;
  /** Human-readable description. */
  description: string;
}

/** Natural-language report built from the divergence analysis. */
export interface DifferentialReport {
  summary: string;
  firstDivergence?: DivergencePoint;
  totalDivergences: number;
  similarity: number;
  recommendations: string[];
}

/** Options for the differential analysis pipeline. */
export interface DifferentialOptions {
  /** DTW bandwidth (cells per row on each side of the diagonal). */
  band?: number;
  /** Insert/delete gap penalty. */
  gap?: number;
  /** Context keys to ignore while fingerprinting (run-specific noise). */
  ignoreKeys?: string[];
  /** Minimum significance for a divergence to be reported. */
  minSignificance?: number;
  /** Enable the noise model + semantic filter + regression scorer. */
  regression?: RegressionOptions;
}

/** Full differential analysis output. */
export interface DifferentialAnalysis {
  alignment: Alignment;
  divergences: DivergencePoint[];
  report: DifferentialReport;
  /** Present when `regression` was requested — the regression scorecard. */
  regression?: RegressionScore;
  meta: {
    normalEvents: number;
    faultEvents: number;
    elapsedMs: number;
  };
}
