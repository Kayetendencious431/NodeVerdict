/** V8 Heap Snapshot node types */
export type HeapNodeType =
  | 'hidden' | 'array' | 'string' | 'object' | 'code'
  | 'closure' | 'regexp' | 'number' | 'native' | 'synthetic'
  | 'concatenated-string' | 'sliced-string' | 'symbol' | 'bigint';

export interface HeapNode {
  id: number;
  name: string;
  type: HeapNodeType;
  selfSize: number;
  retainedSize: number;
  children: number[];
  edges: number;
}

export interface HeapEdge {
  type: 'property' | 'element' | 'internal' | 'hidden' | 'weak';
  name: string;
  fromNode: number;
  toNode: number;
}

export interface HeapSnapshot {
  nodes: HeapNode[];
  edges: HeapEdge[];
  strings: string[];
  nodeCount: number;
  edgeCount: number;
  totalSize: number;
  totalRetainedSize: number;
}

/** Top hot object */
export interface HotObject {
  node: HeapNode;
  retainedSize: number;
  gcRootPath: string[];
}

/** Leak suspicion */
export interface LeakSuspicion {
  severity: 'high' | 'medium' | 'low';
  category: 'unbounded-cache' | 'closure-capture' | 'listener-accumulation';
  node: HeapNode;
  description: string;
  evidence: string;
}

export interface HeapAnalysis {
  snapshot: HeapSnapshot;
  hotObjects: HotObject[];
  leakSuspects: LeakSuspicion[];
  totalSize: number;
  topRetainedNodes: { name: string; size: number; count: number }[];
}

/** A single recorded heap snapshot diff comparison, part of the history. */
export interface SnapshotDiffRecord {
  id: string;
  timestamp: number;
  label: string;
  beforeName: string;
  afterName: string;
  beforeSize: number;
  afterSize: number;
  newNodeCount: number;
  removedNodeCount: number;
  retainedSizeDelta: number;
  growthRate: number | null;
  flagged: boolean;
}

/** Snapshot diff history model. */
export interface SnapshotHistory {
  records: SnapshotDiffRecord[];
}