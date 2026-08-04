import type { DifferentialReport, DivergencePoint } from './types';
import type { ValueDiff } from './types';

/**
 * Natural-language divergence report.
 * Summarizes the alignment health and the primary divergence in a way that
 * reads like a diagnosis: what happened, where, and what to check next.
 */

function fmtPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function diffLabel(v: ValueDiff): string {
  switch (v.change) {
    case 'added': return `${v.key} added (${JSON.stringify(v.after)})`;
    case 'removed': return `${v.key} removed (was ${JSON.stringify(v.before)})`;
    case 'changed': return `${v.key}: ${JSON.stringify(v.before)} -> ${JSON.stringify(v.after)}`;
    default: return v.key;
  }
}

function describeDivergencePoint(d: DivergencePoint): string {
  const where = d.eventDiff.normalIndex >= 0
    ? `event #${d.eventDiff.normalIndex + 1} of the normal run`
    : `event #${d.eventDiff.faultIndex + 1} of the fault run`;
  const vars = d.eventDiff.valueDiffs.length > 0
    ? ` Variables: ${d.eventDiff.valueDiffs.slice(0, 4).map(diffLabel).join('; ')}.`
    : '';
  const stack = d.eventDiff.stackDiffs.length > 0
    ? ` Stack differs at ${d.eventDiff.stackDiffs.length} frame(s).`
    : '';
  return `At ${where}, ${d.description.toLowerCase()}${vars}${stack}`;
}

function buildRecommendations(d: DivergencePoint | undefined, divergenceCount: number): string[] {
  if (!d) return ['Both runs appear structurally identical — check for timing-only or variable-order differences.'];
  const out: string[] = [];
  const kind = d.eventDiff.kind;
  const vars = d.eventDiff.valueDiffs;

  if (kind === 'error-introduced') {
    out.push(`Inspect the error raised in the fault run: "${d.eventDiff.fault?.error?.message ?? 'unknown error'}".`);
    if (d.eventDiff.stackDiffs.length) out.push('Compare the full stack traces — the differing frame is where the fault path enters.');
  }
  if (kind === 'event-missing') {
    out.push(`The fault run skipped a ${d.eventDiff.normal?.channel ?? 'unknown'} operation. Check the condition guarding it.`);
  }
  if (kind === 'event-inserted') {
    out.push(`The fault run executed an extra ${d.eventDiff.fault?.channel ?? 'unknown'} operation. Check for a duplicate call or retry.`);
  }
  if (kind === 'event-value-change') {
    const meaningful = vars.filter(v => v.change === 'changed');
    if (meaningful.length) {
      const keys = meaningful.slice(0, 3).map(v => v.key).join(', ');
      out.push(`The diverging variables (${keys}) hold different values — trace where they are assigned in the fault path.`);
    }
  }
  if (divergenceCount > 1) {
    out.push(`${divergenceCount - 1} downstream divergence(s) follow the primary one — treat them as symptoms until the cause is fixed.`);
  }
  if (out.length === 0) {
    out.push('No clear cause signature — widen the diff window around the first differing event.');
  }
  return out;
}

/** Build the natural-language report from divergences. */
export function buildReport(
  similarity: number,
  divergences: DivergencePoint[],
): DifferentialReport {
  const first = divergences[0];
  const count = divergences.length;

  const summary = count === 0
    ? `No structural divergence found. The two runs align at ${fmtPct(similarity)} similarity.`
    : `The two runs align at ${fmtPct(similarity)} similarity and diverge at ${count} point${count === 1 ? '' : 's'}. `
      + `The first divergence is a ${first!.eventDiff.kind.replace(/-/g, ' ')}.`;

  return {
    summary,
    firstDivergence: first,
    totalDivergences: count,
    similarity,
    recommendations: buildRecommendations(first, count),
  };
}
