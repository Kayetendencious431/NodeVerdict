import { AppShell } from './AppShell';
import { EventViewerPage } from '../features/event-viewer';
import { TraceViewerPage } from '../features/trace-viewer';
import { ValidatorPage } from '../features/validator';
import { HeapAnalyzerPage } from '../features/heap-analyzer';
import { ReportPage } from '../features/report';
import { CpuProfilerPage } from '../features/cpu-profiler';
import { HeapDiffPage } from '../features/heap-diff';
import { SearchFilterPage } from '../features/search-filter';
import { TimeSeriesPage } from '../features/time-series';
import { PerfComparePage } from '../features/perf-compare';
import { useUIStore } from '../stores';
import { TutorialPage } from '../features/tutorial';
import { MemoryTimelinePage } from '../features/memory-timeline';
import { GcLogPage } from '../features/gc-log';
import { LiveMonitorPage } from '../features/live-monitor';
import { AlertRulesPage } from '../features/alert-rules';
import { SnapshotHistoryPage } from '../features/snapshot-history';
import { useEffect } from 'react';
import { useI18n } from '../shared/i18n/useI18n';

function HomePage() {
  const { navigate } = useUIStore();
  const { t } = useI18n();

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="text-center py-12">
        <div className="w-16 h-16 bg-indigo-100 dark:bg-indigo-900/50 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-indigo-600 dark:text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-2">{t('app.title')}</h1>
        <p className="text-gray-500 dark:text-gray-400 mb-8">{t('app.description')}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FeatureCard
          title={t('feature.event-viewer')}
          description={t('feature.event-viewer.desc')}
          icon="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
          onClick={() => navigate('event-viewer')}
        />
        <FeatureCard
          title={t('feature.trace-viewer')}
          description={t('feature.trace-viewer.desc')}
          icon="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z"
          onClick={() => navigate('trace-viewer')}
        />
        <FeatureCard
          title={t('feature.cpu-profiler')}
          description={t('feature.cpu-profiler.desc')}
          icon="M13 10V3L4 14h7v7l9-11h-7z"
          onClick={() => navigate('cpu-profiler')}
        />
        <FeatureCard
          title={t('feature.heap-analyzer')}
          description={t('feature.heap-analyzer.desc')}
          icon="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"
          onClick={() => navigate('heap-analyzer')}
        />
        <FeatureCard
          title={t('feature.heap-diff')}
          description={t('feature.heap-diff.desc')}
          icon="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          onClick={() => navigate('heap-diff')}
        />
        <FeatureCard
          title={t('feature.time-series')}
          description={t('feature.time-series.desc')}
          icon="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
          onClick={() => navigate('time-series')}
        />
        <FeatureCard
          title={t('feature.perf-compare')}
          description={t('feature.perf-compare.desc')}
          icon="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
          onClick={() => navigate('perf-compare')}
        />
        <FeatureCard
          title="Validator"
          description="Validate TracingChannel events against naming conventions, field requirements, and pairing completeness."
          icon="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
          onClick={() => navigate('validator')}
        />
        <FeatureCard
          title="Search & Filter"
          description="Full-text search, regex, duration range, status filter, and time range across all events."
          icon="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          onClick={() => navigate('search-filter')}
        />
        <FeatureCard
          title="Memory Timeline"
          description="Upload process.memoryUsage() time series data to visualize external, heap, and RSS memory trends."
          icon="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
          onClick={() => navigate('memory-timeline')}
        />
        <FeatureCard
          title="GC Log Analyzer"
          description="Upload --trace-gc log files to analyze garbage collection patterns, pause times, and external memory pressure."
          icon="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
          onClick={() => navigate('gc-log')}
        />
        <FeatureCard
          title="Live Monitor"
          description="Connect to a running Node.js process via WebSocket — stream tracing events, memory usage, heap snapshots, and CPU profiles in real-time."
          icon="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
          onClick={() => navigate('live-monitor')}
        />
        <FeatureCard
          title="Report"
          description="Generate shareable diagnostic reports with findings compressed into the URL or as a standalone HTML file."
          icon="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          onClick={() => navigate('report')}
          className="md:col-span-2"
        />
      </div>

      <div className="mt-6">
        <FeatureCard
          title="Tutorial"
          description="Learn how to generate diagnostic data from your Node.js project and use all of NodeVerdict's features."
          icon="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
          onClick={() => navigate('tutorial')}
        />
      </div>
    </div>
  );
}

function FeatureCard({ title, description, icon, onClick, className = '' }: {
  title: string; description: string; icon: string; onClick: () => void; className?: string;
}) {
  return (
    <button onClick={onClick} className={`bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 text-left hover:shadow-md hover:border-indigo-200 dark:hover:border-indigo-600 transition-all group ${className}`}>
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 bg-indigo-50 dark:bg-indigo-900/30 rounded-lg flex items-center justify-center shrink-0 group-hover:bg-indigo-100 dark:group-hover:bg-indigo-900/50 transition-colors">
          <svg className="w-5 h-5 text-indigo-600 dark:text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={icon} />
          </svg>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 group-hover:text-indigo-700 dark:group-hover:text-indigo-400 transition-colors">{title}</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">{description}</p>
        </div>
      </div>
    </button>
  );
}

export function App() {
  const { currentPage } = useUIStore();
  const darkMode = useUIStore((s) => s.darkMode);

  // Apply dark class on mount and when darkMode changes
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  return (
    <AppShell>
      <div style={{ display: currentPage === 'home' ? 'block' : 'none' }}><HomePage /></div>
      <div style={{ display: currentPage === 'event-viewer' ? 'block' : 'none' }}><EventViewerPage /></div>
      <div style={{ display: currentPage === 'trace-viewer' ? 'block' : 'none' }}><TraceViewerPage /></div>
      <div style={{ display: currentPage === 'validator' ? 'block' : 'none' }}><ValidatorPage /></div>
      <div style={{ display: currentPage === 'heap-analyzer' ? 'block' : 'none' }}><HeapAnalyzerPage /></div>
      <div style={{ display: currentPage === 'heap-diff' ? 'block' : 'none' }}><HeapDiffPage /></div>
      <div style={{ display: currentPage === 'report' ? 'block' : 'none' }}><ReportPage /></div>
      <div style={{ display: currentPage === 'cpu-profiler' ? 'block' : 'none' }}><CpuProfilerPage /></div>
      <div style={{ display: currentPage === 'search-filter' ? 'block' : 'none' }}><SearchFilterPage /></div>
      <div style={{ display: currentPage === 'time-series' ? 'block' : 'none' }}><TimeSeriesPage /></div>
      <div style={{ display: currentPage === 'perf-compare' ? 'block' : 'none' }}><PerfComparePage /></div>
      <div style={{ display: currentPage === 'tutorial' ? 'block' : 'none' }}><TutorialPage /></div>
      <div style={{ display: currentPage === 'memory-timeline' ? 'block' : 'none' }}><MemoryTimelinePage /></div>
      <div style={{ display: currentPage === 'gc-log' ? 'block' : 'none' }}><GcLogPage /></div>
      <div style={{ display: currentPage === 'live-monitor' ? 'block' : 'none' }}><LiveMonitorPage /></div>
      <div style={{ display: currentPage === 'alert-rules' ? 'block' : 'none' }}><AlertRulesPage /></div>
      <div style={{ display: currentPage === 'snapshot-history' ? 'block' : 'none' }}><SnapshotHistoryPage /></div>
    </AppShell>
  );
}