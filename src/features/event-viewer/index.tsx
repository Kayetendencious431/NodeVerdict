import { useCallback, useMemo, useState } from 'react';
import { useRootStore } from '../../stores';
import { analyzeTracingEvents } from '../../shared/engine';
import { useFileUpload, useRemoteFile } from '../../shared/hooks';
import type { ProgressInfo } from '../../shared/hooks/useFileUpload';
import { useI18n } from '../../shared/i18n/useI18n';
import { EventTimeline } from './components/EventTimeline';
import { EventDetail } from './components/EventDetail';
import { EventSummary } from './components/EventSummary';
import { ChannelFilter } from '../../shared/components';
import { FileUpload } from '../../shared/components';
import { EmptyState } from '../../shared/components';
import { LoadingOverlay } from '../../shared/components';
import type { TracingEvent } from '../../shared/types';
import { ExportButton } from '../report/ExportButton';
import { toMarkdown } from '../report/exportUtils';

export function EventViewerPage() {
  const { t } = useI18n();
  const {
    tracingAnalysis,
    setTracingAnalysis,
    selectedChannels,
    setSelectedChannels,
    selectedEventIndex,
    setSelectedEventIndex,
  } = useRootStore();

  const handleFileRead = useCallback(async (content: string) => {
    const events = JSON.parse(content) as TracingEvent[];
    const analysis = analyzeTracingEvents(events);
    setTracingAnalysis(analysis);
    setSelectedChannels(analysis.channels);
  }, [setTracingAnalysis, setSelectedChannels]);

  const [progress, setProgress] = useState<ProgressInfo | null>(null);
  const { loading, error, fileName, fileSize, handleFile, reset } = useFileUpload(handleFileRead, setProgress);

  const {
    loading: urlLoading,
    error: urlError,
    progress: urlProgress,
    loadFromUrl,
    cancel: cancelUrl,
    reset: resetUrl,
  } = useRemoteFile({
    onFile: handleFileRead,
    onProgress: (p) => setProgress({ loaded: p.loaded, total: p.total, percent: p.total > 0 ? Math.round((p.loaded / p.total) * 100) : 0 }),
  });

  const filteredEvents = useMemo(() => {
    if (!tracingAnalysis) return [];
    // When no channels are selected, show all events (select-all default)
    if (selectedChannels.length === 0) return tracingAnalysis.events;
    return tracingAnalysis.events.filter(e => selectedChannels.includes(e.channel));
  }, [tracingAnalysis, selectedChannels]);

  const selectedEvent = useMemo(() => {
    if (selectedEventIndex === null || !tracingAnalysis) return null;
    return tracingAnalysis.events[selectedEventIndex] ?? null;
  }, [selectedEventIndex, tracingAnalysis]);

  function handleReset() {
    reset();
    resetUrl();
    setTracingAnalysis(null);
    setSelectedChannels([]);
    setSelectedEventIndex(null);
  }

  if (!tracingAnalysis) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">{t('eventViewer.uploadTitle')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('eventViewer.uploadHint')}</p>
        </div>
        <FileUpload
          onFile={handleFile}
          accept=".json"
          label={t('eventViewer.uploadTitle')}
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
        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
        {urlError && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{urlError}</p>}
        <LoadingOverlay visible={loading || urlLoading} message={t('eventViewer.parsingEvents')} />
        <div className="mt-8">
          <EmptyState
            title={t('eventViewer.noEvents')}
            description={t('eventViewer.uploadHint')}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">{t('eventViewer.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('eventViewer.eventsAndOps').replace('{events}', String(tracingAnalysis.totalEvents)).replace('{operations}', String(tracingAnalysis.totalOperations))}</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButton
            onExportMarkdown={() => toMarkdown({
              title: 'Diagnostic Event Viewer',
              sections: [
                {
                  title: t('eventViewer.summary'),
                  type: 'stats',
                  content: [
                    { label: t('eventViewer.totalEvents'), value: tracingAnalysis.totalEvents.toLocaleString() },
                    { label: t('eventViewer.totalOperations'), value: tracingAnalysis.totalOperations.toLocaleString() },
                    { label: t('eventViewer.errorRate'), value: `${(tracingAnalysis.errorRate * 100).toFixed(1)}%` },
                    { label: t('eventViewer.totalChannels'), value: tracingAnalysis.channels.length.toString() },
                  ],
                },
                {
                  title: t('eventViewer.channelStats'),
                  type: 'table',
                  content: {
                    headers: [t('eventViewer.channel'), t('eventViewer.operations'), t('eventViewer.avgLatency'), t('eventViewer.p95Latency'), t('eventViewer.errors')],
                    rows: tracingAnalysis.channelStats.slice(0, 30).map(cs => [
                      cs.channel,
                      cs.totalOperations.toString(),
                      `${cs.avgDuration.toFixed(0)}ms`,
                      `${cs.p95Duration.toFixed(0)}ms`,
                      cs.errorCount.toString(),
                    ]),
                  },
                },
              ],
            })}
            filename="event-viewer"
          />
          <div className="w-72">
            <FileUpload
              onFile={handleFile}
              accept=".json"
              label={t('eventViewer.uploadTitle')}
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
      </div>

      <EventSummary analysis={tracingAnalysis} />

      <div className="mt-4 mb-3">
        <ChannelFilter
          channels={tracingAnalysis.channels}
          selected={selectedChannels}
          onChange={setSelectedChannels}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <EventTimeline
            events={filteredEvents}
            selectedIndex={selectedEventIndex}
            onSelect={setSelectedEventIndex}
          />
        </div>
        <div>
          {selectedEvent ? (
            <EventDetail event={selectedEvent} onClose={() => setSelectedEventIndex(null)} />
          ) : (
            <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-6 text-center text-sm text-gray-400 dark:text-gray-500">
              Click an event to see details
            </div>
          )}
        </div>
      </div>

      <LoadingOverlay visible={loading} message={t('eventViewer.parsingEvents')} />
    </div>
  );
}