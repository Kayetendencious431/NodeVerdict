export { analyzeTracingEvents } from './tracing-parser';
export { buildWaterfall, buildDependencies, findBottlenecks } from './trace-aggregator';
export { parseHeapSnapshot, analyzeHeap, detectLeaks } from './heap-parser';
export { validateEvents } from './validator';
export { generateReport, compressReport, decompressReport } from './report-generator';
export type { ValidationResult, ValidationIssue } from './validator';