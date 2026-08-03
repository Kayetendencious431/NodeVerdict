import { analyzeTracingEvents } from '../engine';
import type { TracingEvent, TracingAnalysis } from '../types';
import { createWorkerHandler } from './worker-factory';

self.onmessage = createWorkerHandler((events: TracingEvent[]) => {
  return analyzeTracingEvents(events);
});

export type TracingWorkerInput = TracingEvent[];
export type TracingWorkerOutput = TracingAnalysis;