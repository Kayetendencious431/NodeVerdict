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
const PORT = parseInt(args.find(a => a.startsWith('--port='))?.split('=')[1] ?? '9876', 10);
const CONNECT_PID = parseInt(args.find(a => a.startsWith('--connect='))?.split('=')[1] ?? '0', 10);
const CHANNELS = (args.find(a => a.startsWith('--channels='))?.split('=')[1] ?? '')
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

// ─── WebSocket Server ───────────────────────────────────────────────────────
function startServer(port) {
  const server = createServer();
  wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    console.log('[agent] Client connected');
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
console.log('  ║       NodeVerdict Live Agent v1.0           ║');
console.log('  ╚══════════════════════════════════════════════╝');
console.log('');

startServer(PORT);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[agent] Shutting down...');
  if (tracingActive) stopTracing();
  if (memoryInterval) clearInterval(memoryInterval);
  if (cpuProfileSession) {
    try { cpuProfileSession.post('Profiler.disable'); cpuProfileSession.disconnect(); } catch {}
  }
  process.exit(0);
});

process.on('SIGTERM', () => {
  process.exit(0);
});