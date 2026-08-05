/**
 * Elastic alignment & noise-suppression domain types (Deep-water 5).
 *
 * The existing `align.ts` uses a banded DP whose only noise handling is
 * `DEFAULT_IGNORE_KEYS` at fingerprint time. Two runs of identical code still
 * diverge by GC pauses, DNS/TCP setup and timer jitter — differences that are
 * *jitter*, not *regressions*. These types model that distinction so the
 * pipeline can suppress noise before scoring and only report semantic
 * regressions (latency degradation / control-flow changes).
 */

/** A category of jitter that should not be reported as a regression. */
export type NoiseKind = 'gc-pause' | 'timer-jitter' | 'network-dns' | 'tcp-handshake' | 'inter-event-gap';

/** A single masked noise region in one trace. */
export interface NoiseRegion {
  kind: NoiseKind;
  /** Inclusive event-index range within the trace's normalized array. */
  from: number;
  to: number;
  /** Human-readable reason (e.g. "mark-sweep 47ms"). */
  reason: string;
}

/** Output of noise detection for both traces. */
export interface NoiseModel {
  normal: NoiseRegion[];
  fault: NoiseRegion[];
}

/** A divergence that survived semantic filtering — a real regression signal. */
export interface SemanticDivergence {
  /** Index into the original divergence list. */
  divergenceIndex: number;
  kind: string;
  channel: string;
  operationId?: string;
  /** Negative = improved, positive = regressed (ms). */
  durationDeltaMs: number;
  /** True when the control-flow path itself changed (insert/missing/error). */
  pathChanged: boolean;
  /** 0..1 impact share within the whole divergence set. */
  impact: number;
  /** 0..1 filtered significance (noise removed). */
  significance: number;
}

/** Per-channel regression aggregate. */
export interface ChannelRegression {
  channel: string;
  durationDeltaMs: number;
  /** Number of divergences that touched this channel. */
  divergenceCount: number;
  errorIntroduced: boolean;
  pathChanged: boolean;
}

/** Final regression scorecard. */
export interface RegressionScore {
  /** 0..1 overall regression severity across the whole trace. */
  severity: number;
  /** 0..1 confidence (how much of the diff is real vs. noise). */
  confidence: number;
  /** 0..1 impact (share of operations/channels affected). */
  impact: number;
  /** Total accumulated latency regression, ms. */
  totalDeltaMs: number;
  regressedChannels: ChannelRegression[];
}

/** Options for the noise + regression pipeline. */
export interface RegressionOptions {
  /** GC pauses longer than this (ms) are treated as jitter, not regressions. */
  gcPauseThresholdMs?: number;
  /** Inter-event gaps wider than this (ms) are treated as scheduling noise. */
  gapThresholdMs?: number;
  /** Only per-channel latency deltas above this (ms) count as regressions. */
  minDeltaMs?: number;
  /** Channels treated as GC machinery (prefix-matched). */
  gcChannels?: string[];
  /** Channels treated as timer machinery (prefix-matched). */
  timerChannels?: string[];
  /** Channels treated as network/DNS setup (prefix-matched). */
  networkChannels?: string[];
}