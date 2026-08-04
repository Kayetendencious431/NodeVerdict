/**
 * Distributed tracing / service-topology domain types.
 * Used by the Topology feature to model cross-service traces, build the
 * service dependency graph, and run root-cause localization algorithms.
 */

export type ServiceHealth = 'healthy' | 'warning' | 'faulty';

export type HealthSignal = 'latency' | 'error' | 'throughput';

/** A single span reconstructed from paired operations, grouped into a trace tree. */
export interface DistSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  serviceName: string;
  name: string;
  /** OTel span kind: 1 internal, 2 server, 3 client, 4 producer, 5 consumer. */
  kind?: number;
  /** Raw (uncorrected) wall-clock start in ms. */
  startTime: number;
  /** Raw (uncorrected) wall-clock end in ms. */
  endTime: number;
  duration: number;
  error: boolean;
  errorMessage?: string;
  attributes: Record<string, unknown>;
  /** Clock-skew-corrected start/end (Lamport-adjusted logical clocks). */
  adjustedStart?: number;
  adjustedEnd?: number;
  children: DistSpan[];
  depth: number;
}

/** A single trace: root spans (forest roots) plus flat lookup. */
export interface DistTrace {
  traceId: string;
  roots: DistSpan[];
  spans: DistSpan[];
  startTime: number;
  endTime: number;
  /** Total clock correction applied (ms) — a measure of skew severity. */
  skewCorrectionMs: number;
  corrected: boolean;
}

/** A node in the aggregated service dependency graph. */
export interface ServiceNode {
  id: string;
  serviceName: string;
  /** Spans attributed to this service (calls it received/executed). */
  callCount: number;
  /** Distinct traces this service participated in. */
  traceCount: number;
  avgDuration: number;
  p50Duration: number;
  p95Duration: number;
  p99Duration: number;
  maxDuration: number;
  errorCount: number;
  errorRate: number;
  /** Fraction of traces in which this service sits on the critical path. */
  criticality: number;
  /** Combined anomaly score 0..1 (root-cause ranking signal). */
  anomalyScore: number;
  /** Personalized PageRank blame score 0..1. */
  blameScore: number;
  health: ServiceHealth;
  primarySignal: HealthSignal;
}

/** A directed call edge between two services (caller -> callee). */
export interface ServiceEdge {
  id: string;
  source: string;
  target: string;
  /** How often the caller invoked the callee. */
  callCount: number;
  /** Callee-side latency aggregated across calls. */
  avgDuration: number;
  p50Duration: number;
  p95Duration: number;
  errorCount: number;
  errorRate: number;
  kind: 'sync' | 'async';
}

/** The full aggregated service dependency graph. */
export interface TopologyGraph {
  nodes: ServiceNode[];
  edges: ServiceEdge[];
  traces: number;
  services: number;
  timeRange: { start: number; end: number };
}

/** A node along a trace's critical (longest-duration) path. */
export interface CriticalPathNode {
  traceId: string;
  spanId: string;
  serviceName: string;
  spanName: string;
  startTime: number;
  endTime: number;
  duration: number;
  error: boolean;
}

/** One step in the causal "A -> B -> C" cascade chain. */
export interface CascadeStep {
  service: string;
  signal: HealthSignal;
  impact: number;
  symptom: string;
  evidence: string;
}

/** Ranked root-cause candidate. */
export interface RankedService {
  service: string;
  score: number;
  primarySignal: HealthSignal;
  evidence: string[];
}

/** Final root-cause analysis output. */
export interface RootCauseReport {
  rootCause: { service: string; confidence: number; evidence: string[] };
  ranked: RankedService[];
  criticalPaths: CriticalPathNode[][];
  cascade: CascadeStep[];
  recommendations: string[];
}
