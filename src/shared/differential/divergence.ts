import type { TracingEvent } from '../types';
import type { Alignment, AlignedPair, CauseClassification, DivergenceKind, DivergencePoint, EventDiff } from './types';
import { classifyPair, diffPair } from './diff';

/**
 * Divergence localization.
 *
 * Walks the aligned pairs and groups consecutive non-exact pairs into
 * "divergence regions". The first divergence point is the event where the two
 * executions first stop agreeing. Cause/effect classification is a heuristic:
 * the first divergence is treated as the cause; later divergences that share
 * its channel or follow it in time are usually downstream symptoms.
 */

export const DEFAULT_MIN_SIGNIFICANCE = 0.3;

export interface DivergenceOptions {
  minSignificance?: number;
  /** Treat later divergences on these channels as effects of the cause. */
  effectChannels?: string[];
}

/** Group consecutive non-'match' pairs into regions of divergence. */
export function groupDivergenceRegions(alignment: Alignment): AlignedPair[][] {
  const regions: AlignedPair[][] = [];
  let current: AlignedPair[] = [];
  for (const pair of alignment.pairs) {
    if (pair.kind === 'match') {
      if (current.length) {
        regions.push(current);
        current = [];
      }
    } else {
      current.push(pair);
    }
  }
  if (current.length) regions.push(current);
  return regions;
}

/**
 * Pick the representative pair of a region: the first pair that introduces an
 * error, otherwise the region's first pair.
 */
function representativePair(region: AlignedPair[]): AlignedPair {
  const errorPair = region.find(p => p.fault?.error && !p.normal?.error);
  return errorPair ?? region[0];
}

/** Find the earliest normal/fault event index covered by a region. */
function regionBounds(region: AlignedPair[]): { normalIndex: number; faultIndex: number } {
  let normalIndex = Infinity;
  let faultIndex = Infinity;
  for (const p of region) {
    if (p.normalIndex >= 0) normalIndex = Math.min(normalIndex, p.normalIndex);
    if (p.faultIndex >= 0) faultIndex = Math.min(faultIndex, p.faultIndex);
  }
  return {
    normalIndex: normalIndex === Infinity ? -1 : normalIndex,
    faultIndex: faultIndex === Infinity ? -1 : faultIndex,
  };
}

function classifyCause(
  region: AlignedPair[],
  isFirst: boolean,
  effectChannels: Set<string>,
): CauseClassification {
  const kind = classifyPair(region[0]);
  const firstChannel = region[0].normal?.channel ?? region[0].fault?.channel ?? '';
  const introducesError = region.some(p => p.fault?.error && !p.normal?.error);

  if (isFirst) {
    const reason = introducesError
      ? 'the first event where the fault run raises an error the normal run does not'
      : `the first event where the two runs diverge (${kind.replace(/-/g, ' ')})`;
    return { role: 'cause', reason };
  }

  // Downstream on the same channel as the cause, or an error-bearing symptom.
  if (effectChannels.has(firstChannel)) {
    return { role: 'effect', reason: 'same channel as the primary divergence — a downstream symptom' };
  }
  if (introducesError) {
    return { role: 'effect', reason: 'error surfaced downstream of the original divergence' };
  }
  if (region[0].faultIndex >= 0 && region[0].normalIndex >= 0) {
    return { role: 'ambiguous', reason: 'independent divergence not on the primary channel' };
  }
  return { role: 'ambiguous', reason: 'structural difference with unclear causality' };
}

function describeKind(kind: DivergenceKind): string {
  switch (kind) {
    case 'event-value-change': return 'an event ran with different variable values';
    case 'event-inserted': return 'the fault run executed an extra event';
    case 'event-missing': return 'the fault run skipped an event that the normal run executed';
    case 'error-introduced': return 'the fault run threw an error';
    case 'stack-change': return 'the same operation produced a different stack trace';
    case 'channel-sequence': return 'events executed in a different order';
    default: return 'the runs diverged';
  }
}

function describeEvent(event: TracingEvent | undefined, side: string): string {
  if (!event) return `${side}: (none)`;
  const ctx = event.context ?? {};
  const keys = Object.keys(ctx);
  const excerpt = keys.length > 0
    ? ` context {${keys.slice(0, 3).join(', ')}${keys.length > 3 ? ', …' : ''}}`
    : '';
  return `${side}: ${event.channel} ${event.eventType}${excerpt}`;
}

function describeDivergence(region: AlignedPair[], rep: AlignedPair): string {
  const kind = describeKind(classifyPair(rep));
  const normalSide = describeEvent(rep.normal, 'normal');
  const faultSide = describeEvent(rep.fault, 'fault');
  const extra = region.length > 1 ? ` (${region.length} consecutive differing events)` : '';
  return `${kind}${extra}. ${normalSide} vs ${faultSide}`;
}

/**
 * Find all divergence points along the alignment.
 * The first one is the primary divergence; subsequent regions are included
 * when they clear the significance threshold.
 */
export function findDivergences(
  alignment: Alignment,
  options: DivergenceOptions = {},
): DivergencePoint[] {
  const minSignificance = options.minSignificance ?? DEFAULT_MIN_SIGNIFICANCE;
  const effectChannels = new Set(options.effectChannels ?? []);
  const regions = groupDivergenceRegions(alignment);
  const points: DivergencePoint[] = [];

  // Prime effect channels from the first region so downstream symptoms classify.
  const firstRegion = regions[0];
  if (firstRegion) {
    const ch = firstRegion[0].normal?.channel ?? firstRegion[0].fault?.channel;
    if (ch) effectChannels.add(ch);
  }

  for (let r = 0; r < regions.length; r++) {
    const region = regions[r];
    const rep = representativePair(region);
    const eventDiff: EventDiff = diffPair(rep);
    if (eventDiff.significance < minSignificance) continue;

    const cause = classifyCause(region, r === 0, effectChannels);
    const bounds = regionBounds(region);
    const confidence = confidenceOf(eventDiff, region.length, r);

    points.push({
      order: points.length + 1,
      eventDiff,
      cause,
      confidence,
      significance: eventDiff.significance,
      description: describeDivergence(region, rep),
    });
  }
  return points;
}

function confidenceOf(eventDiff: EventDiff, regionSize: number, regionOrder: number): number {
  // First divergence with a structural/error signature gets high confidence.
  let base = eventDiff.significance;
  if (eventDiff.kind === 'error-introduced' || eventDiff.kind === 'event-missing') base = Math.max(base, 0.85);
  if (eventDiff.kind === 'stack-change') base = Math.max(base, 0.8);
  // A longer consistent divergence region reinforces the localization.
  const sizeBonus = Math.min(0.15, regionSize * 0.03);
  // Later regions are progressively less certain to be independent.
  const orderPenalty = Math.min(0.3, regionOrder * 0.05);
  return Math.max(0, Math.min(1, base + sizeBonus - orderPenalty));
}

/** Convenience: get only the primary (first) divergence point. */
export function findFirstDivergence(alignment: Alignment, options?: DivergenceOptions): DivergencePoint | undefined {
  return findDivergences(alignment, options)[0];
}
