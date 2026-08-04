import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { NodeVerdictSpanProcessor, type NodeVerdictExportCallback } from './processor';
import { spansToNodeVerdictEvents, eventsToJson, eventsToOtlpJson } from './spans';
import type { TracingEvent } from './spans';

export { NodeVerdictSpanProcessor, NodeVerdictExporter } from './processor';
export type { NodeVerdictExportCallback } from './processor';
export { spansToNodeVerdictEvents, eventsToJson, eventsToOtlpJson } from './spans';
export type { TracingEvent } from './spans';

export interface StartOptions {
  serviceName: string;
  /** Called with NodeVerdict TracingEvent[] whenever spans are exported. */
  onExport: NodeVerdictExportCallback['onExport'];
  /** Optional callbacks for JSON / OTLP/JSON line output. */
  format?: 'events' | 'otlp';
}

/**
 * One-liner: registers a NodeVerdict span processor on a NodeTracerProvider and
 * makes it the global tracer provider. All instrumented spans are streamed to
 * `onExport` as NodeVerdict TracingEvent[].
 */
export function startNodeVerdict(opts: StartOptions): NodeTracerProvider {
  const provider = new NodeTracerProvider({
    resource: new Resource({ [ATTR_SERVICE_NAME]: opts.serviceName }),
  });

  provider.addSpanProcessor(new NodeVerdictSpanProcessor({ onExport: opts.onExport }));

  if (opts.format === 'otlp') {
    provider.addSpanProcessor(
      new NodeVerdictSpanProcessor({
        onExport: (events: TracingEvent[]) => {
          console.log(eventsToOtlpJson(events, opts.serviceName));
        },
      }),
    );
  }

  provider.register();
  return provider;
}
