import type { TracingEvent } from '../types';
import type { Alignment, AlignedPair } from './types';
import { normalizeTrace, type NormalizedEvent } from './fingerprint';

/**
 * Execution-path alignment.
 *
 * Uses a banded dynamic-time-warping / edit-distance DP to align the "normal"
 * and "fault" event streams. The banded recurrence is O(n * band) time and
 * O(n * band) memory, so 100k-event traces align in well under a second.
 *
 * To keep the band small even when the two traces have very different lengths,
 * identical common prefixes/suffixes are trimmed first (an exact optimization
 * for Levenshtein-style distance) and only the diverging middle is aligned.
 *
 * Event distance: same fingerprint = 0 (match), same channel+type but different
 * context = 1 (value change), different channel/type = 3 (structural change).
 * Gap penalty: 2 (so a value-change substitutes cheaper than delete+insert).
 */

export const GAP = 2;
export const SUB_VALUE = 1;
export const SUB_STRUCTURE = 5;

export function eventDistance(a: NormalizedEvent, b: NormalizedEvent): number {
  if (a.fingerprint === b.fingerprint) return 0;
  if (a.signature === b.signature) return SUB_VALUE;
  return SUB_STRUCTURE;
}

/** Brute-force O(n*m) alignment used as the reference implementation. */
export function alignExact(normal: NormalizedEvent[], fault: NormalizedEvent[]): Alignment {
  const n = normal.length;
  const m = fault.length;
  const dp: number[][] = [];
  for (let i = 0; i <= n; i++) {
    dp.push(new Array<number>(m + 1).fill(Infinity));
  }
  const choice: number[][] = [];
  for (let i = 0; i <= n; i++) choice.push(new Array<number>(m + 1).fill(0));

  dp[0][0] = 0;
  for (let j = 1; j <= m; j++) {
    dp[0][j] = dp[0][j - 1] + GAP;
    choice[0][j] = 2; // insert (fault event has no normal counterpart)
  }
  for (let i = 1; i <= n; i++) {
    dp[i][0] = dp[i - 1][0] + GAP;
    choice[i][0] = 1; // delete (normal event has no fault counterpart)
  }

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const diag = dp[i - 1][j - 1] + eventDistance(normal[i - 1], fault[j - 1]);
      const del = dp[i - 1][j] + GAP;
      const ins = dp[i][j - 1] + GAP;
      if (diag <= del && diag <= ins) {
        dp[i][j] = diag;
        choice[i][j] = 0;
      } else if (del <= ins) {
        dp[i][j] = del;
        choice[i][j] = 1;
      } else {
        dp[i][j] = ins;
        choice[i][j] = 2;
      }
    }
  }

  const pairs: AlignedPair[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const c = choice[i][j];
    if (c === 0) {
      const d = eventDistance(normal[i - 1], fault[j - 1]);
      pairs.push({
        normalIndex: i - 1,
        faultIndex: j - 1,
        kind: d === 0 ? 'match' : 'substitute',
        distance: d,
        normal: normal[i - 1].event,
        fault: fault[j - 1].event,
      });
      i--;
      j--;
    } else if (c === 1) {
      pairs.push({ normalIndex: i - 1, faultIndex: -1, kind: 'delete', distance: GAP, normal: normal[i - 1].event });
      i--;
    } else {
      pairs.push({ normalIndex: -1, faultIndex: j - 1, kind: 'insert', distance: GAP, fault: fault[j - 1].event });
      j--;
    }
  }
  pairs.reverse();
  return summarize(pairs, n, m);
}

/**
 * Banded DP over the middle section after trimming common prefix/suffix.
 * `band` is the max allowed |i - j| offset. Rows are stored as fixed-width
 * arrays indexed by k = j - i + band, so each row is O(band) memory.
 */
function bandedAlign(normal: NormalizedEvent[], fault: NormalizedEvent[], band: number): AlignedPair[] {
  const n = normal.length;
  const m = fault.length;
  const width = 2 * band + 1;
  const INF = Infinity;

  let prev = new Float64Array(width).fill(INF);
  let curr = new Float64Array(width).fill(INF);
  // choice values: 0 = diag, 1 = delete (normal event), 2 = insert (fault event)
  const choices = new Uint8Array((n + 1) * width);

  // Row i = 0: only j in [0, min(m, band)] reachable; all-insert column prefix.
  const jLo0 = 0;
  const jHi0 = Math.min(m, band);
  for (let j = jLo0; j <= jHi0; j++) {
    const k = j - 0 + band;
    curr[k] = j * GAP;
    choices[0 * width + k] = 2;
  }
  prev = curr;

  for (let i = 1; i <= n; i++) {
    curr = new Float64Array(width).fill(INF);
    const jLo = Math.max(0, i - band);
    const jHi = Math.min(m, i + band);
    const prevJLo = Math.max(0, (i - 1) - band);
    const prevJHi = Math.min(m, (i - 1) + band);

    for (let j = jLo; j <= jHi; j++) {
      const k = j - i + band;
      if (j === 0) {
        // Only reachable by deleting normal events: dp(i-1, 0) + GAP.
        const upK = k + 1;
        const upValid = k + 1 < width;
        curr[k] = (upValid ? prev[upK] : INF) + GAP;
        choices[i * width + k] = 1;
        continue;
      }
      const diag = prev[k] + eventDistance(normal[i - 1], fault[j - 1]);
      const upValid = j <= prevJHi && k + 1 < width;
      const up = upValid ? prev[k + 1] + GAP : INF;
      const left = k > 0 ? curr[k - 1] + GAP : INF;
      if (diag <= up && diag <= left) {
        curr[k] = diag;
        choices[i * width + k] = 0;
      } else if (up <= left) {
        curr[k] = up;
        choices[i * width + k] = 1;
      } else {
        curr[k] = left;
        choices[i * width + k] = 2;
      }
    }
    prev = curr;
  }

  // Backtrack from (n, m).
  const pairs: AlignedPair[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const k = j - i + band;
    const c = choices[i * width + k];
    if (c === 0) {
      const d = eventDistance(normal[i - 1], fault[j - 1]);
      pairs.push({
        normalIndex: i - 1,
        faultIndex: j - 1,
        kind: d === 0 ? 'match' : 'substitute',
        distance: d,
        normal: normal[i - 1].event,
        fault: fault[j - 1].event,
      });
      i--;
      j--;
    } else if (c === 1) {
      pairs.push({ normalIndex: i - 1, faultIndex: -1, kind: 'delete', distance: GAP, normal: normal[i - 1].event });
      i--;
    } else {
      pairs.push({ normalIndex: -1, faultIndex: j - 1, kind: 'insert', distance: GAP, fault: fault[j - 1].event });
      j--;
    }
  }
  pairs.reverse();
  return pairs;
}

function summarize(pairs: AlignedPair[], n: number, m: number): Alignment {
  let cost = 0;
  let editDistance = 0;
  let matches = 0;
  for (const p of pairs) {
    cost += p.distance;
    if (p.kind === 'match') matches++;
    else editDistance++;
  }
  const denom = Math.max(1, Math.max(n, m));
  const similarity = matches / denom;
  return { pairs, similarity, editDistance, cost, matches, alignTimeMs: 0 };
}

/**
 * Align a normal and a fault trace (arrays of TracingEvent). Sorts by time,
 * trims common prefix/suffix, and runs banded DP on the middle.
 */
export function alignEvents(
  normal: TracingEvent[],
  fault: TracingEvent[],
  options: { band?: number; ignoreKeys?: Set<string> } = {},
): Alignment {
  const started = performance.now();
  const band = options.band ?? 256;
  const ignore = options.ignoreKeys;
  const norm = normalizeTrace(normal, ignore);
  const faultNorm = normalizeTrace(fault, ignore);
  return alignNormalized(norm, faultNorm, band, started);
}

/** Align already-normalized sequences (used by tests and the pipeline). */
export function alignNormalized(
  norm: NormalizedEvent[],
  fault: NormalizedEvent[],
  band: number,
  started = performance.now(),
): Alignment {
  const n = norm.length;
  const m = fault.length;
  const pairs: AlignedPair[] = [];

  // Trim common prefix (exact, in-order matches).
  let p = 0;
  while (p < n && p < m && norm[p].fingerprint === fault[p].fingerprint) {
    pairs.push({
      normalIndex: p,
      faultIndex: p,
      kind: 'match',
      distance: 0,
      normal: norm[p].event,
      fault: fault[p].event,
    });
    p++;
  }

  // Trim common suffix (exact, reverse-order matches).
  let s = 0;
  while (s < n - p && s < m - p && norm[n - 1 - s].fingerprint === fault[m - 1 - s].fingerprint) {
    s++;
  }

  const midN = norm.slice(p, n - s);
  const midF = fault.slice(p, m - s);
  if (midN.length > 0 || midF.length > 0) {
    const midBand = Math.max(band, Math.abs(midN.length - midF.length));
    const midPairs = bandedAlign(midN, midF, midBand);
    for (const pr of midPairs) {
      pairs.push({
        ...pr,
        normalIndex: pr.normalIndex >= 0 ? pr.normalIndex + p : -1,
        faultIndex: pr.faultIndex >= 0 ? pr.faultIndex + p : -1,
      });
    }
  }

  for (let t = 0; t < s; t++) {
    const i = n - 1 - t;
    const j = m - 1 - t;
    pairs.push({
      normalIndex: i,
      faultIndex: j,
      kind: 'match',
      distance: 0,
      normal: norm[i].event,
      fault: fault[j].event,
    });
  }

  const alignment = summarize(pairs, n, m);
  alignment.alignTimeMs = performance.now() - started;
  return alignment;
}
