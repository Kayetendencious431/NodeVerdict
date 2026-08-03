import { useState, useCallback } from 'react';
import { parseHeapSnapshot, diffHeapSnapshots } from '../../shared/engine';
import { useFileUpload } from '../../shared/hooks';
import { FileUpload, EmptyState, StatCard, LoadingOverlay } from '../../shared/components';
import { formatBytes } from '../../shared/utils';
import type { HeapSnapshot } from '../../shared/types';
import type { HeapDiffResult } from '../../shared/engine';

export function HeapDiffPage() {
  const [snapshotA, setSnapshotA] = useState<HeapSnapshot | null>(null);
  const [snapshotB, setSnapshotB] = useState<HeapSnapshot | null>(null);
  const [diffResult, setDiffResult] = useState<HeapDiffResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileAName, setFileAName] = useState<string | null>(null);
  const [fileBName, setFileBName] = useState<string | null>(null);

  const handleFileA = useCallback(async (file: File) => {
    setLoading(true);
    setError(null);
    setFileAName(file.name);
    try {
      const content = await file.text();
      const snapshot = parseHeapSnapshot(content);
      setSnapshotA(snapshot);
      if (snapshotB) {
        setDiffResult(diffHeapSnapshots(snapshot, snapshotB));
      }
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('"snapshot" field')) {
        setError('This is not a valid .heapsnapshot file. Use Node.js to generate a heap snapshot (node --heapsnapshot-signal=SIGUSR2 app.js) or use the examples/heap-*.heapsnapshot files from the examples directory.');
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [snapshotB]);

  const handleFileB = useCallback(async (file: File) => {
    setLoading(true);
    setError(null);
    setFileBName(file.name);
    try {
      const content = await file.text();
      const snapshot = parseHeapSnapshot(content);
      setSnapshotB(snapshot);
      if (snapshotA) {
        setDiffResult(diffHeapSnapshots(snapshotA, snapshot));
      }
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('"snapshot" field')) {
        setError('This is not a valid .heapsnapshot file. Use Node.js to generate a heap snapshot (node --heapsnapshot-signal=SIGUSR2 app.js) or use the examples/heap-*.heapsnapshot files from the examples directory.');
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [snapshotA]);

  function handleReset() {
    setSnapshotA(null);
    setSnapshotB(null);
    setDiffResult(null);
    setError(null);
    setFileAName(null);
    setFileBName(null);
  }

  if (!diffResult) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Heap Snapshot Diff</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Upload two .heapsnapshot files to compare memory allocation differences</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Before (Snapshot A)</p>
            <FileUpload
              onFile={handleFileA}
              accept=".heapsnapshot,.json"
              label="Upload before snapshot"
              maxSize={200 * 1024 * 1024}
              fileName={fileAName}
              onReset={() => { setSnapshotA(null); setDiffResult(null); setFileAName(null); }}
            />
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">After (Snapshot B)</p>
            <FileUpload
              onFile={handleFileB}
              accept=".heapsnapshot,.json"
              label="Upload after snapshot"
              maxSize={200 * 1024 * 1024}
              fileName={fileBName}
              onReset={() => { setSnapshotB(null); setDiffResult(null); setFileBName(null); }}
            />
          </div>
        </div>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <LoadingOverlay visible={loading} message="Comparing snapshots..." />

        <div className="mt-8">
          <EmptyState
            title="No snapshots to compare"
            description="Upload two .heapsnapshot files (before and after) to identify memory growth, new objects, and potential leaks."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Heap Diff Results</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Comparing {fileAName ?? 'A'} vs {fileBName ?? 'B'}
          </p>
        </div>
        <button
          onClick={handleReset}
          className="px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        >
          Clear & Start Over
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        <StatCard title="Size Before" value={formatBytes(diffResult.totalSizeBefore)} />
        <StatCard title="Size After" value={formatBytes(diffResult.totalSizeAfter)} />
        <StatCard
          title="Size Delta"
          value={`${diffResult.totalSizeDelta >= 0 ? '+' : ''}${formatBytes(Math.abs(diffResult.totalSizeDelta))}`}
          color={diffResult.totalSizeDelta > 0 ? 'text-red-600' : diffResult.totalSizeDelta < 0 ? 'text-emerald-600' : 'text-gray-900'}
        />
        <StatCard
          title="Object Delta"
          value={`${diffResult.totalCountDelta >= 0 ? '+' : ''}${diffResult.totalCountDelta.toLocaleString()}`}
          color={diffResult.totalCountDelta > 0 ? 'text-red-600 dark:text-red-400' : diffResult.totalCountDelta < 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-900 dark:text-gray-100'}
        />
      </div>

      {/* New / Growing / Removed summaries */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <StatCard
          title="New Object Types"
          value={diffResult.newNodes.length.toString()}
          color="text-red-600 dark:text-red-400"
        />
        <StatCard
          title="Growing Types"
          value={diffResult.growingNodes.length.toString()}
          color="text-amber-600 dark:text-amber-400"
          subtitle={`${diffResult.growingNodes.slice(0, 3).map(n => `${n.name} +${formatBytes(n.sizeDelta)}`).join(', ')}${diffResult.growingNodes.length > 3 ? '...' : ''}`}
        />
        <StatCard
          title="Removed Types"
          value={diffResult.removedNodes.length.toString()}
          color="text-emerald-600 dark:text-emerald-400"
        />
      </div>

      {/* Full Diff Table */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
        <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">All Types — Sorted by Size Delta</h2>
        </div>
        <div className="overflow-x-auto max-h-96 overflow-y-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 sticky top-0">
                <th className="text-left px-4 py-2 font-medium text-gray-500 dark:text-gray-400">Name</th>
                <th className="text-left px-4 py-2 font-medium text-gray-500 dark:text-gray-400">Type</th>
                <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">Count Δ</th>
                <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">Before</th>
                <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">After</th>
                <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">Size Δ</th>
              </tr>
            </thead>
            <tbody>
              {diffResult.nodes.slice(0, 200).map((node, idx) => (
                <tr key={idx} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800">
                  <td className="px-4 py-2 font-mono text-xs text-gray-700 dark:text-gray-200 max-w-xs truncate">{node.name}</td>
                  <td className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400">{node.type}</td>
                  <td className={`px-4 py-2 text-right font-mono text-xs ${
                    node.countDelta > 0 ? 'text-red-600 dark:text-red-400' : node.countDelta < 0 ? 'text-emerald-600 dark:text-emerald-400' : ''
                  }`}>
                    {node.countDelta > 0 ? '+' : ''}{node.countDelta.toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs text-gray-600 dark:text-gray-300">{formatBytes(node.beforeSize)}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs text-gray-600 dark:text-gray-300">{formatBytes(node.afterSize)}</td>
                  <td className={`px-4 py-2 text-right font-mono text-xs ${
                    node.sizeDelta > 0 ? 'text-red-600 dark:text-red-400 font-medium' : node.sizeDelta < 0 ? 'text-emerald-600 dark:text-emerald-400' : ''
                  }`}>
                    {node.sizeDelta > 0 ? '+' : ''}{formatBytes(node.sizeDelta)}
                  </td>
                </tr>
              ))}
              {diffResult.nodes.length > 200 && (
                <tr className="bg-gray-50 dark:bg-gray-900">
                  <td colSpan={6} className="px-4 py-3 text-center text-xs text-gray-500 dark:text-gray-400">
                    Showing first 200 of {diffResult.nodes.length} types
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}