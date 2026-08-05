import { analyzeCpuProfile } from '../engine';
import type { CpuProfileAnalysis } from '../types';
import { createWorkerHandler } from './worker-factory';

self.onmessage = createWorkerHandler((raw: string): CpuProfileAnalysis => {
  return analyzeCpuProfile(raw);
});

export type CpuProfileWorkerInput = string;
export type CpuProfileWorkerOutput = CpuProfileAnalysis;