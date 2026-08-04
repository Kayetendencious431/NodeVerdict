import { buildDistributedTraces } from './span-tree';
import { buildTopology } from './topology';
import { analyzeRootCause } from './root-cause';
import type { TracingEvent } from '../types';

export { buildDistributedTraces, correctClockSkew, linkSpans, operationsToSpans, extractServiceName, MIN_DELTA_MS } from './span-tree';
export { buildTopology, classifyHealth } from './topology';
export {
  analyzeRootCause,
  computeAnomaly,
  findCriticalPaths,
  computeCriticality,
  computeBlameScore,
} from './root-cause';
export type {
  DistSpan, DistTrace, ServiceNode, ServiceEdge, TopologyGraph,
  CriticalPathNode, CascadeStep, RankedService, RootCauseReport,
  ServiceHealth, HealthSignal,
} from './types';

/** Convenience: run the whole distributed pipeline on a flat event list. */
export function analyzeDistributed(events: TracingEvent[]) {
  const traces = buildDistributedTraces(events);
  const graph = buildTopology(traces);
  const { report, nodes } = analyzeRootCause(graph, traces);
  return {
    traces,
    graph: { ...graph, nodes },
    report,
  };
}
