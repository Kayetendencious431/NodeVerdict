import { useState, useCallback, useMemo } from 'react';
import { useRootStore } from '../../stores';
import { useFileUpload } from '../../shared/hooks';
import { analyzeTracingEvents, generateReport, decompressReport } from '../../shared/engine';
import { encodeReportToHash, decodeReportFromHash } from '../../shared/utils';
import { FileUpload, EmptyState, StatCard, LoadingOverlay } from '../../shared/components';
import type { TracingEvent, ReportData, ChannelStats } from '../../shared/types';

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

  const { loading, error, fileName, fileSize, handleFile, reset } = useFileUpload(handleFileRead);

  function handleReset() {
    reset();
    setReportData(null);
  }

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
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Report Generator</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Generate shareable diagnostic reports from tracing data</p>
        </div>
        <FileUpload onFile={handleFile} accept=".json" label="Upload tracing events to generate report" maxSize={50 * 1024 * 1024} fileName={fileName} fileSize={fileSize} onReset={handleReset} />
        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
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
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Diagnostic Report</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Generated {new Date(reportData.generatedAt).toLocaleString()}</p>
        </div>
        <div className="w-72">
          <FileUpload
            onFile={handleFile}
            accept=".json"
            label="Upload tracing events to generate report"
            maxSize={50 * 1024 * 1024}
            fileName={fileName}
            fileSize={fileSize}
            onReset={handleReset}
          />
        </div>
      </div>

      {/* Key Findings */}
      <div className="mb-6">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">Key Findings</h2>
        <ul className="space-y-1">
          {reportData.keyFindings.map((finding, idx) => (
            <li key={idx} className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-300">
              <span className="text-indigo-500 mt-0.5">•</span>
              {finding}
            </li>
          ))}
        </ul>
      </div>

      {/* Channel Summary */}
      {reportData.eventSummary && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">Event Summary</h2>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <StatCard title="Total Events" value={reportData.eventSummary.totalEvents.toLocaleString()} />
            <StatCard title="Total Operations" value={reportData.eventSummary.totalOperations.toLocaleString()} />
          </div>

          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
                  <th className="text-left px-4 py-2 font-medium text-gray-500 dark:text-gray-400">Channel</th>
                  <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">Ops</th>
                  <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">Avg</th>
                  <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">P95</th>
                  <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">Errors</th>
                </tr>
              </thead>
              <tbody>
                {reportData.eventSummary.channels.map(cs => (
                  <tr key={cs.channel} className="border-b border-gray-100 dark:border-gray-800">
                    <td className="px-4 py-2 font-medium text-gray-700 dark:text-gray-200">{cs.channel}</td>
                    <td className="px-4 py-2 text-right text-gray-600 dark:text-gray-300">{cs.totalOperations}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs text-gray-600 dark:text-gray-300">{cs.avgDuration.toFixed(0)}ms</td>
                    <td className="px-4 py-2 text-right font-mono text-xs text-gray-600 dark:text-gray-300">{cs.p95Duration.toFixed(0)}ms</td>
                    <td className="px-4 py-2 text-right">
                      <span className={cs.errorCount > 0 ? 'text-red-600 dark:text-red-400 font-medium' : 'text-gray-400 dark:text-gray-500'}>
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
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">Heap Analysis</h2>
          <div className="grid grid-cols-3 gap-3">
            <StatCard title="Heap Size" value={`${(reportData.heapAnalysis.totalSize / 1024 / 1024).toFixed(1)}MB`} />
            <StatCard title="Top Objects" value={reportData.heapAnalysis.topObjects.length.toString()} />
            <StatCard title="Leak Suspects" value={reportData.heapAnalysis.leakCount.toString()} color={reportData.heapAnalysis.leakCount > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-900'} />
          </div>
        </div>
      )}

      {/* Share */}
      <div className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4 mb-4">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">Share Report</h2>
        <div className="flex items-center gap-2">
          <input
            type="text"
            readOnly
            value={reportUrl}
            className="flex-1 text-xs font-mono bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-3 py-2 text-gray-600 dark:text-gray-300 truncate"
          />
          <button
            onClick={copyLink}
            className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 transition-colors whitespace-nowrap"
          >
            {copied ? 'Copied!' : 'Copy Link'}
          </button>
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
          This URL contains all report data compressed. Share it in GitHub Issues, Slack, or documentation.
        </p>
      </div>

      {/* Export HTML */}
      <div className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">Export Offline Report</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">Download a standalone HTML file with all data and charts embedded. No server needed to view.</p>
        <button
          onClick={() => exportHtmlReport(reportData)}
          className="px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 transition-colors"
        >
          Download HTML Report
        </button>
      </div>

      <LoadingOverlay visible={loading} />
    </div>
  );
}

function exportHtmlReport(reportData: ReportData): void {
  const channels = reportData.eventSummary?.channels ?? [];
  const findings = reportData.keyFindings ?? [];
  const heap = reportData.heapAnalysis;

  const rows = channels.map(cs => `
    <tr key="${cs.channel}">
      <td className="px-4 py-2 font-medium">${escapeHtml(cs.channel)}</td>
      <td style="padding:4px 8px;font-size:13px;text-align:right">${cs.totalOperations}</td>
      <td style="padding:4px 8px;font-size:13px;text-align:right">${cs.avgDuration.toFixed(1)}ms</td>
      <td style="padding:4px 8px;font-size:13px;text-align:right;color:${cs.p95Duration > 100 ? 'text-red-600' : 'text-gray-600'}">${cs.p95Duration.toFixed(1)}ms</td>
      <td style="padding:4px 8px;font-size:13px;text-align:right;color:${cs.errorCount > 0 ? 'text-red-600' : 'text-gray-600'}">${cs.errorCount}</td>
    </tr>
  `).join('');
  const findingsHtml = findings.map(f => `<li className="mb-2 text-sm text-gray-600 dark:text-gray-300">${escapeHtml(f)}</li>`).join('');

  const heapHtml = heap ? `
    <div style="margin-top:16px">
      <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-200 mb-4">Heap Analysis</h2>
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
          <p className="text-xs text-gray-500 dark:text-gray-400 text-uppercase tracking-wider">Total Size</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-2">${(heap.totalSize / 1024 / 1024).toFixed(1)}MB</p>
        </div>
        <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
          <p className="text-xs text-gray-500 text-uppercase tracking-wider">Top Objects</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-2">${heap.topObjects.length}</p>
        </div>
        <div className="bg-fef2f2 dark:bg-gray-800 rounded-lg p-4">
          <p className="text-xs text-gray-500 text-uppercase tracking-wider">Leak Suspects</p>
          <p className="text-2xl font-bold text-red-600 dark:text-red-400 mt-2">${heap.leakCount}</p>
        </div>  
      </div>
    </div>
  ` : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>NodeVerdict Diagnostic Report</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 24px; background: #f9fafb; color: #1f2937; }
    .container { max-width: 800px; margin: 0 auto; }
    h1 { font-size: 24px; font-weight: 700; margin: 0 0 4px 0; }
    .subtitle { font-size: 14px; color: #6b7280; margin-bottom: 24px; }
    table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    th { background: #f9fafb; text-align: left; padding: 8px; font-size: 12px; font-weight: 500; color: #6b72
</head>
<body>
  <div class="container">
    <div className="flex items-center gap-2 mb-4">
      <div className="w-8 h-8 bg-emerald-600 text-white text-center font-bold text-lg rounded-md flex items-center justify-center">N</div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">NodeVerdict Diagnostic Report</h1>
    </div>
    <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Generated ${new Date(reportData.generatedAt).toLocaleString()} | ${reportData.eventSummary?.totalEvents ?? 0} events, ${reportData.eventSummary?.totalOperations ?? 0} operations</p>

    <div class="findings">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Key Findings</h2>
      <ul className="list-disc pl-5 text-gray-700 dark:text-gray-300">${findingsHtml}</ul>
    </div>

    <table>
      <thead>
        <tr>
          <th className="px-4 py-2 font-medium text-left text-gray-500 dark:text-gray-400">Channel</th>
          <th className="px-4 py-2 font-medium text-right text-gray-500 dark:text-gray-400">Ops</th>
          <th className="px-4 py-2 font-medium text-right text-gray-500 dark:text-gray-400">Avg</th>
          <th className="px-4 py-2 font-medium text-right text-gray-500 dark:text-gray-400">P95</th>
          <th className="px-4 py-2 font-medium text-right text-gray-500 dark:text-gray-400">Errors</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    ${heapHtml}

    <div className="text-center text-sm text-gray-500 dark:text-gray-400 mt-4">
      <p className="text-center">Generated by NodeVerdict — ${new Date().toISOString()}</p>
    </div>
  </div>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'nodeverdict-report.html';
  a.click();
  URL.revokeObjectURL(url);
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}