import { useState, useRef, useCallback, useEffect } from 'react';
import { StatCard } from '../../shared/components';
import { formatBytes, formatTimestamp } from '../../shared/utils';

interface WebSocketMessage {
  type: 'event' | 'memory-usage' | 'status' | 'error' | 'heap-snapshot-chunk' | 'cpu-profile-chunk';
  data?: any;
  message?: string;
  command?: string;
  index?: number;
  total?: number;
  channel?: string;
  eventType?: string;
  timestamp?: number;
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

  // WebSocket message handler
  const handleMessage = useCallback((event: MessageEvent) => {
    let msg: WebSocketMessage;
    try {
      msg = JSON.parse(event.data) as WebSocketMessage;
    } catch {
      addLog('Failed to parse message: ' + event.data, 'error');
      return;
    }

    switch (msg.type) {
      case 'status':
        addLog(msg.message ?? '');
        if (msg.data?.pid) {
          setAgentPid(msg.data.pid);
        }
        break;
      case 'error':
        addLog(msg.message ?? 'Unknown error', 'error');
        break;
      case 'memory-usage':
        if (msg.data) {
          setMemoryData({
            rss: msg.data.rss ?? 0,
            heapTotal: msg.data.heapTotal ?? 0,
            heapUsed: msg.data.heapUsed ?? 0,
            external: msg.data.external ?? 0,
          });
        }
        break;
      case 'event':
        setTracingEvents(prev => {
          const next = [
            {
              channel: msg.channel ?? msg.data?.channel ?? 'unknown',
              eventType: msg.eventType ?? msg.data?.eventType ?? 'unknown',
              timestamp: msg.timestamp ?? msg.data?.timestamp ?? Date.now(),
            },
            ...prev,
          ];
          return next.slice(0, 100);
        });
        break;
      case 'heap-snapshot-chunk':
        if (snapState === 'idle') setSnapState('receiving');
        assembleChunk(
          msg.index ?? 0,
          msg.total ?? 0,
          msg.data ?? '',
          snapBufferRef,
          (url) => {
            setSnapDownloadUrl(url);
            setSnapState('ready');
            addLog('Heap snapshot ready');
          },
        );
        break;
      case 'cpu-profile-chunk':
        if (cpuProfileState === 'idle') setCpuProfileState('receiving');
        assembleChunk(
          msg.index ?? 0,
          msg.total ?? 0,
          msg.data ?? '',
          cpuProfileBufferRef,
          (url) => {
            setCpuProfileDownloadUrl(url);
            setCpuProfileState('ready');
            addLog('CPU profile ready');
          },
        );
        break;
      default:
        addLog('Unknown message type: ' + msg.type);
    }
  }, [snapState, cpuProfileState]);

  function connect() {
    const url = `ws://${host}:${port}`;
    setConnectionStatus('connecting');
    addLog(`Connecting to ${url}...`);

    const ws = new WebSocket(url);
    ws.onopen = () => {
      setConnectionStatus('connected');
      addLog('Connected');
    };
    ws.onmessage = handleMessage;
    ws.onclose = () => {
      setConnectionStatus('disconnected');
      setAgentPid(null);
      addLog('Disconnected');
    };
    ws.onerror = () => {
      setConnectionStatus('disconnected');
      setAgentPid(null);
      addLog('Connection error', 'error');
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
      addLog('Tracing stopped');
    } else {
      setTracingEvents([]);
      sendCommand('start-tracing');
      setTracingActive(true);
      addLog('Tracing started');
    }
  }

  // Heap snapshot
  function takeHeapSnapshot() {
    resetSnapBuffer();
    setSnapState('receiving');
    sendCommand('take-heap-snapshot');
    addLog('Requesting heap snapshot...');
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
      addLog('CPU profile stopped');
    } else {
      resetCpuProfileBuffer();
      setCpuProfileState('receiving');
      sendCommand('start-cpu-profile');
      addLog('CPU profile started...');
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
      addLog('Memory polling stopped');
    } else {
      sendCommand('start-memory-polling');
      setMemPollingActive(true);
      addLog(`Memory polling started (interval: ${memPollingInterval}ms)`);
    }
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      wsRef.current?.close();
    };
  }, []);

  const statusDot = connectionStatus === 'connected'
    ? 'bg-green-500'
    : connectionStatus === 'connecting'
      ? 'bg-yellow-500'
      : 'bg-red-500';

  const statusLabel = connectionStatus === 'connected'
    ? 'Connected'
    : connectionStatus === 'connecting'
      ? 'Connecting...'
      : 'Disconnected';

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Live Monitor</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Connect to a running Node.js diagnostic agent via WebSocket
        </p>
      </div>

      {/* Connection Panel */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-4">
        <div className="flex items-center gap-4 flex-wrap">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Host</label>
            <input
              type="text"
              value={host}
              onChange={e => setHost(e.target.value)}
              disabled={connectionStatus !== 'disconnected'}
              className="w-32 px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-50"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Port</label>
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
                Connect
              </button>
            ) : (
              <button
                onClick={disconnect}
                className="px-4 py-2 rounded-lg font-medium text-sm bg-red-600 hover:bg-red-700 text-white"
              >
                Disconnect
              </button>
            )}
          </div>
          <div className="pt-5 flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full inline-block ${statusDot}`} />
            <span className="text-sm text-gray-600 dark:text-gray-300">{statusLabel}</span>
            {agentPid !== null && (
              <span className="text-xs text-gray-400 dark:text-gray-500 ml-2">PID: {agentPid}</span>
            )}
          </div>
        </div>
      </div>

      {connectionStatus === 'connected' && (
        <>
          {/* Memory Panel */}
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">Memory Usage</h2>
            <div className="grid grid-cols-4 gap-3">
              <StatCard title="RSS" value={memoryData ? formatBytes(memoryData.rss) : '-'} />
              <StatCard title="Heap Used" value={memoryData ? formatBytes(memoryData.heapUsed) : '-'} />
              <StatCard title="Heap Total" value={memoryData ? formatBytes(memoryData.heapTotal) : '-'} />
              <StatCard title="External" value={memoryData ? formatBytes(memoryData.external) : '-'} />
            </div>
          </div>

          {/* Actions Panel */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-4">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">Actions</h2>
            <div className="flex flex-wrap gap-3 items-center">
              {/* Heap Snapshot */}
              <button
                onClick={takeHeapSnapshot}
                disabled={snapState === 'receiving'}
                className="px-4 py-2 rounded-lg font-medium text-sm bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50"
              >
                {snapState === 'receiving' ? 'Receiving...' : 'Take Heap Snapshot'}
              </button>
              {snapState === 'ready' && snapDownloadUrl && (
                <button
                  onClick={downloadSnap}
                  className="px-4 py-2 rounded-lg font-medium text-sm bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  Download Snapshot
                </button>
              )}

              {/* CPU Profile */}
              <button
                onClick={toggleCpuProfile}
                disabled={cpuProfileState === 'receiving'}
                className="px-4 py-2 rounded-lg font-medium text-sm bg-orange-600 hover:bg-orange-700 text-white disabled:opacity-50"
              >
                {cpuProfileState === 'ready' || cpuProfileState === 'receiving'
                  ? 'Stop CPU Profile'
                  : 'Start CPU Profile'}
              </button>
              {cpuProfileState === 'ready' && cpuProfileDownloadUrl && (
                <button
                  onClick={downloadCpuProfile}
                  className="px-4 py-2 rounded-lg font-medium text-sm bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  Download CPU Profile
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
                  {memPollingActive ? 'Stop Memory Polling' : 'Start Memory Polling'}
                </button>
              </div>
            </div>
          </div>

          {/* Tracing Panel */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Tracing</h2>
              <div className="flex items-center gap-3">
                {tracingActive && (
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    Events: {tracingEvents.length}
                  </span>
                )}
                <button
                  onClick={toggleTracing}
                  className="px-4 py-2 rounded-lg font-medium text-sm bg-amber-600 hover:bg-amber-700 text-white"
                >
                  {tracingActive ? 'Stop Tracing' : 'Start Tracing'}
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
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">Status Log</h2>
        <div className="max-h-48 overflow-y-auto font-mono text-xs space-y-0.5">
          {logs.length === 0 ? (
            <p className="text-gray-400 dark:text-gray-500">No messages yet</p>
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

// Simple channel color based on channel name
function channelColor(channel: string): string {
  let hash = 0;
  for (let i = 0; i < channel.length; i++) {
    hash = ((hash << 5) - hash) + channel.charCodeAt(i);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 65%, 55%)`;
}