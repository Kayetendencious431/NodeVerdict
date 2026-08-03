import { useState, useCallback, useRef, type DragEvent } from 'react';

interface FileUploadProps {
  onFile: (file: File) => void;
  accept?: string;
  label?: string;
  disabled?: boolean;
  maxSize?: number;
  fileName?: string | null;
  fileSize?: number | null;
  onReset?: () => void;
}

export function FileUpload({ onFile, accept = '.json', label = 'Upload file', disabled, maxSize, fileName, fileSize, onReset }: FileUploadProps) {
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

  // Show loaded file state with clear button
  if (fileName) {
    return (
      <div className="flex items-center gap-3 px-4 py-3 bg-indigo-50 border border-indigo-200 rounded-lg">
        <svg className="w-5 h-5 text-indigo-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-indigo-700 truncate">{fileName}</p>
          {fileSize != null && <p className="text-xs text-indigo-500">{formatFileSize(fileSize)}</p>}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onReset?.(); }}
          className="px-3 py-1.5 text-xs font-medium text-red-600 bg-white border border-red-200 rounded-md hover:bg-red-50 transition-colors shrink-0"
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
      onClick={() => inputRef.current?.click()}
      className={`
        border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all
        ${dragOver ? 'border-indigo-500 bg-indigo-50' : 'border-gray-300 hover:border-indigo-400 hover:bg-gray-50'}
        ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
      `}
    >
      <input ref={inputRef} type="file" accept={accept} onChange={handleChange} className="hidden" />
      <div className="flex flex-col items-center gap-2">
        <svg className="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
        </svg>
        <p className="text-sm font-medium text-gray-600">{label}</p>
        <p className="text-xs text-gray-400">Drag & drop or click to browse</p>
      </div>
    </div>
  );
}