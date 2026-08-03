import type { HeapSnapshot, StringAnalysis, MemoryTimeline, MemoryGrowthRate, GCLogAnalysis, GCEntry } from '../types';

/**
 * Analyze string data from a heap snapshot.
 * Strings are stored in the snapshot's strings array and as string-type nodes.
 */
export function analyzeStrings(snapshot: HeapSnapshot): StringAnalysis {
  // Collect all string nodes
  const stringNodes = snapshot.nodes.filter(n => n.type === 'string' || n.type === 'concatenated-string' || n.type === 'sliced-string');
  const totalStrings = stringNodes.length;
  const totalSelfSize = stringNodes.reduce((s, n) => s + n.selfSize, 0);
  const totalRetainedSize = stringNodes.reduce((s, n) => s + n.retainedSize, 0);

  // Count unique string values (from the strings table)
  const uniqueStrings = snapshot.strings.length;
  const dedupRatio = totalStrings > 0 ? 1 - (uniqueStrings / totalStrings) : 0;

  // Top largest strings by retained size
  const topStrings = stringNodes
    .sort((a, b) => b.retainedSize - a.retainedSize)
    .slice(0, 20)
    .map(n => ({
      value: n.name.length > 100 ? n.name.slice(0, 100) + '...' : n.name,
      selfSize: n.selfSize,
      retainedSize: n.retainedSize,
      count: 1,
    }));

  // Group by type
  const typeGroups = new Map<string, { count: number; size: number }>();
  for (const n of stringNodes) {
    const existing = typeGroups.get(n.type);
    if (existing) {
      existing.count++;
      existing.size += n.selfSize;
    } else {
      typeGroups.set(n.type, { count: 1, size: n.selfSize });
    }
  }
  const byType = Array.from(typeGroups.entries()).map(([type, data]) => ({
    type,
    count: data.count,
    size: data.size,
  }));

  return {
    totalStrings,
    totalSelfSize,
    totalRetainedSize,
    uniqueStrings,
    dedupRatio,
    topStrings,
    byType,
  };
}

/**
 * Analyze external memory from a heap snapshot.
 * Estimates external memory from concatenated and sliced string nodes.
 */
export function analyzeExternalMemory(snapshot: HeapSnapshot): {
  totalExternal: number;
  totalArrayBuffers: number;
  externalStrings: number;
  externalPercent: number;
} {
  // Concatenated and sliced strings represent external memory (V8 stores them off-heap)
  const externalStrings = snapshot.nodes
    .filter(n => n.type === 'concatenated-string' || n.type === 'sliced-string')
    .reduce((s, n) => s + n.retainedSize, 0);

  // Array buffers are also external
  const arrayBufferNodes = snapshot.nodes.filter(n => n.name === 'ArrayBuffer' || n.name === 'SharedArrayBuffer');
  const totalArrayBuffers = arrayBufferNodes.reduce((s, n) => s + n.retainedSize, 0);

  // Total external = external strings + array buffers
  const totalExternal = externalStrings + totalArrayBuffers;

  // Percentage of total memory
  const totalMemory = snapshot.totalSize + totalExternal;
  const externalPercent = totalMemory > 0 ? (totalExternal / totalMemory) * 100 : 0;

  return { totalExternal, totalArrayBuffers, externalStrings, externalPercent };
}

/**
 * Parse a memory usage timeline from a JSON array of process.memoryUsage() snapshots.
 * Expected format: Array of { timestamp, rss, heapTotal, heapUsed, external, arrayBuffers }
 */
export function parseMemoryTimeline(raw: string): MemoryTimeline {
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) {
    throw new Error('Memory timeline must be a JSON array of memory usage snapshots');
  }
  if (data.length < 2) {
    throw new Error('Memory timeline must contain at least 2 snapshots');
  }

  // Validate and normalize each entry
  const snapshots = data.map((entry: any, idx: number) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(`Entry ${idx} is not an object`);
    }
    // Accept both field name styles
    const timestamp = entry.timestamp ?? entry.ts ?? Date.now();
    const rss = entry.rss ?? 0;
    const heapTotal = entry.heapTotal ?? 0;
    const heapUsed = entry.heapUsed ?? 0;
    const external = entry.external ?? 0;
    const arrayBuffers = entry.arrayBuffers ?? 0;

    if (typeof timestamp !== 'number') {
      throw new Error(`Entry ${idx}: "timestamp" must be a number`);
    }

    return {
      timestamp: Math.floor(timestamp),
      rss: Math.floor(rss),
      heapTotal: Math.floor(heapTotal),
      heapUsed: Math.floor(heapUsed),
      external: Math.floor(external),
      arrayBuffers: Math.floor(arrayBuffers),
    };
  });

  // Sort by timestamp
  snapshots.sort((a, b) => a.timestamp - b.timestamp);

  const durationMs = snapshots[snapshots.length - 1].timestamp - snapshots[0].timestamp;
  const intervalMs = durationMs / (snapshots.length - 1);

  return { snapshots, durationMs, intervalMs };
}

/**
 * Calculate memory growth rate from a timeline.
 * Uses linear regression of the last half of snapshots to determine trend.
 */
export function calculateGrowthRate(timeline: MemoryTimeline): MemoryGrowthRate {
  const snapshots = timeline.snapshots;
  const n = snapshots.length;

  // Use the last 50% of snapshots for growth calculation
  const startIdx = Math.floor(n / 2);
  const subset = snapshots.slice(startIdx);
  const m = subset.length;

  if (m < 2) {
    return {
      source: 'timeline',
      externalGrowthRateMs: 0,
      heapUsedGrowthRateMs: 0,
      rssGrowthRateMs: 0,
      flagged: false,
      summary: 'Not enough data points to calculate growth rate',
    };
  }

  const t0 = subset[0].timestamp;

  // Linear regression: y = a + b*x where b is the growth rate
  function linearRegression(values: number[]): number {
    const xMean = subset.reduce((s, p) => s + (p.timestamp - t0), 0) / m;
    const yMean = values.reduce((s, v) => s + v, 0) / m;

    let num = 0, den = 0;
    for (let i = 0; i < m; i++) {
      const x = subset[i].timestamp - t0 - xMean;
      const y = values[i] - yMean;
      num += x * y;
      den += x * x;
    }

    return den !== 0 ? num / den : 0;
  }

  // Growth rates in bytes per ms, convert to MB/s
  const bytesPerMsToMbPerSec = (rate: number) => rate * 1000 / (1024 * 1024);

  const externalRate = bytesPerMsToMbPerSec(linearRegression(subset.map(s => s.external)));
  const heapUsedRate = bytesPerMsToMbPerSec(linearRegression(subset.map(s => s.heapUsed)));
  const rssRate = bytesPerMsToMbPerSec(linearRegression(subset.map(s => s.rss)));

  // Flag as abnormal if external or RSS growth > 1 MB/s
  const flagged = externalRate > 1 || rssRate > 2;

  const summary = flagged
    ? `Abnormal memory growth detected: external +${externalRate.toFixed(2)} MB/s, heap +${heapUsedRate.toFixed(2)} MB/s, RSS +${rssRate.toFixed(2)} MB/s. Check for unmanaged external memory (e.g., large string buffers, ArrayBuffers not freed).`
    : `Memory growth appears normal: external +${externalRate.toFixed(2)} MB/s, heap +${heapUsedRate.toFixed(2)} MB/s, RSS +${rssRate.toFixed(2)} MB/s.`;

  return {
    source: 'timeline',
    externalGrowthRateMs: externalRate,
    heapUsedGrowthRateMs: heapUsedRate,
    rssGrowthRateMs: rssRate,
    flagged,
    summary,
  };
}

/**
 * Parse a --trace-gc log into structured GC entries.
 * Handles both V8's default format and Node.js enhanced format.
 *
 * Example input lines:
 * [82365:0x158001600]    11623 ms: Scavenge 78.6 (92.8) -> 69.5 (93.8) MB, 1.9 / 0.0 ms  (average mu = 0.994, current mu = 0.994) allocation failure
 * [82365:0x158001600]    12456 ms: Mark-sweep 93.8 (109.6) -> 84.2 (107.2) MB, 6.3 / 0.0 ms  (average mu = 0.992, current mu = 0.992) allocation failure
 */
export function parseGcLog(raw: string): GCLogAnalysis {
  const lines = raw.split('\n');
  const entries: GCEntry[] = [];

  // Regex for V8 GC log format
  // Groups: timestamp, type, heapBefore, heapTotalBefore, heapAfter, heapTotalAfter, duration
  const gcRegex = /(\d+)\s*ms:\s+(\S+)\s+([\d.]+)\s+\(([\d.]+)\)\s*->\s*([\d.]+)\s+\(([\d.]+)\)\s+MB,\s+([\d.]+)\s*\/\s*([\d.]+)\s*ms/;

  for (const line of lines) {
    const match = line.match(gcRegex);
    if (match) {
      const timestamp = parseInt(match[1], 10);
      const type = match[2].trim();
      const heapBefore = parseFloat(match[3]) * 1024 * 1024;
      const heapAfter = parseFloat(match[5]) * 1024 * 1024;
      const durationMs = parseFloat(match[7]) + parseFloat(match[8]);
      const pauseType = type.toLowerCase().includes('scavenge') ? 'minor' : 'major';

      entries.push({
        timestamp,
        type,
        heapBefore: Math.floor(heapBefore),
        heapAfter: Math.floor(heapAfter),
        externalBefore: 0, // Not available in standard trace-gc output
        externalAfter: 0,
        durationMs,
        pauseType,
      });
    }
  }

  if (entries.length === 0) {
    throw new Error('No GC events found in the log. Make sure it is a --trace-gc output file.');
  }

  const majorGcs = entries.filter(e => e.pauseType === 'major');
  const minorGcs = entries.filter(e => e.pauseType === 'minor');
  const totalPauseMs = entries.reduce((s, e) => s + e.durationMs, 0);

  // External memory trend: use heap delta as proxy
  const externalStart = entries[0].heapBefore;
  const externalEnd = entries[entries.length - 1].heapAfter;
  const externalGrowthMb = (externalEnd - externalStart) / (1024 * 1024);
  const externalUnmanaged = externalGrowthMb > 50; // Flag if heap grew > 50MB

  return {
    entries,
    totalGcs: entries.length,
    majorGcCount: majorGcs.length,
    minorGcCount: minorGcs.length,
    totalPauseMs,
    avgMajorPauseMs: majorGcs.length > 0 ? majorGcs.reduce((s, e) => s + e.durationMs, 0) / majorGcs.length : 0,
    avgMinorPauseMs: minorGcs.length > 0 ? minorGcs.reduce((s, e) => s + e.durationMs, 0) / minorGcs.length : 0,
    externalStart,
    externalEnd,
    externalGrowthMb,
    externalUnmanaged,
  };
}