import { StatCard } from '../../../shared/components';
import type { TracingAnalysis } from '../../../shared/types';
import { formatDuration, formatPercent } from '../../../shared/utils';
import { useI18n } from '../../../shared/i18n/useI18n';

interface EventSummaryProps {
  analysis: TracingAnalysis;
}

export function EventSummary({ analysis }: EventSummaryProps) {
  const { t } = useI18n();
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <StatCard title={t('eventViewer.totalEvents')} value={analysis.totalEvents.toLocaleString()} subtitle={t('eventViewer.acrossChannels')} />
      <StatCard title={t('eventViewer.operations')} value={analysis.totalOperations.toLocaleString()} subtitle={t('eventViewer.pairedStartEnd')} />
      <StatCard
        title={t('eventViewer.errorRate')}
        value={formatPercent(analysis.errorRate)}
        subtitle={t('eventViewer.errorsCount').replace('{count}', String(analysis.operations.filter(o => o.status === 'error').length))}
        color={analysis.errorRate > 0.05 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-gray-100'}
      />
      <StatCard
        title={t('eventViewer.timeRange')}
        value={formatDuration(analysis.timeRange.end - analysis.timeRange.start)}
        subtitle={t('eventViewer.channelsCount').replace('{count}', String(analysis.channels.length))}
      />
    </div>
  );
}