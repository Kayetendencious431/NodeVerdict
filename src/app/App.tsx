import { AppShell } from './AppShell';
import { EventViewerPage } from '../features/event-viewer';
import { TraceViewerPage } from '../features/trace-viewer';
import { ValidatorPage } from '../features/validator';
import { HeapAnalyzerPage } from '../features/heap-analyzer';
import { ReportPage } from '../features/report';
import { useUIStore } from '../stores';

function HomePage() {
  const { navigate } = useUIStore();

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="text-center py-12">
        <div className="w-16 h-16 bg-indigo-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-gray-800 mb-2">NodeVerdict</h1>
        <p className="text-gray-500 mb-8">Node.js TracingChannel diagnostic data viewer — all analysis runs locally in your browser.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FeatureCard
          title="Event Viewer"
          description="Browse tracing events in a timeline, filter by channel, inspect event context and metadata."
          icon="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
          onClick={() => navigate('event-viewer')}
        />
        <FeatureCard
          title="Trace Viewer"
          description="Visualize async operation chains as a waterfall chart, identify bottlenecks."
          icon="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z"
          onClick={() => navigate('trace-viewer')}
        />
        <FeatureCard
          title="Validator"
          description="Validate TracingChannel events against naming conventions, field requirements, and pairing completeness."
          icon="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
          onClick={() => navigate('validator')}
        />
        <FeatureCard
          title="Heap Analyzer"
          description="Parse .heapsnapshot files, find hot objects and memory leak suspects."
          icon="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"
          onClick={() => navigate('heap-analyzer')}
        />
        <FeatureCard
          title="Report"
          description="Generate shareable diagnostic reports with findings compressed into the URL."
          icon="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          onClick={() => navigate('report')}
          className="md:col-span-2"
        />
      </div>
    </div>
  );
}

function FeatureCard({ title, description, icon, onClick, className = '' }: {
  title: string; description: string; icon: string; onClick: () => void; className?: string;
}) {
  return (
    <button onClick={onClick} className={`bg-white border border-gray-200 rounded-xl p-5 text-left hover:shadow-md hover:border-indigo-200 transition-all group ${className}`}>
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 bg-indigo-50 rounded-lg flex items-center justify-center shrink-0 group-hover:bg-indigo-100 transition-colors">
          <svg className="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={icon} />
          </svg>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-gray-800 group-hover:text-indigo-700 transition-colors">{title}</h3>
          <p className="text-xs text-gray-500 mt-1 leading-relaxed">{description}</p>
        </div>
      </div>
    </button>
  );
}

export function App() {
  const { currentPage } = useUIStore();

  const pageContent = (() => {
    switch (currentPage) {
      case 'event-viewer': return <EventViewerPage />;
      case 'trace-viewer': return <TraceViewerPage />;
      case 'validator': return <ValidatorPage />;
      case 'heap-analyzer': return <HeapAnalyzerPage />;
      case 'report': return <ReportPage />;
      default: return <HomePage />;
    }
  })();

  return (
    <AppShell>
      {pageContent}
    </AppShell>
  );
}