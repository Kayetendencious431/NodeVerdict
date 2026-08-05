import { useCallback, useMemo, useState, useRef, useEffect } from 'react';
import { useRootStore } from '../../stores';
import { useUnifiedFileUpload } from '../../shared/hooks';
import { encodeNdv } from '../../shared/engine';
import { createWorkerClient } from '../../shared/workers/worker-factory';
import type { TracingWorkerInput, TracingWorkerOutput } from '../../shared/workers/tracing-handler';
import { useI18n } from '../../shared/i18n/useI18n';
import { WaterfallChart } from './components/WaterfallChart';
import { BottleneckList } from './components/BottleneckList';
import { FileUpload, EmptyState, StatCard, LoadingOverlay } from '../../shared/components';
import type { TraceViewerData } from '../../shared/types';
import { formatDuration } from '../../shared/utils';

function handleTraceContent(content: string | ArrayBuffer, worker: ReturnType<typeof createWorkerClient<TracingWorkerInput, TracingWorkerOutput>>): Promise<TraceViewerData> {
  const input: TracingWorkerInput = typeof content === 'string'
    ? { content, format: 'json' }
    : { content: '', format: 'ndv', ndvBuffer: content };
  return worker.execute(input);
}

function downloadNdv(_events: unknown[]) {
  // encodeNdv expects TracingEvent[] — for now just inform the user
  console.warn('NDV export from TraceViewerData is not available; use the raw trace file');
}

export function TraceViewerPage() {
  const { t } = useI18n();
  const { traceData, setTraceData } = useRootStore();

  const workerRef = useRef<ReturnType<typeof createWorkerClient<TracingWorkerInput, TracingWorkerOutput>> | null>(null);
  const [traceLoading, setTraceLoading] = useState(false);

  useEffect(() => {
    const worker = new Worker(new URL('../../shared/workers/tracing-handler.ts', import.meta.url), { type: 'module' });
    workerRef.current = createWorkerClient<TracingWorkerInput, TracingWorkerOutput>(worker);
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  const upload = useUnifiedFileUpload({
    onFile: useCallback(async (content: string) => {
      const w = workerRef.current;
      if (!w) return;
      setTraceLoading(true);
      try {
        const data = await handleTraceContent(content, w);
        setTraceData(data);
      } finally {
        setTraceLoading(false);
      }
    }, [setTraceData]),
    onBinaryFile: useCallback(async (buffer: ArrayBuffer) => {
      const w = workerRef.current;
      if (!w) return;
      setTraceLoading(true);
      try {
        const data = await handleTraceContent(buffer, w);
        setTraceData(data);
      } finally {
        setTraceLoading(false);
      }
    }, [setTraceData]),
  });
  const { loading, error, fileName, fileSize, handleFile, progress, urlLoading, urlError, urlProgress, loadFromUrl, cancelUrl, handleReset: uploadReset } = upload;

  function handleReset() {
    uploadReset();
    setTraceData(null);
  }

  const spans = traceData?.spans ?? [];
  const dependencies = traceData?.dependencies ?? [];
  const bottlenecks = traceData?.bottlenecks ?? [];

  const totalDuration = traceData?.timeRange ? traceData.timeRange.end - traceData.timeRange.start : 0;

  function spanCount(spans: { children: any[] }[]): number {
    let count = 0;
    for (const s of spans) {
      count++;
      count += spanCount(s.children);
    }
    return count;
  }

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
        <LoadingOverlay visible={loading || urlLoading || traceLoading} message={t('traceViewer.buildingTrace')} />
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
          onClick={() => downloadNdv([])}
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

      <LoadingOverlay visible={loading || traceLoading} />
    </div>
  );
}