import { useCallback, useMemo } from 'react';
import { useRootStore } from '../../stores';
import { parseHeapSnapshot, analyzeHeap } from '../../shared/engine';
import { useFileUpload } from '../../shared/hooks';
import { FileUpload, EmptyState, StatCard, LoadingOverlay } from '../../shared/components';
import { formatBytes } from '../../shared/utils';

function severityColor(severity: string) {
  switch (severity) {
    case 'high': return 'border-l-red-500 bg-red-50';
    case 'medium': return 'border-l-amber-500 bg-amber-50';
    case 'low': return 'border-l-blue-500 bg-blue-50';
    default: return 'border-l-gray-500 bg-gray-50';
  }
}

export function HeapAnalyzerPage() {
  const { heapAnalysis, setHeapAnalysis } = useRootStore();
  const { loading, error, fileName, fileSize, handleFile, reset } = useFileUpload(useCallback(async (content: string) => {
    const snapshot = parseHeapSnapshot(content);
    const analysis = analyzeHeap(snapshot);
    setHeapAnalysis(analysis);
  }, [setHeapAnalysis]));

  function handleReset() {
    reset();
    setHeapAnalysis(null);
  }

  if (!heapAnalysis) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-gray-800">Heap Snapshot Analyzer</h1>
          <p className="text-sm text-gray-500 mt-1">Upload .heapsnapshot files from Node.js to analyze memory usage</p>
        </div>
        <FileUpload
          onFile={handleFile}
          accept=".heapsnapshot,.json"
          label="Upload heap snapshot (.heapsnapshot)"
          maxSize={200 * 1024 * 1024}
          fileName={fileName}
          fileSize={fileSize}
          onReset={handleReset}
        />
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
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
      <div className="mb-4">
        <h1 className="text-xl font-bold text-gray-800">Heap Analysis</h1>
        <p className="text-sm text-gray-500">{heapAnalysis.snapshot.nodeCount.toLocaleString()} nodes, {heapAnalysis.snapshot.edgeCount.toLocaleString()} edges</p>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <StatCard title="Total Size" value={formatBytes(heapAnalysis.totalSize)} />
        <StatCard title="Total Retained" value={formatBytes(heapAnalysis.snapshot.totalRetainedSize)} />
        <StatCard title="Leak Suspects" value={heapAnalysis.leakSuspects.length.toString()} color={heapAnalysis.leakSuspects.length > 0 ? 'text-red-600' : 'text-gray-900'} />
      </div>

      {/* Top Retained Objects */}
      <div className="mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-2">Top Retained Objects</h2>
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-2 font-medium text-gray-500">Name</th>
                <th className="text-right px-4 py-2 font-medium text-gray-500">Retained Size</th>
                <th className="text-right px-4 py-2 font-medium text-gray-500">Instances</th>
              </tr>
            </thead>
            <tbody>
              {heapAnalysis.topRetainedNodes.slice(0, 20).map((item, idx) => (
                <tr key={idx} className="border-b border-gray-100">
                  <td className="px-4 py-2 font-mono text-xs text-gray-700">{item.name}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs text-gray-600">{formatBytes(item.size)}</td>
                  <td className="px-4 py-2 text-right text-xs text-gray-600">{item.count.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Leak Suspects */}
      {heapAnalysis.leakSuspects.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-700 mb-2">Leak Suspects</h2>
          <div className="space-y-2">
            {heapAnalysis.leakSuspects.map((suspect, idx) => (
              <div
                key={idx}
                className={`border-l-4 rounded-r-lg p-3 ${severityColor(suspect.severity)}`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    suspect.severity === 'high' ? 'bg-red-200 text-red-800' :
                    suspect.severity === 'medium' ? 'bg-amber-200 text-amber-800' :
                    'bg-blue-200 text-blue-800'
                  }`}>
                    {suspect.severity}
                  </span>
                  <span className="text-xs text-gray-500">{suspect.category.replace('-', ' ')}</span>
                </div>
                <p className="text-sm font-medium text-gray-700">{suspect.description}</p>
                <p className="text-xs text-gray-500 mt-1">{suspect.evidence}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <LoadingOverlay visible={loading} />
    </div>
  );
}