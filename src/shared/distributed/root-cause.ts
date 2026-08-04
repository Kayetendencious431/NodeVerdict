import type {
  DistTrace, DistSpan, TopologyGraph, ServiceNode, RootCauseReport,
  CriticalPathNode, CascadeStep, RankedService, HealthSignal,
} from './types';

/**
 * Root-cause localization for distributed traces.
 *
 * Combines four signals into a ranked hypothesis list:
 *   1. unexplainedAnomaly — spans whose duration is slow *without* slow children
 *      (the discriminator: a parent delayed only by a slow child is an effect,
 *      not a cause — this mirrors the "drill into the dominant child" rule).
 *   2. anomalyMagnitude — how far a service's durations exceed its own baseline.
 *   3. criticality — how often the service sits on a trace's critical path.
 *   4. errorSignal — error-rate contribution.
 *   5. blameScore — a reverse personalized PageRank over the dependency graph
 *      (influence flows callee -> caller) measuring impact convergence.
 */

const DAMPING = 0.85;
const ITERATIONS = 24;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Per-service latency baseline. Uses the 25th percentile: normal behavior is
 * usually the lower bound, so a fault that affects the majority of traces
 * still gets detected (a median baseline would absorb the fault itself).
 */
function computeBaselines(traces: DistTrace[]): Map<string, number> {
  const durs = new Map<string, number[]>();
  for (const trace of traces) {
    for (const span of trace.spans) {
      const list = durs.get(span.serviceName) ?? [];
      list.push(span.duration);
      durs.set(span.serviceName, list);
    }
  }
  const out = new Map<string, number>();
  for (const [svc, list] of durs) {
    const sorted = [...list].sort((a, b) => a - b);
    const idx = Math.max(0, Math.ceil(0.25 * sorted.length) - 1);
    out.set(svc, sorted[Math.min(idx, sorted.length - 1)]);
  }
  return out;
}

/** Self-time not explained by children (only meaningful within one trace). */
function unexplainedSelfMs(span: DistSpan): number {
  const childSum = span.children.reduce((acc, c) => {
    const s = c.adjustedStart ?? c.startTime;
    const e = c.adjustedEnd ?? c.endTime;
    return acc + Math.max(0, e - s);
  }, 0);
  return Math.max(0, (span.adjustedEnd ?? span.endTime) - (span.adjustedStart ?? span.startTime) - childSum);
}

/**
 * Computes anomaly magnitude + unexplained-anomaly per service.
 * baseline(service) is that service's median duration across the dataset.
 */
export function computeAnomaly(traces: DistTrace[]): { magnitude: Map<string, number>; unexplained: Map<string, number> } {
  const baselines = computeBaselines(traces);
  const mag = new Map<string, number>();
  const unexp = new Map<string, number>();

  for (const trace of traces) {
    for (const span of trace.spans) {
      const base = baselines.get(span.serviceName) ?? 0;
      // Latency contribution: grows from 0 at 1x baseline to 1 at >=3x baseline.
      const latencyContrib = base > 0 ? clamp((span.duration / base - 1) / 2, 0, 1) : span.duration > 0 ? 1 : 0;
      const errorContrib = span.error ? 0.15 : 0;
      const m = clamp(latencyContrib + errorContrib, 0, 1);
      mag.set(span.serviceName, (mag.get(span.serviceName) ?? 0) + m);

      // Unexplained slowness only counts when the span is genuinely slow (>1.5x baseline).
      let u = 0;
      if (base > 0 && span.duration > base * 1.5) {
        const self = unexplainedSelfMs(span);
        u = clamp(self / Math.max(1, base), 0, 1);
      } else if (base === 0 && span.error) {
        u = 0.6;
      }
      unexp.set(span.serviceName, (unexp.get(span.serviceName) ?? 0) + u);
    }
  }

  // Normalize by span count so the score is an average contribution, not a sum.
  const counts = new Map<string, number>();
  for (const trace of traces) {
    for (const span of trace.spans) {
      counts.set(span.serviceName, (counts.get(span.serviceName) ?? 0) + 1);
    }
  }
  for (const [svc, total] of counts) {
    mag.set(svc, (mag.get(svc) ?? 0) / total);
    unexp.set(svc, (unexp.get(svc) ?? 0) / total);
  }
  return { magnitude: mag, unexplained: unexp };
}

/** Critical path = follow the max-duration child chain from each trace root. */
export function findCriticalPaths(traces: DistTrace[]): CriticalPathNode[][] {
  return traces.map(trace => {
    const path: CriticalPathNode[] = [];
    let current: DistSpan | undefined = trace.roots.length === 1 ? trace.roots[0] : trace.roots[0];
    while (current) {
      path.push({
        traceId: trace.traceId,
        spanId: current.spanId,
        serviceName: current.serviceName,
        spanName: current.name,
        startTime: current.adjustedStart ?? current.startTime,
        endTime: current.adjustedEnd ?? current.endTime,
        duration: current.duration,
        error: current.error,
      });
      if (current.children.length === 0) break;
      let next: DistSpan | undefined;
      let best = -1;
      for (const c of current.children) {
        if (c.duration > best) {
          best = c.duration;
          next = c;
        }
      }
      current = next;
    }
    return path;
  });
}

/** Fraction of traces in which each service appears on the critical path. */
export function computeCriticality(traces: DistTrace[], paths: CriticalPathNode[][]): Map<string, number> {
  const count = new Map<string, number>();
  for (const path of paths) {
    const seen = new Set<string>();
    for (const node of path) seen.add(node.serviceName);
    for (const svc of seen) count.set(svc, (count.get(svc) ?? 0) + 1);
  }
  const out = new Map<string, number>();
  const total = paths.length || 1;
  for (const [svc, c] of count) out.set(svc, c / total);
  return out;
}

/**
 * Reverse personalized PageRank.
 * Influence flows callee -> caller (a slow callee delays its callers). The
 * seed vector is the anomaly magnitude, so blame converges on services that
 * are implicated by many anomalous dependents.
 */
export function computeBlameScore(graph: TopologyGraph, anomaly: Map<string, number>): Map<string, number> {
  // callers[v] = services that call v. Also precompute |callers[v]| for normalization.
  const callers = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const list = callers.get(edge.target) ?? [];
    list.push(edge.source);
    callers.set(edge.target, list);
  }

  const names = graph.nodes.map(n => n.serviceName);
  const seed = new Map<string, number>();
  let seedSum = 0;
  for (const svc of names) {
    const a = anomaly.get(svc) ?? 0;
    seed.set(svc, a);
    seedSum += a;
  }
  if (seedSum > 0) {
    for (const svc of names) seed.set(svc, (seed.get(svc) ?? 0) / seedSum);
  }

  const score = new Map<string, number>(names.map(n => [n, 0]));
  for (let iter = 0; iter < ITERATIONS; iter++) {
    const next = new Map<string, number>();
    for (const svc of names) {
      let acc = 0;
      const cals = callers.get(svc) ?? [];
      for (const caller of cals) {
        const degree = (callers.get(caller) ?? []).length;
        acc += (score.get(caller) ?? 0) / Math.max(1, degree);
      }
      next.set(svc, (1 - DAMPING) * (seed.get(svc) ?? 0) + DAMPING * acc);
    }
    for (const [svc, v] of next) score.set(svc, v);
  }

  // Normalize to 0..1.
  let max = 0;
  for (const v of score.values()) max = Math.max(max, v);
  if (max > 0) {
    for (const svc of names) score.set(svc, (score.get(svc) ?? 0) / max);
  }
  return score;
}

function fmtPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function buildEvidence(node: ServiceNode, magnitude: number, unexplained: number, criticality: number): string[] {
  const out: string[] = [];
  if (node.errorRate > 0) out.push(`${node.errorCount}/${node.callCount} calls errored (${fmtPct(node.errorRate)})`);
  out.push(`p95 ${node.p95Duration.toFixed(0)}ms${node.errorRate === 0 ? '' : `, avg ${node.avgDuration.toFixed(0)}ms`}`);
  if (unexplained > 0.35) out.push(`slow work not explained by child calls (self-time anomaly ${Math.round(unexplained * 100)}%)`);
  if (magnitude > 0.4) out.push(`latency ${Math.round(magnitude * 100)}% above its own baseline`);
  if (criticality > 0.3) out.push(`on critical path in ${Math.round(criticality * 100)}% of traces`);
  if (node.blameScore > 0.4) out.push(`implicated by ${Math.round(node.blameScore * 100)}% of downstream impact`);
  return out;
}

function buildCascade(graph: TopologyGraph, anomaly: Map<string, number>, rootService: string): CascadeStep[] {
  const steps: CascadeStep[] = [];
  const visited = new Set<string>([rootService]);
  const queue: { svc: string; depth: number }[] = [{ svc: rootService, depth: 0 }];
  const byName = new Map(graph.nodes.map(n => [n.serviceName, n]));

  while (queue.length && steps.length < 6) {
    const { svc, depth } = queue.shift()!;
    const node = byName.get(svc);
    const mag = anomaly.get(svc) ?? 0;

    const signal: HealthSignal = node
      ? node.errorRate >= 0.01 ? 'error' : (node.primarySignal ?? 'latency')
      : 'latency';
    const symptom = describeSymptom(signal, node, mag);

    const step: CascadeStep = {
      service: svc,
      signal,
      impact: clamp(mag, 0, 1),
      symptom,
      evidence: buildEvidence(node!, mag, 0, node?.criticality ?? 0).slice(0, 2).join(' · '),
    };
    steps.push(step);

    if (depth < 4) {
      // Propagate upstream: services that call the current service.
      const callers = graph.edges
        .filter(e => e.target === svc && !visited.has(e.source))
        .map(e => e.source)
        .filter(src => (anomaly.get(src) ?? 0) > 0.12);
      for (const c of callers) {
        visited.add(c);
        queue.push({ svc: c, depth: depth + 1 });
      }
    }
  }
  return steps;
}

function describeSymptom(signal: HealthSignal, node: ServiceNode | undefined, mag: number): string {
  if (node && node.errorRate > 0) return `error rate ${fmtPct(node.errorRate)} (${node.errorCount}/${node.callCount} calls)`;
  switch (signal) {
    case 'error':
      return `error rate ${node ? fmtPct(node.errorRate) : 'n/a'}`;
    case 'latency':
      return node
        ? `latency up to ${node.p95Duration.toFixed(0)}ms (${Math.round((mag) * 100)}% above baseline)`
        : `latency ${Math.round(mag * 100)}% above baseline`;
    case 'throughput':
    default:
      return `throughput pressure / queue backlog (${Math.round(mag * 100)}% of normal load)`;
  }
}

function buildRecommendations(ranked: RankedService[], errorMessages: string[]): string[] {
  const out: string[] = [];
  const joined = errorMessages.join('\n').toLowerCase();

  if (joined.includes('timeout') || joined.includes('timed out')) {
    out.push('Raise client/server timeout bounds and re-check the dependency SLO for the slowest callee.');
  }
  if (joined.includes('pool')) {
    out.push('Connection/thread pool exhaustion detected — increase pool size or add wait-queue limits on the top-ranked service.');
  }
  if (joined.includes('queue') || joined.includes('backlog')) {
    out.push('Downstream queue backlog — add backpressure, rate limiting, or increase consumer concurrency.');
  }
  if (joined.includes('connection refused') || joined.includes('connect econnrefused')) {
    out.push('A callee refused connections — verify the target service is up, healthy, and has free slots.');
  }
  if (joined.includes('ec2 ')) out.push('ECONN reset during a call — check for proxy/load-balancer timeouts or dropped keep-alive connections.');

  const top = ranked[0];
  if (top) {
    const node = top.primarySignal;
    if (node === 'latency') {
      out.push(`Optimize the slowest path in ${top.service}: add caching, reduce N+1 calls, or move work off the critical path.`);
    } else if (node === 'error') {
      out.push(`Triage errors in ${top.service}: check its dependencies and error handling before touching downstream services.`);
    }
  }
  if (ranked.length > 1) {
    out.push(`Treat downstream services (${ranked.slice(1, 4).map(r => r.service).join(', ')}) as effects until ${ranked[0].service} is resolved.`);
  }
  if (out.length === 0) {
    out.push('No obvious systemic fault — compare top-ranked services against their latency baselines and check for saturation.');
  }
  return out;
}

/**
 * Full root-cause analysis. Returns the report and mutates a copy of the graph
 * nodes so the UI can render anomaly/blame/criticality coloring directly.
 */
export function analyzeRootCause(graph: TopologyGraph, traces: DistTrace[]): { report: RootCauseReport; nodes: ServiceNode[] } {
  const { magnitude, unexplained } = computeAnomaly(traces);
  const paths = findCriticalPaths(traces);
  const criticality = computeCriticality(traces, paths);
  const blame = computeBlameScore(graph, magnitude);

  const errorMessages: string[] = [];
  for (const trace of traces) {
    for (const span of trace.spans) {
      if (span.error && span.errorMessage) errorMessages.push(span.errorMessage);
    }
  }

  const nodes = graph.nodes.map(n => ({
    ...n,
    anomalyScore: clamp(magnitude.get(n.serviceName) ?? 0, 0, 1),
    criticality: criticality.get(n.serviceName) ?? 0,
    blameScore: blame.get(n.serviceName) ?? 0,
  }));

  const scores = new Map<string, number>();
  for (const n of nodes) {
    const m = n.anomalyScore;
    const u = unexplained.get(n.serviceName) ?? 0;
    const c = n.criticality;
    const e = Math.min(1, n.errorRate * 5);
    const b = n.blameScore;
    const score = 0.28 * u + 0.2 * m + 0.15 * c + 0.17 * e + 0.2 * b;
    scores.set(n.serviceName, score);
  }

  const ranked: RankedService[] = nodes
    .map(n => {
      const score = scores.get(n.serviceName) ?? 0;
      return {
        service: n.serviceName,
        score,
        primarySignal: n.primarySignal,
        evidence: buildEvidence(n, magnitude.get(n.serviceName) ?? 0, unexplained.get(n.serviceName) ?? 0, n.criticality),
      };
    })
    .sort((a, b) => b.score - a.score);

  const top = ranked[0];
  const runnerUp = ranked[1];
  const separation = top ? Math.max(0, top.score - (runnerUp?.score ?? 0)) : 0;
  const dataConfidence = Math.min(1, graph.traces / 5);
  const evidenceCount = top ? Math.min(1, top.evidence.length / 3) : 0;
  const confidence = top
    ? clamp(0.45 + 0.3 * Math.min(1, separation) + 0.15 * dataConfidence + 0.1 * evidenceCount, 0.3, 0.95)
    : 0;

  const cascade = top ? buildCascade(graph, magnitude, top.service) : [];

  return {
    report: {
      rootCause: top
        ? { service: top.service, confidence, evidence: top.evidence }
        : { service: 'unknown', confidence: 0, evidence: ['No spans available'] },
      ranked,
      criticalPaths: paths.slice(0, 5),
      cascade,
      recommendations: buildRecommendations(ranked, errorMessages),
    },
    nodes,
  };
}
