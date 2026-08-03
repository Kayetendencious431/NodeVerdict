import type { ChannelStats } from './tracing';
import type { LeakSuspicion } from './heap';

export interface ReportData {
  version: 1;
  generatedAt: number;
  eventSummary?: {
    channels: ChannelStats[];
    totalEvents: number;
    totalOperations: number;
    errorRate: number;
  };
  keyFindings: string[];
  heapAnalysis?: {
    totalSize: number;
    topObjects: { name: string; size: number }[];
    leakCount: number;
    leakSuspects: Pick<LeakSuspicion, 'severity' | 'category' | 'description'>[];
  };
}

export const REPORT_CURRENT_VERSION = 1;