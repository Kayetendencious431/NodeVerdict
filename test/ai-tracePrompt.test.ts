import { describe, it, expect } from 'vitest';
import { analyzeTracingEvents, buildWaterfall } from '../src/shared/engine';
import { buildTracePrompt, buildUserPrompt, buildSystemPrompt } from '../src/shared/ai';
import type { TracingEvent } from '../src/shared/types';

function ev(channel: string, eventType: TracingEvent['eventType'], timestamp: number, operationId: string, extra: Partial<TracingEvent> = {}): TracingEvent {
  return { channel, eventType, context: {}, timestamp, operationId, ...extra };
}

function makePrompt() {
  const events: TracingEvent[] = [
    ev('express:request', 'start', 0, 'root'),
    ev('mysql2:query', 'start', 1, 'child'),
    ev('mysql2:query', 'error', 100, 'child', { error: { name: 'ETIMEDOUT', message: 'connect timeout' } }),
    ev('redis:get', 'start', 101, 'cache'),
    ev('redis:get', 'end', 106, 'cache'),
    ev('express:request', 'end', 110, 'root'),
  ];
  const analysis = analyzeTracingEvents(events);
  const spans = buildWaterfall(analysis.operations, analysis.events);
  return { prompt: buildTracePrompt(analysis, spans), analysis };
}

describe('buildTracePrompt', () => {
  it('summarizes the trace overview', () => {
    const { prompt } = makePrompt();
    expect(prompt.overview).toMatchObject({ events: 6, operations: 3, channels: 3 });
    expect(prompt.overview.durationMs).toBe(110);
  });

  it('builds a nested span tree with parent-share percentages', () => {
    const { prompt } = makePrompt();
    expect(prompt.spanTree).toHaveLength(1);
    const root = prompt.spanTree[0];
    expect(root.channel).toBe('express:request');
    expect(root.children).toHaveLength(2);
    const child = root.children[0];
    expect(child.channel).toBe('mysql2:query');
    expect(child.status).toBe('error');
    expect(child.shareOfParent).toBeCloseTo(90, 0);
    expect(child.errorMessage).toBe('connect timeout');
  });

  it('collects error events into the error list', () => {
    const { prompt } = makePrompt();
    expect(prompt.errorList).toHaveLength(1);
    expect(prompt.errorList[0]).toMatchObject({ channel: 'mysql2:query', message: 'connect timeout' });
  });
});

describe('buildUserPrompt', () => {
  it('renders the trace overview line', () => {
    const { prompt } = makePrompt();
    const user = buildUserPrompt(prompt, 'en');
    expect(user).toContain('Trace overview: 6 events, 3 operations');
    expect(user).toContain('Channel statistics');
    expect(user).toContain('mysql2:query');
  });

  it('renders the requested markdown structure for zh and en', () => {
    const { prompt } = makePrompt();
    expect(buildUserPrompt(prompt, 'zh')).toContain('## 根因分析');
    expect(buildUserPrompt(prompt, 'en')).toContain('## Root Cause Analysis');
  });
});

describe('buildSystemPrompt', () => {
  it('includes the Node.js ecosystem knowledge base', () => {
    const system = buildSystemPrompt();
    expect(system).toContain('NodeVerdict');
    expect(system).toContain('connection pools');
  });
});
