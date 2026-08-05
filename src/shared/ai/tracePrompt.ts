import type { TraceViewerData, TraceSpan, ChannelStats } from '../types';
import { buildKnowledgeSection } from './knowledge';

/**
 * Trace-to-Prompt converter.
 * Turns a large trace DAG into a compact, lossy-but-informative summary that an
 * LLM can reason about: topology (parent/child), timing shares, and error status.
 */

export interface TraceSummaryNode {
  operationId: string;
  channel: string;
  duration: number;
  /** Percentage of the parent's duration this node consumed (0-100). */
  shareOfParent: number;
  status: 'success' | 'error' | 'incomplete';
  errorMessage?: string;
  depth: number;
  children: TraceSummaryNode[];
}

export interface TracePrompt {
  overview: {
    events: number;
    operations: number;
    errorRate: number;
    durationMs: number;
    channels: number;
  };
  channelStats: ChannelStats[];
  spanTree: TraceSummaryNode[];
  errorList: { operationId: string; channel: string; message: string; duration: number }[];
}

function toSummaryNode(span: TraceSpan, parentDuration: number, depth: number): TraceSummaryNode {
  const errorEvent = span.status === 'error'
    ? (span.metadata as Record<string, unknown>)?.error
    : undefined;
  const errorMessage = typeof errorEvent === 'object' && errorEvent !== null
    ? String((errorEvent as { message?: string }).message ?? '')
    : undefined;

  return {
    operationId: span.operationId,
    channel: span.channel,
    duration: span.duration,
    shareOfParent: parentDuration > 0 ? Math.round((span.duration / parentDuration) * 1000) / 10 : 0,
    status: span.status,
    errorMessage,
    depth,
    children: span.children.map(c => toSummaryNode(c, span.duration, depth + 1)),
  };
}

function extractErrors(spans: TraceSpan[]): TracePrompt['errorList'] {
  const result: TracePrompt['errorList'] = [];
  const walk = (s: TraceSpan) => {
    if (s.status === 'error') {
      const errMeta = s.metadata?.error as Record<string, unknown> | undefined;
      result.push({
        operationId: s.operationId,
        channel: s.channel,
        message: (errMeta?.message as string) ?? '',
        duration: s.duration,
      });
    }
    s.children.forEach(walk);
  };
  spans.forEach(walk);
  return result.filter(e => e.message);
}

export function buildTracePrompt(analysis: TraceViewerData, spans: TraceSpan[]): TracePrompt {
  const spanTree = spans.map(s => toSummaryNode(s, analysis.timeRange.end - analysis.timeRange.start, 0));
  const errorList = extractErrors(spans);

  return {
    overview: {
      events: analysis.totalEvents,
      operations: analysis.totalOperations,
      errorRate: Math.round(analysis.errorRate * 1000) / 10,
      durationMs: analysis.timeRange.end - analysis.timeRange.start,
      channels: analysis.channels.length,
    },
    channelStats: analysis.channelStats,
    spanTree,
    errorList: errorList.slice(0, 40),
  };
}

function renderTree(nodes: TraceSummaryNode[], lines: string[] = []) {
  for (const n of nodes) {
    const indent = '  '.repeat(n.depth);
    const mark = n.status === 'error' ? '✗' : n.status === 'incomplete' ? '…' : '✓';
    const err = n.errorMessage ? ` ERROR="${n.errorMessage.slice(0, 200)}"` : '';
    lines.push(`${indent}${mark} ${n.channel} (${n.operationId.slice(0, 12)}) ${n.duration.toFixed(1)}ms [${n.shareOfParent.toFixed(1)}% of parent]${err}`);
    renderTree(n.children, lines);
  }
  return lines;
}

export function buildUserPrompt(prompt: TracePrompt, lang: 'en' | 'zh'): string {
  const lines: string[] = [];
  lines.push('Analyze the following Node.js tracing trace and produce a root-cause analysis.');
  lines.push(`Trace overview: ${prompt.overview.events} events, ${prompt.overview.operations} operations, ` +
    `${prompt.overview.errorRate}% error rate, ${prompt.overview.durationMs}ms window, ${prompt.overview.channels} channels.`);
  lines.push('');
  lines.push('Channel statistics (duration in ms):');
  lines.push('| channel | ops | avg | p50 | p95 | p99 | max | errors |');
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const cs of prompt.channelStats) {
    lines.push(`| ${cs.channel} | ${cs.totalOperations} | ${cs.avgDuration.toFixed(1)} | ${cs.p50Duration.toFixed(1)} | ${cs.p95Duration.toFixed(1)} | ${cs.p99Duration.toFixed(1)} | ${cs.maxDuration.toFixed(1)} | ${cs.errorCount} |`);
  }
  if (prompt.channelStats.length === 0) {
    lines.push('(no paired operations)');
  }
  lines.push('');
  lines.push('Span topology (each node shows % of its parent duration; ✗=error, …=incomplete):');
  if (prompt.spanTree.length === 0) {
    lines.push('(no spans)');
  } else {
    lines.push(...renderTree(prompt.spanTree));
  }
  if (prompt.errorList.length > 0) {
    lines.push('');
    lines.push(`Errors (${prompt.errorList.length}):`);
    for (const e of prompt.errorList) {
      lines.push(`- ${e.channel} ${e.operationId.slice(0, 12)}: ${e.message.slice(0, 200)}`);
    }
  }
  lines.push('');
  lines.push(lang === 'zh'
    ? '请用中文回答，并严格按照下面的格式输出（markdown）：'
    : 'Answer in English using exactly the following markdown structure:');
  lines.push(lang === 'zh'
    ? '## 根因分析\n\n### 1. 症状\n\n### 2. 关键证据（引用具体 channel / 耗时数据）\n\n### 3. 根因判断\n\n### 4. 建议修复（引用 Node.js 生态最佳实践）\n\n### 5. 置信度与下一步\n'
    : '## Root Cause Analysis\n\n### 1. Symptom\n\n### 2. Key Evidence (reference specific channels / timings)\n\n### 3. Root Cause\n\n### 4. Recommended Fixes (reference Node.js ecosystem best practices)\n\n### 5. Confidence & Next Steps');
  return lines.join('\n');
}

export function buildSystemPrompt(): string {
  return [
    'You are NodeVerdict, a senior Node.js performance engineer. You analyze tracing traces',
    '(diagnostics_channel TracingChannel data) and diagnose the root cause of latency or errors.',
    'You reason about real Node.js ecosystem behavior: connection pools, event-loop blocking,',
    'N+1 queries, blocking Redis commands, GC pauses, and library-specific tuning.',
    '',
    'Ground rules:',
    '- Only cite evidence that is present in the provided trace; do not invent numbers.',
    '- Identify the span with the largest share of its parent (the dominant cost) as the primary suspect.',
    '- Distinguish "root cause" (why latency grew) from "effect" (downstream spans that wait on it).',
    '- If an operation is slow but its children are fast, suspect synchronous work, I/O, or GC inside it.',
    '- If a child consumes most of a parent\'s time, drill into the child chain.',
    '- Match error messages against the ecosystem knowledge base below.',
    '',
    'Node.js ecosystem knowledge base:',
    buildKnowledgeSection(),
    '',
    'Keep the analysis actionable and specific to the trace. Prefer concise markdown.',
  ].join('\n');
}
