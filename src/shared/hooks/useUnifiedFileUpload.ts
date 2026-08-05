import { useCallback, useState } from 'react';
import { useFileUpload, type ProgressInfo } from './useFileUpload';
import { useRemoteFile } from './useRemoteFile';
import { useStreamingTraceFile } from './useStreamingTraceFile';
import { analyzeTracingEvents, loadTracingData } from '../engine';
import type { TracingAnalysis } from '../types';
import type { TraceStreamResult } from '../streaming/trace-stream-client';

interface Options {
  onFile?: (content: string) => Promise<void>;
  onBinaryFile?: (buffer: ArrayBuffer) => Promise<void>;
  onAnalysis?: (analysis: TracingAnalysis, meta: TraceStreamResult['meta']) => void;
}

export function useUnifiedFileUpload({ onFile, onBinaryFile, onAnalysis }: Options) {
  const [progress, setProgress] = useState<ProgressInfo | null>(null);

  const streaming = useStreamingTraceFile({
    onAnalysis: onAnalysis ?? (() => {}),
    onProgress: setProgress,
  });

  const fileUpload = useFileUpload(onFile ?? (async () => {}), setProgress, onBinaryFile);

  const useStreaming = onAnalysis != null;

  const loading = useStreaming ? streaming.loading : fileUpload.loading;
  const error = useStreaming ? streaming.error : fileUpload.error;
  const fileName = useStreaming ? streaming.fileName : fileUpload.fileName;
  const fileSize = useStreaming ? streaming.fileSize : fileUpload.fileSize;
  const handleFile = useStreaming ? streaming.handleFile : fileUpload.handleFile;
  const reset = useStreaming ? streaming.reset : fileUpload.reset;

  const remoteOnFile = useCallback(async (content: string) => {
    if (onAnalysis) {
      const analysis = analyzeTracingEvents(loadTracingData(content));
      onAnalysis(analysis, {
        truncated: false,
        eventsSeen: analysis.totalEvents,
        invalid: 0,
        wallTimeMs: 0,
      });
      return;
    }
    await onFile?.(content);
  }, [onFile, onAnalysis]);

  const {
    loading: urlLoading,
    error: urlError,
    progress: urlProgress,
    loadFromUrl,
    cancel: cancelUrl,
    reset: resetUrl,
  } = useRemoteFile({ onFile: remoteOnFile, onProgress: setProgress });

  const handleReset = useCallback(() => {
    reset();
    resetUrl();
  }, [reset, resetUrl]);

  return {
    loading,
    error,
    fileName,
    fileSize,
    handleFile,
    progress,
    urlLoading,
    urlError,
    urlProgress,
    loadFromUrl,
    cancelUrl,
    handleReset,
  };
}