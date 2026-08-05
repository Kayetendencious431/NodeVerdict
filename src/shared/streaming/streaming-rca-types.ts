/**
 * Real-time Streaming RCA domain types (Deep-water 6).
 *
 * The RCA engine must work on a trace that is still arriving: it evaluates a
 * *partial* causal DAG, so every verdict is provisional. We model that
 * explicitly with a confidence score that rises as (a) the suspect span's
 * operation closes, and (b) more sibling/base evidence accumulates in the
 * sliding window.
 */

/** Why a node is suspected as a root cause. */
export type StreamingSignal =
  | 'incomplete-open-span' // span is still open; anomalous but unclosed
  | 'latency-spike'        // recent-window mean >> global baseline
  | 'error-rate-spike'     // recent error fraction >> global baseline
  | 'high-error-count';

/** A single live root-cause hypothesis, ordered by score descending. */
export interface StreamingFinding {
  /** operationId (or virtual id) of the suspect node. */
  nodeId: string;
  channel: string;
  /** 0..1 combined anomaly + blame score (higher = more likely root cause). */
  score: number;
  /** Which signals fired for this node. */
  signals: StreamingSignal[];
  /** Whether the node's span is closed (paired end seen) or still open. */
  open: boolean;
  /**
   * 0..1. Reduced while the span is open or while the window is sparse, so a
   * premature verdict is never presented as certain.
   */
  confidence: number;
  /** Recent-window vs baseline ratio (latency dimension). */
  latencyRatio: number;
  /** Global (all-time) baseline mean this is compared against. */
  baselineMs: number;
  /** Recent-window mean duration. */
  windowMeanMs: number;
  /** Recent-window error fraction. */
  windowErrorRate: number;
}

/** A coarse early-warning generated before a precise verdict is possible. */
export interface EarlyWarning {
  channel: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  windowMeanMs: number;
  baselineMs: number;
  ratio: number;
  confidence: number;
}

/** Snapshot of the streaming RCA state at some instant. */
export interface StreamingRcaReport {
  /** Ranked root-cause hypotheses (descending score). */
  findings: StreamingFinding[];
  /** Coarse warnings, independent of the causal graph. */
  earlyWarnings: EarlyWarning[];
  /** Number of operations whose spans are still open (incomplete). */
  openSpanCount: number;
  /** Root cause is only trustworthy once a minimum of closed evidence exists. */
  overallConfidence: number;
  /** Time of this snapshot. */
  now: number;
}

/** Configuration for the streaming RCA engine. */
export interface StreamingRcaOptions {
  /** Only the most recent `windowMs` of samples count as "recent". */
  windowMs?: number;
  /** A window must contain at least this many samples to raise an anomaly. */
  minSamples?: number;
  /** Recent mean at this multiple of baseline triggers a latency anomaly. */
  latencyFactor?: number;
  /** Recent error fraction must exceed baseline by at least this absolute margin. */
  errorMargin?: number;
  /** Per-channel cap on retained duration samples (ring buffer bound). */
  sampleCap?: number;
  /** Confidence multiplier applied while a suspect span is still open. */
  openSpanPenalty?: number;
}