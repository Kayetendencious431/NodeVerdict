import type { TracingEvent, TracingAnalysis, PairedOperation, ChannelStats } from '../types';

/** Pipeline stage: Normalize raw events */
function normalize(events: TracingEvent[]): TracingEvent[] {
  return events
    .filter(e => e.channel && e.eventType && e.timestamp)
    .sort((a, b) => a.timestamp - b.timestamp);
}

/** Pipeline stage: Pair start/end events into operations */
function pairOperations(events: TracingEvent[]): PairedOperation[] {
  const startMap = new Map<string, TracingEvent>();
  const operations: PairedOperation[] = [];

  for (const event of events) {
    const key = event.operationId ?? `${event.channel}:${event.timestamp}`;

    if (event.eventType === 'start') {
      startMap.set(key, event);
    } else if (event.eventType === 'end' || event.eventType === 'error') {
      const start = startMap.get(key);
      if (start) {
        startMap.delete(key);
        operations.push({
          channel: event.channel,
          operationId: key,
          start,
          [event.eventType]: event,
          duration: event.timestamp - start.timestamp,
          status: event.eventType === 'error' ? 'error' : 'success',
        });
      } else {
        // orphan end/error — still record it
        operations.push({
          channel: event.channel,
          operationId: key,
          start: event,
          [event.eventType]: event,
          duration: 0,
          status: event.eventType === 'error' ? 'error' : 'incomplete',
        });
      }
    }
  }

  // Remaining unmatched starts are incomplete
  for (const [key, start] of startMap) {
    operations.push({
      channel: start.channel,
      operationId: key,
      start,
      duration: 0,
      status: 'incomplete',
    });
  }

  return operations;
}

/** Pipeline stage: Compute per-channel statistics */
function computeStats(operations: PairedOperation[]): ChannelStats[] {
  const grouped = new Map<string, number[]>();
  const counts = new Map<string, { success: number; error: number; incomplete: number }>();

  for (const op of operations) {
    const ch = op.channel;
    if (!grouped.has(ch)) grouped.set(ch, []);
    if (!counts.has(ch)) counts.set(ch, { success: 0, error: 0, incomplete: 0 });

    const c = counts.get(ch)!;
    if (op.status === 'success') c.success++;
    else if (op.status === 'error') c.error++;
    else c.incomplete++;

    if (op.duration > 0) grouped.get(ch)!.push(op.duration);
  }

  return Array.from(grouped.entries()).map(([channel, durations]) => {
    const sorted = [...durations].sort((a, b) => a - b);
    const c = counts.get(channel)!;
    const total = c.success + c.error + c.incomplete;

    return {
      channel,
      totalOperations: total,
      successCount: c.success,
      errorCount: c.error,
      incompleteCount: c.incomplete,
      avgDuration: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
      p50Duration: percentile(sorted, 50),
      p95Duration: percentile(sorted, 95),
      p99Duration: percentile(sorted, 99),
      minDuration: sorted[0] ?? 0,
      maxDuration: sorted[sorted.length - 1] ?? 0,
    };
  });
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

/** Pipeline stage: Index events for quick lookup */
function indexEvents(events: TracingEvent[]) {
  const byChannel = new Map<string, TracingEvent[]>();
  const byOperationId = new Map<string, TracingEvent[]>();

  for (const event of events) {
    const ch = byChannel.get(event.channel) ?? [];
    ch.push(event);
    byChannel.set(event.channel, ch);

    if (event.operationId) {
      const ops = byOperationId.get(event.operationId) ?? [];
      ops.push(event);
      byOperationId.set(event.operationId, ops);
    }
  }

  return { byChannel, byOperationId };
}

/** Main pipeline: run all stages */
export function analyzeTracingEvents(rawEvents: TracingEvent[]): TracingAnalysis {
  const events = normalize(rawEvents);
  const operations = pairOperations(events);
  const channelStats = computeStats(operations);
  const indexed = indexEvents(events);

  const channels = Array.from(new Set(events.map(e => e.channel))).sort();
  const errorCount = operations.filter(o => o.status === 'error').length;

  return {
    events,
    operations,
    channelStats,
    totalEvents: events.length,
    totalOperations: operations.length,
    errorRate: operations.length ? errorCount / operations.length : 0,
    timeRange: events.length
      ? { start: events[0].timestamp, end: events[events.length - 1].timestamp }
      : { start: 0, end: 0 },
    channels,
    ...indexed,
  };
}