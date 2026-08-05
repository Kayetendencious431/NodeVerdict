import { describe, it, expect } from 'vitest';
import { StreamingRCA, analyzeStreamingRca } from '../src/shared/streaming/streaming-rca';
import type { TracingEvent } from '../src/shared/types';

function ev(
  channel: string,
  eventType: TracingEvent['eventType'],
  timestamp: number,
  operationId: string,
  context: Record<string, unknown> = {},
  duration?: number,
): TracingEvent {
  return { channel, eventType, context, timestamp, operationId, duration };
}

const noWindow = { windowMs: 1_000_000 } as const; // effectively make all samples recent

describe('StreamingRCA', () => {
  it('evaluates a partial DAG: an open (unclosed) span is flagged with penalized confidence', () => {
    const rca = new StreamingRCA(noWindow);
    // A request starts but never ends within the snapshot.
    rca.ingest(ev('express:request', 'start', 0, 'req1'));
    const report = rca.snapshot(100);
    const finding = report.findings.find((f) => f.nodeId === 'req1')!;
    expect(finding.open).toBe(true);
    expect(finding.signals).toContain('incomplete-open-span');
    // Confidence penalized to zero because there is zero closed evidence AND open.
    expect(report.openSpanCount).toBe(1);
    expect(report.overallConfidence).toBeLessThan(1);
  });

  it('detects a latency spike vs an all-time baseline and ranks it highest', () => {
    const rca = new StreamingRCA(noWindow);
    // Fast baseline first.
    for (let i = 0; i < 8; i++) {
      rca.ingest(ev('mysql2:query', 'start', i * 10, `fast-${i}`));
      rca.ingest(ev('mysql2:query', 'end', i * 10 + 1, `fast-${i}`, {}, 1));
    }
    // A slow blip near the reference time.
    rca.ingest(ev('mysql2:query', 'start', 1000, 'slow'));
    rca.ingest(ev('mysql2:query', 'end', 1050, 'slow', {}, 50));
    const report = rca.snapshot(1100);
    const slow = report.findings.find((f) => f.nodeId === 'slow')!;
    expect(slow.signals).toContain('latency-spike');
    expect(slow.latencyRatio).toBeGreaterThan(1);
    expect(slow.windowMeanMs).toBeGreaterThan(slow.baselineMs);
    // The slow op is the top finding.
    expect(report.findings[0].nodeId).toBe('slow');
  });

  it('detects an error-rate spike', () => {
    // A real window that covers only the later errored samples.
    const rca = new StreamingRCA({ windowMs: 60 });
    for (let i = 0; i < 8; i++) {
      rca.ingest(ev('kafka:consume', 'start', i * 10, `ok-${i}`));
      rca.ingest(ev('kafka:consume', 'end', i * 10 + 1, `ok-${i}`, {}, 1));
    }
    // Now several errors (at t=100..130), just inside the window anchored at 131.
    for (let i = 0; i < 4; i++) {
      const id = `err-${i}`;
      rca.ingest(ev('kafka:consume', 'start', 100 + i * 10, id));
      rca.ingest(ev('kafka:consume', 'error', 100 + i * 10 + 1, id, { error: 'boom' }, 1));
    }
    const report = rca.snapshot(131);
    for (const id of ['err-0', 'err-1', 'err-2', 'err-3']) {
      const f = report.findings.find((x) => x.nodeId === id)!;
      expect(f.signals).toContain('high-error-count');
    }
    expect(report.earlyWarnings.some((w) => w.channel === 'kafka:consume')).toBe(true);
  });

  it('blame flows child -> parent so the root request is implicated', () => {
    const rca = new StreamingRCA(noWindow);
    // A request -> db query that errors. Baseline queries are fast.
    for (let i = 0; i < 6; i++) {
      rca.ingest(ev('mysql2:query', 'start', i * 10, `b-${i}`));
      rca.ingest(ev('mysql2:query', 'end', i * 10 + 1, `b-${i}`, {}, 1));
    }
    rca.ingest(ev('express:request', 'start', 500, 'req', { parentOperationId: undefined }));
    rca.ingest(ev('mysql2:query', 'start', 501, 'q', { parentOperationId: 'req' }));
    rca.ingest(ev('mysql2:query', 'error', 530, 'q', { parentOperationId: 'req', error: 'conn' }, 29));
    rca.ingest(ev('express:request', 'end', 560, 'req', { parentOperationId: undefined }, 60));
    const report = rca.snapshot(600);
    const q = report.findings.find((f) => f.nodeId === 'q')!;
    const req = report.findings.find((f) => f.nodeId === 'req')!;
    expect(q.score).toBeGreaterThan(0.8); // errored child is a strong seed
    expect(req.score).toBeGreaterThan(0); // blame propagated to parent
    // The errored leaf has the highest raw signal among the two.
    expect(q.signals).toContain('high-error-count');
  });

  it('is incremental: verdicts change as events stream in', () => {
    const rca = new StreamingRCA({ ...noWindow, minSamples: 1 });
    rca.ingest(ev('express:request', 'start', 0, 'req'));
    const early = rca.snapshot(10);
    expect(early.overallConfidence).toBe(0); // no closed evidence yet

    rca.ingest(ev('express:request', 'end', 10, 'req', {}, 10));
    const closed = rca.snapshot(20);
    expect(closed.overallConfidence).toBe(1); // >= minSamples closed
    const f = closed.findings.find((x) => x.nodeId === 'req')!;
    expect(f.open).toBe(false);
  });

  it('one-shot analyzeStreamingRca over a list returns findings', () => {
    const report = analyzeStreamingRca(
      [
        ev('express:request', 'start', 0, 'req'),
        ev('mysql2:query', 'start', 1, 'q', { parentOperationId: 'req' }),
        ev('mysql2:query', 'error', 100, 'q', { parentOperationId: 'req', error: 'x' }, 99),
        ev('express:request', 'end', 120, 'req', {}, 120),
      ],
      noWindow,
    );
    expect(report.findings.length).toBe(2);
    const q = report.findings.find((f) => f.nodeId === 'q')!;
    expect(q.signals).toContain('high-error-count');
    expect(report.overallConfidence).toBeGreaterThan(0);
  });
});