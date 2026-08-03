import { useCallback, useMemo } from 'react';
import { useRootStore } from '../../stores';
import { analyzeTracingEvents } from '../../shared/engine';
import { useFileUpload } from '../../shared/hooks';
import { EventTimeline } from './components/EventTimeline';
import { EventDetail } from './components/EventDetail';
import { EventSummary } from './components/EventSummary';
import { ChannelFilter } from '../../shared/components';
import { FileUpload } from '../../shared/components';
import { EmptyState } from '../../shared/components';
import { LoadingOverlay } from '../../shared/components';
import type { TracingEvent } from '../../shared/types';

export function EventViewerPage() {
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

  const { loading, error, fileName, fileSize, handleFile, reset } = useFileUpload(handleFileRead);

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
    setTracingAnalysis(null);
    setSelectedChannels([]);
    setSelectedEventIndex(null);
  }

  if (!tracingAnalysis) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Diagnostic Event Viewer</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Upload a JSON file with TracingChannel events to visualize</p>
        </div>
        <FileUpload
          onFile={handleFile}
          accept=".json"
          label="Upload tracing events JSON"
          maxSize={500 * 1024 * 1024}
          fileName={fileName}
          fileSize={fileSize}
          onReset={handleReset}
        />
        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
        <LoadingOverlay visible={loading} message="Parsing events..." />
        <div className="mt-8">
          <EmptyState
            title="No data loaded"
            description="Upload a JSON file containing TracingChannel diagnostic events to get started. Events should follow the standard TracingChannel format."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Event Viewer</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{tracingAnalysis.totalEvents} events, {tracingAnalysis.totalOperations} operations</p>
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

      <LoadingOverlay visible={loading} message="Parsing events..." />
    </div>
  );
}