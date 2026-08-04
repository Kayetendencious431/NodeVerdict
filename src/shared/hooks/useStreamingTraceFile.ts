import { useCallback, useEffect, useRef, useState } from 'react';
import { useFileUpload } from './useFileUpload';
import type { ProgressInfo } from './useFileUpload';
import { analyzeTracingEvents, loadTracingData, loadNdvBuffer } from '../engine';
import { createTraceStreamClient } from '../streaming';
import type { TraceStreamResult } from '../streaming/trace-stream-client';
import type { TracingAnalysis } from '../types';

/**
 * Streaming-capable trace file hook. Drop-in replacement for `useFileUpload`
 * in trace-consuming pages.
 *
 *   - Files below `fastPathThreshold` use the existing in-memory path
 *     (identical behavior, supports OTel/ndv via `loadTracingData`).
 *   - Larger files are parsed in a dedicated Web Worker using
 *     `file.stream() + TextDecoderStream + IncrementalJsonParser`, so the UI
 *     thread is never blocked and peak memory stays bounded.
 *
 * The result is delivered through `onAnalysis(analysis, meta)` where `meta`
 * reports whether the retained event/operation arrays were truncated to cap
 * memory (aggregate stats always cover the full file).
 */

export interface StreamingFileOptions {
  onAnalysis: (analysis: TracingAnalysis, meta: TraceStreamResult['meta']) => void;
  onProgress?: (progress: ProgressInfo) => void;
  /** Files at or above this size (bytes) are streamed in a worker. */
  fastPathThreshold?: number;
  /** Worker retention caps; only affect peak memory for very large files. */
  maxEvents?: number;
  maxOperations?: number;
}

export function useStreamingTraceFile(options: StreamingFileOptions) {
  const { onAnalysis, onProgress, fastPathThreshold = 64 * 1024 * 1024, maxEvents, maxOperations } = options;
  const onAnalysisRef = useRef(onAnalysis);
  onAnalysisRef.current = onAnalysis;

  const [state, setState] = useState<{ loading: boolean; error: string | null; fileName: string | null; fileSize: number | null }>({
    loading: false,
    error: null,
    fileName: null,
    fileSize: null,
  });

  const workerRef = useRef<ReturnType<typeof createTraceStreamClient> | null>(null);

  // Lazy: the worker is only spawned the first time a large file is handled,
  // and always terminated on unmount.
  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  const getWorkerClient = useCallback(() => {
    if (!workerRef.current) {
      const worker = new Worker(new URL('../streaming/trace-stream.worker.ts', import.meta.url), { type: 'module' });
      workerRef.current = createTraceStreamClient(worker);
    }
    return workerRef.current;
  }, []);

  const fastPath = useFileUpload(
    useCallback((content: string) => {
      const events = loadTracingData(content);
      const analysis = analyzeTracingEvents(events);
      onAnalysisRef.current(analysis, {
        truncated: false,
        eventsSeen: analysis.totalEvents,
        invalid: 0,
        wallTimeMs: 0,
      });
    }, []),
    onProgress,
    useCallback((buffer: ArrayBuffer) => {
      const events = loadNdvBuffer(buffer);
      const analysis = analyzeTracingEvents(events);
      onAnalysisRef.current(analysis, {
        truncated: false,
        eventsSeen: analysis.totalEvents,
        invalid: 0,
        wallTimeMs: 0,
      });
    }, []),
  );

  const sessionRef = useRef(0);

  const handleFile = useCallback(async (file: File) => {
    if (file.size < fastPathThreshold) {
      await fastPath.handleFile(file);
      return;
    }

    const session = ++sessionRef.current;
    setState({ loading: true, error: null, fileName: file.name, fileSize: file.size });
    try {
      const client = getWorkerClient();
      const result = await client.analyze(
        { file, maxEvents, maxOperations },
        {
          onProgress: (p) => {
            onProgress?.({ loaded: p.loaded, total: p.total, percent: p.percent });
          },
        },
      );
      if (session !== sessionRef.current) return; // stale result after reset
      onAnalysisRef.current(result.analysis, result.meta);
      setState(prev => ({ ...prev, loading: false }));
    } catch (err) {
      if (session !== sessionRef.current) return;
      setState({ loading: false, error: (err as Error).message, fileName: null, fileSize: null });
    }
  }, [fastPathThreshold, maxEvents, maxOperations, fastPath.handleFile, onProgress]);

  const reset = useCallback(() => {
    sessionRef.current++;
    fastPath.reset();
    setState({ loading: false, error: null, fileName: null, fileSize: null });
  }, [fastPath]);

  return { ...state, handleFile, reset };
}
