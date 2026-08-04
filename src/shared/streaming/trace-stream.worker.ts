import { IncrementalJsonParser } from './streaming-json';
import { StreamingTraceAnalyzer } from './trace-analyzer';
import type { StreamingMeta } from './trace-analyzer';
import type { TracingAnalysis } from '../types';

/**
 * Streaming trace parsing worker.
 *
 * Reads a File via `file.stream().pipeThrough(new TextDecoderStream())`,
 * incrementally tokenizes the JSON with `IncrementalJsonParser` and feeds each
 * complete event into `StreamingTraceAnalyzer`. The full file is never held in
 * memory and parsing never touches the main thread.
 *
 * Messages:
 *   in:  { id, payload: { file, maxEvents?, maxOperations? } }
 *   out: { id, type: 'progress', loaded, total, percent, eventsSeen }
 *        { id, type: 'done', analysis, meta }
 *        { id, type: 'error', error }
 */

export interface TraceStreamRequest {
  file: File;
  maxEvents?: number;
  maxOperations?: number;
}

interface ProgressMessage {
  id: string;
  type: 'progress';
  loaded: number;
  total: number;
  percent: number;
  eventsSeen: number;
}

interface DoneMessage {
  id: string;
  type: 'done';
  analysis: TracingAnalysis;
  meta: StreamingMeta;
}

interface ErrorMessage {
  id: string;
  type: 'error';
  error: string;
}

function post(msg: ProgressMessage | DoneMessage | ErrorMessage) {
  self.postMessage(msg);
}

async function handleRequest(id: string, payload: TraceStreamRequest) {
  const { file, maxEvents, maxOperations } = payload;
  const total = file.size;
  let loaded = 0;
  let lastPost = 0;

  const parser = new IncrementalJsonParser();
  const analyzer = new StreamingTraceAnalyzer({ maxEvents, maxOperations });

  const stream = file.stream().pipeThrough(new TextDecoderStream());
  const reader = stream.getReader();

  // Feed the parser until we know the top-level shape so we can fail fast on
  // non-array exports (which are not streamable in this pass).
  while (loaded < total && !parser.shape) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      loaded += new Blob([value]).size;
      parser.push(value);
    }
  }

  if (parser.shape !== 'array') {
    reader.cancel();
    const shape = parser.shape ?? 'unknown';
    post({
      id,
      type: 'error',
      error: `Streaming import currently supports top-level TracingEvent[] arrays. ` +
        `Detected a ${shape}-shaped export; for object-based OTel/jaeger files use the ` +
        `standard import (works up to a few hundred MB).`,
    });
    return;
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    loaded += new Blob([value]).size;
    parser.push(value);

    let item: string | null;
    while ((item = parser.next()) !== null) {
      try {
        analyzer.feed(JSON.parse(item) as never);
      } catch {
        // Skip malformed element; the analyzer itself also filters bad events.
      }
    }

    const now = performance.now();
    if (now - lastPost > 100) {
      lastPost = now;
      post({
        id,
        type: 'progress',
        loaded,
        total,
        percent: total > 0 ? Math.round((loaded / total) * 100) : 100,
        eventsSeen: analyzer.progress.eventsSeen,
      });
    }
  }

  const { analysis, meta } = analyzer.finish(loaded);
  post({ id, type: 'done', analysis, meta });
}

self.onmessage = async (event: MessageEvent<{ id: string; payload: TraceStreamRequest }>) => {
  const { id, payload } = event.data;
  try {
    await handleRequest(id, payload);
  } catch (err) {
    post({ id, type: 'error', error: (err as Error).message ?? String(err) });
  }
};

export {};
