import type { SnapshotDiffRecord } from '../types';
import { generateId } from '../utils/helpers';

/** Add a new record to the snapshot diff history, returning a new array. */
export function addSnapshotDiff(
  diffs: SnapshotDiffRecord[],
  newRecord: Omit<SnapshotDiffRecord, 'id' | 'timestamp'>,
): SnapshotDiffRecord[] {
  const record: SnapshotDiffRecord = {
    ...newRecord,
    id: generateId('snap-diff-'),
    timestamp: Date.now(),
  };
  return [...diffs, record];
}

/** Extract growth trend data from history records for charting. */
export function getGrowthTrend(records: SnapshotDiffRecord[]): {
  dates: string[];
  retainedSizes: number[];
  newNodes: number[];
} {
  return {
    dates: records.map((r) => new Date(r.timestamp).toLocaleDateString()),
    retainedSizes: records.map((r) => r.retainedSizeDelta),
    newNodes: records.map((r) => r.newNodeCount),
  };
}

/** Detect a simple leak pattern based on the most recent records. */
export function detectLeakPattern(
  records: SnapshotDiffRecord[],
): { flagged: boolean; pattern: 'growing' | 'stable' | 'shrinking' | 'unknown'; description: string } {
  if (records.length === 0) {
    return { flagged: false, pattern: 'unknown', description: 'Not enough history to determine a leak pattern yet.' };
  }

  const lastThree = records.slice(-3);
  if (lastThree.length >= 3 && lastThree.every((r) => r.retainedSizeDelta > 0)) {
    return {
      flagged: true,
      pattern: 'growing',
      description: 'Memory retained size has been increasing across the last 3 comparisons. This could indicate a growing memory leak risk.',
    };
  }

  const last = records[records.length - 1];
  if (last.retainedSizeDelta === 0) {
    return { flagged: false, pattern: 'stable', description: 'The latest comparison shows no change in retained size.' };
  }
  if (last.retainedSizeDelta < 0) {
    return { flagged: false, pattern: 'shrinking', description: 'The latest comparison shows a decrease in retained size — memory appears to be recovering.' };
  }
  return { flagged: false, pattern: 'stable', description: 'No clear leak pattern detected yet.' };
}
