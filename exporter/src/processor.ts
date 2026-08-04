import type { ReadableSpan, SpanProcessor, SpanExporter } from '@opentelemetry/sdk-trace-base';
import type { ExportResult } from '@opentelemetry/core';
import { spansToNodeVerdictEvents, type TracingEvent } from './spans';

export interface NodeVerdictExportCallback {
  onExport: (events: TracingEvent[]) => void | Promise<void>;
}

/**
 * A SpanProcessor that converts completed OTel spans into NodeVerdict TracingEvents
 * and forwards them to a callback. Flushes on every span by default for streaming;
 * pass a batchSize to buffer and a flushIntervalMs to drain periodically.
 */
export class NodeVerdictSpanProcessor implements SpanProcessor {
  private batch: TracingEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly cb: NodeVerdictExportCallback,
    private readonly batchSize: number = 1,
    private readonly flushIntervalMs: number = 1000,
  ) {
    if (this.flushIntervalMs > 0) {
      this.timer = setInterval(() => { void this.flush(); }, this.flushIntervalMs);
      this.timer.unref?.();
    }
  }

  onStart(): void {}

  onEnd(span: ReadableSpan): void {
    const events = spansToNodeVerdictEvents([span]);
    this.batch.push(...events);
    if (this.batch.length >= this.batchSize) {
      void this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.batch.length === 0) return;
    const events = this.batch;
    this.batch = [];
    await this.cb.onExport(events);
  }

  async shutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.flush();
  }

  async forceFlush(): Promise<void> {
    await this.flush();
  }
}

/**
 * A batch SpanExporter (compatible with BatchSpanProcessor / SimpleSpanProcessor)
 * that converts exported OTel spans into NodeVerdict TracingEvents.
 */
export class NodeVerdictExporter implements SpanExporter {
  constructor(private readonly cb: NodeVerdictExportCallback) {}

  async export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): Promise<void> {
    try {
      await this.cb.onExport(spansToNodeVerdictEvents(spans));
      resultCallback({ code: 0 });
    } catch (err) {
      resultCallback({ code: 1, error: err as Error });
    }
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}
