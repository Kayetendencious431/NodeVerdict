import type { NormalizedEvent } from './fingerprint';
import type { NoiseKind, NoiseModel, NoiseRegion, RegressionOptions } from './regression-types';

/**
 * Jitter noise model.
 *
 * Identifies regions of a normalized trace that are *scheduling jitter* rather
 * than *semantic change*:
 *   - GC pauses — long windows owned by a GC channel, or a wide inter-event gap
 *     while the previous operation was a GC/timer op.
 *   - timer jitter — `timers`/`node:timers` machinery whose latency varies run
 *     to run without the program changing.
 *   - DNS / TCP setup — `dns:lookup`, `net` connect handshakes whose cost is
 *     environmental.
 *   - inter-event gaps — wide idle gaps between two adjacent events (event-loop
 *     stalls, OS scheduling) with no operation spanning them.
 *
 * The mask is per-trace (a normal run's GC placement differs from a fault
 * run's), so callers apply it to the divergence analysis rather than to a
 * shared alignment.
 */

function prefixOf(channel: string, prefixes: string[]): boolean {
  return prefixes.some((p) => channel.startsWith(p));
}

function kindForChannel(channel: string, options: RegressionOptions): NoiseKind | undefined {
  if (prefixOf(channel, options.gcChannels ?? ['node:v8.gc', 'v8.gc', 'gc:'])) return 'gc-pause';
  if (prefixOf(channel, options.timerChannels ?? ['timer', 'node:timers', 'timers'])) return 'timer-jitter';
  if (prefixOf(channel, options.networkChannels ?? ['dns', 'net:', 'node:net', 'tcp', 'http.get', 'dns.lookup'])) {
    return channel.startsWith('dns') ? 'network-dns' : 'tcp-handshake';
  }
  return undefined;
}

/** Estimate a region's duration from its endpoints (event relTime). */
function regionDuration(events: NormalizedEvent[], from: number, to: number): number {
  const start = events[from]?.relTime ?? 0;
  const end = events[to]?.relTime ?? start;
  return Math.max(0, end - start);
}

/**
 * Scan one normalized trace for noise regions. Events are assumed sorted by
 * relTime (as produced by `normalizeTrace`).
 */
export function detectNoiseInTrace(
  events: NormalizedEvent[],
  options: RegressionOptions = {},
): NoiseRegion[] {
  if (events.length < 2) return [];
  const regions: NoiseRegion[] = [];
  const gapThreshold = options.gapThresholdMs ?? 50;
  const gcPauseThreshold = options.gcPauseThresholdMs ?? 15;

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const kind = kindForChannel(ev.signature, options);

    if (kind === 'gc-pause') {
      // A GC event pair spans until the next non-GC event (or a bounded lookahead).
      let j = i;
      while (j + 1 < events.length && kindForChannel(events[j + 1].signature, options) === 'gc-pause') j++;
      const dur = regionDuration(events, i, j);
      if (dur >= gcPauseThreshold) {
        regions.push({
          kind: 'gc-pause',
          from: i,
          to: j,
          reason: `${events[i].signature} pause ~${dur.toFixed(0)}ms`,
        });
      }
      i = j;
      continue;
    }

    // Wide inter-event gap: previous event ended long before the next began.
    if (i > 0) {
      const prev = events[i - 1];
      const gap = ev.relTime - prev.relTime;
      if (gap > gapThreshold) {
        // Only treat as noise when the previous op is *done* (end/asyncEnd/error)
        // — an idle stretch between two completed operations is scheduling jitter.
        const prevType = prev.event.eventType;
        if (prevType === 'end' || prevType === 'asyncEnd' || prevType === 'error') {
          regions.push({
            kind: 'inter-event-gap',
            from: i - 1,
            to: i,
            reason: `idle ${gap.toFixed(0)}ms between ${prev.signature} and ${ev.signature}`,
          });
          continue;
        }
      }
    }

    if (kind === 'timer-jitter' || kind === 'network-dns' || kind === 'tcp-handshake') {
      // Group consecutive same-kind setup events; short windows are noise.
      let j = i;
      while (j + 1 < events.length && kindForChannel(events[j + 1].signature, options) === kind) j++;
      regions.push({
        kind,
        from: i,
        to: j,
        reason: `${events[i].signature} setup`,
      });
      i = j;
    }
  }

  return regions;
}

/** Detect noise in both traces. */
export function buildNoiseModel(
  normal: NormalizedEvent[],
  fault: NormalizedEvent[],
  options: RegressionOptions = {},
): NoiseModel {
  return {
    normal: detectNoiseInTrace(normal, options),
    fault: detectNoiseInTrace(fault, options),
  };
}

/**
 * Does a divergence at `normalIndex`/`faultIndex` fall inside a masked region?
 * Used by the semantic differ to drop divergences that live in jitter.
 */
export function isMasked(
  model: NoiseModel,
  normalIndex: number,
  faultIndex: number,
): boolean {
  for (const r of model.normal) {
    if (normalIndex >= r.from && normalIndex <= r.to) return true;
  }
  for (const r of model.fault) {
    if (faultIndex >= r.from && faultIndex <= r.to) return true;
  }
  return false;
}