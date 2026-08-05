import { useCallback, useEffect, useRef, useState } from 'react';
import { probeBackend } from './detect';
import { DEFAULT_BACKEND_PORT } from './types';
import type { BackendInfo, BackendProbe, BackendStatus, BackendTarget } from './types';

export interface UseBackendOptions {
  host?: string;
  port?: string;
  /** How often to re-probe while the backend is offline (ms). 0 = once only. */
  retryIntervalMs?: number;
  /** How often to re-probe while the backend is online (ms). 0 = once only. */
  checkIntervalMs?: number;
  enabled?: boolean;
}

export interface UseBackendResult {
  status: BackendStatus;
  info: BackendInfo | null;
  error?: string;
  checkedAt: number;
  host: string;
  port: string;
  setHost: (h: string) => void;
  setPort: (p: string) => void;
  probe: () => Promise<BackendProbe>;
  retry: () => void;
}

/**
 * React hook that continuously probes for a NodeVerdict backend.
 * Returns `online` when the agent's `/health` endpoint responds, otherwise
 * `offline` with an error message — the UI then shows the "backend required" gate.
 */
export function useBackend(options: UseBackendOptions = {}): UseBackendResult {
  const [host, setHostState] = useState(options.host ?? 'localhost');
  const [port, setPortState] = useState(options.port ?? DEFAULT_BACKEND_PORT);
  const [status, setStatus] = useState<BackendStatus>('unknown');
  const [info, setInfo] = useState<BackendInfo | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const [checkedAt, setCheckedAt] = useState(0);
  const inFlight = useRef(false);
  const probeSeq = useRef(0);

  const setHost = useCallback((h: string) => setHostState(h.trim() || 'localhost'), []);
  const setPort = useCallback((p: string) => setPortState(p.trim() || DEFAULT_BACKEND_PORT), []);

  const probe = useCallback(async (): Promise<BackendProbe> => {
    if (inFlight.current) {
      return { status, info, error, checkedAt };
    }
    inFlight.current = true;
    setStatus('checking');
    const seq = ++probeSeq.current;
    const target: BackendTarget = { host, port };
    const result = await probeBackend(target);
    if (seq !== probeSeq.current) {
      inFlight.current = false;
      return result;
    }
    setStatus(result.status);
    setInfo(result.info);
    setError(result.error);
    setCheckedAt(result.checkedAt);
    inFlight.current = false;
    return result;
  }, [host, port]);

  const retry = useCallback(() => {
    void probe();
  }, [probe]);

  const enabled = options.enabled ?? true;
  useEffect(() => {
    if (!enabled) return;
    void probe();
  }, [enabled, probe]);

  const retryIntervalMs = options.retryIntervalMs ?? 5000;
  const checkIntervalMs = options.checkIntervalMs ?? 0;
  useEffect(() => {
    if (!enabled) return;
    if (retryIntervalMs <= 0 && checkIntervalMs <= 0) return;
    const interval = setInterval(() => {
      void probe();
    }, retryIntervalMs);
    return () => clearInterval(interval);
  }, [enabled, retryIntervalMs, checkIntervalMs, probe]);

  return { status, info, error, checkedAt, host, port, setHost, setPort, probe, retry };
}
