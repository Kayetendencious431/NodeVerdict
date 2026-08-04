import { describe, it, expect } from 'vitest';
import { analyzeDistributed } from '../src/shared/distributed';
import { loadTracingData } from '../src/shared/engine/data-loader';

const fs = require('fs');

function run() {
  const content = fs.readFileSync('examples/otel-distributed-trace.json', 'utf8');
  const events = loadTracingData(content);
  return analyzeDistributed(events);
}

describe('analyzeRootCause', () => {
  it('identifies the injected fault service (payment-gateway) as the root cause', () => {
    const { report } = run();
    expect(report.rootCause.service).toBe('payment-gateway');
    expect(report.rootCause.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it('ranks the fault service above its downstream effects', () => {
    const { report } = run();
    const paymentIdx = report.ranked.findIndex(r => r.service === 'payment-gateway');
    const orderIdx = report.ranked.findIndex(r => r.service === 'order');
    const apiIdx = report.ranked.findIndex(r => r.service === 'api');
    expect(paymentIdx).toBe(0);
    expect(orderIdx).toBeGreaterThan(paymentIdx);
    expect(apiIdx).toBeGreaterThan(paymentIdx);
  });

  it('produces a causal cascade starting at the root cause', () => {
    const { report } = run();
    expect(report.cascade.length).toBeGreaterThanOrEqual(1);
    expect(report.cascade[0].service).toBe('payment-gateway');
    const services = report.cascade.map(c => c.service);
    // api/order are downstream effects of the payment fault.
    expect(services).toContain('order');
  });

  it('finds critical paths for each trace', () => {
    const { report } = run();
    expect(report.criticalPaths).toHaveLength(5);
    const faulty = report.criticalPaths[2];
    expect(faulty.map(n => n.serviceName)).toContain('payment-gateway');
  });

  it('includes actionable recommendations mentioning the pool error', () => {
    const { report } = run();
    const joined = report.recommendations.join('\n').toLowerCase();
    expect(joined).toContain('pool');
  });

  it('exposes anomaly/blame/criticality scores on the enriched nodes', () => {
    const { graph } = run();
    const payment = graph.nodes.find(n => n.serviceName === 'payment-gateway')!;
    expect(payment.anomalyScore).toBeGreaterThan(0.5);
    expect(payment.criticality).toBeGreaterThan(0);
    expect(payment.blameScore).toBeGreaterThan(0);
  });
});
