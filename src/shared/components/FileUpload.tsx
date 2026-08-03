import { useState, useCallback, useRef, type DragEvent } from 'react';
import type { ProgressInfo } from '../hooks/useFileUpload';

interface FileUploadProps {
  onFile: (file: File) => void;
  accept?: string;
  label?: string;
  disabled?: boolean;
  maxSize?: number;
  fileName?: string | null;
  fileSize?: number | null;
  onReset?: () => void;
  loading?: boolean;
  progress?: ProgressInfo | null;
}

export function FileUpload({ onFile, accept = '.json', label = 'Upload file', disabled, maxSize, fileName, fileSize, onReset, loading, progress }: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) validateAndProcess(file);
  }, [onFile, maxSize]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) validateAndProcess(file);
  }, [onFile, maxSize]);

  function validateAndProcess(file: File) {
    if (maxSize && file.size > maxSize) {
      alert(`File too large. Max size: ${(maxSize / 1024 / 1024).toFixed(0)}MB`);
      return;
    }
    onFile(file);
  }

  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  // Loading state with progress bar
  if (loading) {
    return (
      <div className="flex flex-col gap-2 px-4 py-3 bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-700 rounded-lg">
        <div className="flex items-center gap-3">
          <svg className="w-5 h-5 text-indigo-500 shrink-0 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-indigo-700 dark:text-indigo-300">Loading file...</p>
            {progress && (
              <p className="text-xs text-indigo-500">
                {formatFileSize(progress.loaded)} / {formatFileSize(progress.total)} ({progress.percent}%)
              </p>
            )}
          </div>
        </div>
        {progress && (
          <div className="w-full h-1.5 bg-indigo-200 dark:bg-indigo-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-500 rounded-full transition-all duration-300"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
        )}
      </div>
    );
  }

  // Show loaded file state with clear button
  if (fileName) {
    return (
      <div className="flex items-center gap-3 px-4 py-3 bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-700 rounded-lg">
        <svg className="w-5 h-5 text-indigo-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-indigo-700 dark:text-indigo-300 truncate">{fileName}</p>
          {fileSize != null && <p className="text-xs text-indigo-500">{formatFileSize(fileSize)}</p>}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onReset?.(); }}
          className="px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 bg-white dark:bg-gray-800 border border-red-200 dark:border-red-800 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors shrink-0"
        >
          Clear
        </button>
      </div>
    );
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onClick={() => (disabled ? null : inputRef.current?.click())}
      className={`
        border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all
        ${dragOver ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30' : 'border-gray-300 dark:border-gray-600 hover:border-indigo-400 dark:hover:border-indigo-500 hover:bg-gray-50 dark:hover:bg-gray-800'}
        ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
      `}
    >
      <input ref={inputRef} type="file" accept={accept} onChange={handleChange} className="hidden" />
      <div className="flex flex-col items-center gap-2">
        <svg className="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
        </svg>
        <p className="text-sm font-medium text-gray-600 dark:text-gray-300">{label}</p>
        <p className="text-xs text-gray-400 dark:text-gray-500">Drag & drop or click to browse</p>
      </div>
    </div>
  );
}