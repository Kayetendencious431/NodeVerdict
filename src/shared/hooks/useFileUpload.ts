import { useCallback, useState } from 'react';

interface FileUploadState {
  loading: boolean;
  error: string | null;
  fileName: string | null;
  fileSize: number | null;
}

export interface ProgressInfo {
  loaded: number;
  total: number;
  percent: number;
}

/** Reads a file; .ndv files are read as ArrayBuffer, everything else as text. */
function readFileContent(file: File, onProgress?: (p: ProgressInfo) => void): Promise<string | ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const total = file.size;

    reader.onload = () => resolve(reader.result as string | ArrayBuffer);
    reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));

    if (onProgress && total > 0) {
      reader.onprogress = (e) => {
        if (e.lengthComputable) {
          onProgress({ loaded: e.loaded, total, percent: Math.round((e.loaded / total) * 100) });
        }
      };
    }

    const isBinary = /\.ndv$/i.test(file.name);
    if (isBinary) {
      reader.readAsArrayBuffer(file);
    } else {
      reader.readAsText(file);
    }
  });
}

export function useFileUpload(
  onFileRead: (content: string) => Promise<void> | void,
  onProgress?: (progress: ProgressInfo) => void,
  onBinaryFileRead?: (buffer: ArrayBuffer) => Promise<void> | void,
) {
  const [state, setState] = useState<FileUploadState>({
    loading: false,
    error: null,
    fileName: null,
    fileSize: null,
  });

  const handleFile = useCallback(async (file: File) => {
    setState({ loading: true, error: null, fileName: file.name, fileSize: file.size });

    try {
      const content = await readFileContent(file, onProgress);
      if (typeof content === 'string') {
        await onFileRead(content);
      } else {
        if (!onBinaryFileRead) throw new Error('Binary files are not supported here');
        await onBinaryFileRead(content);
      }
      setState(prev => ({ ...prev, loading: false }));
    } catch (err) {
      setState({ loading: false, error: (err as Error).message, fileName: null, fileSize: null });
    }
  }, [onFileRead, onProgress, onBinaryFileRead]);

  const reset = useCallback(() => {
    setState({ loading: false, error: null, fileName: null, fileSize: null });
  }, []);

  return { ...state, handleFile, reset };
}