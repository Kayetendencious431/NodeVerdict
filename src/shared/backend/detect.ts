import type { BackendInfo, BackendProbe, BackendTarget } from './types';

const DEFAULT_TIMEOUT_MS = 3000;

/**
 * Probe a NodeVerdict backend by hitting its HTTP `/health` endpoint.
 * Works cross-origin because the agent answers with `Access-Control-Allow-Origin: *`.
 */
export async function probeBackend(
  target: BackendTarget,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<BackendProbe> {
  const checkedAt = Date.now();
  const url = `http://${target.host}:${target.port}/health`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      return { status: 'offline', info: null, error: `HTTP ${res.status}`, checkedAt };
    }
    const raw = await res.json();
    const info = normalizeInfo(raw, target);
    return { status: 'online', info, checkedAt };
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === 'AbortError';
    return {
      status: 'offline',
      info: null,
      error: aborted ? `Timed out after ${timeoutMs}ms` : (err as Error)?.message ?? 'Network error',
      checkedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}

function normalizeInfo(raw: any, target: BackendTarget): BackendInfo {
  return {
    name: typeof raw?.name === 'string' ? raw.name : 'nodeverdict-agent',
    version: typeof raw?.version === 'string' ? raw.version : 'unknown',
    pid: Number(raw?.pid ?? 0),
    uptime: Number(raw?.uptime ?? 0),
    startedAt: Number(raw?.startedAt ?? checkedAt(raw)),
    nodeVersion: typeof raw?.nodeVersion === 'string' ? raw.nodeVersion : '',
    channels: Array.isArray(raw?.channels) ? raw.channels.map(String) : [],
    features: Array.isArray(raw?.features) ? raw.features.map(String) : [],
  };
}

function checkedAt(raw: any): number {
  return raw?.uptime != null ? Date.now() - Number(raw.uptime) * 1000 : Date.now();
}

export function backendWsUrl(target: BackendTarget): string {
  return `ws://${target.host}:${target.port}`;
}

export function backendHealthUrl(target: BackendTarget): string {
  return `http://${target.host}:${target.port}/health`;
}
