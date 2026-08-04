import type { TraceStreamRequest } from './trace-stream.worker';
import type { TracingAnalysis } from '../types';
import type { StreamingMeta } from './trace-analyzer';

/**
 * Progress-aware client for the streaming trace worker.
 * Unlike the simple request/response worker factory, this one relays
 * intermediate `progress` messages as the file is streamed.
 */

export interface TraceStreamCallbacks {
  onProgress?: (info: { loaded: number; total: number; percent: number; eventsSeen: number }) => void;
}

export interface TraceStreamResult {
  analysis: TracingAnalysis;
  meta: StreamingMeta;
}

type WorkerOut =
  | { id: string; type: 'progress'; loaded: number; total: number; percent: number; eventsSeen: number }
  | { id: string; type: 'done'; analysis: TracingAnalysis; meta: StreamingMeta }
  | { id: string; type: 'error'; error: string };

export function createTraceStreamClient(worker: Worker) {
  const pending = new Map<
    string,
    { resolve: (v: TraceStreamResult) => void; reject: (e: Error) => void; callbacks: TraceStreamCallbacks }
  >();

  worker.onmessage = (event: MessageEvent<WorkerOut>) => {
    const msg = event.data;
    const call = pending.get(msg.id);
    if (!call) return;
    if (msg.type === 'progress') {
      call.callbacks.onProgress?.(msg);
      return;
    }
    pending.delete(msg.id);
    if (msg.type === 'done') {
      call.resolve({ analysis: msg.analysis, meta: msg.meta });
    } else {
      call.reject(new Error(msg.error));
    }
  };

  let nextId = 0;

  return {
    analyze(payload: TraceStreamRequest, callbacks: TraceStreamCallbacks = {}): Promise<TraceStreamResult> {
      return new Promise((resolve, reject) => {
        const id = `stream_${nextId++}_${Date.now()}`;
        pending.set(id, { resolve, reject, callbacks });
        worker.postMessage({ id, payload });
      });
    },
    terminate() {
      worker.terminate();
      for (const { reject } of pending.values()) reject(new Error('Worker terminated'));
      pending.clear();
    },
  };
}
