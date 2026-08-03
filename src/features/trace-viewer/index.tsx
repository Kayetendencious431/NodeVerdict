import { useCallback, useMemo } from 'react';
import { useRootStore } from '../../stores';
import { useFileUpload } from '../../shared/hooks';
import { analyzeTracingEvents, buildWaterfall, buildDependencies, findBottlenecks } from '../../shared/engine';
import { WaterfallChart } from './components/WaterfallChart';
import { BottleneckList } from './components/BottleneckList';
import { FileUpload, EmptyState, StatCard, LoadingOverlay } from '../../shared/components';
import type { TracingEvent, TraceSpan } from '../../shared/types';
import { formatDuration } from '../../shared/utils';

export function TraceViewerPage() {
  const { traceData, setTraceData } = useRootStore();
  const { loading, error, fileName, fileSize, handleFile, reset } = useFileUpload(useCallback(async (content: string) => {
    const events = JSON.parse(content) as TracingEvent[];
    const analysis = analyzeTracingEvents(events);
    setTraceData(analysis);
  }, [setTraceData]));

  function handleReset() {
    reset();
    setTraceData(null);
  }

  const spans = useMemo(() => {
    if (!traceData) return [];
    return buildWaterfall(traceData.operations, traceData.events);
  }, [traceData]);

  const dependencies = useMemo(() => {
    if (!traceData) return [];
    return buildDependencies(traceData.operations);
  }, [traceData]);

  const bottlenecks = useMemo(() => {
    if (!traceData) return [];
    return findBottlenecks(spans.flatMap(s => [s, ...flattenChildren(s)]));
  }, [spans]);

  const totalDuration = traceData?.timeRange ? traceData.timeRange.end - traceData.timeRange.start : 0;

  if (!traceData) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Trace Waterfall View</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Upload tracing events to visualize async operation chains</p>
        </div>
        <FileUpload onFile={handleFile} accept=".json" label="Upload tracing events JSON" maxSize={500 * 1024 * 1024} fileName={fileName} fileSize={fileSize} onReset={handleReset} />
        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
        <LoadingOverlay visible={loading} message="Building trace..." />
        <div className="mt-8">
          <EmptyState
            title="No trace data"
            description="Upload a JSON file with TracingChannel events. asyncStart/asyncEnd events will be used to build the waterfall."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Trace Waterfall</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{traceData.totalOperations} operations, {dependencies.length} dependency links</p>
        </div>
        <div className="w-72">
          <FileUpload
            onFile={handleFile}
            accept=".json"
            label="Upload tracing events JSON"
            maxSize={500 * 1024 * 1024}
            fileName={fileName}
            fileSize={fileSize}
            onReset={handleReset}
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <StatCard title="Total Time" value={formatDuration(totalDuration)} subtitle={`${spanCount(spans)} trace spans`} />
        <StatCard title="Operations" value={traceData.totalOperations.toString()} />
        <StatCard title="Bottlenecks" value={bottlenecks.length.toString()} color={bottlenecks.length > 0 ? 'text-orange-600 dark:text-orange-400' : 'text-gray-900 dark:text-gray-100'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="lg:col-span-3">
          <WaterfallChart spans={spans} />
        </div>
        <div>
          <BottleneckList bottlenecks={bottlenecks} />
        </div>
      </div>

      <LoadingOverlay visible={loading} />
    </div>
  );
}

function flattenChildren(span: { children: TraceSpan[] }): TraceSpan[] {
  const result: TraceSpan[] = [];
  for (const child of span.children) {
    result.push(child);
    result.push(...flattenChildren(child));
  }
  return result;
}

function spanCount(spans: TraceSpan[]): number {
  let count = 0;
  for (const s of spans) {
    count++;
    count += spanCount(s.children);
  }
  return count;
}