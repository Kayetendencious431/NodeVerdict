import type { DistTrace, DistSpan, TopologyGraph, ServiceNode, ServiceEdge, ServiceHealth, HealthSignal } from './types';

/**
 * Service topology discovery.
 *
 * Aggregates per-trace span trees into a service dependency graph:
 *   nodes  = services (call volume, latency percentiles, error rate, health)
 *   edges  = caller -> callee calls (frequency, latency, error rate)
 * Node/edge metrics power the root-cause ranking and the force-directed UI.
 */

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function isAsyncSpan(span: DistSpan): boolean {
  return span.kind === 4 || span.kind === 5; // producer / consumer
}

export function classifyHealth(errorRate: number, p95: number, medianP95: number): { health: ServiceHealth; primarySignal: HealthSignal } {
  const latencyElevated = medianP95 > 0 && p95 >= 3 * medianP95;
  const latencyModerate = medianP95 > 0 && p95 >= 1.5 * medianP95;
  const errorHigh = errorRate >= 0.05;
  const errorModerate = errorRate >= 0.01;

  let health: ServiceHealth = 'healthy';
  let primarySignal: HealthSignal = 'throughput';
  if (errorHigh || (errorModerate && latencyElevated)) {
    health = 'faulty';
    primarySignal = 'error';
  } else if (errorModerate || latencyElevated) {
    health = errorModerate ? 'warning' : 'faulty';
    primarySignal = errorModerate ? 'error' : 'latency';
  } else if (latencyModerate) {
    health = 'warning';
    primarySignal = 'latency';
  }
  return { health, primarySignal };
}

/**
 * Builds the aggregated service dependency graph from corrected traces.
 * The `analyzeRootCause` pass (root-cause module) fills in anomaly/blame/criticality.
 */
export function buildTopology(traces: DistTrace[]): TopologyGraph {
  const nodeDurs = new Map<string, number[]>();
  const nodeCalls = new Map<string, { errors: number; traces: Set<string> }>();
  const edgeDurs = new Map<string, number[]>();
  const edgeCalls = new Map<string, { errors: number; async: boolean }>();

  let minTime = Infinity;
  let maxTime = -Infinity;

  for (const trace of traces) {
    const stack: DistSpan[] = [...trace.roots];
    while (stack.length) {
      const span = stack.pop()!;
      const svc = span.serviceName;
      minTime = Math.min(minTime, span.adjustedStart ?? span.startTime);
      maxTime = Math.max(maxTime, span.adjustedEnd ?? span.endTime);

      const durs = nodeDurs.get(svc) ?? [];
      durs.push(span.duration);
      nodeDurs.set(svc, durs);

      const calls = nodeCalls.get(svc) ?? { errors: 0, traces: new Set<string>() };
      if (span.error) calls.errors++;
      calls.traces.add(trace.traceId);
      nodeCalls.set(svc, calls);

      for (const child of span.children) {
        stack.push(child);
        if (child.serviceName !== svc) {
          const key = `${svc}\u0000${child.serviceName}`;
          const cdurs = edgeDurs.get(key) ?? [];
          cdurs.push(child.duration);
          edgeDurs.set(key, cdurs);

          const ecalls = edgeCalls.get(key) ?? { errors: 0, async: false };
          if (child.error) ecalls.errors++;
          if (isAsyncSpan(span) || isAsyncSpan(child)) ecalls.async = true;
          edgeCalls.set(key, ecalls);
        }
      }
    }
  }

  // Baseline latency for health classification (median of per-service p95s).
  const allP95s = Array.from(nodeDurs.values())
    .map(d => percentile(d, 95))
    .filter(v => v > 0)
    .sort((a, b) => a - b);
  const medianP95 = allP95s.length ? allP95s[Math.floor(allP95s.length / 2)] : 0;

  const nodes: ServiceNode[] = Array.from(nodeDurs.entries()).map(([serviceName, durs]) => {
    const calls = nodeCalls.get(serviceName)!;
    const sorted = [...durs].sort((a, b) => a - b);
    const total = durs.length;
    const errorRate = total ? calls.errors / total : 0;
    const p95 = percentile(sorted, 95);
    const { health, primarySignal } = classifyHealth(errorRate, p95, medianP95);
    return {
      id: serviceName,
      serviceName,
      callCount: total,
      traceCount: calls.traces.size,
      avgDuration: total ? durs.reduce((a, b) => a + b, 0) / total : 0,
      p50Duration: percentile(sorted, 50),
      p95Duration: p95,
      p99Duration: percentile(sorted, 99),
      maxDuration: sorted[sorted.length - 1] ?? 0,
      errorCount: calls.errors,
      errorRate,
      criticality: 0,
      anomalyScore: 0,
      blameScore: 0,
      health,
      primarySignal,
    };
  });

  const edges: ServiceEdge[] = Array.from(edgeDurs.entries()).map(([key, durs]) => {
    const idx = key.indexOf('\u0000');
    const source = key.slice(0, idx);
    const target = key.slice(idx + 1);
    const calls = edgeCalls.get(key)!;
    const sorted = [...durs].sort((a, b) => a - b);
    return {
      id: `${source}->${target}`,
      source,
      target,
      callCount: durs.length,
      avgDuration: durs.length ? durs.reduce((a, b) => a + b, 0) / durs.length : 0,
      p50Duration: percentile(sorted, 50),
      p95Duration: percentile(sorted, 95),
      errorCount: calls.errors,
      errorRate: durs.length ? calls.errors / durs.length : 0,
      kind: calls.async ? 'async' : 'sync',
    };
  });

  const serviceCount = new Map<string, number>();
  for (const e of edges) {
    serviceCount.set(e.source, (serviceCount.get(e.source) ?? 0) + 1);
    serviceCount.set(e.target, (serviceCount.get(e.target) ?? 0) + 1);
  }

  return {
    nodes,
    edges,
    traces: traces.length,
    services: nodes.length,
    timeRange: {
      start: Number.isFinite(minTime) ? minTime : 0,
      end: Number.isFinite(maxTime) ? maxTime : 0,
    },
  };
}
