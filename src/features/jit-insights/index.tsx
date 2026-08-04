import { useCallback, useMemo, useState } from 'react';
import { useFileUpload } from '../../shared/hooks/useFileUpload';
import type { ProgressInfo } from '../../shared/hooks/useFileUpload';
import { parseV8Trace, analyzeJit, generatePatches } from '../../shared/engine';
import type { JitAnalysis, JitFinding } from '../../shared/types';
import { FileUpload, EmptyState, StatCard, LoadingOverlay } from '../../shared/components';
import { useUIStore } from '../../stores';
import { useI18n } from '../../shared/i18n/useI18n';
import { IcStateGraph } from './components/IcStateGraph';
import { OptTimeline } from './components/OptTimeline';
import { FindingsList } from './components/FindingsList';
import { PatchPanel } from './components/PatchPanel';
import demoV8Trace from '../../../examples/v8-jit-trace.log?raw';

type Tab = 'overview' | 'graph' | 'timeline' | 'findings' | 'patches';

const STATE_BADGE: Record<string, string> = {
  monomorphic: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  polymorphic: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  megamorphic: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  uninitialized: 'bg-gray-50 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
};

export function JitInsightsPage() {
  const { t } = useI18n();
  const darkMode = useUIStore(s => s.darkMode);

  const [analysis, setAnalysis] = useState<JitAnalysis | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressInfo | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [selectedSite, setSelectedSite] = useState<string | null>(null);

  const { loading, error, fileName, fileSize, handleFile, reset } = useFileUpload(
    useCallback((content: string) => {
      setParseError(null);
      try {
        const trace = parseV8Trace(content);
        if (trace.icEvents.length === 0 && trace.optEvents.length === 0 && trace.deoptEvents.length === 0) {
          setParseError(t('jitInsights.noEvents'));
          setAnalysis(null);
          return;
        }
        setAnalysis(analyzeJit(trace));
        setSelectedSite(null);
        setTab('overview');
      } catch (err) {
        setParseError((err as Error).message);
        setAnalysis(null);
      }
    }, [t]),
    setProgress,
  );

  const displayError = parseError || error;

  function handleReset() {
    reset();
    setAnalysis(null);
    setParseError(null);
    setSelectedSite(null);
  }

  function loadDemo() {
    setParseError(null);
    const trace = parseV8Trace(demoV8Trace);
    setAnalysis(analyzeJit(trace));
    setSelectedSite(null);
    setTab('overview');
  }

  const demoTrace = useMemo(() => (analysis ? analysis.trace : null), [analysis]);
  const findings = useMemo(() => analysis?.findings ?? [], [analysis]);
  const criticalCount = useMemo(() => findings.filter((f: JitFinding) => f.severity === 'critical').length, [findings]);

  const TAB_DEFS: { id: Tab; label: string }[] = [
    { id: 'overview', label: t('jitInsights.tab.overview') },
    { id: 'graph', label: t('jitInsights.tab.graph') },
    { id: 'timeline', label: t('jitInsights.tab.timeline') },
    { id: 'findings', label: t('jitInsights.tab.findings') },
    { id: 'patches', label: t('jitInsights.tab.patches') },
  ];

  if (!analysis || !demoTrace) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">{t('jitInsights.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('jitInsights.description')}</p>
        </div>
        <FileUpload
          onFile={handleFile}
          accept=".txt,.log"
          label={t('jitInsights.uploadTitle')}
          maxSize={512 * 1024 * 1024}
          fileName={fileName}
          fileSize={fileSize}
          onReset={handleReset}
          loading={loading}
          progress={progress}
        />
        {displayError && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{displayError}</p>}
        <div className="mt-4">
          <button
            onClick={loadDemo}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
          >
            {t('jitInsights.loadDemo')}
          </button>
        </div>
        <div className="mt-8">
          <EmptyState title={t('jitInsights.noData')} description={t('jitInsights.description')} />
        </div>
        <LoadingOverlay visible={loading} />
      </div>
    );
  }

  const siteRows = analysis.sites.slice(0, 12);

  return (
    <div className="p-6">
      <div className="mb-4 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">{t('jitInsights.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('jitInsights.summary').replace('{ic}', demoTrace.icEvents.length.toLocaleString()).replace('{opt}', demoTrace.optEvents.length.toLocaleString()).replace('{deopt}', demoTrace.deoptEvents.length.toLocaleString())}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadDemo}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600"
          >
            {t('jitInsights.loadDemo')}
          </button>
          <div className="w-56">
            <FileUpload
              onFile={handleFile}
              accept=".txt,.log"
              label={t('jitInsights.uploadTitle')}
              maxSize={512 * 1024 * 1024}
              fileName={fileName}
              fileSize={fileSize}
              onReset={handleReset}
              loading={loading}
              progress={progress}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatCard title={t('jitInsights.icEvents')} value={demoTrace.icEvents.length.toLocaleString()} subtitle={t('jitInsights.icEventsSub').replace('{count}', analysis.sites.length.toLocaleString())} />
        <StatCard title={t('jitInsights.optEvents')} value={demoTrace.optEvents.length.toLocaleString()} />
        <StatCard title={t('jitInsights.deoptEvents')} value={demoTrace.deoptEvents.length.toLocaleString()} subtitle={t('jitInsights.findingsCount').replace('{count}', String(findings.length))} />
        <StatCard
          title={t('jitInsights.health')}
          value={`${Math.round(analysis.healthScore * 100)}%`}
          color={analysis.healthScore > 0.6 ? 'text-emerald-600 dark:text-emerald-400' : analysis.healthScore > 0.35 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}
          subtitle={criticalCount > 0 ? t('jitInsights.criticalCount').replace('{count}', String(criticalCount)) : t('jitInsights.noCritical')}
        />
      </div>

      <div className="mb-4 flex items-center gap-1 flex-wrap">
        {TAB_DEFS.map(def => (
          <button
            key={def.id}
            onClick={() => setTab(def.id)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${tab === def.id ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
          >
            {def.label}
            {def.id === 'findings' && findings.length > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-[9px] bg-white/20">{findings.length}</span>
            )}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
            <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 text-sm font-semibold text-gray-700 dark:text-gray-200">
              {t('jitInsights.hotSites')}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 text-left">
                    <th className="px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('jitInsights.kind')}</th>
                    <th className="px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('jitInsights.site')}</th>
                    <th className="px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('jitInsights.state')}</th>
                    <th className="px-4 py-2 text-right font-medium text-gray-500 dark:text-gray-400">{t('jitInsights.maps')}</th>
                    <th className="px-4 py-2 text-right font-medium text-gray-500 dark:text-gray-400">{t('jitInsights.hits')}</th>
                    <th className="px-4 py-2 font-medium text-gray-500 dark:text-gray-400">{t('jitInsights.keys')}</th>
                  </tr>
                </thead>
                <tbody>
                  {siteRows.map(site => (
                    <tr key={site.id} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800">
                      <td className="px-4 py-2 font-mono text-xs text-gray-700 dark:text-gray-200">{site.kind}</td>
                      <td className="px-4 py-2 font-mono text-xs text-gray-600 dark:text-gray-300">{site.site ?? '—'}</td>
                      <td className="px-4 py-2">
                        <span className={`inline-block text-[10px] font-medium px-2 py-0.5 rounded capitalize ${STATE_BADGE[site.state] ?? ''}`}>
                          {site.state}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs text-gray-600 dark:text-gray-300">{site.maps.length}</td>
                      <td className="px-4 py-2 text-right font-mono text-xs text-gray-600 dark:text-gray-300">{site.hits}</td>
                      <td className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400">{site.keys.slice(0, 4).join(', ')}{site.keys.length > 4 ? '…' : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <FindingsList findings={findings} />
        </div>
      )}

      {tab === 'graph' && (
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">{t('jitInsights.graphHint')}</p>
          <IcStateGraph
            graph={analysis.graph}
            darkMode={darkMode}
            onSelectSite={setSelectedSite}
            selectedSite={selectedSite}
          />
          {selectedSite && (
            <button onClick={() => setSelectedSite(null)} className="mt-2 text-xs text-indigo-600 dark:text-indigo-400">
              {t('jitInsights.clearSelection')}
            </button>
          )}
        </div>
      )}

      {tab === 'timeline' && <OptTimeline trace={demoTrace} functions={analysis.functions} />}

      {tab === 'findings' && <FindingsList findings={findings} />}

      {tab === 'patches' && <PatchPanel />}
    </div>
  );
}
