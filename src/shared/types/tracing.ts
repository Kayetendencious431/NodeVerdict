/** Core TracingChannel event types */

export type EventType = 'start' | 'end' | 'asyncStart' | 'asyncEnd' | 'error';

export interface TracingEvent {
  channel: string;
  eventType: EventType;
  context: Record<string, unknown>;
  timestamp: number;
  duration?: number;
  error?: { message: string; stack?: string; name?: string };
  /** Optional operation ID for cross-event correlation */
  operationId?: string;
}

/** A paired operation (start + end/error) */
export interface PairedOperation {
  channel: string;
  operationId: string;
  start: TracingEvent;
  end?: TracingEvent;
  error?: TracingEvent;
  asyncStart?: TracingEvent;
  asyncEnd?: TracingEvent;
  duration: number;
  status: 'success' | 'error' | 'incomplete';
}

/** Channel statistics */
export interface ChannelStats {
  channel: string;
  totalOperations: number;
  successCount: number;
  errorCount: number;
  incompleteCount: number;
  avgDuration: number;
  p50Duration: number;
  p95Duration: number;
  p99Duration: number;
  minDuration: number;
  maxDuration: number;
}

/** Aggregated analysis result */
export interface TracingAnalysis {
  events: TracingEvent[];
  operations: PairedOperation[];
  channelStats: ChannelStats[];
  totalEvents: number;
  totalOperations: number;
  errorRate: number;
  timeRange: { start: number; end: number };
  channels: string[];
}

/**
 * Lightweight trace data for the trace-viewer.
 * All heavy computation (waterfall, dependencies, bottlenecks)
 * is done inside the Worker so the main thread never receives
 * the raw events/operations arrays over postMessage.
 */
export interface TraceViewerData {
  channelStats: ChannelStats[];
  totalEvents: number;
  totalOperations: number;
  errorRate: number;
  timeRange: { start: number; end: number };
  channels: string[];
  spans: TraceSpan[];
  dependencies: DependencyLink[];
  bottlenecks: TraceSpan[];
}

/** Trace span for waterfall visualization */
export interface TraceSpan {
  id: string;
  operationId: string;
  channel: string;
  label: string;
  startTime: number;
  endTime: number;
  duration: number;
  depth: number;
  parentId?: string;
  children: TraceSpan[];
  status: 'success' | 'error' | 'incomplete';
  metadata: Record<string, unknown>;
}

/** Dependency link between spans */
export interface DependencyLink {
  source: string;
  target: string;
  type: 'async' | 'sequential' | 'parent-child';
}