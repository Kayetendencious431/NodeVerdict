import { describe, it, expect } from 'vitest';
import { analyzeTracingEvents, buildWaterfall, buildDependencies, causalGraphToSpans, buildCausalGraph } from '../src/shared/engine';
import type { TracingEvent, TraceSpan } from '../src/shared/types';

function ev(
  channel: string,
  eventType: TracingEvent['eventType'],
  timestamp: number,
  operationId: string,
  context: Record<string, unknown> = {},
  extra: Partial<TracingEvent> = {},
): TracingEvent {
  return { channel, eventType, context, timestamp, operationId, ...extra };
}

function flatten(roots: TraceSpan[]): TraceSpan[] {
  const out: TraceSpan[] = [];
  const walk = (s: TraceSpan) => {
    out.push(s);
    s.children.forEach(walk);
  };
  roots.forEach(walk);
  return out;
}

describe('causalGraphToSpans (unified IR)', () => {
  it('derives the tree from DAG edges, not containment', () => {
    const events = [
      ev('express:request', 'start', 0, 'root'),
      ev('mysql2:query', 'start', 1, 'child', { parentOperationId: 'root' }),
      ev('mysql2:query', 'end', 11, 'child', { parentOperationId: 'root' }),
      ev('express:request', 'end', 50, 'root'),
    ];
    const analysis = analyzeTracingEvents(events);
    const roots = buildWaterfall(analysis.operations, analysis.events);
    expect(roots).toHaveLength(1);
    expect(roots[0].children).toHaveLength(1);
    const child = roots[0].children[0];
    expect(child.edgeKind).toBe('explicit-parent');
    expect(child.edgeConfidence).toBe('high');
  });

  it('marks containment edges as medium confidence', () => {
    const events = [
      ev('http', 'start', 0, 'root'),
      ev('http', 'start', 1, 'inner'),
      ev('http', 'end', 9, 'inner'),
      ev('http', 'end', 20, 'root'),
    ];
    const analysis = analyzeTracingEvents(events);
    const roots = buildWaterfall(analysis.operations, analysis.events);
    const child = roots[0].children[0];
    expect(child.edgeKind).toBe('containment');
    expect(child.edgeConfidence).toBe('medium');
  });

  it('does not emit virtual (gap-healed) nodes as spans', () => {
    const events = [
      ev('express:request', 'start', 0, 'orphan-req', { parentOperationId: 'ghost-ancestor' }),
      ev('express:request', 'end', 40, 'orphan-req', { parentOperationId: 'ghost-ancestor' }),
    ];
    const analysis = analyzeTracingEvents(events);
    const roots = buildWaterfall(analysis.operations, analysis.events);
    const all = flatten(roots);
    expect(all.every((s) => !s.operationId.startsWith('virtual:'))).toBe(true);
    // The concrete orphan becomes a root once its virtual ancestor is dropped.
    expect(roots.map((r) => r.operationId)).toContain('orphan-req');
    expect(roots[0].parentId).toBeUndefined();
  });

  it('carries error payloads from operations onto spans', () => {
    const events = [
      ev('express:request', 'start', 0, 'root'),
      ev('mysql2:query', 'start', 1, 'q', { parentOperationId: 'root' }),
      ev('mysql2:query', 'error', 11, 'q', { parentOperationId: 'root' }, { error: { name: 'ETIMEDOUT', message: 'connect timeout' } }),
      ev('express:request', 'end', 50, 'root'),
    ];
    const analysis = analyzeTracingEvents(events);
    const roots = buildWaterfall(analysis.operations, analysis.events);
    const q = roots[0].children[0];
    expect(q.status).toBe('error');
    expect((q.metadata as Record<string, unknown>).error).toEqual({ name: 'ETIMEDOUT', message: 'connect timeout' });
  });

  it('keeps sibling spans as separate roots with equal depth', () => {
    const events = [
      ev('http', 'start', 0, 'a'),
      ev('http', 'end', 10, 'a'),
      ev('http', 'start', 20, 'b'),
      ev('http', 'end', 30, 'b'),
    ];
    const analysis = analyzeTracingEvents(events);
    const roots = buildWaterfall(analysis.operations, analysis.events);
    expect(roots).toHaveLength(2);
    expect(roots.every((r) => r.children.length === 0 && r.depth === 0)).toBe(true);
  });

  it('orders children by start time regardless of edge order', () => {
    const events = [
      ev('express:request', 'start', 0, 'root'),
      ev('mysql2:query', 'start', 10, 'second', { parentOperationId: 'root' }),
      ev('redis:get', 'start', 2, 'first', { parentOperationId: 'root' }),
      ev('redis:get', 'end', 6, 'first', { parentOperationId: 'root' }),
      ev('mysql2:query', 'end', 20, 'second', { parentOperationId: 'root' }),
      ev('express:request', 'end', 50, 'root'),
    ];
    const analysis = analyzeTracingEvents(events);
    const roots = buildWaterfall(analysis.operations, analysis.events);
    expect(roots[0].children.map((c) => c.operationId)).toEqual(['first', 'second']);
  });
});

describe('buildDependencies from the unified IR', () => {
  it('emits parent-child links from DAG edges and keeps sequential links', () => {
    const events = [
      ev('http', 'start', 0, 'root'),
      ev('http', 'start', 1, 'inner'),
      ev('http', 'end', 9, 'inner'),
      ev('http', 'end', 20, 'root'),
    ];
    const analysis = analyzeTracingEvents(events);
    const graph = buildCausalGraph(analysis.events);
    const links = buildDependencies(analysis.operations, graph);
    expect(links.some((l) => l.type === 'parent-child' && l.source === 'root' && l.target === 'inner')).toBe(true);
  });

  it('falls back to containment when no graph is passed (backward compat)', () => {
    const events = [
      ev('http', 'start', 0, 'root'),
      ev('http', 'start', 1, 'inner'),
      ev('http', 'end', 9, 'inner'),
      ev('http', 'end', 20, 'root'),
    ];
    const analysis = analyzeTracingEvents(events);
    const links = buildDependencies(analysis.operations);
    expect(links.some((l) => l.type === 'parent-child' && l.source === 'root' && l.target === 'inner')).toBe(true);
  });

  it('does not emit links through virtual gap-healed nodes', () => {
    const events = [
      ev('express:request', 'start', 0, 'orphan-req', { parentOperationId: 'ghost-ancestor' }),
      ev('express:request', 'end', 40, 'orphan-req', { parentOperationId: 'ghost-ancestor' }),
    ];
    const analysis = analyzeTracingEvents(events);
    const graph = buildCausalGraph(analysis.events);
    const links = buildDependencies(analysis.operations, graph);
    // The only causal edge is gap-healed to a virtual ancestor, so the orphan
    // gets no parent-child link at all (virtual placeholders are never emitted).
    expect(links.every((l) => !l.source.startsWith('virtual:') && !l.target.startsWith('virtual:'))).toBe(true);
    expect(links.some((l) => l.target === 'orphan-req')).toBe(false);
  });
});
