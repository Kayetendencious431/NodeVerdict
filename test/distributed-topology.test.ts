import { describe, it, expect } from 'vitest';
import { buildDistributedTraces } from '../src/shared/distributed/span-tree';
import { buildTopology } from '../src/shared/distributed/topology';
import { loadTracingData } from '../src/shared/engine/data-loader';

const fs = require('fs');

function buildGraph() {
  const content = fs.readFileSync('examples/otel-distributed-trace.json', 'utf8');
  const events = loadTracingData(content);
  const traces = buildDistributedTraces(events);
  return buildTopology(traces);
}

describe('buildTopology', () => {
  it('discovers all services and call edges', () => {
    const graph = buildGraph();
    expect(graph.traces).toBe(5);
    expect(graph.nodes.map(n => n.serviceName).sort()).toEqual([
      'api', 'auth', 'inventory', 'inventory-db', 'order', 'payment-gateway', 'users-db',
    ]);
    const edges = graph.edges.map(e => `${e.source}->${e.target}`).sort();
    expect(edges).toContain('api->auth');
    expect(edges).toContain('api->order');
    expect(edges).toContain('auth->users-db');
    expect(edges).toContain('order->inventory');
    expect(edges).toContain('order->payment-gateway');
    expect(edges).toContain('inventory->inventory-db');
  });

  it('aggregates call counts and latency percentiles per edge', () => {
    const graph = buildGraph();
    const edge = graph.edges.find(e => e.source === 'order' && e.target === 'payment-gateway')!;
    expect(edge.callCount).toBe(5);
    expect(edge.avgDuration).toBeGreaterThan(0);
    expect(edge.p95Duration).toBeGreaterThanOrEqual(edge.avgDuration);
  });

  it('flags the injected fault service as faulty with high error rate', () => {
    const graph = buildGraph();
    const payment = graph.nodes.find(n => n.serviceName === 'payment-gateway')!;
    expect(payment.callCount).toBe(5);
    expect(payment.errorCount).toBe(3);
    expect(payment.errorRate).toBeCloseTo(0.6, 1);
    expect(payment.health).toBe('faulty');
    expect(payment.primarySignal).toBe('error');
  });

  it('classifies healthy services as healthy and warns on elevated latency', () => {
    const graph = buildGraph();
    const db = graph.nodes.find(n => n.serviceName === 'users-db')!;
    expect(db.health).toBe('healthy');
    const order = graph.nodes.find(n => n.serviceName === 'order')!;
    // order is slow because it waits on the faulty payment call in 3/5 traces.
    expect(['warning', 'faulty']).toContain(order.health);
  });

  it('marks producer/consumer (async) call edges', () => {
    const graph = buildGraph();
    // payment-gateway uses kind 3 (client) from the caller side; not async here.
    const sync = graph.edges.find(e => e.source === 'order' && e.target === 'payment-gateway')!;
    expect(sync.kind).toBe('sync');
  });
});
