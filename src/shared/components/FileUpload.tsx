import { useState, useCallback, useRef, type DragEvent } from 'react';

interface FileUploadProps {
  onFile: (file: File) => void;
  accept?: string;
  label?: string;
  disabled?: boolean;
  maxSize?: number;
}

export function FileUpload({ onFile, accept = '.json', label = 'Upload file', disabled, maxSize }: FileUploadProps) {
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