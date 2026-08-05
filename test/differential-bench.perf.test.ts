import { describe, it, expect } from 'vitest';
import { performance } from 'node:perf_hooks';
import { alignEvents, analyzeDifferential } from '../src/shared/differential';
import type { TracingEvent } from '../src/shared/types';

/**
 * Differential alignment perf smoke test.
 * Run with:  BENCH_DIFF=1 npx vitest run test/differential-bench.perf.test.ts
 * Tune size with: BENCH_EVENTS=100000
 *
 * Acceptance target: align 100k events in well under 5s.
 */

const runBench = process.env.BENCH_DIFF === '1';
const bench = runBench ? describe : describe.skip;

function genTrace(count: number, fault: boolean): TracingEvent[] {
  const channels = ['express:request', 'mysql2:query', 'ioredis:get', 'http:fetch'];
  const out: TracingEvent[] = [];
  for (let i = 0; i < count; i += 2) {
    const ch = channels[i % channels.length];
    const op = `op${i}`;
    const ctx: Record<string, unknown> = { req: i % 100 };
    if (fault && i === Math.floor(count * 0.5)) {
      ctx.rows = 0;
      ctx.error = 'timeout';
    }
    out.push({ channel: ch, eventType: 'start', timestamp: i * 10, operationId: op, context: ctx });
    out.push({ channel: ch, eventType: fault && i === Math.floor(count * 0.5) ? 'error' : 'end', timestamp: i * 10 + (i % 50), operationId: op, context: ctx });
  }
  return out;
}

bench('Differential alignment perf', () => {
  it('aligns 100k events quickly and localizes the injected divergence', async () => {
    const count = Number(process.env.BENCH_EVENTS ?? 100_000);
    const normal = genTrace(count, false);
    const fault = genTrace(count, true);

    const t0 = performance.now();
    const alignment = alignEvents(normal, fault);
    const t1 = performance.now();
    const analysis = analyzeDifferential(normal, fault);
    const t2 = performance.now();

    const alignMs = t1 - t0;
    const fullMs = t2 - t1;

    // eslint-disable-next-line no-console
    console.log(`\n  events: ${count.toLocaleString()} per run`);
    // eslint-disable-next-line no-console
    console.log(`  align: ${alignMs.toFixed(1)}ms | similarity ${(alignment.similarity * 100).toFixed(1)}%`);
    // eslint-disable-next-line no-console
    console.log(`  full pipeline: ${fullMs.toFixed(1)}ms | ${analysis.divergences.length} divergence(s)`);
    // eslint-disable-next-line no-console
    console.log(`  first divergence at normal event #${analysis.divergences[0]?.eventDiff.normalIndex ?? 'n/a'}\n`);

    expect(alignment.similarity).toBeGreaterThan(0.9);
    expect(alignMs).toBeLessThan(5000);
    expect(analysis.divergences.length).toBe(1);
    const expectedIndex = Math.floor(count * 0.5);
    // The trace is sorted by timestamp during normalization, so the injected
    // fault may land a few positions from its generation index.
    expect(analysis.divergences[0].eventDiff.normalIndex).toBeGreaterThanOrEqual(expectedIndex - 10);
    expect(analysis.divergences[0].eventDiff.normalIndex).toBeLessThanOrEqual(expectedIndex + 10);
    expect(analysis.divergences[0].eventDiff.faultIndex).toBeGreaterThanOrEqual(expectedIndex - 10);
    expect(analysis.divergences[0].eventDiff.faultIndex).toBeLessThanOrEqual(expectedIndex + 10);
  });
});
