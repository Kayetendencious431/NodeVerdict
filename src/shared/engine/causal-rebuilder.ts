import type { TracingEvent } from '../types';
import type {
  CausalCycle,
  CausalEdge,
  CausalGraph,
  CausalNode,
  EdgeConfidence,
  EdgeKind,
} from './causal-types';

/**
 * Streaming Causal Graph Reconstruction.
 *
 * Turns a flat, possibly-broken stream of `TracingEvent`s into a causal DAG.
 * Design goals:
 *
 *  1. **Incremental / streaming** — `CausalGraphBuilder.ingest()` accepts events
 *     one at a time, so the graph is usable while the trace is still arriving
 *     (Live agent) or being streamed (worker). Nodes are keyed by operationId
 *     and accumulated idempotently.
 *  2. **Causality, not just time** — edges come from explicit parent ids,
 *     `asyncId`/`triggerAsyncId` matching, or interval containment. Out-of-order
 *     arrivals are handled because pairing is deferred until an `end`/`error`.
 *  3. **Confidence + gap healing** — every relationship carries a confidence
 *     label; missing ancestors are back-filled as virtual nodes so the topology
 *     stays connected without inventing real operations.
 *  4. **Loop detection** — a valid causal DAG is acyclic. DFS finds back edges,
 *     their nodes are flagged `cyclic`, and the cycles are reported.
 *
 * Orphan semantics: a node is an *orphan* only when a causal relationship it
 * *declares* is broken — a missing explicit parent, or an end/error with no
 * start. A genuine root (no parent, nothing declared) is not an orphan.
 *
 * Complexity: O(n log n) time (chronological sort for containment) and O(n)
 * memory for a full trace; each `ingest` is O(1) amortized.
 */

function confidenceOf(kind: EdgeKind): EdgeConfidence {
  switch (kind) {
    case 'explicit-parent':
    case 'async-context':
      return 'high';
    case 'containment':
    case 'out-of-order':
      return 'medium';
    case 'gap-healed':
      return 'low';
  }
}

/** Read `context[key]` as a string id, tolerating undefined / numeric values. */
function ctxId(ctx: Record<string, unknown>, ...keys: string[]): string | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = ctx as any;
  for (const key of keys) {
    const v = c[key];
    if (v === undefined || v === null) continue;
    if (typeof v === 'string' && v.length > 0) return v;
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return undefined;
}

/** Operation pairing key — mirrors tracing-parser semantics. */
function opKey(event: TracingEvent): string {
  return event.operationId ?? `${event.channel}:${event.timestamp}`;
}

/** Parent-hint keys, in priority order, that libraries may populate. */
const PARENT_KEYS = ['parentOperationId', 'parentId', 'parentSpanId', 'parent_span_id'];
const ASYNC_ID_KEYS = ['asyncId', 'async_id'];
const TRIGGER_KEYS = ['triggerAsyncId', 'trigger_async_id'];

interface PendingOp {
  id: string;
  channel: string;
  startTime: number;
  endTime?: number;
  status: 'success' | 'error' | 'incomplete' | 'virtual';
  context: Record<string, unknown>;
  declaredParent?: string;
  triggerAsyncId?: string;
  isVirtual: boolean;
  hasStart: boolean;
}

/**
 * Incremental causal-graph builder.
 *
 * Feed events via `ingest()` in any order (pairing is buffered), then call
 * `build()` to finalize the DAG.
 */
export class CausalGraphBuilder {
  private byId = new Map<string, PendingOp>();
  private openStarts = new Map<string, TracingEvent>();
  /** Ops whose end/error arrived before their start (unpair-able). */
  private unpairedEnds = new Set<string>();
  private asyncIdToOp = new Map<string, string>();

  /** Accept a single event. Streaming-safe and idempotent per op. */
  ingest(event: TracingEvent): void {
    if (!event.channel || !event.eventType || typeof event.timestamp !== 'number') return;
    const key = opKey(event);
    const existing = this.byId.get(key);

    if (event.eventType === 'start') {
      const asyncId = ctxId(event.context, ...ASYNC_ID_KEYS);
      if (existing) {
        // Start arriving after an out-of-order end: back-fill the timing.
        if (!existing.hasStart) {
          existing.startTime = event.timestamp;
          existing.hasStart = true;
          existing.context = event.context;
          existing.declaredParent = ctxId(event.context, ...PARENT_KEYS);
          existing.triggerAsyncId = ctxId(event.context, ...TRIGGER_KEYS);
          this.unpairedEnds.delete(key);
        }
        return;
      }
      this.byId.set(key, {
        id: key,
        channel: event.channel,
        startTime: event.timestamp,
        status: 'incomplete',
        context: event.context,
        declaredParent: ctxId(event.context, ...PARENT_KEYS),
        triggerAsyncId: ctxId(event.context, ...TRIGGER_KEYS),
        isVirtual: false,
        hasStart: true,
      });
      this.openStarts.set(key, event);
      if (asyncId) this.asyncIdToOp.set(asyncId, key);
    } else if (event.eventType === 'end' || event.eventType === 'error') {
      if (existing && existing.hasStart) {
        existing.endTime = event.timestamp;
        existing.status = event.eventType === 'error' ? 'error' : 'success';
        this.openStarts.delete(key);
      } else if (existing && !existing.hasStart) {
        existing.endTime = event.timestamp;
        existing.status = event.eventType === 'error' ? 'error' : 'success';
      } else {
        // Orphan end/error: keep a placeholder so the graph stays closed.
        this.byId.set(key, {
          id: key,
          channel: event.channel,
          startTime: event.timestamp,
          endTime: event.timestamp,
          status: event.eventType === 'error' ? 'error' : 'success',
          context: event.context,
          declaredParent: ctxId(event.context, ...PARENT_KEYS),
          triggerAsyncId: ctxId(event.context, ...TRIGGER_KEYS),
          isVirtual: false,
          hasStart: false,
        });
        this.unpairedEnds.add(key);
      }
    }
    // asyncStart / asyncEnd carry no DAG semantics by themselves; the
    // waterfall / diff layers consume them.
  }

  /** Number of distinct operations seen so far. */
  get size(): number {
    return this.byId.size;
  }

  private ensureVirtual(id: string, at: number): PendingOp {
    const existing = this.byId.get(id);
    if (existing) return existing;
    const op: PendingOp = {
      id,
      channel: 'virtual',
      startTime: at,
      endTime: at,
      status: 'virtual',
      context: {},
      isVirtual: true,
      hasStart: false,
    };
    this.byId.set(id, op);
    return op;
  }

  build(): CausalGraph {
    const byId = this.byId;
    const edges: CausalEdge[] = [];
    const childToParent = new Map<string, string>();
    const orphanIds = new Set<string>(this.unpairedEnds);

    // Deterministic chronological order for containment inference.
    const orderedIds = Array.from(byId.keys()).sort(
      (a, b) => byId.get(a)!.startTime - byId.get(b)!.startTime,
    );
    const activeStack: { id: string; endTime: number }[] = [];

    for (const id of orderedIds) {
      const op = byId.get(id)!;
      if (op.isVirtual) continue; // virtual roots are linked by their consumers

      let parent: string | undefined;

      // 1) Explicit parent id (highest trust).
      const dp = op.declaredParent;
      if (dp && dp !== id) {
        if (byId.has(dp) && !byId.get(dp)!.isVirtual) {
          parent = dp;
          edges.push({ parentId: dp, childId: id, kind: 'explicit-parent', confidence: confidenceOf('explicit-parent') });
        } else {
          // Declared parent missing -> gap-heal a virtual ancestor.
          const v = this.ensureVirtual(`virtual:${dp}`, op.startTime);
          parent = v.id;
          orphanIds.add(id);
          edges.push({ parentId: v.id, childId: id, kind: 'gap-healed', confidence: confidenceOf('gap-healed') });
        }
      }

      // 2) Async context: an op we created earlier exposed the asyncId that
      //    this op carries as its triggerAsyncId.
      if (!parent) {
        const trig = op.triggerAsyncId;
        const linked = trig ? this.asyncIdToOp.get(trig) : undefined;
        if (linked && linked !== id && byId.has(linked)) {
          parent = linked;
          edges.push({ parentId: linked, childId: id, kind: 'async-context', confidence: confidenceOf('async-context') });
        }
      }

      // 3) Interval containment via a sweep stack (medium trust).
      if (!parent) {
        while (activeStack.length > 0 && (activeStack[activeStack.length - 1].endTime ?? Infinity) < op.startTime) {
          activeStack.pop();
        }
        if (activeStack.length > 0) {
          const cand = activeStack[activeStack.length - 1].id;
          if (cand !== id) {
            parent = cand;
            edges.push({ parentId: cand, childId: id, kind: 'containment', confidence: confidenceOf('containment') });
          }
        }
      }

      if (parent !== undefined) {
        childToParent.set(id, parent);
      } else {
        // A legitimate root — nothing to heal, not an orphan.
        childToParent.set(id, '(root)');
      }

      activeStack.push({ id, endTime: op.endTime ?? Infinity });
    }

    // Heal unpaired end/error ops (and any remaining broken nodes) onto a
    // dedicated virtual root so every concrete node is reachable from a root.
    const healTargets = Array.from(orphanIds).filter(
      (id) => byId.has(id) && !byId.get(id)!.isVirtual && (childToParent.get(id) ?? '(root)') === '(root)',
    );
    for (const id of healTargets) {
      const v = this.ensureVirtual(`virtual:orphan:${id}`, byId.get(id)!.startTime);
      childToParent.set(id, v.id);
      edges.push({ parentId: v.id, childId: id, kind: 'gap-healed', confidence: confidenceOf('gap-healed') });
    }

    // Root set: concrete roots plus any virtual node that itself has no parent.
    const rootIds = new Set<string>();
    for (const [id, p] of childToParent) if (p === '(root)') rootIds.add(id);
    for (const [id, op] of byId) {
      if (op.isVirtual && !childToParent.has(id)) rootIds.add(id);
    }

    // Build node list (concrete + virtual), ordered by time.
    const nodeMap = new Map<string, CausalNode>();
    for (const id of Array.from(byId.keys()).sort((a, b) => byId.get(a)!.startTime - byId.get(b)!.startTime)) {
      const op = byId.get(id)!;
      nodeMap.set(id, {
        id,
        channel: op.channel,
        opId: op.id,
        startTime: op.startTime,
        endTime: op.endTime,
        duration: op.endTime !== undefined ? Math.max(0, op.endTime - op.startTime) : 0,
        status: op.status,
        virtual: op.isVirtual,
        orphan: orphanIds.has(id),
        cyclic: false,
        metadata: op.context,
      });
    }

    // Cycle detection (DFS back edges) over parent -> children adjacency.
    const adjacency = new Map<string, string[]>();
    for (const e of edges) {
      if (e.childId === e.parentId) continue;
      if (!adjacency.has(e.parentId)) adjacency.set(e.parentId, []);
      adjacency.get(e.parentId)!.push(e.childId);
    }
    const cycles: CausalCycle[] = [];
    const visited = new Set<string>();
    const onStack = new Set<string>();
    const stack: string[] = [];

    const dfs = (node: string): void => {
      visited.add(node);
      onStack.add(node);
      stack.push(node);
      for (const next of adjacency.get(node) ?? []) {
        if (!visited.has(next)) {
          dfs(next);
        } else if (onStack.has(next)) {
          const cut = stack.indexOf(next);
          const path = stack.slice(cut);
          path.push(next);
          cycles.push({ path, nodeIds: Array.from(new Set(path)) });
        }
      }
      stack.pop();
      onStack.delete(node);
    };
    for (const id of nodeMap.keys()) if (!visited.has(id)) dfs(id);

    const cyclicIds = new Set<string>();
    for (const c of cycles) for (const id of c.nodeIds) cyclicIds.add(id);

    // Final edges (drop self-loops; cycle edges are kept but nodes flagged).
    const finalEdges = edges.filter((e) => e.childId !== e.parentId);
    const confidenceCounts: Record<EdgeConfidence, number> = { high: 0, medium: 0, low: 0 };
    let gapHealCount = 0;
    for (const e of finalEdges) {
      confidenceCounts[e.confidence]++;
      if (e.kind === 'gap-healed') gapHealCount++;
    }

    return {
      nodes: Array.from(nodeMap.values())
        .sort((a, b) => a.startTime - b.startTime)
        .map((n) => (cyclicIds.has(n.id) ? { ...n, cyclic: true } : n)),
      edges: finalEdges,
      cycles,
      rootIds: Array.from(rootIds),
      gapHealCount,
      orphanCount: orphanIds.size,
      confidenceCounts,
    };
  }
}

/** One-shot convenience: build a causal graph from a full array of events. */
export function buildCausalGraph(events: TracingEvent[]): CausalGraph {
  const builder = new CausalGraphBuilder();
  for (const e of events) builder.ingest(e);
  return builder.build();
}

/** Quick sanity helper for consumers: does the graph contain any cycle? */
export function hasCycle(graph: CausalGraph): boolean {
  return graph.cycles.length > 0;
}