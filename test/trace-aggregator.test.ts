import { describe, it, expect } from 'vitest';
import { analyzeTracingEvents, buildWaterfall, buildDependencies, findBottlenecks } from '../src/shared/engine';
import type { TracingEvent } from '../src/shared/types';

function ev(channel: string, eventType: TracingEvent['eventType'], timestamp: number, operationId: string): TracingEvent {
  return { channel, eventType, context: {}, timestamp, operationId };
}

function waterfall(events: TracingEvent[]) {
  const analysis = analyzeTracingEvents(events);
  return buildWaterfall(analysis.operations, analysis.events);
}

describe('buildWaterfall', () => {
  it('infers parent-child relationships by containment', () => {
    const events = [
      ev('express:request', 'start', 0, 'root'),
      ev('mysql2:query', 'start', 1, 'child'),
      ev('mysql2:query', 'end', 11, 'child'),
      ev('express:request', 'end', 50, 'root'),
    ];
    const roots = waterfall(events);
    expect(roots).toHaveLength(1);
    expect(roots[0].channel).toBe('express:request');
    expect(roots[0].children).toHaveLength(1);
    const child = roots[0].children[0];
    expect(child.channel).toBe('mysql2:query');
    expect(child.parentId).toBe(roots[0].id);
    expect(child.depth).toBe(1);
  });

  it('returns sibling spans as separate roots when not contained', () => {
    const events = [
      ev('http', 'start', 0, 'a'),
      ev('http', 'end', 10, 'a'),
      ev('http', 'start', 20, 'b'),
      ev('http', 'end', 30, 'b'),
    ];
    const roots = waterfall(events);
    expect(roots).toHaveLength(2);
    expect(roots.every(r => r.children.length === 0)).toBe(true);
  });
});

describe('buildDependencies', () => {
  it('creates a parent-child link for a containing operation', () => {
    const events = [
      ev('http', 'start', 0, 'root'),
      ev('http', 'start', 1, 'inner'),
      ev('http', 'end', 9, 'inner'),
      ev('http', 'end', 20, 'root'),
    ];
    const analysis = analyzeTracingEvents(events);
    const links = buildDependencies(analysis.operations);
    expect(links.some(l => l.type === 'parent-child' && l.source === 'root' && l.target === 'inner')).toBe(true);
  });

  it('creates a sequential link for adjacent ops with a small gap', () => {
    const events = [
      ev('db', 'start', 0, 'q1'),
      ev('db', 'end', 10, 'q1'),
      ev('db', 'start', 12, 'q2'),
      ev('db', 'end', 22, 'q2'),
    ];
    const analysis = analyzeTracingEvents(events);
    const links = buildDependencies(analysis.operations);
    expect(links.some(l => l.type === 'sequential' && l.source === 'q1' && l.target === 'q2')).toBe(true);
  });
});

describe('findBottlenecks', () => {
  it('returns spans above the percentile threshold', () => {
    const events = [
      ev('root', 'start', 0, 'root'),
      ev('db', 'start', 1, 'child'),
      ev('db', 'end', 11, 'child'),
      ev('root', 'end', 60, 'root'),
    ];
    const roots = waterfall(events);
    const bottlenecks = findBottlenecks(roots, 95);
    expect(bottlenecks).toHaveLength(1);
    expect(bottlenecks[0].channel).toBe('root');
  });
});
