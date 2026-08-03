import { useCallback, useMemo, useState } from 'react';
import { useRootStore } from '../../stores';
import { parseHeapSnapshot, analyzeHeap, analyzeStrings, analyzeExternalMemory, calculateGrowthRate } from '../../shared/engine';
import { useFileUpload } from '../../shared/hooks';
import type { ProgressInfo } from '../../shared/hooks/useFileUpload';
import type { StringAnalysis, MemoryGrowthRate } from '../../shared/types';
import { FileUpload, EmptyState, StatCard, LoadingOverlay } from '../../shared/components';
import { formatBytes } from '../../shared/utils';

function severityColor(severity: string) {
  switch (severity) {
    case 'high': return 'border-l-red-500 bg-red-50 dark:bg-red-900/20';
    case 'medium': return 'border-l-amber-500 bg-amber-50 dark:bg-amber-900/20';
    case 'low': return 'border-l-blue-500 bg-blue-50 dark:bg-blue-900/20';
    default: return 'border-l-gray-500 bg-gray-50 dark:bg-gray-900';
  }
}

export function HeapAnalyzerPage() {
  const { heapAnalysis, setHeapAnalysis } = useRootStore();
  const [progress, setProgress] = useState<ProgressInfo | null>(null);
  const [stringAnalysis, setStringAnalysis] = useState<StringAnalysis | null>(null);
  const [externalMemory, setExternalMemory] = useState<{totalExternal: number; totalArrayBuffers: number; externalStrings: number; externalPercent: number} | null>(null);
  const { loading, error, fileName, fileSize, handleFile, reset } = useFileUpload(useCallback(async (content: string) => {
    const snapshot = parseHeapSnapshot(content);
    const analysis = analyzeHeap(snapshot);
    setHeapAnalysis(analysis);
    const stringResult = analyzeStrings(snapshot);
    const externalResult = analyzeExternalMemory(snapshot);
    setStringAnalysis(stringResult);
    setExternalMemory(externalResult);
  }, [setHeapAnalysis, setStringAnalysis, setExternalMemory]), setProgress);

  function handleReset() {
    reset();
    setHeapAnalysis(null);
    setStringAnalysis(null);
    setExternalMemory(null);
  }

  // Wrap the raw error from parseHeapSnapshot with a more helpful message
  const displayError = error?.includes('"snapshot" field')
    ? 'This is not a valid .heapsnapshot file. Use Node.js to generate a heap snapshot (node --heapsnapshot-signal=SIGUSR2 app.js) or use the examples/heap-*.heapsnapshot files from the examples directory.'
    : error;

  if (!heapAnalysis) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Heap Snapshot Analyzer</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Upload .heapsnapshot files from Node.js to analyze memory usage</p>
        </div>
        <FileUpload
          onFile={handleFile}
          accept=".heapsnapshot,.json"
          label="Upload heap snapshot (.heapsnapshot)"
          maxSize={3 * 1024 * 1024 * 1024}
          fileName={fileName}
          fileSize={fileSize}
          onReset={handleReset}
          loading={loading}
          progress={progress}
        />
        {displayError && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{displayError}</p>}
        <LoadingOverlay visible={loading} message="Parsing heap snapshot..." />
        <div className="mt-8">
          <EmptyState
            title="No heap data"
            description="Upload a .heapsnapshot file to analyze memory allocation, detect hot objects, and identify potential memory leaks."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Heap Analysis</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{heapAnalysis.snapshot.nodeCount.toLocaleString()} nodes, {heapAnalysis.snapshot.edgeCount.toLocaleString()} edges</p>
        </div>
        <div className="w-72">
          <FileUpload
            onFile={handleFile}
            accept=".heapsnapshot,.json"
            label="Upload heap snapshot (.heapsnapshot)"
            maxSize={3 * 1024 * 1024 * 1024}
            fileName={fileName}
            fileSize={fileSize}
            onReset={handleReset}
            loading={loading}
            progress={progress}
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <StatCard title="Total Size" value={formatBytes(heapAnalysis.totalSize)} />
        <StatCard title="Total Retained" value={formatBytes(heapAnalysis.snapshot.totalRetainedSize)} />
        <StatCard title="Leak Suspects" value={heapAnalysis.leakSuspects.length.toString()} color={heapAnalysis.leakSuspects.length > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-gray-100'} />
      </div>

      {/* Top Retained Objects */}
      <div className="mb-6">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">Top Retained Objects</h2>
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
                <th className="text-left px-4 py-2 font-medium text-gray-500 dark:text-gray-400">Name</th>
                <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">Retained Size</th>
                <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">Instances</th>
              </tr>
            </thead>
            <tbody>
              {heapAnalysis.topRetainedNodes.slice(0, 20).map((item, idx) => (
                <tr key={idx} className="border-b border-gray-100 dark:border-gray-800">
                  <td className="px-4 py-2 font-mono text-xs text-gray-700 dark:text-gray-200">{item.name}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs text-gray-600 dark:text-gray-300">{formatBytes(item.size)}</td>
                  <td className="px-4 py-2 text-right text-xs text-gray-600 dark:text-gray-300">{item.count.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Leak Suspects */}
      {heapAnalysis.leakSuspects.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">Leak Suspects</h2>
          <div className="space-y-2">
            {heapAnalysis.leakSuspects.map((suspect, idx) => (
              <div
                key={idx}
                className={`border-l-4 rounded-r-lg p-3 ${severityColor(suspect.severity)}`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    suspect.severity === 'high' ? 'bg-red-200 dark:bg-red-900/40 text-red-800 dark:text-red-300' :
                    suspect.severity === 'medium' ? 'bg-amber-200 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300' :
                    'bg-blue-200 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300'
                  }`}>
                    {suspect.severity}
                  </span>
                  <span className="text-xs text-gray-500">{suspect.category.replace('-', ' ')}</span>
                </div>
                <p className="text-sm font-medium text-gray-700 dark:text-gray-200">{suspect.description}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{suspect.evidence}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* External Memory */}
      {externalMemory && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">External Memory</h2>
          <div className="grid grid-cols-3 gap-3">
            <StatCard title="External Memory" value={formatBytes(externalMemory.totalExternal)} color="text-orange-600 dark:text-orange-400" />
            <StatCard title="ArrayBuffers" value={formatBytes(externalMemory.totalArrayBuffers)} color="text-purple-600 dark:text-purple-400" />
            <StatCard
              title="External %"
              value={externalMemory.externalPercent.toFixed(1) + '%'}
              color={externalMemory.externalPercent > 20 ? 'text-red-600 dark:text-red-400' : undefined}
            />
          </div>
        </div>
      )}

      {/* String Analysis */}
      {stringAnalysis && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">String Analysis</h2>
          <div className="grid grid-cols-4 gap-3 mb-4">
            <StatCard title="Total Strings" value={stringAnalysis.totalStrings.toLocaleString()} />
            <StatCard title="String Size" value={formatBytes(stringAnalysis.totalSelfSize)} />
            <StatCard title="Unique Strings" value={stringAnalysis.uniqueStrings.toLocaleString()} />
            <StatCard title="Dedup Ratio" value={(stringAnalysis.dedupRatio * 100).toFixed(1) + '%'} />
          </div>

          {/* Top Largest Strings */}
          <div className="mb-4">
            <h3 className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-2">Top Largest Strings</h3>
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
                    <th className="text-left px-4 py-2 font-medium text-gray-500 dark:text-gray-400">Value</th>
                    <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">Self Size</th>
                    <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">Retained Size</th>
                  </tr>
                </thead>
                <tbody>
                  {stringAnalysis.topStrings.slice(0, 20).map((item, idx) => (
                    <tr key={idx} className="border-b border-gray-100 dark:border-gray-800">
                      <td className="px-4 py-2 font-mono text-xs text-gray-700 dark:text-gray-200 max-w-xs truncate">{item.value}</td>
                      <td className="px-4 py-2 text-right font-mono text-xs text-gray-600 dark:text-gray-300">{formatBytes(item.selfSize)}</td>
                      <td className="px-4 py-2 text-right font-mono text-xs text-gray-600 dark:text-gray-300">{formatBytes(item.retainedSize)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Strings by Type */}
          <div>
            <h3 className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-2">Strings by Type</h3>
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
                    <th className="text-left px-4 py-2 font-medium text-gray-500 dark:text-gray-400">Type</th>
                    <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">Count</th>
                    <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">Size</th>
                  </tr>
                </thead>
                <tbody>
                  {stringAnalysis.byType.map((item, idx) => (
                    <tr key={idx} className="border-b border-gray-100 dark:border-gray-800">
                      <td className="px-4 py-2 text-xs text-gray-700 dark:text-gray-200 capitalize">{item.type.replace('-', ' ')}</td>
                      <td className="px-4 py-2 text-right text-xs text-gray-600 dark:text-gray-300">{item.count.toLocaleString()}</td>
                      <td className="px-4 py-2 text-right font-mono text-xs text-gray-600 dark:text-gray-300">{formatBytes(item.size)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Memory Growth Rate */}
      <div className="mb-6">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">Memory Growth Rate</h2>
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">Upload a memory usage timeline (Memory Timeline page) to calculate growth rates.</p>
        </div>
      </div>

      <LoadingOverlay visible={loading} />
    </div>
  );
}