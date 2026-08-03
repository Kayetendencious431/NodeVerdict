import { useCallback, useMemo, useState } from 'react';
import { useRootStore } from '../../stores';
import { useFileUpload } from '../../shared/hooks';
import { analyzeCpuProfile } from '../../shared/engine';
import { FlameGraph } from './components/FlameGraph';
import { FileUpload, EmptyState, StatCard, LoadingOverlay } from '../../shared/components';
import type { CpuProfileAnalysis } from '../../shared/types';

export function CpuProfilerPage() {
  const [analysis, setAnalysis] = useState<CpuProfileAnalysis | null>(null);
  const [sortBy, setSortBy] = useState<'self' | 'total'>('total');
  const { loading, error, fileName, fileSize, handleFile, reset } = useFileUpload(useCallback(async (content: string) => {
    const result = analyzeCpuProfile(content);
    setAnalysis(result);
  }, []));

  // Must be before any early return to keep hooks consistent
  const sortedFunctions = useMemo(() => {
    if (!analysis) return [];
    const list = [...analysis.hotFunctions];
    if (sortBy === 'self') {
      list.sort((a, b) => b.selfTime - a.selfTime);
    } else {
      list.sort((a, b) => b.totalTime - a.totalTime);
    }
    return list.slice(0, 100);
  }, [analysis, sortBy]);

  function handleReset() {
    reset();
    setAnalysis(null);
  }

  if (!analysis) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">CPU Profiler</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Upload .cpuprofile files to visualize CPU usage with flame graphs</p>
        </div>
        <FileUpload
          onFile={handleFile}
          accept=".cpuprofile,.json"
          label="Upload CPU profile (.cpuprofile)"
          maxSize={50 * 1024 * 1024}
          fileName={fileName}
          fileSize={fileSize}
          onReset={handleReset}
        />
        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
        <LoadingOverlay visible={loading} message="Analyzing CPU profile..." />
        <div className="mt-8">
          <EmptyState
            title="No CPU profile loaded"
            description="Upload a .cpuprofile file from Node.js (--cpu-prof) or Chrome DevTools to visualize hot functions and call stacks."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">CPU Profile Analysis</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {analysis.sampleCount.toLocaleString()} samples, {analysis.totalTime.toFixed(2)}ms total
          </p>
        </div>
        <div className="w-72">
          <FileUpload
            onFile={handleFile}
            accept=".cpuprofile,.json"
            label="Upload CPU profile"
            maxSize={50 * 1024 * 1024}
            fileName={fileName}
            fileSize={fileSize}
            onReset={handleReset}
          />
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        <StatCard title="Total Time" value={`${analysis.totalTime.toFixed(1)}ms`} />
        <StatCard title="Samples" value={analysis.sampleCount.toLocaleString()} />
        <StatCard title="Functions" value={analysis.hotFunctions.length.toLocaleString()} />
        <StatCard title="Top Hot" value={analysis.topFunctions[0]?.functionName ?? 'N/A'} subtitle={analysis.topFunctions[0] ? `${analysis.topFunctions[0].totalTime.toFixed(1)}ms` : ''} />
      </div>

      {/* Flame Graph */}
      <div className="mb-6">
        <FlameGraph flameTree={analysis.flameTree} totalTime={analysis.totalTime} />
      </div>

      {/* Hot Functions Table */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
        <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Hot Functions</h2>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 dark:text-gray-400">Sort by:</span>
            <button
              onClick={() => setSortBy('total')}
              className={`px-2 py-1 text-xs rounded ${sortBy === 'total' ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
            >
              Total Time
            </button>
            <button
              onClick={() => setSortBy('self')}
              className={`px-2 py-1 text-xs rounded ${sortBy === 'self' ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
            >
              Self Time
            </button>
          </div>
        </div>
        <div className="overflow-x-auto max-h-80 overflow-y-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 sticky top-0">
                <th className="text-left px-4 py-2 font-medium text-gray-500 dark:text-gray-400">Function</th>
                <th className="text-left px-4 py-2 font-medium text-gray-500 dark:text-gray-400">File</th>
                <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">Self Time</th>
                <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">Total Time</th>
                <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">Self %</th>
                <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">Hits</th>
              </tr>
            </thead>
            <tbody>
              {sortedFunctions.map((fn, idx) => (
                <tr key={idx} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800">
                  <td className="px-4 py-2 font-mono text-xs text-gray-700 dark:text-gray-200 max-w-xs truncate">{fn.functionName}</td>
                  <td className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400 max-w-[120px] truncate">
                    {fn.url ? fn.url.split('/').pop() + (fn.line ? `:${fn.line}` : '') : '-'}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs text-gray-600 dark:text-gray-300">{fn.selfTime.toFixed(2)}ms</td>
                  <td className="px-4 py-2 text-right font-mono text-xs text-gray-600 dark:text-gray-300">{fn.totalTime.toFixed(2)}ms</td>
                  <td className="px-4 py-2 text-right font-mono text-xs text-gray-600 dark:text-gray-300">{fn.selfPercent.toFixed(1)}%</td>
                  <td className="px-4 py-2 text-right text-xs text-gray-600 dark:text-gray-300">{fn.hitCount.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}