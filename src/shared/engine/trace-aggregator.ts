import type { TracingEvent, TraceSpan, DependencyLink, PairedOperation } from '../types';

/**
 * Build a waterfall tree from paired operations.
 * Uses asyncStart/asyncEnd events to infer parent-child relationships.
 */
export function buildWaterfall(operations: PairedOperation[], events: TracingEvent[]): TraceSpan[] {
  // Index asyncStart events by their operationId to find parent relationships
  const asyncStarts = new Map<string, TracingEvent>();

  for (const event of events) {
    if (event.eventType === 'asyncStart' && event.operationId) {
      asyncStarts.set(event.operationId, event);
    }
  }

  // Build spans from operations
  const spans: TraceSpan[] = [];

  for (const op of operations) {
    const span: TraceSpan = {
      id: op.operationId,
      operationId: op.operationId,
      channel: op.channel,
      label: op.channel,
      startTime: op.start.timestamp,
      endTime: op.end?.timestamp ?? op.start.timestamp,
      duration: op.duration,
      depth: 0,
      children: [],
      status: op.status,
      metadata: op.start.context,
    };

    // Try to infer parent from asyncStart/asyncEnd proximity
    const asyncStart = asyncStarts.get(op.operationId);

    if (asyncStart) {
      span.metadata = { ...span.metadata, ...asyncStart.context };
    }

    spans.push(span);
  }

  // Compute depth and parent-child relationships
  // Sort by start time, then assign parents based on containment
  spans.sort((a, b) => a.startTime - b.startTime);

  for (let i = 0; i < spans.length; i++) {
    for (let j = i - 1; j >= 0; j--) {
      if (spans[j].startTime <= spans[i].startTime && spans[j].endTime >= spans[i].endTime) {
        spans[i].parentId = spans[j].id;
        spans[j].children.push(spans[i]);
        spans[i].depth = spans[j].depth + 1;
        break;
      }
    }
  }

  // Return only root spans (children are nested inside)
  return spans.filter(s => !s.parentId);
}

/** Build dependency links between operations (O(n log n) sweep-line algorithm) */
export function buildDependencies(operations: PairedOperation[]): DependencyLink[] {
  const links: DependencyLink[] = [];
  if (operations.length === 0) return links;

  // Sort by start time once
  const sorted = [...operations].sort((a, b) => a.start.timestamp - b.start.timestamp);

  // First pass: parent-child detection using a sweep line
  // Track active (containing) operations in a stack
  const active: { op: PairedOperation; endTime: number }[] = [];

  for (const op of sorted) {
    const opEnd = op.end?.timestamp ?? Infinity;

    // Pop finished containers
    while (active.length > 0 && active[active.length - 1].endTime < op.start.timestamp) {
      active.pop();
    }

    // The top of the stack is the direct parent (if any)
    if (active.length > 0) {
      links.push({
        source: active[active.length - 1].op.operationId,
        target: op.operationId,
        type: 'parent-child',
      });
    }

    active.push({ op, endTime: opEnd });
  }

  // Second pass: sequential detection (only adjacent in sorted order)
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const prevEnd = prev.end?.timestamp ?? prev.start.timestamp;
    const gap = curr.start.timestamp - prevEnd;

    // Gap of 0-5ms suggests sequential dependency
    if (gap >= 0 && gap <= 5) {
      links.push({
        source: prev.operationId,
        target: curr.operationId,
        type: 'sequential',
      });
    }
  }

  return links;
}

/** Identify bottleneck nodes in the trace */
export function findBottlenecks(spans: TraceSpan[], thresholdPercentile = 95): TraceSpan[] {
  const durations = spans.map(s => s.duration).sort((a, b) => a - b);
  const threshold = durations.length
    ? durations[Math.ceil((thresholdPercentile / 100) * durations.length) - 1]
    : 0;

  return spans.filter(s => s.duration >= threshold && s.duration > 0);
}