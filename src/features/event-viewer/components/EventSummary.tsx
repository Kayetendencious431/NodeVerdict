import { StatCard } from '../../../shared/components';
import type { TracingAnalysis } from '../../../shared/types';
import { formatDuration, formatPercent } from '../../../shared/utils';

interface EventSummaryProps {
  analysis: TracingAnalysis;
}

export function EventSummary({ analysis }: EventSummaryProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <StatCard title="Total Events" value={analysis.totalEvents.toLocaleString()} subtitle="Across all channels" />
      <StatCard title="Operations" value={analysis.totalOperations.toLocaleString()} subtitle="Paired start/end" />
      <StatCard
        title="Error Rate"
        value={formatPercent(analysis.errorRate)}
        subtitle={`${analysis.operations.filter(o => o.status === 'error').length} errors`}
        color={analysis.errorRate > 0.05 ? 'text-red-600' : 'text-gray-900'}
      />
      <StatCard
        title="Time Range"
        value={formatDuration(analysis.timeRange.end - analysis.timeRange.start)}
        subtitle={`${analysis.channels.length} channels`}
      />
    </div>
  );
}