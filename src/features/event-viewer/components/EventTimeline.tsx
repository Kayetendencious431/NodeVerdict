import type { TracingEvent } from '../../../shared/types';
import { formatTimestamp, channelColor, eventTypeColor, truncate } from '../../../shared/utils';
import { useI18n } from '../../../shared/i18n/useI18n';

interface EventTimelineProps {
  events: TracingEvent[];
  selectedIndex: number | null;
  onSelect: (idx: number) => void;
}

export function EventTimeline({ events, selectedIndex, onSelect }: EventTimelineProps) {
  const { t } = useI18n();
  const maxTime = events[events.length - 1]?.timestamp ?? 0;
  const minTime = events[0]?.timestamp ?? 0;
  const range = Math.max(maxTime - minTime, 1);

  return (
    <div className="overflow-auto border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
            <th className="text-left px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('eventViewer.timestamp')}</th>
            <th className="text-left px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('eventViewer.channel')}</th>
            <th className="text-left px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('eventViewer.type')}</th>
            <th className="text-left px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('eventViewer.context')}</th>
            <th className="w-24 px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('eventViewer.timeline')}</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event, idx) => (
            <tr
              key={idx}
              onClick={() => onSelect(idx)}
              className={`border-b border-gray-100 dark:border-gray-800 cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 ${
                selectedIndex === idx ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-800' : ''
              }`}
            >
              <td className="px-4 py-2 font-mono text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                {formatTimestamp(event.timestamp)}
              </td>
              <td className="px-4 py-2">
                <span
                  className="inline-block px-2 py-0.5 rounded text-xs font-medium text-white"
                  style={{ backgroundColor: channelColor(event.channel) }}
                >
                  {event.channel}
                </span>
              </td>
              <td className="px-4 py-2">
                <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${eventTypeColor(event.eventType)}`}>
                  {event.eventType}
                </span>
              </td>
              <td className="px-4 py-2 text-xs text-gray-600 dark:text-gray-300 max-w-xs truncate">
                {truncate(JSON.stringify(event.context), 60)}
              </td>
              <td className="px-4 py-2">
                <div className="relative h-4 w-20 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className="absolute top-0 h-full rounded-full opacity-70"
                    style={{
                      left: `${((event.timestamp - minTime) / range) * 100}%`,
                      width: '4px',
                      backgroundColor: channelColor(event.channel),
                    }}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}