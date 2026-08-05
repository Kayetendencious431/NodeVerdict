import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { probeBackend, backendWsUrl, backendHealthUrl } from '../src/shared/backend/detect';

let server: Server;
let port: number;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        name: 'nodeverdict-live-agent',
        version: '1.1.0',
        pid: 1234,
        uptime: 42,
        startedAt: Date.now() - 42000,
        nodeVersion: 'v22.16.0',
        channels: ['mysql2:query', 'express:request'],
        features: ['tracing', 'heap-snapshot', 'cpu-profile', 'memory-polling'],
      }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') {
        port = address.port;
      }
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('probeBackend', () => {
  it('detects an online backend via /health', async () => {
    const result = await probeBackend({ host: '127.0.0.1', port: String(port) }, 3000);
    expect(result.status).toBe('online');
    expect(result.info).not.toBeNull();
    expect(result.info?.name).toBe('nodeverdict-live-agent');
    expect(result.info?.version).toBe('1.1.0');
    expect(result.info?.features).toContain('tracing');
  });

  it('reports offline when nothing listens on the port', async () => {
    const result = await probeBackend({ host: '127.0.0.1', port: '1' }, 1000);
    expect(result.status).toBe('offline');
    expect(result.info).toBeNull();
    expect(result.error).toBeDefined();
  });

  it('times out instead of hanging', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((input: any, init?: any) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted', 'AbortError'));
        });
      })) as typeof fetch;
    try {
      const result = await probeBackend({ host: '127.0.0.1', port: String(port) }, 300);
      expect(result.status).toBe('offline');
      expect(result.info).toBeNull();
      expect(result.error).toContain('Timed out');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('builds the ws and health urls', () => {
    expect(backendWsUrl({ host: 'localhost', port: '9876' })).toBe('ws://localhost:9876');
    expect(backendHealthUrl({ host: 'localhost', port: '9876' })).toBe('http://localhost:9876/health');
  });
});
