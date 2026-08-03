import { create } from 'zustand';
import type { TracingAnalysis, HeapAnalysis, ReportData } from '../shared/types';
import type { ValidationResult } from '../shared/engine';

/**
 * Root store using Zustand with slice pattern.
 * Each feature registers its slice here for centralized access.
 */
interface RootState {
  // Event Viewer slice
  tracingAnalysis: TracingAnalysis | null;
  setTracingAnalysis: (analysis: TracingAnalysis | null) => void;
  selectedChannels: string[];
  setSelectedChannels: (channels: string[]) => void;
  selectedEventIndex: number | null;
  setSelectedEventIndex: (idx: number | null) => void;

  // Trace Viewer slice
  traceData: TracingAnalysis | null;
  setTraceData: (data: TracingAnalysis | null) => void;

  // Validator slice
  validationResults: ValidationResult[] | null;
  setValidationResults: (results: ValidationResult[] | null) => void;

  // Heap Analyzer slice
  heapAnalysis: HeapAnalysis | null;
  setHeapAnalysis: (analysis: HeapAnalysis | null) => void;

  // Report slice
  reportData: ReportData | null;
  setReportData: (data: ReportData | null) => void;
}

export const useRootStore = create<RootState>((set) => ({
  // Event Viewer
  tracingAnalysis: null,
  setTracingAnalysis: (analysis) => set({ tracingAnalysis: analysis }),
  selectedChannels: [],
  setSelectedChannels: (channels) => set({ selectedChannels: channels }),
  selectedEventIndex: null,
  setSelectedEventIndex: (idx) => set({ selectedEventIndex: idx }),

  // Trace Viewer
  traceData: null,
  setTraceData: (data) => set({ traceData: data }),

  // Validator
  validationResults: null,
  setValidationResults: (results) => set({ validationResults: results }),

  // Heap Analyzer
  heapAnalysis: null,
  setHeapAnalysis: (analysis) => set({ heapAnalysis: analysis }),

  // Report
  reportData: null,
  setReportData: (data) => set({ reportData: data }),
}));