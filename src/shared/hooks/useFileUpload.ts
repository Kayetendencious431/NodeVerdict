import { useCallback, useState } from 'react';
import { readFileAsText } from '../utils';

interface FileUploadState {
  loading: boolean;
  error: string | null;
  fileName: string | null;
  fileSize: number | null;
}

export function useFileUpload(onFileRead: (content: string) => Promise<void> | void) {
  const [state, setState] = useState<FileUploadState>({
    loading: false,
    error: null,
    fileName: null,
    fileSize: null,
  });

  const handleFile = useCallback(async (file: File) => {
    setState({ loading: true, error: null, fileName: file.name, fileSize: file.size });
    try {
      const content = await readFileAsText(file);
      await onFileRead(content);
      setState(prev => ({ ...prev, loading: false }));
    } catch (err) {
      setState({ loading: false, error: (err as Error).message, fileName: null, fileSize: null });
    }
  }, [onFileRead]);

  const reset = useCallback(() => {
    setState({ loading: false, error: null, fileName: null, fileSize: null });
  }, []);

  return { ...state, handleFile, reset };
}