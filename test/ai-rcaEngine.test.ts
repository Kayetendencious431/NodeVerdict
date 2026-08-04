import { describe, it, expect, beforeEach } from 'vitest';
import { analyzeTracingEvents, buildWaterfall } from '../src/shared/engine';
import {
  loadRcaConfig,
  saveRcaConfig,
  clearRcaConfig,
  isRcaConfigured,
  analyzeTraceLocally,
} from '../src/shared/ai';
import type { TracingEvent } from '../src/shared/types';

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  (globalThis as unknown as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  };
});

describe('RCA config persistence', () => {
  it('returns null when nothing is stored', () => {
    expect(loadRcaConfig()).toBeNull();
    expect(isRcaConfigured()).toBe(false);
  });

  it('persists and loads a config with defaults applied', () => {
    saveRcaConfig({ apiKey: 'sk-test', baseUrl: '', model: '' });
    const cfg = loadRcaConfig()!;
    expect(cfg.apiKey).toBe('sk-test');
    expect(cfg.baseUrl).toBe('https://api.openai.com/v1');
    expect(cfg.model).toBe('gpt-4o-mini');
    expect(isRcaConfigured()).toBe(true);
  });

  it('ignores a stored config without an api key', () => {
    store.set('nodeverdict-ai-config', JSON.stringify({ baseUrl: 'http://x' }));
    expect(loadRcaConfig()).toBeNull();
  });

  it('tolerates corrupted JSON in storage', () => {
    store.set('nodeverdict-ai-config', '{oops');
    expect(loadRcaConfig()).toBeNull();
  });

  it('clearRcaConfig removes the stored config', () => {
    saveRcaConfig({ apiKey: 'sk-x', baseUrl: '', model: '' });
    clearRcaConfig();
    expect(isRcaConfigured()).toBe(false);
  });
});

describe('analyzeTraceLocally', () => {
  function build() {
    const events: TracingEvent[] = [
      // Dominant slow channel
      ...[1, 2, 3].flatMap(i => [
        ev('mysql2:query', 'start', i * 200, `slow-${i}`),
        ev('mysql2:query', 'end', i * 200 + 100, `slow-${i}`),
      ]),
      // Fast channel
      ev('redis:get', 'start', 1000, 'fast'),
      ev('redis:get', 'end', 1005, 'fast'),
      // An error deep in the tree
      ev('express:request', 'start', 50, 'root'),
      ev('mysql2:query', 'error', 75, 'err-child', { error: { name: 'Timeout', message: 'pool exhausted' } }),
      ev('express:request', 'end', 80, 'root'),
    ];
    const analysis = analyzeTracingEvents(events);
    const spans = buildWaterfall(analysis.operations, analysis.events);
    return { analysis, spans };
  }

  it('flags the dominant slow channel as primary suspect', () => {
    const { analysis, spans } = build();
    const zh = analyzeTraceLocally(analysis, spans, 'zh');
    expect(zh).toContain('## 根因分析（本地启发式）');
    expect(zh).toContain('mysql2:query');
    expect(zh).toContain('主要嫌疑频道');
    expect(zh).toContain('100.0ms');

    const en = analyzeTraceLocally(analysis, spans, 'en');
    expect(en).toContain('## Root Cause Analysis (local heuristic)');
    expect(en).toContain('Primary suspect channel');
  });

  it('reports the deepest error in the span tree', () => {
    const { analysis, spans } = build();
    const zh = analyzeTraceLocally(analysis, spans, 'zh');
    expect(zh).toContain('最深层的错误');
    expect(zh).toContain('mysql2:query');
  });
});

function ev(channel: string, eventType: TracingEvent['eventType'], timestamp: number, operationId: string, extra: Partial<TracingEvent> = {}): TracingEvent {
  return { channel, eventType, context: {}, timestamp, operationId, ...extra };
}
