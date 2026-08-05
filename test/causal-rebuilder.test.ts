import { describe, it, expect } from 'vitest';
import {
  CausalGraphBuilder,
  buildCausalGraph,
  hasCycle,
} from '../src/shared/engine/causal-rebuilder';
import type { CausalGraph } from '../src/shared/engine/causal-types';
import type { TracingEvent } from '../src/shared/types';

function ev(
  channel: string,
  eventType: TracingEvent['eventType'],
  timestamp: number,
  operationId: string,
  context: Record<string, unknown> = {},
): TracingEvent {
  return { channel, eventType, context, timestamp, operationId };
}

function edgeIds(g: CausalGraph): Array<[string, string]> {
  return g.edges.map((e) => [e.parentId, e.childId]);
}

describe('buildCausalGraph', () => {
  it('links via explicit parent id (highest confidence)', () => {
    const g = buildCausalGraph([
      ev('express:request', 'start', 0, 'req1'),
      ev('mysql2:query', 'start', 1, 'q1', { parentOperationId: 'req1' }),
      ev('mysql2:query', 'end', 11, 'q1', { parentOperationId: 'req1' }),
      ev('express:request', 'end', 50, 'req1'),
    ]);
    expect(edgeIds(g)).toContainEqual(['req1', 'q1']);
    const e = g.edges.find((x) => x.childId === 'q1')!;
    expect(e.kind).toBe('explicit-parent');
    expect(e.confidence).toBe('high');
    expect(g.rootIds).toContain('req1');
    expect(g.orphanCount).toBe(0);
  });

  it('links by async context (asyncId -> triggerAsyncId)', () => {
    const g = buildCausalGraph([
      ev('http:server', 'start', 0, 'srv', { asyncId: 100 }),
      ev('mysql2:query', 'start', 2, 'q', { triggerAsyncId: 100 }),
      ev('mysql2:query', 'end', 12, 'q', { triggerAsyncId: 100 }),
      ev('http:server', 'end', 40, 'srv', { asyncId: 100 }),
    ]);
    expect(edgeIds(g)).toContainEqual(['srv', 'q']);
    const e = g.edges.find((x) => x.childId === 'q')!;
    expect(e.kind).toBe('async-context');
    expect(e.confidence).toBe('high');
  });

  it('infers containment when neither parent nor async context is present', () => {
    const g = buildCausalGraph([
      ev('express:request', 'start', 0, 'root'),
      ev('mysql2:query', 'start', 1, 'child'),
      ev('mysql2:query', 'end', 11, 'child'),
      ev('express:request', 'end', 50, 'root'),
    ]);
    expect(edgeIds(g)).toContainEqual(['root', 'child']);
    const e = g.edges.find((x) => x.childId === 'child')!;
    expect(e.kind).toBe('containment');
    expect(e.confidence).toBe('medium');
  });

  it('does not treat an overlapping-but-earlier sibling as a parent (strict containment)', () => {
    // q0 [10,60] and q1 [20,70] overlap but neither contains the other;
    // both are children of root [0,500], never a q0 -> q1 nesting.
    const g = buildCausalGraph([
      ev('express:request', 'start', 0, 'root'),
      ev('mysql2:query', 'start', 10, 'q0'),
      ev('mysql2:query', 'end', 60, 'q0'),
      ev('mysql2:query', 'start', 20, 'q1'),
      ev('mysql2:query', 'end', 70, 'q1'),
      ev('express:request', 'end', 500, 'root'),
    ]);
    expect(edgeIds(g)).toContainEqual(['root', 'q0']);
    expect(edgeIds(g)).toContainEqual(['root', 'q1']);
    expect(edgeIds(g).some(([p, c]) => p === 'q0' && c === 'q1')).toBe(false);
    expect(edgeIds(g).some(([p, c]) => p === 'q1' && c === 'q0')).toBe(false);
  });

  it('gap-heals a missing declared parent into a virtual node (low confidence)', () => {
    const g = buildCausalGraph([
      ev('express:request', 'start', 0, 'orphan-req', { parentOperationId: 'ghost-ancestor' }),
      ev('express:request', 'end', 40, 'orphan-req', { parentOperationId: 'ghost-ancestor' }),
    ]);
    const virtualEdges = g.edges.filter((e) => e.kind === 'gap-healed');
    expect(virtualEdges.length).toBeGreaterThanOrEqual(1);
    expect(virtualEdges[0].parentId).toContain('virtual:');
    expect(virtualEdges[0].confidence).toBe('low');
    const vNode = g.nodes.find((n) => n.id === virtualEdges[0].parentId)!;
    expect(vNode.virtual).toBe(true);
    expect(g.gapHealCount).toBeGreaterThan(0);
    // The concrete node is still reachable from a root (the virtual parent).
    expect(g.nodes.find((n) => n.id === 'orphan-req')!.orphan).toBe(true);
  });

  it('flags orphan end/error with no start and links it to a virtual root', () => {
    const g = buildCausalGraph([
      ev('kafka:consume', 'error', 10, 'k1', { error: 'boom' }),
    ]);
    const orphan = g.nodes.find((n) => n.id === 'k1')!;
    expect(orphan.status).toBe('error');
    expect(orphan.orphan).toBe(true);
    // Still connected: a virtual root parents it.
    expect(g.rootIds.length).toBeGreaterThanOrEqual(1);
    expect(edgeIds(g).some(([p, c]) => c === 'k1' && p.startsWith('virtual:'))).toBe(true);
  });

  it('handles out-of-order arrivals (end before start ingested) — same op, one node', () => {
    const builder = new CausalGraphBuilder();
    builder.ingest(ev('mysql2:query', 'end', 11, 'q'));
    builder.ingest(ev('mysql2:query', 'start', 1, 'q'));
    const g = builder.build();
    expect(g.nodes.filter((n) => n.id === 'q')).toHaveLength(1);
    const q = g.nodes.find((n) => n.id === 'q')!;
    expect(q.status).toBe('success');
    expect(q.duration).toBe(10);
  });

  it('detects cycles and flags the involved nodes', () => {
    const g = buildCausalGraph([
      ev('a:op', 'start', 0, 'A', { parentOperationId: 'B' }),
      ev('a:op', 'end', 10, 'A', { parentOperationId: 'B' }),
      ev('b:op', 'start', 5, 'B', { parentOperationId: 'A' }),
      ev('b:op', 'end', 15, 'B', { parentOperationId: 'A' }),
    ]);
    expect(hasCycle(g)).toBe(true);
    expect(g.cycles.length).toBeGreaterThan(0);
    expect(g.nodes.filter((n) => n.cyclic).map((n) => n.id).sort()).toEqual(['A', 'B']);
  });

  it('is streaming: partial builds are consistent and grow monotonically', () => {
    const builder = new CausalGraphBuilder();
    const g1 = builder.build();
    expect(g1.nodes).toHaveLength(0);

    builder.ingest(ev('http:server', 'start', 0, 'srv', { asyncId: 7 }));
    const g2 = builder.build();
    expect(g2.nodes.find((n) => n.id === 'srv')?.status).toBe('incomplete');

    builder.ingest(ev('mysql2:query', 'start', 1, 'q', { triggerAsyncId: 7 }));
    builder.ingest(ev('mysql2:query', 'end', 5, 'q', { triggerAsyncId: 7 }));
    builder.ingest(ev('http:server', 'end', 20, 'srv', { asyncId: 7 }));
    const g3 = builder.build();
    expect(g3.nodes).toHaveLength(2);
    expect(edgeIds(g3)).toContainEqual(['srv', 'q']);
    expect(g3.cycles).toHaveLength(0);
    expect(g3.confidenceCounts.high).toBeGreaterThan(0);
  });

  it('flags a lone start as incomplete without fabricating parents', () => {
    const g = buildCausalGraph([ev('mysql2:query', 'start', 1, 'q')]);
    const q = g.nodes.find((n) => n.id === 'q')!;
    expect(q.status).toBe('incomplete');
    expect(q.duration).toBe(0);
  });
});
