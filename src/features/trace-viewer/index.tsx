import { useCallback, useMemo, useState } from 'react';
import { useRootStore } from '../../stores';
import { useFileUpload, useRemoteFile } from '../../shared/hooks';
import type { ProgressInfo } from '../../shared/hooks/useFileUpload';
import { analyzeTracingEvents, buildWaterfall, buildDependencies, findBottlenecks, loadTracingData, loadNdvBuffer, encodeNdv } from '../../shared/engine';
import { useI18n } from '../../shared/i18n/useI18n';
import { WaterfallChart } from './components/WaterfallChart';
import { BottleneckList } from './components/BottleneckList';
import { FileUpload, EmptyState, StatCard, LoadingOverlay } from '../../shared/components';
import type { TracingEvent, TraceSpan } from '../../shared/types';
import { formatDuration } from '../../shared/utils';

function handleTraceContent(content: string | ArrayBuffer, setTraceData: (a: ReturnType<typeof analyzeTracingEvents> | null) => void) {
  const events = typeof content === 'string'
    ? loadTracingData(content)
    : loadNdvBuffer(content);
  const analysis = analyzeTracingEvents(events);
  setTraceData(analysis);
}

function downloadNdv(events: TracingEvent[]) {
  const bytes = encodeNdv(events);
  const blob = new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `trace-${Date.now()}.ndv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function TraceViewerPage() {
  const { t } = useI18n();
  const { traceData, setTraceData } = useRootStore();
  const [progress, setProgress] = useState<ProgressInfo | null>(null);
  const { loading, error, fileName, fileSize, handleFile, reset } = useFileUpload(
    useCallback(async (content: string) => {
      handleTraceContent(content, setTraceData);
    }, [setTraceData]),
    setProgress,
    useCallback(async (buffer: ArrayBuffer) => {
      handleTraceContent(buffer, setTraceData);
    }, [setTraceData]),
  );

  const {
    loading: urlLoading,
    error: urlError,
    progress: urlProgress,
    loadFromUrl,
    cancel: cancelUrl,
    reset: resetUrl,
  } = useRemoteFile({
    onFile: useCallback(async (content: string) => {
      handleTraceContent(content, setTraceData);
    }, [setTraceData]),
    onProgress: setProgress,
  });

  function handleReset() {
    reset();
    resetUrl();
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
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">{t('traceViewer.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('traceViewer.uploadHint')}</p>
        </div>
        <FileUpload onFile={handleFile} accept=".json,.ndv" label={t('traceViewer.uploadTitle')} maxSize={500 * 1024 * 1024} fileName={fileName} fileSize={fileSize} onReset={handleReset} loading={loading} progress={progress} onUrlLoad={loadFromUrl} urlLoading={urlLoading} urlError={urlError} urlProgress={urlProgress} onUrlCancel={cancelUrl} />
        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
        {urlError && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{urlError}</p>}
        <LoadingOverlay visible={loading || urlLoading} message={t('traceViewer.buildingTrace')} />
        <div className="mt-8">
          <EmptyState
            title={t('traceViewer.noData')}
            description={t('traceViewer.uploadDesc')}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">{t('traceViewer.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('traceViewer.operationsAndLinks').replace('{operations}', String(traceData.totalOperations)).replace('{links}', String(dependencies.length))}</p>
        </div>
        <div className="w-72">
          <FileUpload
            onFile={handleFile}
            accept=".json,.ndv"
            label={t('traceViewer.uploadTitle')}
            maxSize={500 * 1024 * 1024}
            fileName={fileName}
            fileSize={fileSize}
            onReset={handleReset}
            loading={loading}
            progress={progress}
            onUrlLoad={loadFromUrl}
            urlLoading={urlLoading}
            urlError={urlError}
            urlProgress={urlProgress}
            onUrlCancel={cancelUrl}
          />
        </div>
      </div>

      <div className="mb-4">
        <button
          onClick={() => downloadNdv(traceData.events)}
          className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          {t('traceViewer.exportNdv')}
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <StatCard title={t('traceViewer.totalSpans')} value={formatDuration(totalDuration)} subtitle={t('traceViewer.spanCount').replace('{count}', String(spanCount(spans)))} />
        <StatCard title={t('traceViewer.operations')} value={traceData.totalOperations.toString()} />
        <StatCard title={t('traceViewer.bottleneckCount')} value={bottlenecks.length.toString()} color={bottlenecks.length > 0 ? 'text-orange-600 dark:text-orange-400' : 'text-gray-900 dark:text-gray-100'} />
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