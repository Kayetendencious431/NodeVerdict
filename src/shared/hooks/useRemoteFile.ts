import { useState, useCallback, useRef } from 'react';
import { loadFileFromUrl } from '../utils/remote-loader';
import type { ProgressInfo } from './useFileUpload';

interface UseRemoteFileOptions {
  onFile: (content: string) => Promise<void>;
  onProgress?: (progress: ProgressInfo) => void;
}

interface UseRemoteFileReturn {
  loading: boolean;
  error: string | null;
  progress: ProgressInfo | null;
  loadFromUrl: (url: string) => Promise<void>;
  cancel: () => void;
  reset: () => void;
}

export function useRemoteFile(options: UseRemoteFileOptions): UseRemoteFileReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressInfo | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    setError(null);
    setProgress(null);
  }, []);

  const loadFromUrl = useCallback(async (url: string) => {
    setLoading(true);
    setError(null);
    setProgress(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const result = await loadFileFromUrl({
        url,
        chunkSize: 1024 * 1024, // 1MB chunks
        onProgress: (loaded, total) => {
          const info = { loaded, total, percent: total > 0 ? Math.round((loaded / total) * 100) : 0 };
          setProgress(info);
          options.onProgress?.(info);
        },
        signal: controller.signal,
      });

      await options.onFile(result.content);
    } catch (err: any) {
      if (err.name === 'AbortError') {
        setError(null);
      } else {
        setError(err.message || 'Failed to load remote file');
      }
    } finally {
      setLoading(false);
    }
  }, [options.onFile, options.onProgress]);

  return { loading, error, progress, loadFromUrl, cancel, reset };
}