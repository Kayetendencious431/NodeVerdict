import type { AlertRule, AlertMetric, MetricSnapshot, FiredAlert } from '../types/alert';
import { generateId } from '../utils/helpers';

/**
 * Evaluate all rules against a metric snapshot.
 * Returns fired alerts that meet their threshold conditions.
 */
export function evaluateAlerts(rules: AlertRule[], snapshot: MetricSnapshot, now?: number): FiredAlert[] {
  const time = now ?? Date.now();
  const fired: FiredAlert[] = [];

  for (const rule of rules) {
    if (!rule.enabled) continue;
    const value = snapshot[rule.metric];
    const didFire = compareRule(rule, value);
    if (didFire) {
      fired.push({
        ruleId: rule.id,
        ruleName: rule.name,
        metric: rule.metric,
        value,
        threshold: rule.threshold,
        level: rule.level,
        timestamp: time,
        message: buildMessage(rule, value),
      });
    }
  }
  return fired;
}

function compareRule(rule: AlertRule, value: number): boolean {
  switch (rule.operator) {
    case 'greaterThan': return value > rule.threshold;
    case 'greaterThanOrEqual': return value >= rule.threshold;
    case 'lessThan': return value < rule.threshold;
    case 'lessThanOrEqual': return value <= rule.threshold;
    default: return false;
  }
}

function buildMessage(rule: AlertRule, value: number): string {
  const metricLabel = metricLabelMap[rule.metric];
  const opLabel = operatorLabelMap[rule.operator];
  return `${metricLabel} ${opLabel} ${formatThreshold(rule.threshold, rule.metric)}. Current: ${formatThreshold(value, rule.metric)}`;
}

const metricLabelMap: Record<AlertMetric, string> = {
  heapUsedPercent: 'Heap Used %',
  externalMemory: 'External Memory',
  heapGrowthRate: 'Heap Growth Rate',
  rssGrowthRate: 'RSS Growth Rate',
  errorRate: 'Error Rate',
  eventRate: 'Event Rate',
};

const operatorLabelMap: Record<string, string> = {
  greaterThan: '>',
  greaterThanOrEqual: '>=',
  lessThan: '<',
  lessThanOrEqual: '<=',
};

function formatThreshold(value: number, metric: AlertMetric): string {
  switch (metric) {
    case 'heapUsedPercent': return `${value.toFixed(1)}%`;
    case 'externalMemory': return `${value.toFixed(1)} MB`;
    case 'heapGrowthRate': return `${value.toFixed(2)} MB/s`;
    case 'rssGrowthRate': return `${value.toFixed(2)} MB/s`;
    case 'errorRate': return `${value.toFixed(1)}%`;
    case 'eventRate': return `${value.toFixed(0)} evt/s`;
    default: return String(value);
  }
}

/**
 * Build a metric snapshot from Live Monitor values.
 */
export function buildMetricSnapshot(params: {
  memoryData?: { rss: number; heapTotal: number; heapUsed: number; external: number } | null;
  memoryHistory?: Array<{ time: number; rss: number; heapUsed: number; external: number }>;
  errorRate?: number;
  eventRate?: number;
}): MetricSnapshot {
  const { memoryData, memoryHistory, errorRate = 0, eventRate = 0 } = params;

  const heapUsedPercent = memoryData && memoryData.heapTotal > 0
    ? (memoryData.heapUsed / memoryData.heapTotal) * 100
    : 0;

  const externalMemory = memoryData ? memoryData.external / (1024 * 1024) : 0;

  // Compute growth rates from history (MB/s)
  let heapGrowthRate = 0;
  let rssGrowthRate = 0;
  if (memoryHistory && memoryHistory.length >= 2) {
    heapGrowthRate = computeRate(memoryHistory, d => d.heapUsed);
    rssGrowthRate = computeRate(memoryHistory, d => d.rss);
  }

  return {
    heapUsedPercent,
    externalMemory,
    heapGrowthRate,
    rssGrowthRate,
    errorRate,
    eventRate,
  };
}

function computeRate(
  history: Array<{ time: number; rss: number; heapUsed: number; external: number }>,
  selector: (d: { time: number; rss: number; heapUsed: number; external: number }) => number,
): number {
  if (history.length < 2) return 0;
  const n = Math.min(history.length, 20);
  const points = history.slice(-n);
  const t0 = points[0].time;
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (const p of points) {
    const x = (p.time - t0) / 1000; // seconds
    const y = selector(p) / (1024 * 1024); // MB
    sx += x; sy += y; sxy += x * y; sxx += x * x;
  }
  const denom = n * sxx - sx * sx;
  if (denom === 0) return 0;
  return (n * sxy - sx * sy) / denom;
}

export function defaultAlertRules(): AlertRule[] {
  return [
    {
      id: generateId('algo-'),
      name: 'Critical Heap Used',
      metric: 'heapUsedPercent',
      operator: 'greaterThan',
      threshold: 90,
      level: 'critical',
      enabled: true,
      createdAt: Date.now(),
    },
    {
      id: generateId('algo-'),
      name: 'High Error Rate',
      metric: 'errorRate',
      operator: 'greaterThan',
      threshold: 5,
      level: 'warning',
      enabled: true,
      createdAt: Date.now(),
    },
  ];
}