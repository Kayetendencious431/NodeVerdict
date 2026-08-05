/** V8 JIT / inline-cache trace analysis types */

/** Inline-cache (IC) state. Mirrors V8's state machine. */
export type IcState = 'uninitialized' | 'monomorphic' | 'polymorphic' | 'megamorphic';

/** Kinds of inline cache reported by V8's --trace-ic. */
export type IcKind =
  | 'LoadIC'
  | 'StoreIC'
  | 'KeyedLoadIC'
  | 'KeyedStoreIC'
  | 'CallIC'
  | 'BinaryOpIC'
  | 'CompareIC'
  | 'UnaryOpIC'
  | 'BCH'
  | 'MEG';

/** A single IC event parsed from a --trace-ic line. */
export interface IcEvent {
  /** Sequence index of the event in the log (used as pseudo-time). */
  seq: number;
  kind: IcKind | string;
  /** Call site position, e.g. "demo.js:8:25". */
  site: string | null;
  /** Bytecode offset reported by V8. */
  offset: number | null;
  /** Property / key being loaded or stored ("[key: foo]"). */
  key: string | null;
  /** State words observed on the line, e.g. "slow", "megamorphic". */
  state: IcState;
  /** Map (hidden class) addresses observed at this call site. */
  maps: string[];
  /** Raw trace line (trimmed) for reference. */
  raw: string;
}

/** A hidden-class transition observed via --trace-maps lines. */
export interface MapTransition {
  seq: number;
  from: string;
  to: string;
  /** Property whose addition triggered the transition, when known. */
  property: string | null;
  /** Site that triggered the transition, when known. */
  site: string | null;
  raw: string;
}

/** A function optimization event parsed from --trace-opt. */
export interface OptEvent {
  seq: number;
  kind: 'marking' | 'compiling' | 'optimized' | 'disabled' | 'osr' | 'reoptimize';
  /** Address of the SharedFunctionInfo. */
  address: string | null;
  /** Function name as printed by V8. */
  name: string | null;
  /** Compiler used, e.g. "TurboFan". */
  compiler: string | null;
  /** Reason string, e.g. "SmallFunction", "NeverOptimize". */
  reason: string | null;
  /** Compilation duration in ms when reported. */
  tookMs: number | null;
  raw: string;
}

/** A deoptimization event parsed from --trace-deopt. */
export interface DeoptEvent {
  seq: number;
  /** Deopt kind, e.g. "eager" | "lazy" | "soft" | "unoptimize". */
  kind: string;
  /** Function address. */
  address: string | null;
  /** Function name. */
  name: string | null;
  /** Position reported with the event, e.g. "demo.js:8:25". */
  site: string | null;
  /** Bailout reason when V8 reported one, e.g. "Smi", "Map check". */
  reason: string | null;
  raw: string;
}

/** Parsed, structured V8 trace. */
export interface V8Trace {
  icEvents: IcEvent[];
  optEvents: OptEvent[];
  deoptEvents: DeoptEvent[];
  mapTransitions: MapTransition[];
  /** Total number of log lines parsed. */
  lineCount: number;
  /** File names seen in call-site positions. */
  files: string[];
}

/** A call site aggregated across all IC events. */
export interface IcSiteSummary {
  /** Stable site key: kind + site position. */
  id: string;
  kind: string;
  site: string | null;
  offset: number | null;
  /** Distinct maps observed. */
  maps: string[];
  /** Hit count (events) at this site. */
  hits: number;
  /** Derived IC state. */
  state: IcState;
  /** Distinct keys accessed at this site. */
  keys: string[];
}

/** Aggregated per-function view. */
export interface FunctionSummary {
  name: string;
  address: string | null;
  optCount: number;
  deoptCount: number;
  reoptCount: number;
  compiler: string | null;
  /** Last optimization status: 'optimized' | 'disabled' | 'never' | 'none'. */
  status: 'optimized' | 'disabled' | 'never' | 'none';
  reasons: string[];
  /** Max deopts observed within the sliding storm window. */
  maxDeoptBurst: number;
}

/** Node in the IC-state / hidden-class migration graph. */
export interface IcGraphNode {
  id: string;
  type: 'map' | 'site';
  /** Display label. */
  label: string;
  /** For maps: property keys seen. For sites: keys accessed. */
  props: string[];
  /** Map address or site key. */
  ref: string;
  /** Hit count. */
  count: number;
  /** For sites: aggregated IC state. */
  state: IcState | null;
  /** File (from site position) for site nodes. */
  file: string | null;
}

/** Edge in the IC-state graph. */
export interface IcGraphEdge {
  source: string;
  target: string;
  /** 'observed' = site sees a map, 'transition' = hidden-class migration. */
  kind: 'observed' | 'transition';
  property: string | null;
  weight: number;
}

/** The IC-state migration graph. */
export interface IcStateGraph {
  nodes: IcGraphNode[];
  edges: IcGraphEdge[];
}

/** Severity of an anti-pattern finding. */
export type FindingSeverity = 'info' | 'warning' | 'critical';

/** A detected JIT anti-pattern. */
export interface JitFinding {
  id: string;
  rule: 'megamorphic-ic' | 'deopt-storm' | 'hidden-class-fragmentation' | 'optimization-suppressed' | 'deopt-loop';
  severity: FindingSeverity;
  /** 0..1 impact score (CPU share proxy × frequency). */
  score: number;
  title: string;
  detail: string;
  /** Target call site / function. */
  target: string;
  /** Supporting evidence (raw trace lines). */
  evidence: string[];
}

/** Strategy identifiers for generated patches. */
export type PatchStrategy = 'object-literal-key-order' | 'field-initialization-order' | 'shape-dispatch-split';

/** Result of the AST-level semantic equivalence check. */
export interface EquivalenceResult {
  passed: boolean;
  /** Explanation of what was verified. */
  note: string;
  /** 0..1 confidence in the equivalence claim. */
  confidence: number;
}

/** One insertion step in an order-based rewrite. */
export interface PatchMove {
  /** Property key being moved. */
  key: string;
  /** Index it originally sits at. */
  fromIdx: number;
  /** Index it lands at after this step. */
  toIdx: number;
}

/** A distinct object shape (key set + insertion order) found in source. */
export interface KeyShape {
  /** Canonical (sorted) key set. */
  keys: string[];
  /** Every distinct insertion order that builds this key set. */
  orders: string[][];
  /** How many object constructions share this key set. */
  sites: number;
}

/** A generated, semantically-verified optimization patch. */
export interface JitPatch {
  id: string;
  strategy: PatchStrategy;
  /** Finding this patch addresses (null = manual source analysis). */
  findingId: string | null;
  title: string;
  rationale: string;
  /** Original source region that was rewritten. */
  before: string;
  /** Rewritten source region. */
  after: string;
  /** AST-level equivalence verification outcome. */
  equivalence: EquivalenceResult;
  /** Path/context label, e.g. "demo.js:9". */
  location: string;
  /** Original insertion order of the rewritten keys. */
  keys: string[];
  /** Canonical (sorted) order those keys are rewritten to. */
  canonicalKeys: string[];
  /** Insertion steps, keyed by positions in the current board. */
  moves: PatchMove[];
}

/** Full analysis result. */
export interface JitAnalysis {
  trace: V8Trace;
  sites: IcSiteSummary[];
  functions: FunctionSummary[];
  graph: IcStateGraph;
  findings: JitFinding[];
  patches: JitPatch[];
  /** 0..1 overall health (1 = fully JIT-friendly). */
  healthScore: number;
}
