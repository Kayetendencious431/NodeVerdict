#!/usr/bin/env node

/**
 * NodeVerdict Live Agent
 *
 * Connects to the current Node.js process via diagnostics_channel and inspector,
 * streams diagnostic data to the NodeVerdict frontend via WebSocket.
 *
 * Usage:
 *   node live-agent.mjs [--port 9876] [--channels mysql2:query,express:request]
 *
 * Or connect to a remote process:
 *   node live-agent.mjs --connect <pid> [--port 9876]
 */

import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import diagnostics_channel from 'node:diagnostics_channel';
import v8 from 'node:v8';
import inspector from 'node:inspector';
import process from 'node:process';

// Try to load ws, show helpful message if missing
let WebSocketServer;
try {
  const ws = await import('ws');
  WebSocketServer = ws.WebSocketServer;
} catch {
  console.error('Missing dependency: "ws". Install it with:');
  console.error('  cd server && npm install');
  process.exit(1);
}

// ─── CLI args ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);

function getArgValue(names) {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    for (const name of names) {
      if (arg === name && args[i + 1] != null) return args[i + 1];
      if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
    }
  }
  return null;
}

const PORT = parseInt(getArgValue(['--port', '-p']) ?? '9876', 10);
const CONNECT_PID = parseInt(getArgValue(['--connect']) ?? '0', 10);
const CHANNELS = (getArgValue(['--channels']) ?? '')
  .split(',').filter(Boolean);

const DEFAULT_CHANNELS = [
  'mysql2:query',
  'ioredis:command',
  'redis:command',
  'pg:query',
  'express:request',
  'express:response',
  'kafkajs:producer',
  'kafkajs:consumer',
  'undici:request',
  'mongodb:command',
];

const channelsToWatch = CHANNELS.length > 0 ? CHANNELS : DEFAULT_CHANNELS;

// ─── State ──────────────────────────────────────────────────────────────────
let wss = null;
let activeSubscriptions = [];
let tracingActive = false;
let cpuProfileSession = null;
let memoryInterval = null;
let gcHandler = null;
let leakDetectorInterval = null;
let leakConfig = null;
const leakHistory = [];

// ─── HTTP Health Endpoint ───────────────────────────────────────────────────
const STARTED_AT = Date.now();

function healthPayload() {
  return {
    name: 'nodeverdict-live-agent',
    version: '1.1.0',
    pid: process.pid,
    uptime: process.uptime(),
    startedAt: STARTED_AT,
    nodeVersion: process.version,
    channels: channelsToWatch,
    features: ['tracing', 'heap-snapshot', 'cpu-profile', 'memory-polling', 'gc-events', 'alerts', 'flame-stream'],
    ws: `ws://localhost:${PORT}`,
  };
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
}

function handleHttp(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(healthPayload()));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ name: 'nodeverdict-live-agent', health: '/health' }));
}

// ─── WebSocket Server ───────────────────────────────────────────────────────
function startServer(port) {
  const server = createServer(handleHttp);
  wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    console.log('[agent] Client connected');
    send(ws, { type: 'hello', agent: 'nodeverdict-live-agent', version: 1, pid: process.pid });
    send(ws, { type: 'status', message: `Connected to NodeVerdict agent (PID ${process.pid})` });
    send(ws, { type: 'status', message: `Available channels: ${channelsToWatch.join(', ')}` });
    send(ws, { type: 'memory-usage', data: getMemoryUsage() });

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        send(ws, { type: 'error', message: 'Invalid JSON' });
        return;
      }

      handleCommand(ws, msg);
    });

    ws.on('close', () => {
      console.log('[agent] Client disconnected');
      if (tracingActive) stopTracing();
      if (memoryInterval) clearInterval(memoryInterval);
      if (leakConfig) stopLeakDetector();
      if (flameSession) stopFlameStream();
      stopGcListener();
    });
  });

  server.listen(port, () => {
    console.log(`\n  ╔══════════════════════════════════════════════╗`);
    console.log(`  ║     NodeVerdict Live Agent is running       ║`);
    console.log(`  ╠══════════════════════════════════════════════╣`);
    console.log(`  ║  PID: ${String(process.pid).padEnd(40)}║`);
    console.log(`  ║  WebSocket: ws://localhost:${String(port).padEnd(30)}║`);
    console.log(`  ║  Channels: ${channelsToWatch.length} subscribed                ║`);
    console.log(`  ╚══════════════════════════════════════════════╝\n`);
    console.log(`  Open NodeVerdict → Live Monitor → connect to ws://localhost:${port}`);
    console.log('');
  });

  return server;
}

function send(ws, msg) {
  if (ws.readyState === 1) { // WebSocket.OPEN
    ws.send(JSON.stringify(msg));
  }
}

function broadcast(msg) {
  if (!wss) return;
  const data = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(data);
    }
  }
}

// ─── Commands ───────────────────────────────────────────────────────────────
function handleCommand(ws, msg) {
  switch (msg.command) {
    case 'start-tracing':
      startTracing(ws);
      break;
    case 'stop-tracing':
      stopTracing();
      send(ws, { type: 'status', message: 'Tracing stopped' });
      break;
    case 'start-gc':
      installGcListener(ws);
      break;
    case 'stop-gc':
      stopGcListener();
      send(ws, { type: 'status', message: 'GC event capture stopped' });
      break;
    case 'start-flame-stream':
      startFlameStream(ws, msg);
      break;
    case 'stop-flame-stream':
      stopFlameStream(ws);
      break;
    case 'start-leak-detector':
      startLeakDetector(ws, msg);
      break;
    case 'stop-leak-detector':
      stopLeakDetector(ws);
      break;
    case 'take-heap-snapshot':
      takeHeapSnapshot(ws);
      break;
    case 'start-cpu-profile':
      startCpuProfile(ws);
      break;
    case 'stop-cpu-profile':
      stopCpuProfile(ws);
      break;
    case 'get-memory-usage':
      send(ws, { type: 'memory-usage', data: getMemoryUsage() });
      break;
    case 'start-memory-polling':
      if (memoryInterval) clearInterval(memoryInterval);
      const interval = msg.interval ?? 1000;
      memoryInterval = setInterval(() => {
        broadcast({ type: 'memory-usage', data: getMemoryUsage() });
      }, interval);
      send(ws, { type: 'status', message: `Memory polling started (every ${interval}ms)` });
      break;
    case 'stop-memory-polling':
      if (memoryInterval) {
        clearInterval(memoryInterval);
        memoryInterval = null;
      }
      send(ws, { type: 'status', message: 'Memory polling stopped' });
      break;
    default:
      send(ws, { type: 'error', message: `Unknown command: ${msg.command}` });
  }
}

// ─── Diagnostics Channel Tracing ────────────────────────────────────────────
function startTracing(ws) {
  if (tracingActive) {
    send(ws, { type: 'status', message: 'Tracing already active' });
    return;
  }

  tracingActive = true;
  let eventCount = 0;

  for (const channelName of channelsToWatch) {
    try {
      const ch = diagnostics_channel.channel(channelName);
      if (!ch || !ch.hasSubscribers) {
        // Channel exists but may not have subscribers yet - subscribe anyway
      }

      const handler = (event) => {
        eventCount++;
        broadcast({
          type: 'event',
          data: {
            channel: channelName,
            eventType: event?.name ?? 'message',
            timestamp: Date.now(),
            context: safeSerialize(event),
          },
        });
      };

      diagnostics_channel.subscribe(channelName, handler);
      activeSubscriptions.push({ channelName, handler });
    } catch (err) {
      send(ws, { type: 'error', message: `Failed to subscribe to ${channelName}: ${err.message}` });
    }
  }

  send(ws, { type: 'status', message: `Tracing started on ${activeSubscriptions.length} channels` });
  console.log(`[agent] Tracing started on ${activeSubscriptions.length} channels`);
}

function stopTracing() {
  for (const { channelName, handler } of activeSubscriptions) {
    try {
      diagnostics_channel.unsubscribe(channelName, handler);
    } catch {}
  }
  activeSubscriptions = [];
  tracingActive = false;
  console.log('[agent] Tracing stopped');
}

// ─── Heap Snapshot ──────────────────────────────────────────────────────────
function takeHeapSnapshot(ws) {
  send(ws, { type: 'status', message: 'Taking heap snapshot...' });

  try {
    const snapshot = v8.getHeapSnapshot();
    const chunks = [];

    snapshot.on('data', (chunk) => chunks.push(chunk));
    snapshot.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      // Send in chunks to avoid WebSocket message size limits
      const CHUNK_SIZE = 1024 * 512; // 512KB chunks
      const totalChunks = Math.ceil(raw.length / CHUNK_SIZE);

      for (let i = 0; i < totalChunks; i++) {
        const chunk = raw.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        send(ws, {
          type: 'heap-snapshot-chunk',
          index: i,
          total: totalChunks,
          data: chunk,
        });
      }

      send(ws, { type: 'status', message: `Heap snapshot complete (${(raw.length / 1024 / 1024).toFixed(1)} MB, ${totalChunks} chunks)` });
      console.log(`[agent] Heap snapshot sent (${(raw.length / 1024 / 1024).toFixed(1)} MB)`);
    });
  } catch (err) {
    send(ws, { type: 'error', message: `Heap snapshot failed: ${err.message}` });
  }
}

// ─── CPU Profiling ──────────────────────────────────────────────────────────
function startCpuProfile(ws) {
  if (cpuProfileSession) {
    send(ws, { type: 'status', message: 'CPU profiling already in progress' });
    return;
  }

  try {
    cpuProfileSession = new inspector.Session();
    cpuProfileSession.connect();
    cpuProfileSession.post('Profiler.enable');
    cpuProfileSession.post('Profiler.start');
    send(ws, { type: 'status', message: 'CPU profiling started' });
    console.log('[agent] CPU profiling started');
  } catch (err) {
    send(ws, { type: 'error', message: `Failed to start CPU profiling: ${err.message}` });
    cpuProfileSession = null;
  }
}

function stopCpuProfile(ws) {
  if (!cpuProfileSession) {
    send(ws, { type: 'status', message: 'No active CPU profile' });
    return;
  }

  cpuProfileSession.post('Profiler.stop', (err, data) => {
    if (err) {
      send(ws, { type: 'error', message: `Failed to stop CPU profile: ${err.message}` });
      return;
    }

    try {
      cpuProfileSession.post('Profiler.disable');
      cpuProfileSession.disconnect();
    } catch {}

    const profile = data.profile;
    // Add timing info
    const startTime = profile.startTime ?? 0;
    const endTime = profile.endTime ?? 0;
    const duration = (endTime - startTime) / 1000; // microseconds to ms

    // Send in chunks
    const raw = JSON.stringify(profile);
    const CHUNK_SIZE = 1024 * 512;
    const totalChunks = Math.ceil(raw.length / CHUNK_SIZE);

    for (let i = 0; i < totalChunks; i++) {
      const chunk = raw.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
      send(ws, {
        type: 'cpu-profile-chunk',
        index: i,
        total: totalChunks,
        data: chunk,
      });
    }

    send(ws, { type: 'status', message: `CPU profile complete (${duration.toFixed(0)}ms recording, ${(raw.length / 1024).toFixed(1)} KB, ${totalChunks} chunks)` });
    console.log(`[agent] CPU profile sent (${duration.toFixed(0)}ms, ${(raw.length / 1024).toFixed(1)} KB)`);
    cpuProfileSession = null;
  });
}

// ─── Flame Stream (real-time flame graph push) ──────────────────────────────
let flameSession = null;
let flameWindowIndex = 0;

function buildFlameTree(profile) {
  const nodeMap = new Map();
  for (const node of profile.nodes ?? []) nodeMap.set(node.id, node);

  const nodeCount = new Map();
  for (const sid of profile.samples ?? []) nodeCount.set(sid, (nodeCount.get(sid) ?? 0) + 1);

  const totalTime = (profile.timeDeltas?.length ?? 0) > 0
    ? profile.timeDeltas.reduce((a, b) => a + b, 0) / 1000
    : ((profile.endTime ?? 0) - (profile.startTime ?? 0));

  const parentMap = new Map();
  for (const node of profile.nodes ?? []) {
    for (const childId of node.children ?? []) parentMap.set(childId, node.id);
  }

  const rootIds = (profile.nodes ?? []).filter(n => !parentMap.has(n.id)).map(n => n.id);
  const sampleLen = (profile.samples ?? []).length;

  function buildFrame(nodeId, depth) {
    const node = nodeMap.get(nodeId);
    const count = nodeCount.get(nodeId) ?? 0;
    const value = sampleLen > 0 ? (count / sampleLen) * totalTime : count;
    const frame = {
      name: node?.callFrame?.functionName ?? '(anonymous)',
      url: node?.callFrame?.url ?? '',
      line: node?.callFrame?.lineNumber ?? 0,
      col: node?.callFrame?.columnNumber ?? 0,
      value,
      children: [],
      nodeId,
      depth,
    };
    if (node) {
      for (const childId of node.children ?? []) {
        if ((nodeCount.get(childId) ?? 0) > 0) {
          frame.children.push(buildFrame(childId, depth + 1));
        }
      }
    }
    return frame;
  }

  return {
    name: '(root)',
    url: '',
    line: 0,
    col: 0,
    value: totalTime,
    children: rootIds.map(id => buildFrame(id, 1)),
    nodeId: 0,
    depth: 0,
  };
}

function startFlameStream(ws, config) {
  if (flameSession) {
    send(ws, { type: 'status', message: 'Flame stream already active' });
    return;
  }

  const windowMs = Math.min(60000, Math.max(500, Number(config?.windowMs) || 3000));
  const sampleInterval = Math.min(5000, Math.max(100, Number(config?.sampleInterval) || 1000));
  flameWindowIndex = 0;

  function runWindow() {
    const profiler = new inspector.Session();
    profiler.connect();
    profiler.post('Profiler.enable');
    profiler.post('Profiler.setSamplingInterval', { interval: sampleInterval });
    profiler.post('Profiler.start', (err) => {
      if (err) {
        send(ws, { type: 'error', message: `Flame stream: ${err.message}` });
        stopFlameStream();
        return;
      }
      setTimeout(() => {
        profiler.post('Profiler.stop', (stopErr, data) => {
          try { profiler.post('Profiler.disable'); profiler.disconnect(); } catch {}
          if (stopErr) {
            send(ws, { type: 'error', message: `Flame stream: ${stopErr.message}` });
            stopFlameStream();
            return;
          }
          const profile = data?.profile;
          if (!profile) {
            stopFlameStream();
            return;
          }
          const tree = buildFlameTree(profile);
          const totalTimeMs = (profile.timeDeltas?.length ?? 0) > 0
            ? profile.timeDeltas.reduce((a, b) => a + b, 0) / 1000
            : 0;
          broadcast({
            type: 'flame-stream',
            data: {
              windowIndex: flameWindowIndex,
              sampleCount: profile.samples?.length ?? 0,
              totalTimeMs,
              windowMs,
              flameTree: tree,
              timestamp: Date.now(),
            },
          });
          flameWindowIndex++;
          if (flameSession) runWindow();
        });
      }, windowMs);
    });
  }

  flameSession = { active: true };
  runWindow();
  send(ws, {
    type: 'status',
    message: `Flame stream started (window ${windowMs}ms, sampling ${sampleInterval}µs)`,
  });
  console.log(`[agent] Flame stream started (window ${windowMs}ms, sampling ${sampleInterval}µs)`);
}

function stopFlameStream(ws) {
  flameSession = null;
  if (ws) send(ws, { type: 'status', message: 'Flame stream stopped' });
  console.log('[agent] Flame stream stopped');
}

// ─── GC Events ──────────────────────────────────────────────────────────────
const GC_KIND_NAMES = {
  0: 'Scavenge',
  1: 'Minor Mark-Compact',
  2: 'Mark-Sweep-Compact',
  3: 'Incremental Marking',
  4: 'Process WeakCallbacks',
  5: 'Minor Mark-Trace',
  6: 'Concurrent Marking',
};

function gcKindLabel(kind) {
  if (typeof kind === 'number') return GC_KIND_NAMES[kind] ?? `GC#${kind}`;
  if (typeof kind === 'string' && kind.trim()) return kind;
  return 'GC';
}

let gcInferenceInterval = null;
let lastGcSample = null;
let gcCount = 0;
let gcChurnWindow = [];

function emitGcEvent(payload) {
  const heap = v8.getHeapStatistics();
  const mem = process.memoryUsage();
  broadcast({
    type: 'gc-event',
    data: {
      kind: payload.kind ?? 'GC',
      durationMs: payload.durationMs ?? 0,
      reclaimedMb: payload.reclaimedMb ?? 0,
      intervalMs: payload.intervalMs ?? 0,
      rss: mem.rss,
      heapUsed: heap.used_heap_size,
      heapTotal: heap.total_heap_size,
      heapLimit: heap.heap_size_limit,
      timestamp: Date.now(),
    },
  });
  if (leakConfig) {
    leakHistory.push({ time: Date.now(), heapUsed: heap.used_heap_size });
    while (leakHistory.length > (leakConfig.samples ?? 20)) leakHistory.shift();
    evaluateLeakTrend();
  }
}

function installGcListener(ws) {
  if (gcHandler) return;
  // 1) Precise GC events when the runtime publishes them (some Node versions).
  gcHandler = (message) => {
    const entry = message?.performanceEntry ?? message ?? {};
    const kind = gcKindLabel(entry.kind ?? message?.kind ?? message?.type);
    const durationMs = typeof entry.duration === 'number' ? entry.duration
      : typeof message?.duration === 'number' ? message.duration : 0;
    emitGcEvent({ kind, durationMs });
  };
  try {
    diagnostics_channel.subscribe('node:v8.gc', gcHandler);
    send(ws, { type: 'status', message: 'GC event capture started (node:v8.gc)' });
    console.log('[agent] GC event capture started (node:v8.gc)');
  } catch (err) {
    send(ws, { type: 'error', message: `Failed to subscribe to GC events: ${err.message}` });
  }

  // 2) Inferred GC events from heap sampling — works on every runtime. A heapUsed
  //    drop between samples signals a collection; reclaimed bytes = drop size.
  if (gcInferenceInterval) clearInterval(gcInferenceInterval);
  gcInferenceInterval = setInterval(() => {
    const now = Date.now();
    const heapUsed = v8.getHeapStatistics().used_heap_size;
    if (lastGcSample && lastGcSample.heapUsed > 0) {
      const drop = lastGcSample.heapUsed - heapUsed;
      const interval = now - lastGcSample.time;
      if (drop > 1024 * 1024) {
        gcCount++;
        emitGcEvent({
          kind: 'inferred',
          reclaimedMb: drop / (1024 * 1024),
          intervalMs: interval,
          durationMs: 0,
        });
        gcChurnWindow.push({ time: now, reclaimedMb: drop / (1024 * 1024) });
        gcChurnWindow = gcChurnWindow.filter(e => now - e.time < 10_000);
        evaluateGcPressure();
      }
    }
    lastGcSample = { time: now, heapUsed };
  }, 500);
}

function stopGcListener() {
  if (gcHandler) {
    try { diagnostics_channel.unsubscribe('node:v8.gc', gcHandler); } catch {}
    gcHandler = null;
  }
  if (gcInferenceInterval) {
    clearInterval(gcInferenceInterval);
    gcInferenceInterval = null;
  }
  lastGcSample = null;
  gcChurnWindow = [];
}

// Alerts when collections reclaim a large amount repeatedly within 10s (churn).
let gcPressureCount = 0;
function evaluateGcPressure() {
  const windowMb = gcChurnWindow.reduce((acc, e) => acc + e.reclaimedMb, 0);
  if (windowMb > 64) {
    gcPressureCount++;
    if (gcPressureCount % 5 === 0) {
      const mbPerSec = windowMb / 10;
      broadcast({
        type: 'alert',
        data: {
          id: `gc-${Date.now()}`,
          level: 'warning',
          metric: 'gcChurnRate',
          value: mbPerSec,
          threshold: 6.4,
          message: `High GC pressure: ${windowMb.toFixed(0)} MB reclaimed in 10s (${mbPerSec.toFixed(1)} MB/s) — likely allocation churn`,
          source: 'gc-detector',
          timestamp: Date.now(),
        },
      });
      console.log(`[agent] WARNING: ${windowMb.toFixed(0)} MB reclaimed in 10s`);
    }
  } else {
    gcPressureCount = 0;
  }
}

// ─── Memory Leak Detector ───────────────────────────────────────────────────
function startLeakDetector(ws, config) {
  leakConfig = {
    rateBps: Number(config?.rateBps) || 2 * 1024 * 1024,
    heapPercent: Number(config?.heapPercent) || 90,
    samples: Number(config?.samples) || 20,
    sustained: Number(config?.sustained) || 3,
    intervalMs: Number(config?.intervalMs) || 2000,
    checkIntervalMs: Number(config?.checkIntervalMs) || 2000,
  };
  leakHistory.length = 0;

  if (leakDetectorInterval) clearInterval(leakDetectorInterval);
  leakDetectorInterval = setInterval(() => {
    const heap = v8.getHeapStatistics();
    leakHistory.push({ time: Date.now(), heapUsed: heap.used_heap_size });
    while (leakHistory.length > leakConfig.samples) leakHistory.shift();
    evaluateLeakTrend();
  }, leakConfig.checkIntervalMs);

  send(ws, {
    type: 'status',
    message: `Leak detector started (rate > ${(leakConfig.rateBps / 1024 / 1024).toFixed(1)} MB/s or heap > ${leakConfig.heapPercent}%)`,
  });
  console.log(`[agent] Leak detector started (rate > ${(leakConfig.rateBps / 1024 / 1024).toFixed(1)} MB/s or heap > ${leakConfig.heapPercent}%)`);
}

function stopLeakDetector(ws) {
  if (leakDetectorInterval) {
    clearInterval(leakDetectorInterval);
    leakDetectorInterval = null;
  }
  leakConfig = null;
  leakHistory.length = 0;
  if (ws) send(ws, { type: 'status', message: 'Leak detector stopped' });
  console.log('[agent] Leak detector stopped');
}

let leakSustained = 0;
function evaluateLeakTrend() {
  if (!leakConfig || leakHistory.length < 2) return;
  const points = leakHistory.slice();
  const heap = v8.getHeapStatistics();
  const heapUsedPercent = (heap.used_heap_size / heap.heap_size_limit) * 100;

  // Linear regression on post-GC / sampled heapUsed → live-set growth (bytes/s)
  const n = points.length;
  const t0 = points[0].time;
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (const p of points) {
    const x = (p.time - t0) / 1000;
    const y = p.heapUsed;
    sx += x; sy += y; sxy += x * y; sxx += x * x;
  }
  const denom = n * sxx - sx * sx;
  const slope = denom === 0 ? 0 : (n * sxy - sx * sy) / denom;

  const ratePerSec = Math.max(slope, 0);
  const sustainedNeeded = leakConfig.sustained;

  if (ratePerSec > leakConfig.rateBps || heapUsedPercent > leakConfig.heapPercent) {
    leakSustained++;
    if (leakSustained >= sustainedNeeded && leakSustained % sustainedNeeded === 0) {
      const isRate = ratePerSec > leakConfig.rateBps;
      const level = isRate ? 'critical' : 'warning';
      const metric = isRate ? 'heapGrowthRate' : 'heapUsedPercent';
      const value = isRate ? ratePerSec / (1024 * 1024) : heapUsedPercent;
      const threshold = isRate ? leakConfig.rateBps / (1024 * 1024) : leakConfig.heapPercent;
      const message = isRate
        ? `Suspected memory leak: live set growing ${(value).toFixed(1)} MB/s (threshold ${(threshold).toFixed(1)} MB/s)`
        : `Heap usage critical: ${value.toFixed(1)}% of limit (threshold ${threshold.toFixed(1)}%)`;
      broadcast({
        type: 'alert',
        data: {
          id: `leak-${Date.now()}`,
          level,
          metric,
          value,
          threshold,
          message,
          source: 'leak-detector',
          timestamp: Date.now(),
        },
      });
      console.log(`[agent] ${level.toUpperCase()}: ${message}`);
    }
  } else {
    leakSustained = 0;
  }
}

// ─── Memory Usage ───────────────────────────────────────────────────────────
function getMemoryUsage() {
  const mem = process.memoryUsage();
  return {
    timestamp: Date.now(),
    rss: mem.rss,
    heapTotal: mem.heapTotal,
    heapUsed: mem.heapUsed,
    external: mem.external,
    arrayBuffers: mem.arrayBuffers ?? 0,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function safeSerialize(obj) {
  try {
    // Handle circular references and large objects
    const seen = new WeakSet();
    return JSON.parse(JSON.stringify(obj, (key, value) => {
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) return '[Circular]';
        seen.add(value);
      }
      if (typeof value === 'bigint') return value.toString();
      if (value instanceof Buffer) return `[Buffer ${value.length}]`;
      if (value instanceof Error) return { message: value.message, stack: value.stack };
      return value;
    }));
  } catch {
    return { serializationError: 'Failed to serialize' };
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────
console.log('');
console.log('  ╔══════════════════════════════════════════════╗');
console.log('  ║       NodeVerdict Live Agent v1.1          ║');
console.log('  ╚══════════════════════════════════════════════╝');
console.log('');

startServer(PORT);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[agent] Shutting down...');
  if (tracingActive) stopTracing();
  if (memoryInterval) clearInterval(memoryInterval);
  if (leakConfig) stopLeakDetector();
  if (flameSession) stopFlameStream();
  stopGcListener();
  if (cpuProfileSession) {
    try { cpuProfileSession.post('Profiler.disable'); cpuProfileSession.disconnect(); } catch {}
  }
  process.exit(0);
});

process.on('SIGTERM', () => {
  process.exit(0);
});