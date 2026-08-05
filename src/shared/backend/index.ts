export { probeBackend, backendWsUrl, backendHealthUrl } from './detect';
export { useBackend } from './useBackend';
export { BackendGate, BackendOfflineBanner } from './BackendGate';
export { DEFAULT_BACKEND_PORT, BACKEND_FEATURES } from './types';
export type {
  BackendInfo,
  BackendProbe,
  BackendStatus,
  BackendTarget,
  BackendFeature,
} from './types';
export type { UseBackendOptions, UseBackendResult } from './useBackend';
