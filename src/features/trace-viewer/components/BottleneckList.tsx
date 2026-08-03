import type { TraceSpan } from '../../../shared/types';
import { formatDuration, channelColor } from '../../../shared/utils';

interface BottleneckListProps {
  bottlenecks: TraceSpan[];
}

export function BottleneckList({ bottlenecks }: BottleneckListProps) {
  if (bottlenecks.length === 0) {
    return <div className="text-sm text-gray-400 text-center py-4">No bottlenecks detected</div>;
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-gray-700">Bottlenecks (P95+)</h3>
      {bottlenecks.map(span => (
        <div key={span.id} className="flex items-center gap-3 bg-orange-50 border border-orange-200 rounded-lg p-3">
          <div
            className="w-2 h-8 rounded-full"
            style={{ backgroundColor: channelColor(span.channel) }}
          />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-700 truncate">{span.channel}</p>
            <p className="text-xs text-gray-500">{formatDuration(span.duration)}</p>
          </div>
          <span className="text-xs font-medium text-orange-600">Bottleneck</span>
        </div>
      ))}
    </div>
  );
}