export type AlertMetric = 'heapUsedPercent' | 'externalMemory' | 'heapGrowthRate' | 'rssGrowthRate' | 'errorRate' | 'eventRate';

export type AlertOperator = 'greaterThan' | 'lessThan' | 'greaterThanOrEqual' | 'lessThanOrEqual';

export type AlertLevel = 'info' | 'warning' | 'critical';

export interface AlertRule {
  id: string;
  name: string;
  metric: AlertMetric;
  operator: AlertOperator;
  threshold: number;
  level: AlertLevel;
  enabled: boolean;
  createdAt: number;
}

export interface FiredAlert {
  ruleId: string;
  ruleName: string;
  metric: AlertMetric;
  value: number;
  threshold: number;
  level: AlertLevel;
  timestamp: number;
  message: string;
}

export interface MetricSnapshot {
  heapUsedPercent: number;
  externalMemory: number;  // MB
  heapGrowthRate: number;  // MB/s
  rssGrowthRate: number;   // MB/s
  errorRate: number;       // %
  eventRate: number;       // events/sec
}
