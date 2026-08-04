import type { TracingEvent, TracingAnalysis, PairedOperation, ChannelStats } from '../types';

/**
 * Incremental trace analyzer.
 *
 * Mirrors the semantics of `analyzeTracingEvents` in `engine/tracing-parser.ts`
 * (Normalize → Pair → Stats → Index) but consumes events one at a time as they
 * stream in, so the full file never has to exist as a parsed object tree.
 *
 * Retention policy: full `TracingEvent[]` / `PairedOperation[]` arrays are kept
 * only up to `maxEvents` / `maxOperations`. Aggregate statistics are computed
 * over *all* events regardless of the caps, keeping peak memory bounded while
 * preserving correct channel stats, error rates and time ranges for 3GB files.
 */

export interface StreamingAnalyzerOptions {
  maxEvents?: number;
  maxOperations?: number;
  /** Called every `progressEvery` events with cumulative counts. */
  onProgress?: (info: { eventsSeen: number; operations: number }) => void;
  progressEvery?: number;
}

export interface StreamingMeta {
  /** True when this file was larger than the retention caps. */
  truncated: boolean;
  eventsSeen: number;
  invalid: number;
  wallTimeMs: number;
  bytes?: number;
}

const DEFAULT_MAX_EVENTS = 250_000;
const DEFAULT_MAX_OPERATIONS = 250_000;

interface ChannelCounts {
  success: number;
  error: number;
  incomplete: number;
}

export class StreamingTraceAnalyzer {
  private pending = new Map<string, TracingEvent>();
  private durations = new Map<string, number[]>();
  private counts = new Map<string, ChannelCounts>();
  private channelOrder: string[] = [];
  private retainedEvents: TracingEvent[] = [];
  private retainedOps: PairedOperation[] = [];
  private opsTotal = 0;
  private errorsTotal = 0;
  private eventsSeen = 0;
  private invalid = 0;
  private minTs = Infinity;
  private maxTs = -Infinity;
  private startedAt = 0;
  private nextProgress = 0;
  private options: Required<Omit<StreamingAnalyzerOptions, 'onProgress'>> & StreamingAnalyzerOptions;

  constructor(options: StreamingAnalyzerOptions = {}) {
    this.options = {
      maxEvents: options.maxEvents ?? DEFAULT_MAX_EVENTS,
      maxOperations: options.maxOperations ?? DEFAULT_MAX_OPERATIONS,
      progressEvery: options.progressEvery ?? 50_000,
      onProgress: options.onProgress,
    };
    this.startedAt = performance.now();
    this.nextProgress = this.options.progressEvery;
  }

  /** Current cumulative counts (for progress reporting). */
  get progress(): { eventsSeen: number; operations: number } {
    return { eventsSeen: this.eventsSeen, operations: this.opsTotal };
  }

  /** Feed one parsed event object. Returns true if it was accepted as valid. */
  feed(event: TracingEvent): boolean {
    if (!event || typeof event.channel !== 'string' || event.channel === '') {
      this.invalid++;
      return false;
    }
    if (event.eventType !== 'start' && event.eventType !== 'end'
      && event.eventType !== 'error' && event.eventType !== 'asyncStart'
      && event.eventType !== 'asyncEnd') {
      this.invalid++;
      return false;
    }
    if (typeof event.timestamp !== 'number' || Number.isNaN(event.timestamp)) {
      this.invalid++;
      return false;
    }

    this.eventsSeen++;
    if (event.timestamp < this.minTs) this.minTs = event.timestamp;
    if (event.timestamp > this.maxTs) this.maxTs = event.timestamp;

    if (this.retainedEvents.length < this.options.maxEvents) {
      this.retainedEvents.push(event);
    }

    this.trackChannel(event.channel);
    this.pair(event);

    if (this.eventsSeen >= this.nextProgress) {
      this.nextProgress += this.options.progressEvery;
      this.options.onProgress?.({ eventsSeen: this.eventsSeen, operations: this.opsTotal });
    }
    return true;
  }

  /** Finalize remaining pending starts and compute the aggregate analysis. */
  finish(bytes?: number): { analysis: TracingAnalysis; meta: StreamingMeta } {
    for (const [key, start] of this.pending) {
      this.opsTotal++;
      const op: PairedOperation = {
        channel: start.channel,
        operationId: key,
        start,
        duration: 0,
        status: 'incomplete',
      };
      if (this.retainedOps.length < this.options.maxOperations) {
        this.retainedOps.push(op);
      }
      this.bumpCount(start.channel, 'incomplete');
    }
    this.pending.clear();

    this.retainedEvents.sort((a, b) => a.timestamp - b.timestamp);

    const channelStats = this.computeChannelStats();
    const channels = [...this.channelOrder].sort();
    const truncated = this.eventsSeen > this.options.maxEvents
      || this.opsTotal > this.options.maxOperations;

    const analysis: TracingAnalysis = {
      events: this.retainedEvents,
      operations: this.retainedOps,
      channelStats,
      totalEvents: this.eventsSeen,
      totalOperations: this.opsTotal,
      errorRate: this.opsTotal > 0 ? this.errorsTotal / this.opsTotal : 0,
      timeRange: this.eventsSeen > 0
        ? { start: this.minTs, end: this.maxTs }
        : { start: 0, end: 0 },
      channels,
    };

    const meta: StreamingMeta = {
      truncated,
      eventsSeen: this.eventsSeen,
      invalid: this.invalid,
      wallTimeMs: performance.now() - this.startedAt,
      bytes,
    };

    return { analysis, meta };
  }

  private trackChannel(channel: string) {
    if (!this.durations.has(channel)) {
      this.durations.set(channel, []);
      this.counts.set(channel, { success: 0, error: 0, incomplete: 0 });
      this.channelOrder.push(channel);
    }
  }

  private bumpCount(channel: string, status: 'success' | 'error' | 'incomplete') {
    const c = this.counts.get(channel)!;
    if (status === 'success') c.success++;
    else if (status === 'error') c.error++;
    else c.incomplete++;
  }

  private pair(event: TracingEvent) {
    const key = event.operationId ?? `${event.channel}:${event.timestamp}`;

    if (event.eventType === 'start') {
      this.pending.set(key, event);
      return;
    }
    if (event.eventType !== 'end' && event.eventType !== 'error') {
      // asyncStart / asyncEnd: not paired in the synchronous pipeline.
      return;
    }

    const start = this.pending.get(key);
    this.opsTotal++;
    if (start) {
      this.pending.delete(key);
      const op: PairedOperation = {
        channel: event.channel,
        operationId: key,
        start,
        [event.eventType]: event,
        duration: event.timestamp - start.timestamp,
        status: event.eventType === 'error' ? 'error' : 'success',
      };
      if (this.retainedOps.length < this.options.maxOperations) {
        this.retainedOps.push(op);
      }
      if (op.status === 'error') this.errorsTotal++;
      this.bumpCount(op.channel, op.status);
      if (op.duration > 0) this.durations.get(op.channel)!.push(op.duration);
    } else {
      const op: PairedOperation = {
        channel: event.channel,
        operationId: key,
        start: event,
        [event.eventType]: event,
        duration: 0,
        status: event.eventType === 'error' ? 'error' : 'incomplete',
      };
      if (this.retainedOps.length < this.options.maxOperations) {
        this.retainedOps.push(op);
      }
      if (op.status === 'error') this.errorsTotal++;
      this.bumpCount(op.channel, op.status);
    }
  }

  private computeChannelStats(): ChannelStats[] {
    return this.channelOrder.map((channel) => {
      const durations = this.durations.get(channel)!;
      const c = this.counts.get(channel)!;
      const sorted = durations.sort((a, b) => a - b);
      const total = c.success + c.error + c.incomplete;
      return {
        channel,
        totalOperations: total,
        successCount: c.success,
        errorCount: c.error,
        incompleteCount: c.incomplete,
        avgDuration: sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 0,
        p50Duration: percentile(sorted, 50),
        p95Duration: percentile(sorted, 95),
        p99Duration: percentile(sorted, 99),
        minDuration: sorted[0] ?? 0,
        maxDuration: sorted[sorted.length - 1] ?? 0,
      };
    });
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}
