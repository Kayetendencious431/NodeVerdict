import type { TracingEvent } from '../../../shared/types';
import { formatTimestamp, eventTypeColor } from '../../../shared/utils';

interface EventDetailProps {
  event: TracingEvent;
  onClose: () => void;
}

export function EventDetail({ event, onClose }: EventDetailProps) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700">Event Details</h3>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-500">Channel</span>
          <span className="font-medium">{event.channel}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Type</span>
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${eventTypeColor(event.eventType)}`}>
            {event.eventType}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Timestamp</span>
          <span className="font-mono text-xs">{formatTimestamp(event.timestamp)}</span>
        </div>
        {event.duration !== undefined && (
          <div className="flex justify-between">
            <span className="text-gray-500">Duration</span>
            <span className="font-medium">{event.duration.toFixed(2)}ms</span>
          </div>
        )}
        {event.error && (
          <div className="flex justify-between">
            <span className="text-gray-500">Error</span>
            <span className="text-red-600">{event.error.message}</span>
          </div>
        )}
      </div>

      <div className="mt-3">
        <p className="text-xs font-medium text-gray-500 mb-1">Context</p>
        <pre className="text-xs bg-gray-50 rounded p-2 overflow-auto max-h-48">
          {JSON.stringify(event.context, null, 2)}
        </pre>
      </div>
    </div>
  );
}