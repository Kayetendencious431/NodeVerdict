import { analyzeTracingEvents, loadTracingData, loadNdvBuffer, buildWaterfall, buildDependencies, findBottlenecks } from '../engine';
import type { TracingAnalysis, TraceViewerData, TraceSpan } from '../types';
import { createWorkerHandler } from './worker-factory';

export interface TracingWorkerInput {
  /** JSON string content, or 'ndv' to use buffer path */
  content: string;
  /** Optional binary buffer for .ndv format */
  ndvBuffer?: ArrayBuffer;
  /** Format hint */
  format?: 'json' | 'ndv';
}

export type TracingWorkerOutput = TraceViewerData;

function flattenChildren(span: TraceSpan): TraceSpan[] {
  const result: TraceSpan[] = [];
  for (const child of span.children) {
    result.push(child);
    result.push(...flattenChildren(child));
  }
  return result;
}

self.onmessage = createWorkerHandler((input: TracingWorkerInput): TraceViewerData => {
  const events = input.format === 'ndv' && input.ndvBuffer
    ? loadNdvBuffer(input.ndvBuffer)
    : loadTracingData(input.content);

  const analysis: TracingAnalysis = analyzeTracingEvents(events);

  // All heavy computation done here in the Worker
  const spans = buildWaterfall(analysis.operations, analysis.events);
  const dependencies = buildDependencies(analysis.operations);
  const allSpans = spans.flatMap(s => [s, ...flattenChildren(s)]);
  const bottlenecks = findBottlenecks(allSpans);

  // Return only the lightweight TraceViewerData — no raw events/operations
  return {
    channelStats: analysis.channelStats,
    totalEvents: analysis.totalEvents,
    totalOperations: analysis.totalOperations,
    errorRate: analysis.errorRate,
    timeRange: analysis.timeRange,
    channels: analysis.channels,
    spans,
    dependencies,
    bottlenecks,
  };
});