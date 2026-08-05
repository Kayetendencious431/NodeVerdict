import type { TracingEvent } from '../types';
import type { DifferentialAnalysis, DifferentialOptions } from './types';
import { alignEvents } from './align';
import { findDivergences } from './divergence';
import { buildReport } from './report';
import { DEFAULT_IGNORE_KEYS, normalizeTrace } from './fingerprint';
import { buildNoiseModel } from './noise-model';
import { filterSemanticDivergences } from './semantic-differ';
import { scoreRegressions } from './regression-scoring';
import type { RegressionOptions, RegressionScore } from './regression-types';

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
export { buildNoiseModel, detectNoiseInTrace, isMasked } from './noise-model';
export { filterSemanticDivergences, isPathChanging } from './semantic-differ';
export { scoreRegressions } from './regression-scoring';
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
export type {
  NoiseKind,
  NoiseModel,
  NoiseRegion,
  SemanticDivergence,
  ChannelRegression,
  RegressionScore,
  RegressionOptions,
} from './regression-types';

/**
 * Convenience: run the whole differential pipeline on two raw event lists.
 *
 * When `options.regression` is provided, the pipeline additionally runs the
 * noise model + semantic filter + regression scorer and attaches the scorecard.
 * Without it, behaviour is identical to the original pipeline (backward
 * compatible).
 */
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

  let regression: RegressionScore | undefined;
  if (options.regression) {
    const noise = buildNoiseModel(normalizeTrace(normal, ignore), normalizeTrace(fault, ignore), options.regression);
    const semantic = filterSemanticDivergences(divergences, noise, {
      minSignificance: options.minSignificance,
    });
    regression = scoreRegressions(semantic, options.regression);
  }

  return {
    alignment,
    divergences,
    report,
    regression,
    meta: {
      normalEvents: normal.length,
      faultEvents: fault.length,
      elapsedMs: performance.now() - started,
    },
  };
}