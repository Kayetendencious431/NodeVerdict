// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync, execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { encodeNdv } from '../src/shared/engine';
import type { TracingEvent } from '../src/shared/types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, '../cli/check.mjs');
const EXAMPLE = resolve(__dirname, '../examples/tracing-perf-before.json');

function run(args: string[], opts: { expectCode?: number } = {}): string {
  const expected = opts.expectCode ?? 0;
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
    return stdout;
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    if (e.status === expected) return `${e.stdout ?? ''}${e.stderr ?? ''}`;
    throw new Error(`CLI exit ${e.status}, expected ${expected}: ${e.stderr ?? e.stdout ?? ''}`);
  }
}

beforeAll(() => {
  try {
    execFileSync(process.execPath, [
      resolve(__dirname, '../node_modules/esbuild/bin/esbuild'),
      'cli/check.ts', '--bundle', '--platform=node', '--format=esm', '--outfile=cli/check.mjs',
    ], { cwd: resolve(__dirname, '..'), stdio: 'ignore' });
  } catch {
    // reuse the existing bundle
  }
});

describe('node-verdict check CLI', () => {
  it('exits 0 when the sample trace passes the default gate', () => {
    run(['check', EXAMPLE], { expectCode: 0 });
  });

  it('exits 1 when a strict threshold is violated', () => {
    const out = run(['check', EXAMPLE, '--threshold=p99MaxMs=10'], { expectCode: 1 });
    expect(out).toContain('FAIL');
  });

  it('exits 2 on usage error', () => {
    run(['check'], { expectCode: 2 });
  });

  it('exits 2 when the trace file does not exist', () => {
    run(['check', 'no-such-file.json'], { expectCode: 2 });
  });

  it('emits machine-readable JSON with --json', () => {
    const out = run(['check', EXAMPLE, '--json'], { expectCode: 0 });
    const parsed = JSON.parse(out) as { passed: boolean; rules: unknown[]; metrics: { totalEvents: number } };
    expect(parsed.passed).toBe(true);
    expect(Array.isArray(parsed.rules)).toBe(true);
    expect(parsed.metrics.totalEvents).toBeGreaterThan(0);
  });

  it('writes a markdown report with --report', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ndv-report-'));
    try {
      const report = join(dir, 'report.md');
      run(['check', EXAMPLE, `--report=${report}`], { expectCode: 0 });
      const content = readFileSync(report, 'utf-8');
      expect(content).toContain('NodeVerdict Performance Gate');
      expect(content).toContain('tracing-perf-before.json');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('accepts a .ndv binary trace file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ndv-trace-'));
    try {
      const events: TracingEvent[] = [
        { channel: 'http:request', eventType: 'start', context: {}, timestamp: 0, operationId: 'a' },
        { channel: 'http:request', eventType: 'end', context: {}, timestamp: 10, duration: 10, operationId: 'a' },
      ];
      const ndv = join(dir, 'trace.ndv');
      writeFileSync(ndv, encodeNdv(events));
      const out = run(['check', ndv, '--json'], { expectCode: 0 });
      const parsed = JSON.parse(out) as { metrics: { totalEvents: number } };
      expect(parsed.metrics.totalEvents).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads thresholds from a --config JSON file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ndv-config-'));
    try {
      const cfg = join(dir, 'gate.json');
      writeFileSync(cfg, JSON.stringify({ p99MaxMs: 1 }));
      run(['check', EXAMPLE, `--config=${cfg}`], { expectCode: 1 });
      writeFileSync(cfg, JSON.stringify({ p99MaxMs: 10000 }));
      run(['check', EXAMPLE, `--config=${cfg}`], { expectCode: 0 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
