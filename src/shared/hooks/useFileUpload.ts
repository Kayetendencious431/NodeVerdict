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

export function useFileUpload(
  onFileRead: (content: string) => Promise<void> | void,
  onProgress?: (progress: ProgressInfo) => void,
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
      const content = await readFileAsText(file, onProgress);
      await onFileRead(content);
      setState(prev => ({ ...prev, loading: false }));
    } catch (err) {
      setState({ loading: false, error: (err as Error).message, fileName: null, fileSize: null });
    }
  }, [onFileRead, onProgress]);

  const reset = useCallback(() => {
    setState({ loading: false, error: null, fileName: null, fileSize: null });
  }, []);

  return { ...state, handleFile, reset };
}

function readFileAsText(file: File, onProgress?: (p: ProgressInfo) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const total = file.size;

    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));

    if (onProgress && total > 0) {
      // Progress tracking via loading events
      reader.onprogress = (e) => {
        if (e.lengthComputable) {
          onProgress({ loaded: e.loaded, total, percent: Math.round((e.loaded / total) * 100) });
        }
      };
    }

    reader.readAsText(file);
  });
}