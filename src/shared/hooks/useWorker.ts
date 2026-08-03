import { useCallback, useEffect, useRef, useState } from 'react';
import { createWorkerClient } from '../workers';

/**
 * Generic hook for calling a Web Worker.
 * Provides execute function, loading state, and error handling.
 */
export function useWorker<TInput, TOutput>(workerFactory: () => Worker) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const clientRef = useRef<ReturnType<typeof createWorkerClient<TInput, TOutput>> | null>(null);

  useEffect(() => {
    const worker = workerFactory();
    clientRef.current = createWorkerClient<TInput, TOutput>(worker);
    return () => {
      clientRef.current?.terminate();
      clientRef.current = null;
    };
  }, [workerFactory]);

  const execute = useCallback(async (input: TInput): Promise<TOutput> => {
    if (!clientRef.current) throw new Error('Worker not initialized');
    setLoading(true);
    setError(null);
    try {
      const result = await clientRef.current.execute(input);
      return result;
    } catch (err) {
      setError(err as Error);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { execute, loading, error };
}