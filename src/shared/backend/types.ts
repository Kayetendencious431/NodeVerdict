/**
 * Backend capability detection — shared types.
 *
 * The frontend stays fully usable offline: features that only parse uploaded
 * files keep working without any server. Features that REQUIRE a live backend
 * (Live Monitor agent, remote profiling, CI gate, OTLP ingest...) go through
 * `BackendGate`/`useBackend`, which probes for the backend and shows a
 * "Backend server required" panel when it is missing.
 */

export type BackendStatus = 'unknown' | 'checking' | 'online' | 'offline';

export interface BackendInfo {
  name: string;
  version: string;
  pid: number;
  uptime: number;
  startedAt: number;
  nodeVersion: string;
  channels: string[];
  features: string[];
}

export interface BackendProbe {
  status: BackendStatus;
  info: BackendInfo | null;
  error?: string;
  checkedAt: number;
}

export interface BackendTarget {
  host: string;
  port: string;
}

export const DEFAULT_BACKEND_PORT = '9876';

export const BACKEND_FEATURES = {
  tracing: 'tracing',
  heapSnapshot: 'heap-snapshot',
  cpuProfile: 'cpu-profile',
  memoryPolling: 'memory-polling',
  gcEvents: 'gc-events',
} as const;

export type BackendFeature = (typeof BACKEND_FEATURES)[keyof typeof BACKEND_FEATURES];
