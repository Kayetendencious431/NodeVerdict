import type { TraceViewerData, TraceSpan } from '../types';
import { buildTracePrompt, buildUserPrompt, buildSystemPrompt, type TracePrompt } from './tracePrompt';

/**
 * Auto-RCA engine.
 * Converts a trace into a prompt and calls an OpenAI-compatible /chat/completions
 * endpoint with streaming support. The API key never leaves the browser's
 * localStorage and requests are made directly from the client (CORS permitting).
 */

export interface RcaConfig {
  apiKey: string;
  /** OpenAI-compatible base URL, e.g. https://api.openai.com/v1 */
  baseUrl: string;
  model: string;
}

export interface RcaOptions {
  config: RcaConfig;
  analysis: TraceViewerData;
  spans: TraceSpan[];
  lang: 'en' | 'zh';
  signal?: AbortSignal;
  onStream?: (chunk: string) => void;
}

const DEFAULT_CONFIG_KEY = 'nodeverdict-ai-config';

export function loadRcaConfig(): RcaConfig | null {
  try {
    const raw = localStorage.getItem(DEFAULT_CONFIG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RcaConfig>;
    if (!parsed.apiKey) return null;
    return {
      apiKey: parsed.apiKey,
      baseUrl: parsed.baseUrl || 'https://api.openai.com/v1',
      model: parsed.model || 'gpt-4o-mini',
    };
  } catch {
    return null;
  }
}

export function saveRcaConfig(config: RcaConfig): void {
  localStorage.setItem(DEFAULT_CONFIG_KEY, JSON.stringify(config));
}

export function clearRcaConfig(): void {
  localStorage.removeItem(DEFAULT_CONFIG_KEY);
}

export function isRcaConfigured(): boolean {
  return loadRcaConfig() !== null;
}

export function buildRcaPrompt(analysis: TraceViewerData, spans: TraceSpan[], lang: 'en' | 'zh'): TracePrompt {
  return buildTracePrompt(analysis, spans);
}

/**
 * Runs the root-cause analysis and returns the full markdown answer.
 * When onStream is provided, chunks are delivered as they arrive.
 */
export async function analyzeTraceWithLLM(opts: RcaOptions): Promise<string> {
  const { config, analysis, spans, lang, signal, onStream } = opts;
  const prompt = buildTracePrompt(analysis, spans);

  const endpoint = config.baseUrl.replace(/\/$/, '') + '/chat/completions';
  const body = {
    model: config.model,
    stream: true,
    temperature: 0.2,
    messages: [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: buildUserPrompt(prompt, lang) },
    ],
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`AI request failed (${res.status}): ${text.slice(0, 300)}`);
  }

  if (!res.body) {
    throw new Error('AI response stream unavailable');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (data === '[DONE]') continue;
      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta?.content ?? '';
        if (delta) {
          full += delta;
          onStream?.(delta);
        }
      } catch {
        // ignore malformed streaming chunks
      }
    }
  }

  return full;
}

/** Heuristic fallback analysis used when no API key is configured. */
export function analyzeTraceLocally(analysis: TraceViewerData, spans: TraceSpan[], lang: 'en' | 'zh'): string {
  const lines: string[] = [];
  lines.push(lang === 'zh' ? '## 根因分析（本地启发式）' : '## Root Cause Analysis (local heuristic)');

  const total = analysis.timeRange.end - analysis.timeRange.start || 1;

  // Dominant channel by average latency × operation count
  const scored = analysis.channelStats
    .map(cs => ({ cs, score: cs.avgDuration * cs.totalOperations }))
    .sort((a, b) => b.score - a.score);
  const dominant = scored[0];

  if (dominant) {
    lines.push('');
    lines.push(lang === 'zh'
      ? `### 1. 主要嫌疑频道\n\n**${dominant.cs.channel}**：平均 ${dominant.cs.avgDuration.toFixed(1)}ms，P95 ${dominant.cs.p95Duration.toFixed(1)}ms，共 ${dominant.cs.totalOperations} 个操作，错误 ${dominant.cs.errorCount} 个。这是耗时贡献最大的频道。`
      : `### 1. Primary suspect channel\n\n**${dominant.cs.channel}**: avg ${dominant.cs.avgDuration.toFixed(1)}ms, P95 ${dominant.cs.p95Duration.toFixed(1)}ms, ${dominant.cs.totalOperations} ops, ${dominant.cs.errorCount} errors. Highest cost contribution.`);
  }

  // Deepest error in the span tree
  const flat: { span: TraceSpan; depth: number }[] = [];
  const walk = (s: TraceSpan, depth: number) => { flat.push({ span: s, depth }); s.children.forEach(c => walk(c, depth + 1)); };
  spans.forEach(s => walk(s, 0));
  const deepestError = flat
    .filter(f => f.span.status === 'error')
    .sort((a, b) => b.depth - a.depth)[0];

  if (deepestError) {
    lines.push('');
    lines.push(lang === 'zh'
      ? `### 2. 最深层的错误\n\n**${deepestError.span.channel}**（${deepestError.span.operationId.slice(0, 12)}）在深度 ${deepestError.depth} 处失败，耗时 ${deepestError.span.duration.toFixed(1)}ms。`
      : `### 2. Deepest error\n\n**${deepestError.span.channel}** (${deepestError.span.operationId.slice(0, 12)}) failed at depth ${deepestError.depth}, ${deepestError.span.duration.toFixed(1)}ms.`);
  }

  // Share of total
  const slowest = [...flat].sort((a, b) => b.span.duration - a.span.duration)[0];
  if (slowest) {
    const share = total > 0 ? ((slowest.span.duration / total) * 100).toFixed(1) : '0';
    lines.push('');
    lines.push(lang === 'zh'
      ? `### 3. 最耗时跨度\n\n**${slowest.span.channel}** 耗时 ${slowest.span.duration.toFixed(1)}ms，占整个 Trace 窗口（${total.toFixed(0)}ms）的 ${share}%。优先检查该跨度的实现。`
      : `### 3. Most expensive span\n\n**${slowest.span.channel}** took ${slowest.span.duration.toFixed(1)}ms, ${share}% of the ${total.toFixed(0)}ms trace window. Inspect its implementation first.`);
  }

  lines.push('');
  lines.push(lang === 'zh'
    ? '> 提示：以上为本地启发式分析。配置 AI API 密钥可获得结合 Node.js 生态最佳实践的深度根因分析。'
    : '> Note: local heuristic analysis. Configure an AI API key for a deeper, ecosystem-aware root-cause analysis.');
  return lines.join('\n');
}
