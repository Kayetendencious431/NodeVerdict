import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { analyzeDifferential } from '../src/shared/differential';
import type { TracingEvent } from '../src/shared/types';

it('analyzes the example differential traces', () => {
  const normal = JSON.parse(readFileSync('examples/differential-normal.json', 'utf8')) as TracingEvent[];
  const fault = JSON.parse(readFileSync('examples/differential-fault.json', 'utf8')) as TracingEvent[];
  const analysis = analyzeDifferential(normal, fault);
  // eslint-disable-next-line no-console
  console.log('\n' + analysis.report.summary);
  for (const d of analysis.divergences) {
    // eslint-disable-next-line no-console
    console.log(`  #${d.order} [${d.cause.role}] ${d.description} (conf ${d.confidence.toFixed(2)})`);
  }
  expect(analysis.alignment.similarity).toBeGreaterThan(0.7);
  expect(analysis.divergences.length).toBeGreaterThanOrEqual(1);
  const first = analysis.divergences[0];
  expect(first.cause.role).toBe('cause');
  expect(first.eventDiff.fault?.context?.reqId).toBe('req-004');
});
