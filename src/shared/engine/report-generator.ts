import LZString from 'lz-string';
import type { ChannelStats, LeakSuspicion } from '../types';
import type { ReportData } from '../types';

export function compressReport(data: ReportData): string {
  return LZString.compressToEncodedURIComponent(JSON.stringify(data));
}

export function decompressReport(compressed: string): ReportData | null {
  try {
    const json = LZString.decompressFromEncodedURIComponent(compressed);
    if (!json) return null;
    return JSON.parse(json) as ReportData;
  } catch {
    return null;
  }
}

export function generateReport(
  channelStats: ChannelStats[],
  totalEvents: number,
  totalOperations: number,
  errorRate: number,
  heapAnalysis?: { totalSize: number; topObjects: { name: string; size: number }[]; leakCount: number; leakSuspects: Pick<LeakSuspicion, 'severity' | 'category' | 'description'>[] },
): ReportData {
  const keyFindings: string[] = [];

  for (const cs of channelStats) {
    if (cs.avgDuration > 100) {
      keyFindings.push(`"${cs.channel}" avg ${cs.avgDuration.toFixed(0)}ms, P95 ${cs.p95Duration.toFixed(0)}ms`);
    }
    if (cs.errorCount > 0) {
      keyFindings.push(`"${cs.channel}" has ${cs.errorCount} errors (${(cs.errorCount / cs.totalOperations * 100).toFixed(1)}%)`);
    }
  }

  if (heapAnalysis) {
    if (heapAnalysis.leakCount > 0) {
      keyFindings.push(`Heap analysis found ${heapAnalysis.leakCount} potential leak(s)`);
    }
    keyFindings.push(`Heap total: ${(heapAnalysis.totalSize / 1024 / 1024).toFixed(1)}MB`);
  }

  if (keyFindings.length === 0) {
    keyFindings.push('No significant findings');
  }

  return {
    version: 1,
    generatedAt: Date.now(),
    eventSummary: {
      channels: channelStats,
      totalEvents,
      totalOperations,
      errorRate,
    },
    keyFindings,
    heapAnalysis,
  };
}