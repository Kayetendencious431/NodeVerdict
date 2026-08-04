import { describe, it, expect } from 'vitest';
import type { TracingEvent } from '../src/shared/types';
import {
  alignEvents,
  alignExact,
  alignNormalized,
  analyzeDifferential,
  canonicalizeValue,
  diffContext,
  diffPair,
  diffStacks,
  findDivergences,
  fingerprintEvent,
  groupDivergenceRegions,
  normalizeTrace,
} from '../src/shared/differential';

function ev(
  channel: string,
  eventType: TracingEvent['eventType'],
  timestamp: number,
  context: Record<string, unknown> = {},
  extra: Partial<TracingEvent> = {},
): TracingEvent {
  return { channel, eventType, timestamp, context, operationId: `${channel}:${timestamp}`, ...extra };
}

function eventList(specs: Array<[string, number, Record<string, unknown>?]>): TracingEvent[] {
  return specs.map(([ch, ts, ctx]) => ev(ch, 'start', ts, ctx ?? {}));
}
describe('fingerprint', () => {
  it('ignores timestamps and run-specific request ids', () => {
    const a = ev('mysql2:query', 'end', 1000, { query: 'SELECT 1', rows: 1, requestId: 'abc' });
    const b = ev('mysql2:query', 'end', 5000, { query: 'SELECT 1', rows: 1, requestId: 'xyz' });
    expect(fingerprintEvent(a)).toBe(fingerprintEvent(b));
  });

  it('detects value changes in context', () => {
    const a = ev('http:fetch', 'end', 1, { status: 200 });
    const b = ev('http:fetch', 'end', 1, { status: 500 });
    expect(fingerprintEvent(a)).not.toBe(fingerprintEvent(b));
  });

  it('canonicalizes nested objects and arrays deterministically', () => {
    expect(canonicalizeValue({ b: 2, a: 1 })).toBe(canonicalizeValue({ a: 1, b: 2 }));
    expect(canonicalizeValue([1, [2, 3]])).toBe(canonicalizeValue([1, [2, 3]]));
  });

  it('normalizeTrace sorts by time and precomputes relative time', () => {
    const t = eventList([['a:start', 300], ['a:start', 100], ['a:start', 200]]);
    const norm = normalizeTrace(t);
    expect(norm.map(n => n.event.timestamp)).toEqual([100, 200, 300]);
    expect(norm.map(n => n.relTime)).toEqual([0, 100, 200]);
  });
});

describe('alignment', () => {
  it('aligns identical traces with full similarity', () => {
    const trace = eventList([['a:x', 1], ['a:x', 2], ['a:x', 3]]);
    const alignment = alignEvents(trace, trace.map(e => ({ ...e })));
    expect(alignment.similarity).toBe(1);
    expect(alignment.editDistance).toBe(0);
    expect(alignment.pairs.every(p => p.kind === 'match')).toBe(true);
  });

  it('detects a single value-change substitute', () => {
    const normal = eventList([['a:x', 1, { v: 1 }], ['a:x', 2, { v: 1 }]]);
    const fault = eventList([['a:x', 1, { v: 1 }], ['a:x', 2, { v: 9 }]]);
    const alignment = alignEvents(normal, fault);
    const sub = alignment.pairs.find(p => p.kind === 'substitute');
    expect(sub).toBeDefined();
    expect(sub!.distance).toBe(1);
    expect(alignment.editDistance).toBe(1);
  });

  it('detects an inserted event in the fault run', () => {
    const normal = eventList([['a:x', 1], ['a:x', 2], ['a:x', 3]]);
    const fault = eventList([['a:x', 1], ['a:x', 2], ['b:extra', 25], ['a:x', 3]]);
    const alignment = alignEvents(normal, fault);
    const ins = alignment.pairs.find(p => p.kind === 'insert');
    expect(ins).toBeDefined();
    expect(ins!.fault?.channel).toBe('b:extra');
    expect(alignment.editDistance).toBe(1);
  });

  it('detects a missing event in the fault run', () => {
    const normal = eventList([['a:x', 1, { n: 1 }], ['a:x', 2, { n: 2 }], ['a:x', 3, { n: 3 }], ['a:x', 4, { n: 4 }]]);
    const fault = eventList([['a:x', 1, { n: 1 }], ['a:x', 3, { n: 3 }], ['a:x', 4, { n: 4 }]]);
    const alignment = alignEvents(normal, fault);
    const del = alignment.pairs.find(p => p.kind === 'delete');
    expect(del).toBeDefined();
    expect(del!.normal?.timestamp).toBe(2);
    expect(alignment.editDistance).toBe(1);
  });

  it('recovers after a multi-event divergence region', () => {
    const normal = eventList([['a:x', 1], ['a:x', 2], ['a:x', 3], ['a:x', 4], ['a:x', 5], ['a:x', 6]]);
    const fault = eventList([['a:x', 1], ['a:x', 2], ['b:y', 25], ['b:z', 26], ['a:x', 5], ['a:x', 6]]);
    const alignment = alignEvents(normal, fault);
    expect(alignment.pairs.filter(p => p.kind === 'match').length).toBe(4);
    expect(alignment.pairs.filter(p => p.kind === 'insert').length).toBe(2);
    expect(alignment.pairs.filter(p => p.kind === 'delete').length).toBe(2);
  });

  it('matches brute-force alignment on random small traces', () => {
    const channels = ['a:x', 'a:y', 'b:x', 'b:y'];
    for (let trial = 0; trial < 40; trial++) {
      const lenN = 3 + Math.floor(Math.random() * 7);
      const lenF = 3 + Math.floor(Math.random() * 7);
      const make = (len: number) =>
        Array.from({ length: len }, (_, i) => {
          const ch = channels[Math.floor(Math.random() * channels.length)];
          const v = Math.floor(Math.random() * 3);
          return ev(ch, i % 2 === 0 ? 'start' : 'end', i * 10 + Math.random() * 5, { v });
        });
      const normal = make(lenN);
      const fault = make(lenF);
      const norm = normalizeTrace(normal);
      const faultNorm = normalizeTrace(fault);
      const exact = alignExact(norm, faultNorm);
      const banded = alignNormalized(norm, faultNorm, 8);
      expect(banded.editDistance).toBe(exact.editDistance);
      expect(banded.similarity).toBeCloseTo(exact.similarity, 10);
      expect(banded.cost).toBe(exact.cost);
    }
  });
});

describe('diff', () => {
  it('finds added / removed / changed context values', () => {
    const normal = ev('http:fetch', 'end', 1, { status: 200, keep: true, removed: 1 });
    const fault = ev('http:fetch', 'end', 1, { status: 500, keep: true, added: 'x' });
    const diffs = diffContext(normal, fault);
    const byKey = Object.fromEntries(diffs.map(d => [d.key, d]));
    expect(byKey.status.change).toBe('changed');
    expect(byKey.removed.change).toBe('removed');
    expect(byKey.added.change).toBe('added');
  });

  it('classifies error introduction from stack diffs', () => {
    const normal = ev('fs:read', 'end', 1, { path: '/x' });
    const fault = ev('fs:read', 'end', 1, { path: '/x' }, {
      error: {
        message: 'boom',
        stack: 'Error: boom\n  at inner (app.js:1:1)\n  at outer (app.js:2:2)',
      },
    });
    const diffs = diffStacks(normal, fault);
    expect(diffs.length).toBeGreaterThan(0);
    const pair = diffPair({ normalIndex: 0, faultIndex: 0, kind: 'substitute', distance: 1, normal, fault });
    expect(pair.kind).toBe('error-introduced');
    expect(pair.stackDiffs.length).toBeGreaterThan(0);
  });

  it('classifies event-missing and event-inserted', () => {
    const e = ev('a:x', 'start', 1);
    expect(diffPair({ normalIndex: 0, faultIndex: -1, kind: 'delete', distance: 2, normal: e }).kind).toBe('event-missing');
    expect(diffPair({ normalIndex: -1, faultIndex: 0, kind: 'insert', distance: 2, fault: e }).kind).toBe('event-inserted');
  });
});

describe('divergence', () => {
  it('finds the first divergence and classifies it as the cause', () => {
    const normal = eventList([['a:x', 1], ['a:x', 2], ['a:x', 3], ['a:x', 4]]);
    const fault = eventList([['a:x', 1], ['a:x', 2], ['a:x', 3, { v: 9 }], ['a:x', 4]]);
    const alignment = alignEvents(normal, fault);
    const divergences = findDivergences(alignment);
    expect(divergences.length).toBe(1);
    const first = divergences[0];
    expect(first.order).toBe(1);
    expect(first.cause.role).toBe('cause');
    expect(first.eventDiff.normalIndex).toBe(2);
  });

  it('treats later same-channel divergences as effects', () => {
    const normal = eventList([
      ['a:x', 1], ['a:x', 2], ['a:x', 3], ['a:x', 4], ['a:x', 5], ['a:x', 6], ['a:x', 7],
    ]);
    const fault = eventList([
      ['a:x', 1], ['a:x', 2, { v: 9 }], ['a:x', 3], ['a:x', 4], ['a:x', 5, { v: 9 }], ['a:x', 6], ['a:x', 7],
    ]);
    const alignment = alignEvents(normal, fault);
    const divergences = findDivergences(alignment);
    expect(divergences.length).toBe(2);
    expect(divergences[0].cause.role).toBe('cause');
    expect(divergences[1].cause.role).toBe('effect');
  });

  it('reports error introduction with high confidence', () => {
    const normal = eventList([['a:x', 1], ['a:x', 2], ['a:x', 3]]);
    const fault = [
      ev('a:x', 'start', 1),
      ev('a:x', 'end', 2),
      ev('a:x', 'error', 3, {}, { error: { message: 'boom', stack: 'Error: boom\n  at f (x.js:1:1)' } }),
    ];
    const alignment = alignEvents(normal, fault);
    const divergences = findDivergences(alignment);
    expect(divergences[0].eventDiff.kind).toBe('error-introduced');
    expect(divergences[0].confidence).toBeGreaterThan(0.8);
  });

  it('groups consecutive non-matching pairs into one region', () => {
    const normal = eventList([['a:x', 1, { n: 1 }], ['a:x', 2, { n: 2 }], ['a:x', 3, { n: 3 }], ['a:x', 4, { n: 4 }]]);
    const fault = eventList([['a:x', 1, { n: 1 }], ['b:y', 2, { n: 5 }], ['b:z', 3, { n: 6 }], ['a:x', 4, { n: 4 }]]);
    const alignment = alignEvents(normal, fault);
    const regions = groupDivergenceRegions(alignment);
    expect(regions).toHaveLength(1);
    expect(regions[0].length).toBe(4);
  });
});

describe('analyzeDifferential', () => {
  it('runs the full pipeline and builds a report', () => {
    const normal = eventList([['a:x', 1], ['a:x', 2], ['a:x', 3]]);
    const fault = eventList([['a:x', 1], ['a:x', 2, { v: 7 }], ['a:x', 3]]);
    const analysis = analyzeDifferential(normal, fault);
    expect(analysis.divergences.length).toBe(1);
    expect(analysis.report.totalDivergences).toBe(1);
    expect(analysis.report.firstDivergence).toBeDefined();
    expect(analysis.report.recommendations.length).toBeGreaterThan(0);
    expect(analysis.meta.normalEvents).toBe(3);
    expect(analysis.meta.faultEvents).toBe(3);
    expect(typeof analysis.report.summary).toBe('string');
  });

  it('reports no divergence for identical runs', () => {
    const trace = eventList([['a:x', 1], ['a:x', 2], ['a:x', 3]]);
    const analysis = analyzeDifferential(trace, trace.map(e => ({ ...e })));
    expect(analysis.divergences).toHaveLength(0);
    expect(analysis.report.summary).toContain('No structural divergence');
  });

  it('handles empty inputs without crashing', () => {
    const analysis = analyzeDifferential([], []);
    expect(analysis.alignment.similarity).toBe(0);
    expect(analysis.divergences).toHaveLength(0);
  });
});
