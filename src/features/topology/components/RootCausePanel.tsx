import type { RootCauseReport, HealthSignal } from '../../../shared/distributed';
import { useI18n } from '../../../shared/i18n/useI18n';

const SIGNAL_LABEL: Record<HealthSignal, { color: string; text: string }> = {
  latency: { color: 'text-amber-600 dark:text-amber-400', text: 'latency' },
  error: { color: 'text-red-600 dark:text-red-400', text: 'error' },
  throughput: { color: 'text-sky-600 dark:text-sky-400', text: 'throughput' },
};

interface Props {
  report: RootCauseReport;
  onOpenTraces: () => void;
}

export function RootCausePanel({ report, onOpenTraces }: Props) {
  const { t } = useI18n();
  const { rootCause, ranked, cascade, criticalPaths, recommendations } = report;
  const top = ranked[0];

  return (
    <div className="space-y-4">
      {/* Root cause summary */}
      <div className="rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('topology.rootCause')}</p>
            <p className="text-lg font-bold text-gray-900 dark:text-gray-100 mt-1">{rootCause.service}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">{Math.round(rootCause.confidence * 100)}%</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">{t('topology.confidence')}</p>
          </div>
        </div>
        <div className="mt-3 h-2 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-indigo-400 transition-all"
            style={{ width: `${Math.round(rootCause.confidence * 100)}%` }}
          />
        </div>
        {rootCause.evidence.length > 0 && (
          <ul className="mt-3 space-y-1">
            {rootCause.evidence.map((ev, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-gray-600 dark:text-gray-300">
                <span className="mt-0.5 w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0" />
                {ev}
              </li>
            ))}
          </ul>
        )}
        <button
          onClick={onOpenTraces}
          className="mt-3 w-full px-3 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors font-medium"
        >
          {t('topology.openTraceViewer')}
        </button>
      </div>

      {/* Cascade chain */}
      {cascade.length > 0 && (
        <div className="rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3">{t('topology.cascadeChain')}</p>
          <div className="space-y-1">
            {cascade.map((step, i) => (
              <div key={i} className="relative flex items-start gap-3">
                {i < cascade.length - 1 && (
                  <div className="absolute left-[11px] top-7 bottom-0 w-px bg-gray-200 dark:bg-gray-600" />
                )}
                <div className={`mt-1 w-[22px] h-[22px] rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${
                  i === 0
                    ? 'bg-red-500 text-white'
                    : SIGNAL_LABEL[step.signal].color.includes('red')
                      ? 'bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400'
                      : 'bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400'
                }`}>
                  {i + 1}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">{step.service}</span>
                    <span className={`text-xs ${SIGNAL_LABEL[step.signal].color}`}>{step.symptom}</span>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{step.evidence}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Ranked services */}
      <div className="rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3">{t('topology.rankedServices')}</p>
        <div className="space-y-2">
          {ranked.slice(0, 6).map((r, i) => (
            <div key={r.service}>
              <div className="flex items-center justify-between text-sm gap-2">
                <span className="flex items-center gap-2 min-w-0 truncate">
                  <span className="w-5 h-5 rounded-full bg-gray-100 dark:bg-gray-700 text-center text-[11px] leading-5 text-gray-500 dark:text-gray-400 shrink-0">{i + 1}</span>
                  <span className={`font-medium truncate ${i === 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-gray-200'}`}>{r.service}</span>
                  <span className={`text-xs ${SIGNAL_LABEL[r.primarySignal].color} shrink-0`}>{r.primarySignal}</span>
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">{r.score.toFixed(2)}</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
                <div
                  className={`h-full rounded-full ${i === 0 ? 'bg-red-500' : 'bg-indigo-400'}`}
                  style={{ width: `${Math.max(4, r.score * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Recommendations */}
      {recommendations.length > 0 && (
        <div className="rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3">{t('topology.recommendations')}</p>
          <ul className="space-y-2">
            {recommendations.map((rec, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-gray-600 dark:text-gray-300">
                <svg className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                <span>{rec}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Critical paths */}
      {criticalPaths.length > 0 && (
        <div className="rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3">{t('topology.criticalPaths')}</p>
          <div className="space-y-2 max-h-64 overflow-auto">
            {criticalPaths.map((path, i) => (
              <div key={i} className="rounded-lg bg-gray-50 dark:bg-gray-900/50 border border-gray-100 dark:border-gray-700 p-2">
                <div className="flex flex-wrap items-center gap-1">
                  {path.map((node, j) => (
                    <span key={j} className="flex items-center gap-1">
                      <span className={`text-[11px] px-1.5 py-0.5 rounded ${node.error ? 'bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400' : 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400'}`}>
                        {node.serviceName} · {node.duration.toFixed(0)}ms
                      </span>
                      {j < path.length - 1 && <span className="text-gray-400">→</span>}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!top && <p className="text-sm text-gray-500 dark:text-gray-400">{t('topology.noRootCause')}</p>}
    </div>
  );
}
