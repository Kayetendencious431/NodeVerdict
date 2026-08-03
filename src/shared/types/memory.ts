/** External memory info from process.memoryUsage() */
export interface MemoryUsageSnapshot {
  /** Timestamp of the snapshot (ms) */
  timestamp: number;
  /** Resident Set Size (bytes) */
  rss: number;
  /** V8 heap total (bytes) */
  heapTotal: number;
  /** V8 heap used (bytes) */
  heapUsed: number;
  /** External memory (bytes, includes ArrayBuffer allocations) */
  external: number;
  /** ArrayBuffer memory (bytes, available in Node.js 22+) */
  arrayBuffers: number;
}

/** A time-series of memory usage snapshots */
export interface MemoryTimeline {
  snapshots: MemoryUsageSnapshot[];
  /** Duration in ms */
  durationMs: number;
  /** Sampling interval in ms */
  intervalMs: number;
}

/** Memory growth rate analysis */
export interface MemoryGrowthRate {
  /** Source of analysis: 'timeline' | 'heap-snapshot' */
  source: 'timeline' | 'heap-snapshot';
  /** External memory growth rate (MB/s) */
  externalGrowthRateMs: number;
  /** Heap used growth rate (MB/s) */
  heapUsedGrowthRateMs: number;
  /** RSS growth rate (MB/s) */
  rssGrowthRateMs: number;
  /** Whether growth is flagged as abnormal */
  flagged: boolean;
  /** Human-readable summary */
  summary: string;
}

/** String analysis from a heap snapshot */
export interface StringAnalysis {
  /** Total number of string nodes */
  totalStrings: number;
  /** Total self size of all strings (bytes) */
  totalSelfSize: number;
  /** Total retained size of all strings (bytes) */
  totalRetainedSize: number;
  /** Number of unique string values */
  uniqueStrings: number;
  /** Deduplication ratio: 1 - (unique / total) */
  dedupRatio: number;
  /** Top largest strings by retained size */
  topStrings: { value: string; selfSize: number; retainedSize: number; count: number }[];
  /** Strings by type breakdown */
  byType: { type: string; count: number; size: number }[];
}

/** Parsed GC log entry */
export interface GCEntry {
  /** Timestamp in ms from start */
  timestamp: number;
  /** GC type: 'Scavenge' | 'MarkSweep' | 'IncrementalMarking' | 'Full' */
  type: string;
  /** Heap before (bytes) */
  heapBefore: number;
  /** Heap after (bytes) */
  heapAfter: number;
  /** External memory before (bytes) */
  externalBefore: number;
  /** External memory after (bytes) */
  externalAfter: number;
  /** GC duration (ms) */
  durationMs: number;
  /** Type of pause: 'major' | 'minor' */
  pauseType: 'major' | 'minor';
}

/** GC log analysis result */
export interface GCLogAnalysis {
  /** All parsed GC entries */
  entries: GCEntry[];
  /** Total number of GC events */
  totalGcs: number;
  /** Major GC count */
  majorGcCount: number;
  /** Minor GC count */
  minorGcCount: number;
  /** Total GC pause time (ms) */
  totalPauseMs: number;
  /** Average major GC pause (ms) */
  avgMajorPauseMs: number;
  /** Average minor GC pause (ms) */
  avgMinorPauseMs: number;
  /** External memory trend: first vs last */
  externalStart: number;
  externalEnd: number;
  /** External memory growth in MB */
  externalGrowthMb: number;
  /** Whether external memory is trending up (unmanaged) */
  externalUnmanaged: boolean;
}

/** Combined memory analysis result */
export interface MemoryAnalysis {
  /** External memory info (from heap snapshot) */
  externalMemory: {
    totalExternal: number;
    totalArrayBuffers: number;
    /** Estimated external strings (concatenated + sliced) */
    externalStrings: number;
    /** Percentage of total memory that is external */
    externalPercent: number;
  } | null;
  /** String analysis (from heap snapshot) */
  stringAnalysis: StringAnalysis | null;
  /** Memory growth rate (from timeline or heap snapshot) */
  growthRate: MemoryGrowthRate | null;
  /** GC log analysis (if GC log was uploaded) */
  gcLog: GCLogAnalysis | null;
  /** Memory timeline (if timeline was uploaded) */
  timeline: MemoryTimeline | null;
}