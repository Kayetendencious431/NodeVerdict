/**
 * Causal graph domain types for the Streaming Causal Graph Reconstruction
 * engine (Deep-water 1).
 *
 * A causal graph models *why* events happen, not just *when*. It reconstructs a
 * DAG from `TracingEvent`s whose async links are often broken (missing
 * parent ids), out-of-order (async completion arriving late), or cross-process
 * (only correlatable via W3C traceparent). Edges carry a confidence score so
 * downstream consumers (RCA, diff) can down-weight speculative links.
 */

/** Confidence of an inferred causal relation. */
export type EdgeConfidence = 'high' | 'medium' | 'low';

/** Why an edge was created. */
export type EdgeKind =
  /** Explicit parent id on the child context (highest trust). */
  | 'explicit-parent'
  /** asyncId of one op == triggerAsyncId of another op. */
  | 'async-context'
  /** Start/end ranges nest (interval containment), inferred with a stack. */
  | 'containment'
  /** Same operation chain but events arrived out of chronological order. */
  | 'out-of-order'
  /** Synthesized: a missing ancestor was back-filled as a virtual node. */
  | 'gap-healed';

/** A vertex in the causal graph. */
export interface CausalNode {
  /** Stable id (usually the operationId). */
  id: string;
  /** Channel label, when the node corresponds to a real operation. */
  channel?: string;
  opId?: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  status: 'success' | 'error' | 'incomplete' | 'virtual';
  /** Virtual nodes are placeholders healed across gaps (not real operations). */
  virtual: boolean;
  /** True when this node was orphaned (parent missing / event broken). */
  orphan: boolean;
  /** Failed the DAG invariant — lies on a detected cycle. */
  cyclic: boolean;
  metadata: Record<string, unknown>;
}

/** A directed causal edge child <- parent (parent caused / enabled child). */
export interface CausalEdge {
  parentId: string;
  childId: string;
  kind: EdgeKind;
  confidence: EdgeConfidence;
}

/** A reconstructed cycle within the graph (should not exist in a valid DAG). */
export interface CausalCycle {
  /** Ordered node ids forming the cycle, repeated at the join point. */
  path: string[];
  /** Nodes involved in the cycle. */
  nodeIds: string[];
}

/** Overall result of one causal-graph build. */
export interface CausalGraph {
  nodes: CausalNode[];
  edges: CausalEdge[];
  cycles: CausalCycle[];
  rootIds: string[];
  /** Ratio of edges that were healed (virtual) — a structural-health signal. */
  gapHealCount: number;
  orphanCount: number;
  /** Aggregate confidence histogram for post-processing. */
  confidenceCounts: Record<EdgeConfidence, number>;
}