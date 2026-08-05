export { analyzeTracingEvents } from './tracing-parser';
export { buildWaterfall, buildDependencies, findBottlenecks } from './trace-aggregator';
export { parseHeapSnapshot, analyzeHeap, detectLeaks } from './heap-parser';
export { validateEvents } from './validator';
export { generateReport, compressReport, decompressReport } from './report-generator';
export type { ValidationResult, ValidationIssue } from './validator';
export { parseCpuProfile, buildFlameTree, extractHotFunctions, analyzeCpuProfile } from './cpu-profile-parser';
export { diffHeapSnapshots } from './heap-diff';
export type { HeapDiffNode, HeapDiffResult } from './heap-diff';
export { analyzeStrings, analyzeExternalMemory, parseMemoryTimeline, calculateGrowthRate, parseGcLog } from './memory-analyzer';
export { evaluateAlerts, buildMetricSnapshot, defaultAlertRules } from './alert-engine';
export type { AlertRule, AlertMetric, AlertOperator, AlertLevel, FiredAlert, MetricSnapshot } from '../types/alert';
export { detectTraceFormat, loadTracingData, loadAndAnalyzeTrace, loadNdvBuffer } from './data-loader';
export type { TraceFormat } from './data-loader';
export { isOtelExport, convertOtelToTracingEvents, loadOtelTraceJson } from './otel-adapter';
export { encodeNdv, decodeNdv, decodeNdvFromArrayBuffer, NdvError } from './ndv-codec';
export { analyzeDistributed, buildDistributedTraces, buildTopology, analyzeRootCause, correctClockSkew } from '../distributed';
export type {
  DistSpan, DistTrace, ServiceNode, ServiceEdge, TopologyGraph,
  CriticalPathNode, CascadeStep, RankedService, RootCauseReport,
  ServiceHealth, HealthSignal,
} from '../distributed';
export { parseV8Trace, icSiteKey } from './jit-parser';
export { analyzeJit, DEFAULT_JIT_OPTIONS } from './jit-analysis';
export type { JitAnalysisOptions } from './jit-analysis';
export { generatePatches, verifyPatchEquivalence, analyzeKeyShapes, scanFunctions, fixSourceForFindings, applySourcePatches } from './jit-patch';