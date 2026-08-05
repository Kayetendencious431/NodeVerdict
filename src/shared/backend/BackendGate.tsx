import { useI18n } from '../i18n/useI18n';
import { backendHealthUrl } from './detect';
import { useBackend } from './useBackend';
import type { BackendInfo, BackendStatus } from './types';

const DEFAULT_START_COMMAND = 'cd server && npm install && npx nodeverdict-agent';

interface BackendGateProps {
  host?: string;
  port?: string;
  onHostChange?: (h: string) => void;
  onPortChange?: (p: string) => void;
  title?: string;
  description?: string;
  startCommand?: string;
  /**
   * fullscreen: replaces the page content until a backend is detected.
   * banner: keeps `children` visible and shows a slim offline notice on top.
   */
  variant?: 'fullscreen' | 'banner';
  children: React.ReactNode;
}

/**
 * Gate for backend-dependent features.
 * - Backend detected → renders `children` (feature works normally).
 * - Backend missing → renders the "Backend server required" panel with the
 *   start command and a re-check button (frontend display preserved either way).
 */
export function BackendGate({
  host,
  port,
  onHostChange,
  onPortChange,
  title,
  description,
  startCommand = DEFAULT_START_COMMAND,
  variant = 'fullscreen',
  children,
}: BackendGateProps) {
  const { t } = useI18n();
  const backend = useBackend({ host, port });

  const gateTitle = title ?? t('backend.title');
  const gateDesc = description ?? t('backend.description');

  if (variant === 'banner') {
    return (
      <>
        {backend.status !== 'online' && (
          <BackendOfflineBanner
            status={backend.status}
            info={backend.info}
            error={backend.error}
            host={backend.host}
            port={backend.port}
            startCommand={startCommand}
            onRetry={backend.retry}
          />
        )}
        {children}
      </>
    );
  }

  if (backend.status !== 'online') {
    return (
      <OfflineGate
        title={gateTitle}
        description={gateDesc}
        status={backend.status}
        error={backend.error}
        healthUrl={backendHealthUrl({ host: backend.host, port: backend.port })}
        startCommand={startCommand}
        onRetry={backend.retry}
      />
    );
  }

  return <>{children}</>;
}

interface OfflineGateProps {
  title: string;
  description: string;
  status: BackendStatus;
  error?: string;
  healthUrl: string;
  startCommand: string;
  onRetry: () => void;
}

function OfflineGate({ title, description, status, error, healthUrl, startCommand, onRetry }: OfflineGateProps) {
  const { t } = useI18n();
  return (
    <div className="p-6">
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-amber-200 dark:border-amber-900/50 overflow-hidden">
        <div className="p-8 flex flex-col items-center text-center">
          <div className="w-16 h-16 rounded-2xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-amber-600 dark:text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100 mb-2">{title}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md mb-6">{description}</p>

          <div className="w-full max-w-md rounded-lg bg-gray-50 dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700 p-4 mb-4 text-left">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
              {t('backend.startHint')}
            </p>
            <pre className="text-xs font-mono text-emerald-600 dark:text-emerald-400 overflow-x-auto whitespace-pre-wrap break-all">
              {startCommand}
            </pre>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-3">
              {t('backend.checkUrl')}: <span className="font-mono">{healthUrl}</span>
            </p>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={onRetry}
              disabled={status === 'checking'}
              className="px-5 py-2 rounded-lg font-medium text-sm bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 inline-flex items-center gap-2"
            >
              {status === 'checking' ? (
                <Spinner />
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              )}
              {t('backend.retry')}
            </button>
            {error && (
              <span className="text-xs text-red-500 dark:text-red-400 max-w-[200px] truncate" title={error}>
                {error}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function BackendOfflineBanner({ status, info, error, host, port, startCommand = DEFAULT_START_COMMAND, onRetry }: {
  status: BackendStatus;
  info: BackendInfo | null;
  error?: string;
  host: string;
  port: string;
  startCommand?: string;
  onRetry: () => void;
}) {
  const { t } = useI18n();
  const healthUrl = backendHealthUrl({ host, port });
  return (
    <div className="mb-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4 flex flex-wrap items-center gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${status === 'checking' ? 'bg-amber-400 animate-pulse' : 'bg-amber-500'}`} />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
            {status === 'checking' ? t('backend.checking') : t('backend.offline')}
          </p>
          <p className="text-xs text-amber-700/80 dark:text-amber-400/80 truncate">
            {status === 'checking' ? healthUrl : t('backend.bannerHint')}
            {info ? ` · PID ${info.pid}` : ''}
            {error ? ` · ${error}` : ''}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 ml-auto">
        <button
          onClick={onRetry}
          disabled={status === 'checking'}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-800 disabled:opacity-50"
        >
          {status === 'checking' ? t('backend.checking') : t('backend.retry')}
        </button>
      </div>
      <div className="w-full">
        <pre className="text-xs font-mono text-emerald-600 dark:text-emerald-400 overflow-x-auto whitespace-pre-wrap break-all">{startCommand}</pre>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  );
}
