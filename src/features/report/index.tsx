import { useState, useCallback, useMemo } from 'react';
import { useRootStore } from '../../stores';
import { useFileUpload } from '../../shared/hooks';
import { analyzeTracingEvents, generateReport, decompressReport } from '../../shared/engine';
import { encodeReportToHash, decodeReportFromHash } from '../../shared/utils';
import { FileUpload, EmptyState, StatCard, LoadingOverlay } from '../../shared/components';
import type { TracingEvent, ReportData } from '../../shared/types';

export function ReportPage() {
  const { reportData, setReportData } = useRootStore();
  const [copied, setCopied] = useState(false);

  const handleFileRead = useCallback(async (content: string) => {
    const events = JSON.parse(content) as TracingEvent[];
    const analysis = analyzeTracingEvents(events);
    const report = generateReport(
      analysis.channelStats,
      analysis.totalEvents,
      analysis.totalOperations,
      analysis.errorRate,
    );
    setReportData(report);
  }, [setReportData]);

  const { loading, error, handleFile } = useFileUpload(handleFileRead);

  // Check URL hash for shared reports
  useMemo(() => {
    if (!reportData && window.location.hash) {
      const decoded = decodeReportFromHash(window.location.hash);
      if (decoded) setReportData(decoded);
    }
  }, []);

  const reportUrl = useMemo(() => {
    if (!reportData) return '';
    return window.location.origin + window.location.pathname + encodeReportToHash(reportData);
  }, [reportData]);

  const copyLink = useCallback(async () => {
    if (reportUrl) {
      await navigator.clipboard.writeText(reportUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [reportUrl]);

  if (!reportData) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-gray-800">Report Generator</h1>
          <p className="text-sm text-gray-500 mt-1">Generate shareable diagnostic reports from tracing data</p>
        </div>
        <FileUpload onFile={handleFile} accept=".json" label="Upload tracing events to generate report" maxSize={50 * 1024 * 1024} />
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <LoadingOverlay visible={loading} message="Generating report..." />
        <div className="mt-8">
          <EmptyState
            title="No report data"
            description="Upload tracing events to generate a shareable diagnostic report. Reports are encoded in the URL — just copy and share the link."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-4">
        <h1 className="text-xl font-bold text-gray-800">Diagnostic Report</h1>
        <p className="text-sm text-gray-500">Generated {new Date(reportData.generatedAt).toLocaleString()}</p>
      </div>

      {/* Key Findings */}
      <div className="mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-2">Key Findings</h2>
        <ul className="space-y-1">
          {reportData.keyFindings.map((finding, idx) => (
            <li key={idx} className="flex items-start gap-2 text-sm text-gray-600">
              <span className="text-indigo-500 mt-0.5">•</span>
              {finding}
            </li>
          ))}
        </ul>
      </div>

      {/* Channel Summary */}
      {reportData.eventSummary && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-2">Event Summary</h2>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <StatCard title="Total Events" value={reportData.eventSummary.totalEvents.toLocaleString()} />
            <StatCard title="Total Operations" value={reportData.eventSummary.totalOperations.toLocaleString()} />
          </div>

          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-4 py-2 font-medium text-gray-500">Channel</th>
                  <th className="text-right px-4 py-2 font-medium text-gray-500">Ops</th>
                  <th className="text-right px-4 py-2 font-medium text-gray-500">Avg</th>
                  <th className="text-right px-4 py-2 font-medium text-gray-500">P95</th>
                  <th className="text-right px-4 py-2 font-medium text-gray-500">Errors</th>
                </tr>
              </thead>
              <tbody>
                {reportData.eventSummary.channels.map(cs => (
                  <tr key={cs.channel} className="border-b border-gray-100">
                    <td className="px-4 py-2 font-medium text-gray-700">{cs.channel}</td>
                    <td className="px-4 py-2 text-right text-gray-600">{cs.totalOperations}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs text-gray-600">{cs.avgDuration.toFixed(0)}ms</td>
                    <td className="px-4 py-2 text-right font-mono text-xs text-gray-600">{cs.p95Duration.toFixed(0)}ms</td>
                    <td className="px-4 py-2 text-right">
                      <span className={cs.errorCount > 0 ? 'text-red-600 font-medium' : 'text-gray-400'}>
                        {cs.errorCount}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Heap Analysis Summary */}
      {reportData.heapAnalysis && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-2">Heap Analysis</h2>
          <div className="grid grid-cols-3 gap-3">
            <StatCard title="Heap Size" value={`${(reportData.heapAnalysis.totalSize / 1024 / 1024).toFixed(1)}MB`} />
            <StatCard title="Top Objects" value={reportData.heapAnalysis.topObjects.length.toString()} />
            <StatCard title="Leak Suspects" value={reportData.heapAnalysis.leakCount.toString()} color={reportData.heapAnalysis.leakCount > 0 ? 'text-red-600' : 'text-gray-900'} />
          </div>
        </div>
      )}

      {/* Share */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-2">Share Report</h2>
        <div className="flex items-center gap-2">
          <input
            type="text"
            readOnly
            value={reportUrl}
            className="flex-1 text-xs font-mono bg-white border border-gray-200 rounded px-3 py-2 text-gray-600 truncate"
          />
          <button
            onClick={copyLink}
            className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 transition-colors whitespace-nowrap"
          >
            {copied ? 'Copied!' : 'Copy Link'}
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-2">
          This URL contains all report data compressed. Share it in GitHub Issues, Slack, or documentation.
        </p>
      </div>

      <LoadingOverlay visible={loading} />
    </div>
  );
}