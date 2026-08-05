import type { TracingEvent } from '../types';

export interface ValidationResult {
  channel: string;
  valid: boolean;
  issues: ValidationIssue[];
}

export interface ValidationIssue {
  severity: 'error' | 'warning' | 'info';
  category: 'naming' | 'required-field' | 'pairing' | 'compatibility';
  message: string;
  event?: TracingEvent;
}

/**
 * Validate TracingChannel events against spec conventions.
 */
export function validateEvents(events: TracingEvent[]): ValidationResult[] {
  const results = new Map<string, ValidationResult>();

  for (const event of events) {
    if (!results.has(event.channel)) {
      results.set(event.channel, { channel: event.channel, valid: true, issues: [] });
    }
    const result = results.get(event.channel)!;

    // 1. Naming convention check
    const namingIssue = checkNaming(event);
    if (namingIssue) result.issues.push(namingIssue);

    // 2. Required fields check
    const fieldIssues = checkRequiredFields(event);
    for (const issue of fieldIssues) result.issues.push(issue);

    // 3. Compatibility check
    const compatIssue = checkCompatibility(event);
    if (compatIssue) result.issues.push(compatIssue);
  }

  // 4. Pairing check (cross-event)
  const pairingIssues = checkPairing(events);
  for (const [channel, issues] of pairingIssues) {
    if (!results.has(channel)) {
      results.set(channel, { channel, valid: true, issues: [] });
    }
    for (const issue of issues) results.get(channel)!.issues.push(issue);
  }

  // Mark validity
  for (const result of results.values()) {
    result.valid = result.issues.every(i => i.severity !== 'error');
  }

  return Array.from(results.values());
}

const CHANNEL_PATTERN = /^[a-z0-9_-]+(\/[a-z0-9_-]+)?:[a-z0-9_.-]+$/;

function checkNaming(event: TracingEvent): ValidationIssue | null {
  if (!CHANNEL_PATTERN.test(event.channel)) {
    return {
      severity: 'warning',
      category: 'naming',
      message: `Channel "${event.channel}" does not follow "{package}:{operation}" naming convention`,
      event,
    };
  }
  return null;
}

function checkRequiredFields(event: TracingEvent): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (event.timestamp == null) {
    issues.push({
      severity: 'error',
      category: 'required-field',
      message: 'Missing required field: timestamp',
      event,
    });
  }

  if (!event.eventType) {
    issues.push({
      severity: 'error',
      category: 'required-field',
      message: 'Missing required field: eventType',
      event,
    });
  }

  // Check for database-specific context fields
  if (event.channel.startsWith('mysql2:') || event.channel.startsWith('pg:') || event.channel.startsWith('redis:')) {
    if (!event.context || Object.keys(event.context).length === 0) {
      issues.push({
        severity: 'warning',
        category: 'required-field',
        message: `Database channel "${event.channel}" should include context fields (query, server.address, etc.)`,
        event,
      });
    }
  }

  return issues;
}

function checkCompatibility(_event: TracingEvent): ValidationIssue | null {
  // Future: Check against OpenTelemetry semantic conventions
  return null;
}

function checkPairing(events: TracingEvent[]): Map<string, ValidationIssue[]> {
  const issues = new Map<string, ValidationIssue[]>();
  const startCounts = new Map<string, number>();
  const endCounts = new Map<string, number>();
  const asyncStartCounts = new Map<string, number>();
  const asyncEndCounts = new Map<string, number>();

  for (const event of events) {
    const key = event.operationId ?? `${event.channel}:${event.timestamp}`;
    if (event.eventType === 'start') startCounts.set(key, (startCounts.get(key) ?? 0) + 1);
    if (event.eventType === 'end' || event.eventType === 'error') endCounts.set(key, (endCounts.get(key) ?? 0) + 1);
    if (event.eventType === 'asyncStart') asyncStartCounts.set(key, (asyncStartCounts.get(key) ?? 0) + 1);
    if (event.eventType === 'asyncEnd') asyncEndCounts.set(key, (asyncEndCounts.get(key) ?? 0) + 1);
  }

  for (const [key, count] of startCounts) {
    const endCount = endCounts.get(key) ?? 0;
    if (count !== endCount) {
      const channel = key.includes(':') ? key.split(':')[0] : 'unknown';
      const list = issues.get(channel) ?? [];
      list.push({
        severity: 'warning',
        category: 'pairing',
        message: `Operation "${key}" has ${count} start event(s) but ${endCount} end/error event(s)`,
      });
      issues.set(channel, list);
    }
  }

  for (const [key, count] of asyncStartCounts) {
    const asyncEndCount = asyncEndCounts.get(key) ?? 0;
    if (count !== asyncEndCount) {
      const channel = key.includes(':') ? key.split(':')[0] : 'unknown';
      const list = issues.get(channel) ?? [];
      list.push({
        severity: 'info',
        category: 'pairing',
        message: `Operation "${key}" has ${count} asyncStart event(s) but ${asyncEndCount} asyncEnd event(s)`,
      });
      issues.set(channel, list);
    }
  }

  return issues;
}