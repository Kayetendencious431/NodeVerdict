import type { DivergencePoint } from './types';
import type { NoiseModel } from './regression-types';
import { isMasked } from './noise-model';

/**
 * Semantic-level diff filtering.
 *
 * After alignment + divergence detection we have a *noisy* list of differences.
 * Most are jitter (GC placement, timer skew, DNS) or trivial value churn that
 * does not indicate a real behavioral change. The semantic differ:
 *   1. drops divergences that fall inside a masked noise region;
 *   2. drops pure value-only substitutions (no stack change, no error, no
 *      structural edit) — these are "same code, different incidental data";
 *   3. keeps structural changes: error-introduced, stack-change, event
 *      inserted/missing (control-flow / path changes);
 *   4. normalizes the survivors into a uniform `SemanticDivergence` shape so
 *      the regression scorer can aggregate them.
 */

import type { SemanticDivergence } from './regression-types';

/** Whether a divergence kind is structural (path-changing) vs. incidental. */
export function isPathChanging(kind: string): boolean {
  switch (kind) {
    case 'error-introduced':
    case 'stack-change':
    case 'event-inserted':
    case 'event-missing':
    case 'channel-sequence':
      return true;
    case 'event-value-change':
      return false;
    default:
      return false;
  }
}

/** Drop jitter: divergences inside a mask, or incidental value-only changes. */
export function filterSemanticDivergences(
  divergences: DivergencePoint[],
  model: NoiseModel | null,
  options: { minSignificance?: number } = {},
): SemanticDivergence[] {
  const out: SemanticDivergence[] = [];
  const minSig = options.minSignificance ?? 0.3;

  for (let i = 0; i < divergences.length; i++) {
    const d = divergences[i];
    const ev = d.eventDiff;
    const normalIdx = ev.normalIndex;
    const faultIdx = ev.faultIndex;

    // 1. Drop masked (noise) divergences.
    if (model && (normalIdx >= 0 || faultIdx >= 0) && isMasked(model, normalIdx, faultIdx)) {
      continue;
    }

    const kind = ev.kind;

    // 2. Drop trivial value-only churn that never reaches significance.
    if (kind === 'event-value-change' && !isPathChanging(kind)) {
      const structuralValues = ev.valueDiffs.filter(
        (v) => !/^(timestamp|time|now|monotonic|duration|cost|latency|elapsed|bytes|count)/i.test(v.key),
      );
      if (structuralValues.length === 0 && d.significance < 0.6) {
        continue;
      }
    }

    // 3. Respect the global significance floor.
    if (d.significance < minSig) continue;

    const durationDeltaMs = durationDelta(ev);
    out.push({
      divergenceIndex: i,
      kind,
      channel: ev.fault?.channel ?? ev.normal?.channel ?? 'unknown',
      operationId: ev.fault?.operationId ?? ev.normal?.operationId,
      durationDeltaMs,
      pathChanged: isPathChanging(kind),
      impact: d.significance, // provisional; normalized later by the scorer
      significance: d.significance,
    });
  }

  return out;
}

/** Estimate a latency regression from one divergence pair, ms. */
function durationDelta(ev: { normal?: { timestamp?: number; duration?: number }; fault?: { timestamp?: number; duration?: number } }): number {
  if (ev.fault?.duration !== undefined && ev.normal?.duration !== undefined) {
    return ev.fault.duration - ev.normal.duration;
  }
  if (ev.fault?.timestamp !== undefined && ev.normal?.timestamp !== undefined) {
    return ev.fault.timestamp - ev.normal.timestamp;
  }
  return 0;
}