import { useState, useRef, useCallback, useEffect } from 'react';
import { StatCard } from '../../shared/components';
import { formatBytes, formatTimestamp, channelColor } from '../../shared/utils';
import { RealtimeChart } from './components/RealtimeChart';
import { MemoryGauge } from './components/MemoryGauge';
import { EventRateChart } from './components/EventRateChart';
import { useRootStore } from '../../stores';
import { evaluateAlerts, buildMetricSnapshot } from '../../shared/engine';
import { useI18n } from '../../shared/i18n/useI18n';

interface WebSocketMessage {
  type?: string;
  data?: any;
  message?: string;
  command?: string;
  index?: number;
  total?: number;
  channel?: string;
  eventType?: string;
  timestamp?: number;
  agent?: string;
  version?: number;
  pid?: number;
  [key: string]: any;
}

interface LogEntry {
  text: string;
  type: 'info' | 'error';
  time: Date;
}

interface TracingEventEntry {
  channel: string;
  eventType: string;
  timestamp: number;
}

interface ChunkBuffer {
  chunks: Record<number, string>;
  total: number;
  received: number;
}

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

type SnapState = 'idle' | 'receiving' | 'ready';
type CpuProfileState = 'idle' | 'receiving' | 'ready';

export function LiveMonitorPage() {
  const { t } = useI18n();
  // Connection
  const [host, setHost] = useState('localhost');
  const [port, setPort] = useState('9876');
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [agentPid, setAgentPid] = useState<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Log
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Memory
  const [memoryData, setMemoryData] = useState<{ rss: number; heapTotal: number; heapUsed: number; external: number } | null>(null);

  // Tracing
  const [tracingActive, setTracingActive] = useState(false);
  const [tracingEvents, setTracingEvents] = useState<TracingEventEntry[]>([]);

  // Heap snapshot
  const [snapState, setSnapState] = useState<SnapState>('idle');
  const snapBufferRef = useRef<ChunkBuffer>({ chunks: {}, total: 0, received: 0 });
  const [snapDownloadUrl, setSnapDownloadUrl] = useState<string | null>(null);

  // CPU profile
  const [cpuProfileState, setCpuProfileState] = useState<CpuProfileState>('idle');
  const cpuProfileBufferRef = useRef<ChunkBuffer>({ chunks: {}, total: 0, received: 0 });
  const [cpuProfileDownloadUrl, setCpuProfileDownloadUrl] = useState<string | null>(null);

  // Memory polling
  const [memPollingActive, setMemPollingActive] = useState(false);
  const [memPollingInterval, setMemPollingInterval] = useState(1000);

  // Live Dashboard
  const [memoryHistory, setMemoryHistory] = useState<Array<{ time: number; rss: number; heapUsed: number; heapTotal: number; external: number }>>([]);
  const [eventRateHistory, setEventRateHistory] = useState<Map<string, { count: number; color: string }>>(new Map());
  const chartRowRef = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState(480);

  // Auto-scroll logs
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  function addLog(text: string, type: 'info' | 'error' = 'info') {
    setLogs(prev => [...prev.slice(-199), { text, type, time: new Date() }]);
  }

  // Chunk assembly helpers
  function resetSnapBuffer() {
    snapBufferRef.current = { chunks: {}, total: 0, received: 0 };
    setSnapDownloadUrl(null);
  }

  function resetCpuProfileBuffer() {
    cpuProfileBufferRef.current = { chunks: {}, total: 0, received: 0 };
    setCpuProfileDownloadUrl(null);
  }

  function assembleChunk(
    index: number,
    total: number,
    data: string,
    bufferRef: React.MutableRefObject<ChunkBuffer>,
    onReady: (url: string) => void,
  ) {
    const buf = bufferRef.current;
    if (buf.total === 0) buf.total = total;
    if (!buf.chunks[index]) {
      buf.chunks[index] = data;
      buf.received++;
    }
    if (buf.received === buf.total) {
      // Reassemble
      const ordered: string[] = [];
      for (let i = 0; i < buf.total; i++) {
        ordered.push(buf.chunks[i] ?? '');
      }
      const full = ordered.join('');
      const blob = new Blob([full], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      onReady(url);
      // Reset buffer
      bufferRef.current = { chunks: {}, total: 0, received: 0 };
    }
  }

  // WebSocket message handler — broadly compatible with any agent protocol
  const handleMessage = useCallback((event: MessageEvent) => {
    let msg: Record<string, any>;
    try {
      msg = JSON.parse(event.data as string);
    } catch {
      addLog(t('liveMonitor.log.parseError').replace('{data}', String(event.data)), 'error');
      return;
    }

    // Try to detect and extract memory data from any message shape
    tryExtractMemory(msg);

    // Try to detect and extract tracing events from any message shape
    tryExtractEvent(msg);

    // Try to detect and handle chunked file transfers
    tryExtractChunk(msg);

    // Handle known protocol messages
    const msgType = msg.type ?? '';
    switch (msgType) {
      case 'hello':
        if (msg.agent) {
          addLog(t('liveMonitor.log.connected')
            .replace('{agent}', String(msg.agent))
            .replace('{version}', String(msg.version ?? '?'))
            .replace('{pid}', String(msg.pid ?? '?')));
          if (msg.pid) setAgentPid(msg.pid);
        }
        break;
      case 'status':
      case 'info':
      case 'log':
        addLog(msg.message ?? msg.text ?? msg.data ?? '');
        break;
      case 'error':
        addLog(msg.message ?? msg.text ?? t('common.error'), 'error');
        break;
      case 'memory-usage':
      case 'memory':
      case 'mem':
        // Already handled by tryExtractMemory above
        break;
      case 'event':
      case 'trace':
      case 'tracing':
        // Already handled by tryExtractEvent above
        break;
      case 'heap-snapshot-chunk':
      case 'cpu-profile-chunk':
        // Already handled by tryExtractChunk above
        break;
      case 'chunk':
        // Already handled by tryExtractChunk above
        break;
      default:
         // Silently ignore unknown types — no noisy logs
         break;
     }
   }, []);

  /** Attempt to extract memory usage data from any message shape */
  function tryExtractMemory(msg: Record<string, any>) {
    // Look for memory data in various shapes
    const mem = msg.data ?? msg;
    const rss = mem.rss ?? mem.RSS ?? mem.memoryRss ?? mem.mem_rss;
    const heapUsed = mem.heapUsed ?? mem.heap_used ?? mem.heapUsedBytes ?? mem.usedHeap;
    const heapTotal = mem.heapTotal ?? mem.heap_total ?? mem.heapTotalBytes ?? mem.totalHeap;
    const external = mem.external ?? mem.externalMemory ?? mem.external_memory;

    if (rss != null && heapUsed != null) {
      setMemoryData({
        rss: Number(rss),
        heapTotal: Number(heapTotal ?? 0),
        heapUsed: Number(heapUsed),
        external: Number(external ?? 0),
      });
      return true;
    }
    // Deeper search: check if any nested object has memory-like fields
    if (msg.data && typeof msg.data === 'object') {
      for (const key of Object.keys(msg.data)) {
        const val = msg.data[key];
        if (val && typeof val === 'object' && val.rss != null) {
          setMemoryData({
            rss: Number(val.rss),
            heapTotal: Number(val.heapTotal ?? 0),
            heapUsed: Number(val.heapUsed ?? 0),
            external: Number(val.external ?? 0),
          });
          return true;
        }
      }
    }
    return false;
  }

  /** Attempt to extract tracing events from any message shape */
  function tryExtractEvent(msg: Record<string, any>) {
    const data = msg.data ?? msg;
    const channel = msg.channel ?? data.channel ?? data.name;
    const eventType = msg.eventType ?? data.eventType ?? data.type ?? data.event ?? msgTypeName(msg);

    if (channel && eventType && typeof channel === 'string') {
      setTracingEvents(prev => {
        const next = [{
          channel,
          eventType: String(eventType),
          timestamp: msg.timestamp ?? data.timestamp ?? Date.now(),
        }, ...prev];
        return next.slice(0, 100);
      });
      return true;
    }
    return false;
  }

  /** Attempt to extract chunked file data from any message shape */
  function tryExtractChunk(msg: Record<string, any>) {
    const data = msg.data ?? '';
    const index = msg.index ?? msg.seq ?? msg.part ?? msg.chunkIndex;
    const total = msg.total ?? msg.count ?? msg.parts ?? msg.totalChunks;

    // Check if this looks like a chunk message
    if (index != null && total != null && total > 1) {
      const idx = Number(index);
      const tot = Number(total);

      // Determine if this is a heap snapshot or CPU profile chunk
      if (msg.type?.includes('snapshot') || msg.type?.includes('heap')) {
        if (snapState === 'idle') setSnapState('receiving');
        assembleChunk(idx, tot, String(data), snapBufferRef, (url) => {
          setSnapDownloadUrl(url);
          setSnapState('ready');
          addLog(t('liveMonitor.snapshotReady'));
        });
      } else if (msg.type?.includes('cpu') || msg.type?.includes('profile')) {
        if (cpuProfileState === 'idle') setCpuProfileState('receiving');
        assembleChunk(idx, tot, String(data), cpuProfileBufferRef, (url) => {
          setCpuProfileDownloadUrl(url);
          setCpuProfileState('ready');
          addLog(t('liveMonitor.profileReady'));
        });
      } else {
        // Generic chunk — try heap snapshot first
        if (snapState === 'idle') setSnapState('receiving');
        assembleChunk(idx, tot, String(data), snapBufferRef, (url) => {
          setSnapDownloadUrl(url);
          setSnapState('ready');
          addLog(t('liveMonitor.log.chunkComplete'));
        });
      }
      return true;
    }
    return false;
  }

  function msgTypeName(msg: Record<string, any>): string {
    return msg.type ?? msg.event ?? msg.name ?? 'message';
  }

  function connect() {
    const url = `ws://${host}:${port}`;
    setConnectionStatus('connecting');
    addLog(t('liveMonitor.connecting') + ` ${url}...`);

    const ws = new WebSocket(url);
    ws.onopen = () => {
      setConnectionStatus('connected');
      addLog(t('liveMonitor.connected'));
    };
    ws.onmessage = handleMessage;
    ws.onclose = () => {
      setConnectionStatus('disconnected');
      setAgentPid(null);
      addLog(t('liveMonitor.disconnected'));
    };
    ws.onerror = () => {
      setConnectionStatus('disconnected');
      setAgentPid(null);
      addLog(t('liveMonitor.connectionError'), 'error');
    };
    wsRef.current = ws;
  }

  function disconnect() {
    wsRef.current?.close();
    wsRef.current = null;
    setConnectionStatus('disconnected');
    setAgentPid(null);
  }

  function sendCommand(command: string) {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ command }));
    }
  }

  // Tracing
  function toggleTracing() {
    if (tracingActive) {
      sendCommand('stop-tracing');
      setTracingActive(false);
      addLog(t('liveMonitor.tracingStopped'));
    } else {
      setTracingEvents([]);
      sendCommand('start-tracing');
      setTracingActive(true);
      addLog(t('liveMonitor.tracingStarted'));
    }
  }

  // Heap snapshot
  function takeHeapSnapshot() {
    resetSnapBuffer();
    setSnapState('receiving');
    sendCommand('take-heap-snapshot');
    addLog(t('liveMonitor.takeHeapSnapshot') + '...');
  }

  function downloadSnap() {
    if (snapDownloadUrl) {
      const a = document.createElement('a');
      a.href = snapDownloadUrl;
      a.download = `heap-snapshot-${Date.now()}.heapsnapshot`;
      a.click();
    }
  }

  // CPU profile
  function toggleCpuProfile() {
    if (cpuProfileState === 'ready' || cpuProfileState === 'receiving') {
      sendCommand('stop-cpu-profile');
      setCpuProfileState('idle');
      resetCpuProfileBuffer();
      addLog(t('liveMonitor.profileReady'));
    } else {
      resetCpuProfileBuffer();
      setCpuProfileState('receiving');
      sendCommand('start-cpu-profile');
      addLog(t('liveMonitor.startCpuProfile') + '...');
    }
  }

  function downloadCpuProfile() {
    if (cpuProfileDownloadUrl) {
      const a = document.createElement('a');
      a.href = cpuProfileDownloadUrl;
      a.download = `cpu-profile-${Date.now()}.cpuprofile`;
      a.click();
    }
  }

  // Memory polling
  function toggleMemPolling() {
    if (memPollingActive) {
      sendCommand('stop-memory-polling');
      setMemPollingActive(false);
      addLog(t('liveMonitor.stopMemoryPolling'));
    } else {
      sendCommand('start-memory-polling');
      setMemPollingActive(true);
      addLog(t('liveMonitor.startMemoryPolling') + ` (interval: ${memPollingInterval}ms)`);
    }
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      wsRef.current?.close();
    };
  }, []);

  // ResizeObserver for chart width
  useEffect(() => {
    const el = chartRowRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        setChartWidth(entry.contentRect.width);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Track memory history
  const historyRef = useRef(memoryHistory);
  historyRef.current = memoryHistory;
  useEffect(() => {
    if (!memoryData) return;
    const now = Date.now();
    const entry = {
      time: now,
      rss: memoryData.rss,
      heapUsed: memoryData.heapUsed,
      heapTotal: memoryData.heapTotal,
      external: memoryData.external,
    };
    setMemoryHistory(prev => {
      const next = [...prev, entry];
      return next.slice(-120);
    });
  }, [memoryData]);

  // Track event rate history
  useEffect(() => {
    if (tracingEvents.length === 0) return;
    const latest = tracingEvents[0];
    if (!latest) return;
    setEventRateHistory(prev => {
      const next = new Map(prev);
      const ch = latest.channel;
      const existing = next.get(ch);
      const color = existing?.color ?? channelColor(ch);
      next.set(ch, {
        count: (existing?.count ?? 0) + 1,
        color,
      });
      // Prune old entries if too many channels
      if (next.size > 50) {
        const sorted = [...next.entries()].sort((a, b) => b[1].count - a[1].count);
        next.clear();
        for (const [k, v] of sorted.slice(0, 50)) {
          next.set(k, v);
        }
      }
      return next;
    });
  }, [tracingEvents]);

  // Alert evaluation
  const { alertRules, addFiredAlert, firedAlerts } = useRootStore();
  useEffect(() => {
    if (!memoryData) return;
    const errorEvents = tracingEvents.filter(e => e.eventType.toLowerCase().includes('error'));
    const traceErrorRate = tracingEvents.length > 0 ? (errorEvents.length / tracingEvents.length) * 100 : 0;
    const snapshot = buildMetricSnapshot({
      memoryData,
      memoryHistory,
      errorRate: traceErrorRate,
      eventRate: tracingEvents.length,
    });
    const fired = evaluateAlerts(alertRules, snapshot);
    if (fired.length > 0) {
      fired.forEach(f => addFiredAlert(f));
      fired.forEach(f => addLog(t('liveMonitor.log.alert').replace('{level}', f.level).replace('{message}', f.message), f.level === 'critical' ? 'error' : 'info'));
    }
  }, [memoryData, alertRules]);

  const statusDot = connectionStatus === 'connected'
    ? 'bg-green-500'
    : connectionStatus === 'connecting'
      ? 'bg-yellow-500'
      : 'bg-red-500';

  const statusLabel = connectionStatus === 'connected'
    ? t('liveMonitor.connected')
    : connectionStatus === 'connecting'
      ? t('liveMonitor.connecting')
      : t('liveMonitor.disconnected');

  // Derived data for charts
  const rssHistory = memoryHistory.map(d => ({ time: d.time, value: d.rss / (1024 * 1024) }));
  const heapUsedHistory = memoryHistory.map(d => ({ time: d.time, value: d.heapUsed / (1024 * 1024) }));
  const eventRateEntries: Array<{ channel: string; count: number; color: string }> = [];
  eventRateHistory.forEach((v, k) => {
    eventRateEntries.push({ channel: k, count: v.count, color: v.color });
  });

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">{t('liveMonitor.title')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {t('liveMonitor.description')}
        </p>
      </div>

      {/* Connection Panel */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-4">
        <div className="flex items-center gap-4 flex-wrap">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t('liveMonitor.host')}</label>
            <input
              type="text"
              value={host}
              onChange={e => setHost(e.target.value)}
              disabled={connectionStatus !== 'disconnected'}
              className="w-32 px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-50"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t('liveMonitor.port')}</label>
            <input
              type="text"
              value={port}
              onChange={e => setPort(e.target.value)}
              disabled={connectionStatus !== 'disconnected'}
              className="w-24 px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-50"
            />
          </div>
          <div className="pt-5">
            {connectionStatus === 'disconnected' ? (
              <button
                onClick={connect}
                className="px-4 py-2 rounded-lg font-medium text-sm bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                {t('liveMonitor.connect')}
              </button>
            ) : (
              <button
                onClick={disconnect}
                className="px-4 py-2 rounded-lg font-medium text-sm bg-red-600 hover:bg-red-700 text-white"
              >
                {t('liveMonitor.disconnect')}
              </button>
            )}
          </div>
          <div className="pt-5 flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full inline-block ${statusDot}`} />
            <span className="text-sm text-gray-600 dark:text-gray-300">{statusLabel}</span>
            {agentPid !== null && (
              <span className="text-xs text-gray-400 dark:text-gray-500 ml-2">{t('liveMonitor.pid')}: {agentPid}</span>
            )}
          </div>
        </div>
      </div>

      {connectionStatus === 'connected' && (
        <>
          {/* Alert strip */}
          {firedAlerts.length > 0 && (
            <div className="mb-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3">
              <div className="flex items-center gap-2 mb-1">
                <svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">{t('liveMonitor.alerts')}</span>
              </div>
              <div className="space-y-1">
                {firedAlerts.slice(0, 3).map((fa, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-xs">
                    <span className={`px-1.5 py-0.5 rounded font-medium ${
                      fa.level === 'critical' ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                        : fa.level === 'warning' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                        : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                    }`}>{fa.level.toUpperCase()}</span>
                    <span className="text-gray-600 dark:text-gray-300">{fa.message}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Memory Panel */}
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">{t('liveMonitor.memory')}</h2>
            <div className="grid grid-cols-4 gap-3">
              <StatCard title={t('liveMonitor.rss')} value={memoryData ? formatBytes(memoryData.rss) : '-'} />
              <StatCard title={t('liveMonitor.heapUsed')} value={memoryData ? formatBytes(memoryData.heapUsed) : '-'} />
              <StatCard title={t('liveMonitor.heapTotal')} value={memoryData ? formatBytes(memoryData.heapTotal) : '-'} />
              <StatCard title={t('liveMonitor.external')} value={memoryData ? formatBytes(memoryData.external) : '-'} />
            </div>
          </div>

          {/* Live Dashboard */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-4">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">{t('liveMonitor.liveDashboard')}</h2>
            
            {/* Memory Gauges Row */}
            <div className="grid grid-cols-4 gap-4 mb-4">
              <MemoryGauge used={memoryData?.heapUsed ?? 0} total={memoryData?.heapTotal ?? 1} label={t('liveMonitor.heapUsed')} color="#22c55e" />
              <MemoryGauge used={memoryData?.rss ?? 0} total={memoryData?.rss ?? 1} label={t('liveMonitor.rss')} color="#3b82f6" />
              <MemoryGauge used={memoryData?.external ?? 0} total={(memoryData?.heapTotal ?? 1)} label={t('liveMonitor.external')} color="#f97316" />
              <MemoryGauge used={((memoryData?.heapUsed ?? 0) / ((memoryData?.heapTotal ?? 1) || 1)) * 100} total={100} label={t('liveMonitor.heapPercent')} color="#8b5cf6" />
            </div>

            {/* Real-time Charts Row */}
            <div ref={chartRowRef} className="grid grid-cols-2 gap-4">
              <div>
                <h3 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">{t('liveMonitor.memoryTrend')}</h3>
                <RealtimeChart data={rssHistory} width={chartWidth / 2 - 8} height={180} color="#3b82f6" label={t('liveMonitor.rss')} unit=" MB" />
              </div>
              <div>
                <h3 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">{t('liveMonitor.heapTrend')}</h3>
                <RealtimeChart data={heapUsedHistory} width={chartWidth / 2 - 8} height={180} color="#22c55e" label={t('liveMonitor.heapUsed')} unit=" MB" />
              </div>
            </div>

            {/* Event Rate Chart */}
            {eventRateEntries.length > 0 && (
              <div className="mt-4">
                <h3 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">{t('liveMonitor.eventRate')}</h3>
                <EventRateChart events={eventRateEntries} width={chartWidth} height={Math.min(eventRateEntries.length * 28 + 16, 300)} />
              </div>
            )}
          </div>

          {/* Actions Panel */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-4">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">{t('liveMonitor.actions')}</h2>
            <div className="flex flex-wrap gap-3 items-center">
              {/* Heap Snapshot */}
              <button
                onClick={takeHeapSnapshot}
                disabled={snapState === 'receiving'}
                className="px-4 py-2 rounded-lg font-medium text-sm bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50"
              >
                {snapState === 'receiving' ? t('common.loading') : t('liveMonitor.takeHeapSnapshot')}
              </button>
              {snapState === 'ready' && snapDownloadUrl && (
                <button
                  onClick={downloadSnap}
                  className="px-4 py-2 rounded-lg font-medium text-sm bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  {t('liveMonitor.downloadSnapshot')}
                </button>
              )}

              {/* CPU Profile */}
              <button
                onClick={toggleCpuProfile}
                disabled={cpuProfileState === 'receiving'}
                className="px-4 py-2 rounded-lg font-medium text-sm bg-orange-600 hover:bg-orange-700 text-white disabled:opacity-50"
              >
                {cpuProfileState === 'ready' || cpuProfileState === 'receiving'
                  ? t('liveMonitor.stopCpuProfile')
                  : t('liveMonitor.startCpuProfile')}
              </button>
              {cpuProfileState === 'ready' && cpuProfileDownloadUrl && (
                <button
                  onClick={downloadCpuProfile}
                  className="px-4 py-2 rounded-lg font-medium text-sm bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  {t('liveMonitor.downloadProfile')}
                </button>
              )}

              {/* Memory Polling */}
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={memPollingInterval}
                  onChange={e => setMemPollingInterval(Number(e.target.value))}
                  min={100}
                  step={100}
                  disabled={memPollingActive}
                  className="w-20 px-2 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-50"
                />
                <span className="text-xs text-gray-500 dark:text-gray-400">ms</span>
                <button
                  onClick={toggleMemPolling}
                  className="px-4 py-2 rounded-lg font-medium text-sm bg-cyan-600 hover:bg-cyan-700 text-white"
                >
                  {memPollingActive ? t('liveMonitor.stopMemoryPolling') : t('liveMonitor.startMemoryPolling')}
                </button>
              </div>
            </div>
          </div>

          {/* Tracing Panel */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">{t('liveMonitor.tracing')}</h2>
              <div className="flex items-center gap-3">
                {tracingActive && (
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {t('report.totalEvents')}: {tracingEvents.length}
                  </span>
                )}
                <button
                  onClick={toggleTracing}
                  className="px-4 py-2 rounded-lg font-medium text-sm bg-amber-600 hover:bg-amber-700 text-white"
                >
                  {tracingActive ? t('liveMonitor.stopTracing') : t('liveMonitor.startTracing')}
                </button>
              </div>
            </div>
            {tracingEvents.length > 0 && (
              <div className="max-h-96 overflow-y-auto space-y-1.5">
                {tracingEvents.map((evt, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-900/50 border border-gray-100 dark:border-gray-800"
                  >
                    <span className="px-2 py-0.5 rounded text-xs font-medium text-white"
                      style={{ backgroundColor: channelColor(evt.channel) }}
                    >
                      {evt.channel}
                    </span>
                    <span className="text-xs text-gray-600 dark:text-gray-300">{evt.eventType}</span>
                    <span className="text-xs text-gray-400 dark:text-gray-500 ml-auto font-mono">
                      {formatTimestamp(evt.timestamp)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Status Log */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">{t('liveMonitor.statusLog')}</h2>
        <div className="max-h-48 overflow-y-auto font-mono text-xs space-y-0.5">
          {logs.length === 0 ? (
            <p className="text-gray-400 dark:text-gray-500">{t('liveMonitor.noLogs')}</p>
          ) : (
            logs.map((entry, idx) => (
              <div key={idx} className={`${entry.type === 'error' ? 'text-red-500 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                <span className="text-gray-400 dark:text-gray-500">{formatTimestamp(entry.time.getTime())} </span>
                {entry.text}
              </div>
            ))
          )}
          <div ref={logEndRef} />
        </div>
      </div>
    </div>
  );
}