import type { TracingEvent } from '../types';
import type { DifferentialAnalysis, DifferentialOptions } from './types';
import { alignEvents } from './align';
import { findDivergences } from './divergence';
import { buildReport } from './report';
import { DEFAULT_IGNORE_KEYS } from './fingerprint';

export { alignExact, alignEvents, alignNormalized, eventDistance, GAP } from './align';
export { findDivergences, findFirstDivergence, groupDivergenceRegions } from './divergence';
export { diffContext, diffPair, diffStacks, classifyPair, significanceOf } from './diff';
export {
  canonicalizeContext,
  canonicalizeValue,
  fingerprintEvent,
  normalizeTrace,
  sortByTime,
  DEFAULT_IGNORE_KEYS,
} from './fingerprint';
export { buildReport } from './report';
export type {
  Alignment,
  AlignedPair,
  CauseClassification,
  DifferentialAnalysis,
  DifferentialOptions,
  DifferentialReport,
  DivergenceKind,
  DivergencePoint,
  EventDiff,
  StackDiff,
  ValueDiff,
} from './types';

/** Convenience: run the whole differential pipeline on two raw event lists. */
export function analyzeDifferential(
  normal: TracingEvent[],
  fault: TracingEvent[],
  options: DifferentialOptions = {},
): DifferentialAnalysis {
  const started = performance.now();
  const ignore = new Set([...DEFAULT_IGNORE_KEYS, ...(options.ignoreKeys ?? [])]);
  const alignment = alignEvents(normal, fault, { band: options.band, ignoreKeys: ignore });
  const divergences = findDivergences(alignment, {
    minSignificance: options.minSignificance,
  });
  const report = buildReport(alignment.similarity, divergences);
  return {
    alignment,
    divergences,
    report,
    meta: {
      normalEvents: normal.length,
      faultEvents: fault.length,
      elapsedMs: performance.now() - started,
    },
  };
}
