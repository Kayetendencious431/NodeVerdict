import type { TraceSpan } from '../../../shared/types';
import { formatDuration, channelColor } from '../../../shared/utils';
import { useI18n } from '../../../shared/i18n/useI18n';

interface BottleneckListProps {
  bottlenecks: TraceSpan[];
}

export function BottleneckList({ bottlenecks }: BottleneckListProps) {
  const { t } = useI18n();
  if (bottlenecks.length === 0) {
    return <div className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">{t('traceViewer.noBottlenecks')}</div>;
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">{t('traceViewer.bottlenecks')}</h3>
      {bottlenecks.map(span => (
        <div key={span.id} className="flex items-center gap-3 bg-orange-50 dark:bg-orange-900/15 border border-orange-200 dark:border-orange-800 rounded-lg p-3">
          <div
            className="w-2 h-8 rounded-full"
            style={{ backgroundColor: channelColor(span.channel) }}
          />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-200 truncate">{span.channel}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">{formatDuration(span.duration)}</p>
          </div>
          <span className="text-xs font-medium text-orange-600 dark:text-orange-400">{t('traceViewer.bottleneck')}</span>
        </div>
      ))}
    </div>
  );
}