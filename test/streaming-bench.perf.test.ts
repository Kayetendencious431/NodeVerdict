import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { IncrementalJsonParser, StreamingTraceAnalyzer } from '../src/shared/streaming';
import { analyzeTracingEvents } from '../src/shared/engine';
import type { TracingEvent } from '../src/shared/types';

/**
 * Streaming vs in-memory benchmark + parity check.
 * Run with:  BENCH_STREAM=1 npx vitest run test/streaming-bench.perf.test.ts
 * Tune size with: BENCH_EVENTS=500000
 */

const runBench = process.env.BENCH_STREAM === '1';
const bench = runBench ? describe : describe.skip;

function genEventsText(count: number): string {
  const channels = ['express:request', 'mysql2:query', 'ioredis:set', 'http:fetch', 'kafka:produce'];
  const parts = new Array<string>(count);
  for (let i = 0; i < count; i += 2) {
    const ch = channels[i % channels.length];
    const op = `op${i}`;
    parts[i] = JSON.stringify({ channel: ch, eventType: 'start', timestamp: i * 10, operationId: op, context: { req: i % 100 } });
    parts[i + 1] = JSON.stringify({ channel: ch, eventType: (i % 7 === 0) ? 'error' : 'end', timestamp: i * 10 + (i % 50), operationId: op, context: { req: i % 100 } });
  }
  return `[${parts.join(',')}]`;
}

bench('Streaming vs in-memory', () => {
  it('parity + timing', async () => {
    const count = Number(process.env.BENCH_EVENTS ?? 200_000);    const dir = mkdtempSync(join(tmpdir(), 'ndv-bench-'));
    const file = join(dir, 'trace.json');
    const text = genEventsText(count);
    writeFileSync(file, text);
    const bytes = text.length;

    // ── In-memory path ─────────────────────────────────────────────
    const heap0 = process.memoryUsage().heapUsed;
    const t0 = performance.now();
    const parsed = JSON.parse(text) as TracingEvent[];
    const t1 = performance.now();
    const sync = analyzeTracingEvents(parsed);
    const t2 = performance.now();
    const heap1 = process.memoryUsage().heapUsed;

    // ── Streaming path ─────────────────────────────────────────────
    const blob = new File([text], 'trace.json');
    const stream = blob.stream().pipeThrough(new TextDecoderStream());
    const parser = new IncrementalJsonParser();
    const analyzer = new StreamingTraceAnalyzer({ maxEvents: 250_000, maxOperations: 250_000 });
    const t3 = performance.now();
    let seen = 0;
    for await (const chunk of stream) {
      parser.push(chunk);
      let item: string | null;
      while ((item = parser.next()) !== null) {
        analyzer.feed(JSON.parse(item) as TracingEvent);
        seen++;
      }
    }
    const t4 = performance.now();

    // ── Parity ─────────────────────────────────────────────────────
    expect(seen).toBe(count);
    expect(analyzer.progress.eventsSeen).toBe(count);

    const streamAnalysis = analyzer.finish(bytes).analysis;
    expect(streamAnalysis.totalEvents).toBe(sync.totalEvents);
    expect(streamAnalysis.totalOperations).toBe(sync.totalOperations);
    expect(streamAnalysis.errorRate).toBeCloseTo(sync.errorRate, 10);
    expect(streamAnalysis.channels).toEqual(sync.channels);
    for (const cs of sync.channelStats) {
      const mine = streamAnalysis.channelStats.find(s => s.channel === cs.channel)!;
      expect(mine.totalOperations).toBe(cs.totalOperations);
      expect(mine.p95Duration).toBe(cs.p95Duration);
      expect(mine.errorCount).toBe(cs.errorCount);
    }

    const parseMs = (t1 - t0).toFixed(0);
    const analyzeMs = (t2 - t1).toFixed(0);
    const streamMs = (t4 - t3).toFixed(0);
    const syncHeapMb = ((heap1 - heap0) / 1024 / 1024).toFixed(0);
    const mb = (bytes / 1024 / 1024).toFixed(1);
    const inMemTotal = Math.max(1, (t1 - t0) + (t2 - t1));

    // eslint-disable-next-line no-console
    console.log(`\n  file: ${mb} MB (${count.toLocaleString()} events, ${(bytes / count).toFixed(0)} B/event)`);
    // eslint-disable-next-line no-console
    console.log(`  in-memory : JSON.parse ${parseMs}ms + analyze ${analyzeMs}ms | +${syncHeapMb} MB heap`);
    // eslint-disable-next-line no-console
    console.log(`  streaming : ${streamMs}ms wall (stream + tokenize + pair + stats)`);
    // eslint-disable-next-line no-console
    console.log(`  ratio: ${((t4 - t3) / inMemTotal).toFixed(2)}x vs in-memory\n`);

    rmSync(dir, { recursive: true, force: true });
  });
});
