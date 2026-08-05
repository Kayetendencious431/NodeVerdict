import type { SemanticDivergence, ChannelRegression, RegressionScore } from './regression-types';

/**
 * Regression severity scoring.
 *
 * severity = confidence × impact.
 *   - confidence: how much of the surviving divergence set is *structural*
 *     (path/error changes) vs. incidental; 1 when every survivor changed the
 *     control flow, falling toward a floor when survivors are mostly value
 *     churn (i.e. a lot of noise slipped through the semantic filter).
 *   - impact: share of divergences weighted by their per-channel latency
 *     deltas, capped per channel so a single hot channel can't dominate.
 *
 * Both are 0..1 and the product is the final severity. This is deliberately a
 * small, deterministic function — no external model — so the result is stable
 * across runs and testable.
 */

export function scoreRegressions(
  divergences: SemanticDivergence[],
  options: { minDeltaMs?: number } = {},
): RegressionScore {
  if (divergences.length === 0) {
    return {
      severity: 0,
      confidence: 0,
      impact: 0,
      totalDeltaMs: 0,
      regressedChannels: [],
    };
  }

  const minDelta = options.minDeltaMs ?? 0;
  const channelMap = new Map<string, ChannelRegression>();

  for (const d of divergences) {
    const ch = channelMap.get(d.channel) ?? {
      channel: d.channel,
      durationDeltaMs: 0,
      divergenceCount: 0,
      errorIntroduced: d.kind === 'error-introduced',
      pathChanged: d.pathChanged,
    };
    ch.divergenceCount++;
    // Only accumulate latency deltas that clear the minimum (anti-noise).
    if (Math.abs(d.durationDeltaMs) >= minDelta) {
      ch.durationDeltaMs += d.durationDeltaMs;
    }
    if (d.kind === 'error-introduced') ch.errorIntroduced = true;
    if (d.pathChanged) ch.pathChanged = true;
    channelMap.set(d.channel, ch);
  }

  const regressedChannels = Array.from(channelMap.values())
    .filter((c) => c.durationDeltaMs !== 0 || c.errorIntroduced || c.pathChanged)
    .sort((a, b) => Math.abs(b.durationDeltaMs) - Math.abs(a.durationDeltaMs));

  // Confidence: fraction of structural survivors (path/error changes).
  const structural = divergences.filter((d) => d.pathChanged || d.kind === 'error-introduced').length;
  const confidence = Math.max(0.2, structural / divergences.length);

  // Impact: mean divergence significance × channel breadth (1..3 channels scale).
  const meanSignificance = divergences.reduce((acc, d) => acc + d.significance, 0) / divergences.length;
  const breadth = Math.min(1, regressedChannels.length / 3);
  const impact = Math.min(1, meanSignificance * (0.6 + 0.4 * breadth));

  const totalDeltaMs = regressedChannels.reduce((acc, c) => acc + c.durationDeltaMs, 0);

  return {
    severity: Math.min(1, confidence * impact),
    confidence,
    impact,
    totalDeltaMs,
    regressedChannels,
  };
}