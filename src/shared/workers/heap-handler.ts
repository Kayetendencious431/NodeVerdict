import { parseHeapSnapshot, analyzeHeap } from '../engine';
import type { HeapAnalysis } from '../types';
import { createWorkerHandler } from './worker-factory';

self.onmessage = createWorkerHandler((raw: string) => {
  const snapshot = parseHeapSnapshot(raw);
  return analyzeHeap(snapshot);
});

export type HeapWorkerInput = string;
export type HeapWorkerOutput = HeapAnalysis;