import { describe, it, expect } from 'vitest';
import { buildNoiseModel, detectNoiseInTrace, isMasked } from '../src/shared/differential/noise-model';
import { filterSemanticDivergences, isPathChanging } from '../src/shared/differential/semantic-differ';
import { scoreRegressions } from '../src/shared/differential/regression-scoring';
import { normalizeTrace, DEFAULT_IGNORE_KEYS } from '../src/shared/differential/fingerprint';
import type { TracingEvent } from '../src/shared/types';
import type { DivergencePoint } from '../src/shared/differential/types';

function ev(
  channel: string,
  eventType: TracingEvent['eventType'],
  relTime: number,
  operationId: string,
  context: Record<string, unknown> = {},
  duration?: number,
): TracingEvent {
  return { channel, eventType, timestamp: relTime, operationId, context, duration };
}

describe('noise-model', () => {
  it('flags long GC pauses as jitter', () => {
    const events = [
      ev('express:request', 'start', 0, 'r'),
      ev('node:v8.gc', 'start', 10, 'gc1'),
      ev('node:v8.gc', 'end', 70, 'gc1'), // 60ms mark-sweep
      ev('express:request', 'end', 80, 'r'),
    ];
    const norm = normalizeTrace(events);
    const regions = detectNoiseInTrace(norm, { gcPauseThresholdMs: 15 });
    const gc = regions.filter((r) => r.kind === 'gc-pause');
    expect(gc.length).toBe(1);
    expect(gc[0].reason).toContain('gc');
  });

  it('flags wide inter-event gaps after a completed op as scheduling jitter', () => {
    const events = [
      ev('mysql2:query', 'start', 0, 'q1'),
      ev('mysql2:query', 'end', 5, 'q1'), // done
      ev('mysql2:query', 'start', 200, 'q2'), // 195ms idle
    ];
    const norm = normalizeTrace(events);
    const regions = detectNoiseInTrace(norm, { gapThresholdMs: 50 });
    expect(regions.some((r) => r.kind === 'inter-event-gap')).toBe(true);
  });

  it('masks DNS/TCP setup channels', () => {
    const events = [
      ev('dns:lookup', 'start', 0, 'd1'),
      ev('dns:lookup', 'end', 40, 'd1'),
      ev('http:client', 'start', 41, 'h1'),
    ];
    const norm = normalizeTrace(events);
    const regions = detectNoiseInTrace(norm);
    expect(regions.some((r) => r.kind === 'network-dns')).toBe(true);
  });

  it('buildNoiseModel masks both traces independently', () => {
    const normal = [
      ev('express:request', 'start', 0, 'r'),
      ev('node:v8.gc', 'start', 10, 'g'),
      ev('node:v8.gc', 'end', 60, 'g'),
      ev('express:request', 'end', 70, 'r'),
    ];
    const fault = [
      ev('express:request', 'start', 0, 'r'),
      ev('express:request', 'end', 5, 'r'), // no GC in the fault run
    ];
    const model = buildNoiseModel(
      normalizeTrace(normal),
      normalizeTrace(fault),
      { gcPauseThresholdMs: 15 },
    );
    expect(model.normal.length).toBeGreaterThan(0);
    expect(model.fault.length).toBe(0);
    // The GC region in the normal trace covers indices 1..2.
    expect(isMasked(model, 1, -1)).toBe(true);
    expect(isMasked(model, 0, 0)).toBe(false);
  });
});

describe('semantic-differ', () => {
  it('classifies structural vs incidental divergence kinds', () => {
    expect(isPathChanging('error-introduced')).toBe(true);
    expect(isPathChanging('stack-change')).toBe(true);
    expect(isPathChanging('event-missing')).toBe(true);
    expect(isPathChanging('event-value-change')).toBe(false);
  });

  it('drops masked divergences and keeps structural ones', () => {
    const model = {
      normal: [{ kind: 'gc-pause' as const, from: 1, to: 1, reason: 'x' }],
      fault: [],
    };
    const divergences: DivergencePoint[] = [
      // inside the GC mask -> dropped
      {
        order: 1,
        eventDiff: {
          kind: 'event-value-change', normalIndex: 1, faultIndex: -1,
          normal: undefined, fault: undefined, valueDiffs: [], stackDiffs: [], significance: 0.5,
        },
        cause: { role: 'effect', reason: '' }, confidence: 0.5, significance: 0.5, description: '',
      },
      // structural, unmasked -> kept
      {
        order: 2,
        eventDiff: {
          kind: 'error-introduced', normalIndex: 5, faultIndex: 5,
          normal: undefined, fault: { channel: 'mysql2:query', operationId: 'q', timestamp: 100, eventType: 'error', context: {} },
          valueDiffs: [], stackDiffs: [], significance: 1,
        },
        cause: { role: 'cause', reason: '' }, confidence: 1, significance: 1, description: '',
      },
    ];
    const kept = filterSemanticDivergences(divergences, model, { minSignificance: 0 });
    expect(kept.length).toBe(1);
    expect(kept[0].kind).toBe('error-introduced');
    expect(kept[0].pathChanged).toBe(true);
  });
});

describe('regression-scoring', () => {
  it('computes confidence from structural share and impact from breadth', () => {
    const result = scoreRegressions([
      { divergenceIndex: 0, kind: 'error-introduced', channel: 'mysql2:query', operationId: 'q1', durationDeltaMs: 50, pathChanged: true, impact: 1, significance: 1 },
      { divergenceIndex: 1, kind: 'event-value-change', channel: 'mysql2:query', operationId: 'q2', durationDeltaMs: 3, pathChanged: false, impact: 0.5, significance: 0.5 },
    ]);
    expect(result.confidence).toBeCloseTo(0.5, 1); // 1 structural / 2 total
    expect(result.totalDeltaMs).toBe(53);
    expect(result.regressedChannels[0].channel).toBe('mysql2:query');
    expect(result.severity).toBeGreaterThan(0);
    expect(result.severity).toBeLessThanOrEqual(1);
  });

  it('returns zero score for no divergences', () => {
    const result = scoreRegressions([]);
    expect(result.severity).toBe(0);
    expect(result.regressedChannels).toEqual([]);
  });

  it('respects the minDeltaMs floor (anti-noise)', () => {
    const result = scoreRegressions(
      [
        { divergenceIndex: 0, kind: 'event-value-change', channel: 'a', operationId: 'x', durationDeltaMs: 2, pathChanged: false, impact: 0.4, significance: 0.4 },
      ],
      { minDeltaMs: 5 },
    );
    expect(result.totalDeltaMs).toBe(0); // sub-threshold delta ignored
    expect(result.regressedChannels).toHaveLength(0);
  });
});

// Integration: the full pipeline with `regression` enabled still runs.
describe('pipeline integration', () => {
  it('runs analyzeDifferential with the regression pass (backward compatible)', async () => {
    const { analyzeDifferential } = await import('../src/shared/differential/index');
    const normal = [
      ev('express:request', 'start', 0, 'r'),
      ev('mysql2:query', 'start', 1, 'q'),
      ev('mysql2:query', 'end', 10, 'q', {}, 9),
      ev('express:request', 'end', 20, 'r', {}, 20),
    ];
    const fault = [
      ev('express:request', 'start', 0, 'r'),
      ev('mysql2:query', 'start', 1, 'q'),
      // Same code path, but the query takes far longer AND its context diverges.
      // A same-signature substitute (value change) keeps both sides aligned, so a
      // real duration delta is measurable.
      ev('mysql2:query', 'end', 120, 'q', { error: 'connection lost' }, 119),
      ev('express:request', 'end', 130, 'r', {}, 130),
    ];
    const withRegression = analyzeDifferential(normal, fault, { regression: {} });
    expect(withRegression.regression).toBeDefined();
    expect(withRegression.regression!.totalDeltaMs).toBeGreaterThan(0);

    // Without the option the pipeline behaves exactly as before.
    const legacy = analyzeDifferential(normal, fault);
    expect(legacy.regression).toBeUndefined();
    expect(legacy.alignment.pairs.length).toBeGreaterThan(0);
  });
});
