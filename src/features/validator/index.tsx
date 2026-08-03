import { useCallback, useMemo } from 'react';
import { useRootStore } from '../../stores';
import { useFileUpload } from '../../shared/hooks';
import { validateEvents } from '../../shared/engine';
import { FileUpload, EmptyState, LoadingOverlay, StatCard } from '../../shared/components';
import type { TracingEvent } from '../../shared/types';

function severityBadge(severity: string) {
  switch (severity) {
    case 'error': return 'bg-red-100 text-red-700';
    case 'warning': return 'bg-amber-100 text-amber-700';
    case 'info': return 'bg-blue-100 text-blue-700';
    default: return 'bg-gray-100 text-gray-700';
  }
}

export function ValidatorPage() {
  const { validationResults, setValidationResults } = useRootStore();
  const { loading, error, fileName, fileSize, handleFile, reset } = useFileUpload(useCallback(async (content: string) => {
    const events = JSON.parse(content) as TracingEvent[];
    const results = validateEvents(events);
    setValidationResults(results);
  }, [setValidationResults]));

  function handleReset() {
    reset();
    setValidationResults(null);
  }

  const stats = useMemo(() => {
    if (!validationResults) return null;
    let errors = 0, warnings = 0, infos = 0;
    for (const r of validationResults) {
      for (const i of r.issues) {
        if (i.severity === 'error') errors++;
        else if (i.severity === 'warning') warnings++;
        else infos++;
      }
    }
    return { channels: validationResults.length, errors, warnings, infos };
  }, [validationResults]);

  if (!validationResults) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-gray-800">Event Validator</h1>
          <p className="text-sm text-gray-500 mt-1">Validate TracingChannel events against spec conventions</p>
        </div>
        <FileUpload onFile={handleFile} accept=".json" label="Upload tracing events to validate" maxSize={50 * 1024 * 1024} fileName={fileName} fileSize={fileSize} onReset={handleReset} />
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <LoadingOverlay visible={loading} message="Validating..." />
        <div className="mt-8">
          <EmptyState
            title="No data to validate"
            description="Upload a JSON file with TracingChannel events to check naming conventions, required fields, event pairing, and OpenTelemetry compatibility."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800">Validation Results</h1>
        </div>
        <div className="w-72">
          <FileUpload
            onFile={handleFile}
            accept=".json"
            label="Upload tracing events to validate"
            maxSize={50 * 1024 * 1024}
            fileName={fileName}
            fileSize={fileSize}
            onReset={handleReset}
          />
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-4 gap-3 mb-4">
          <StatCard title="Channels" value={stats.channels.toString()} />
          <StatCard title="Errors" value={stats.errors.toString()} color={stats.errors > 0 ? 'text-red-600' : 'text-gray-900'} />
          <StatCard title="Warnings" value={stats.warnings.toString()} color={stats.warnings > 0 ? 'text-amber-600' : 'text-gray-900'} />
          <StatCard title="Info" value={stats.infos.toString()} />
        </div>
      )}

      <div className="space-y-4">
        {validationResults.map(result => (
          <div key={result.channel} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className={`px-4 py-2 flex items-center gap-2 ${result.valid ? 'bg-emerald-50' : 'bg-red-50'}`}>
              <span className={`w-2 h-2 rounded-full ${result.valid ? 'bg-emerald-500' : 'bg-red-500'}`} />
              <span className="font-medium text-sm text-gray-700">{result.channel}</span>
              <span className={`ml-auto text-xs px-2 py-0.5 rounded-full ${result.valid ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                {result.valid ? 'Valid' : 'Issues Found'}
              </span>
            </div>

            {result.issues.length > 0 && (
              <div className="divide-y divide-gray-100">
                {result.issues.map((issue, idx) => (
                  <div key={idx} className="px-4 py-2.5 flex items-start gap-3 text-sm">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${severityBadge(issue.severity)}`}>
                      {issue.severity}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-gray-700">{issue.message}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{issue.category}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {result.issues.length === 0 && (
              <div className="px-4 py-3 text-sm text-gray-500">No issues found</div>
            )}
          </div>
        ))}
      </div>

      <LoadingOverlay visible={loading} />
    </div>
  );
}