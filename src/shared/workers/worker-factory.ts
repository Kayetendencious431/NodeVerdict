/**
 * Generic type-safe worker factory.
 * Wraps a handler function into a Web Worker-compatible message handler.
 */
export type WorkerHandler<TInput, TOutput> = (input: TInput) => TOutput | Promise<TOutput>;

export interface WorkerRequest<T = unknown> {
  id: string;
  payload: T;
}

export interface WorkerResponse<T = unknown> {
  id: string;
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Create a worker-ready message handler from a pure function.
 * Used inside the actual Worker file.
 */
export function createWorkerHandler<TInput, TOutput>(
  handler: WorkerHandler<TInput, TOutput>,
) {
  return async (event: MessageEvent<WorkerRequest<TInput>>) => {
    const { id, payload } = event.data;
    try {
      const result = await handler(payload);
      const response: WorkerResponse<TOutput> = { id, success: true, data: result };
      self.postMessage(response);
    } catch (err) {
      const response: WorkerResponse = { id, success: false, error: (err as Error).message };
      self.postMessage(response);
    }
  };
}

/**
 * Client-side wrapper that creates a Worker and returns a callable interface.
 */
export function createWorkerClient<TInput, TOutput>(worker: Worker, timeoutMs = 60_000) {
  const pending = new Map<string, { resolve: (v: TOutput) => void; reject: (e: Error) => void }>();

  worker.onmessage = (event: MessageEvent<WorkerResponse<TOutput>>) => {
    const { id, success, data, error } = event.data;
    const pendingCall = pending.get(id);
    if (!pendingCall) return;
    pending.delete(id);
    if (success && data !== undefined) {
      pendingCall.resolve(data);
    } else {
      pendingCall.reject(new Error(error ?? 'Unknown worker error'));
    }
  };

  worker.onerror = (event) => {
    // Worker-level error — reject all pending
    const err = new Error(`Worker error: ${event.message}`);
    for (const [id, { reject }] of pending) {
      reject(err);
    }
    pending.clear();
  };

  let nextId = 0;

  return {
    execute(input: TInput): Promise<TOutput> {
      return new Promise((resolve, reject) => {
        const id = `worker_${nextId++}_${Date.now()}`;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Worker execution timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        pending.set(id, {
          resolve: (v) => { clearTimeout(timer); resolve(v); },
          reject: (e) => { clearTimeout(timer); reject(e); },
        });
        const request: WorkerRequest<TInput> = { id, payload: input };
        worker.postMessage(request);
      });
    },
    terminate() {
      worker.terminate();
      for (const { reject } of pending.values()) {
        reject(new Error('Worker terminated'));
      }
      pending.clear();
    },
  };
}