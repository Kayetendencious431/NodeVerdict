import { describe, it, expect } from 'vitest';
import { buildDistributedTraces, correctClockSkew, MIN_DELTA_MS } from '../src/shared/distributed/span-tree';
import { loadTracingData } from '../src/shared/engine/data-loader';
import type { DistSpan } from '../src/shared/distributed';

const fs = require('fs');

function loadExample(): ReturnType<typeof buildDistributedTraces> {
  const content = fs.readFileSync('examples/otel-distributed-trace.json', 'utf8');
  const events = loadTracingData(content);
  return buildDistributedTraces(events);
}

function findSpan(spans: DistSpan[], name: string, traceIndex: number): DistSpan {
  const matches = spans.filter(s => s.name === name);
  return matches[traceIndex];
}

describe('buildDistributedTraces', () => {
  it('reconstructs 5 traces from the OTel export', () => {
    const traces = loadExample();
    expect(traces).toHaveLength(5);
  });

  it('links spans into parent-child trees via parentSpanId', () => {
    const traces = loadExample();
    const order = traces[0].spans.find(s => s.name === 'order.create');
    expect(order).toBeDefined();
    expect(order!.children.map(c => c.name).sort()).toEqual(['inventory.reserve', 'payment.charge']);
    expect(order!.children.every(c => c.depth === order!.depth + 1)).toBe(true);
  });

  it('extracts service names from OTel resource attributes', () => {
    const traces = loadExample();
    const payment = traces[0].spans.find(s => s.name === 'payment.charge');
    expect(payment!.serviceName).toBe('payment-gateway');
  });
});

describe('correctClockSkew', () => {
  it('preserves causality: corrected child starts after its parent', () => {
    const traces = loadExample();
    for (const trace of traces) {
      const stack = [...trace.roots];
      while (stack.length) {
        const s = stack.pop()!;
        const sStart = s.adjustedStart!;
        for (const c of s.children) {
          expect(c.adjustedStart!).toBeGreaterThanOrEqual(sStart + MIN_DELTA_MS);
          stack.push(c);
        }
      }
    }
  });

  it('shifts a skewed child (clock behind) so it no longer precedes its parent', () => {
    // inventory-db host clock is 6ms behind, so its reported start (41) is
    // before its parent inventory (46). Correction must push it to >= 46.001.
    const traces = loadExample();
    const inventory = traces[0].spans.find(s => s.name === 'inventory.reserve')!;
    const db = inventory.children[0];
    expect(db.name).toBe('inventory-db SELECT');
    expect(db.startTime).toBeLessThan(inventory.startTime); // raw skew present
    expect(db.adjustedStart!).toBeGreaterThanOrEqual(inventory.adjustedStart! + MIN_DELTA_MS);
  });

  it('reports a positive skewCorrectionMs when corrections were applied', () => {
    const traces = loadExample();
    const corrected = traces.filter(t => t.corrected);
    expect(corrected.length).toBeGreaterThan(0);
    for (const t of corrected) {
      expect(t.skewCorrectionMs).toBeGreaterThan(0);
    }
  });

  it('is idempotent: correcting an already-corrected trace adds no further shift', () => {
    const traces = loadExample();
    const once = traces[0];
    const twice = correctClockSkew(once);
    expect(twice.skewCorrectionMs).toBe(0);
  });
});
