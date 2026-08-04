import type { ServiceNode, ServiceEdge, ServiceHealth } from '../../../shared/distributed';
import { useI18n } from '../../../shared/i18n/useI18n';

const HEALTH_BADGE: Record<ServiceHealth, string> = {
  healthy: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400',
  warning: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400',
  faulty: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400',
};

const HEALTH_LABEL_KEY: Record<ServiceHealth, string> = {
  healthy: 'topology.health.healthy',
  warning: 'topology.health.warning',
  faulty: 'topology.health.faulty',
};

interface Props {
  node: ServiceNode;
  edges: ServiceEdge[];
  onOpenTraces: () => void;
}

function Metric({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg bg-gray-50 dark:bg-gray-900/50 border border-gray-100 dark:border-gray-700 p-2">
      <p className="text-[11px] text-gray-500 dark:text-gray-400">{label}</p>
      <p className={`text-sm font-semibold mt-0.5 ${accent ? 'text-red-600 dark:text-red-400' : 'text-gray-800 dark:text-gray-100'}`}>{value}</p>
    </div>
  );
}

export function ServiceDetail({ node, edges, onOpenTraces }: Props) {
  const { t } = useI18n();
  const outgoing = edges.filter(e => e.source === node.id);
  const incoming = edges.filter(e => e.target === node.id);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-base font-bold text-gray-900 dark:text-gray-100 truncate">{node.serviceName}</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">{node.traceCount} {t('topology.traces')}</p>
        </div>
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium shrink-0 ${HEALTH_BADGE[node.health]}`}>
          {t(HEALTH_LABEL_KEY[node.health])}
        </span>
      </div>

      <div className="grid grid-cols-4 gap-2">
        <Metric label={t('topology.calls')} value={String(node.callCount)} />
        <Metric label={t('topology.errorRate')} value={`${(node.errorRate * 100).toFixed(1)}%`} accent={node.errorRate > 0.01} />
        <Metric label={t('topology.avg')} value={`${node.avgDuration.toFixed(1)}ms`} />
        <Metric label={t('topology.p50')} value={`${node.p50Duration.toFixed(1)}ms`} />
        <Metric label="P95" value={`${node.p95Duration.toFixed(1)}ms`} accent={node.health === 'faulty'} />
        <Metric label="P99" value={`${node.p99Duration.toFixed(1)}ms`} />
        <Metric label="Max" value={`${node.maxDuration.toFixed(1)}ms`} />
        <Metric label={t('topology.errors')} value={String(node.errorCount)} accent={node.errorCount > 0} />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Metric label={t('topology.anomaly')} value={node.anomalyScore.toFixed(2)} accent={node.anomalyScore > 0.5} />
        <Metric label={t('topology.criticality')} value={`${(node.criticality * 100).toFixed(0)}%`} />
        <Metric label={t('topology.blame')} value={node.blameScore.toFixed(2)} />
      </div>

      {outgoing.length > 0 && (
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">{t('topology.callsOut')}</p>
          <div className="space-y-1">
            {outgoing.map(e => (
              <div key={e.id} className="flex items-center justify-between text-xs rounded-lg bg-gray-50 dark:bg-gray-900/50 border border-gray-100 dark:border-gray-700 px-2 py-1.5">
                <span className="text-gray-700 dark:text-gray-200">
                  {e.source} <span className="text-gray-400">→</span> {e.target}
                </span>
                <span className="text-gray-500 dark:text-gray-400">
                  {e.callCount} · p95 {e.p95Duration.toFixed(0)}ms
                  {e.errorCount > 0 && <span className="text-red-500"> · {(e.errorRate * 100).toFixed(0)}% err</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {incoming.length > 0 && (
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">{t('topology.callsIn')}</p>
          <div className="space-y-1">
            {incoming.map(e => (
              <div key={e.id} className="flex items-center justify-between text-xs rounded-lg bg-gray-50 dark:bg-gray-900/50 border border-gray-100 dark:border-gray-700 px-2 py-1.5">
                <span className="text-gray-700 dark:text-gray-200">{e.source} <span className="text-gray-400">→</span> {e.target}</span>
                <span className="text-gray-500 dark:text-gray-400">{e.callCount} calls</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={onOpenTraces}
        className="w-full px-3 py-2 text-sm rounded-lg border border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
      >
        {t('topology.openTraceViewer')}
      </button>
    </div>
  );
}
