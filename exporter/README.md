# nodeverdict-exporter

OpenTelemetry exporter for [NodeVerdict](../README.md). Convert OpenTelemetry spans
in your Node.js service into NodeVerdict's native `TracingEvent[]` format and stream
them straight into the browser viewer — no Jaeger or tracing backend required.

## Install

```bash
npm install nodeverdict-exporter
```

Requires your app to already use OpenTelemetry instrumentation (e.g.
`@opentelemetry/instrumentation-http`, `@opentelemetry/instrumentation-mysql2`).

## Quick start

```ts
import { startNodeVerdict } from 'nodeverdict-exporter';

startNodeVerdict({
  serviceName: 'api',
  onExport: (events) => {
    // Send events to your local NodeVerdict browser viewer.
    // Example: POST them to a small endpoint your viewer reads from,
    // or write to a file that you then open in the Trace Viewer.
    console.log(JSON.stringify(events));
  },
});
```

All instrumented spans are converted to `start`/`end`/`error` event pairs and
forwarded to `onExport` as they complete (streaming). Open the output in any
NodeVerdict page: **Trace Viewer**, **Event Viewer**, **Validator**, **AI Root Cause**,
or run it through the `node-verdict check` performance gate.

## Output formats

The SDK always gives you `TracingEvent[]`. Two serializers are provided to hand
that data to the viewer:

```ts
import { spansToNodeVerdictEvents, eventsToJson, eventsToOtlpJson, NodeVerdictExporter } from 'nodeverdict-exporter';

// 1. Native NodeVerdict events (Trace Viewer / Event Viewer / AI-RCA):
const events = spansToNodeVerdictEvents(spanBatch);
console.log(eventsToJson(events));

// 2. OTLP/JSON export — the viewer auto-detects this and imports it directly:
console.log(eventsToOtlpJson(events, 'api'));
```

### Use as a `SpanExporter`

Works with any `SimpleSpanProcessor` / `BatchSpanProcessor`:

```ts
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeVerdictExporter } from 'nodeverdict-exporter';

const provider = new NodeTracerProvider();
provider.addSpanProcessor(new SimpleSpanProcessor(
  new NodeVerdictExporter({ onExport: (events) => {/* forward */} }),
));
provider.register();
```

### Just the processor

If you already configure your own `TracerProvider`, attach the processor directly:

```ts
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { NodeVerdictSpanProcessor } from 'nodeverdict-exporter';

const provider = new NodeTracerProvider();
provider.addSpanProcessor(new NodeVerdictSpanProcessor({
  onExport: (events) => {/* forward */},
}));
provider.register();
```

## Mapping

| OpenTelemetry | NodeVerdict |
|---|---|
| `span.name` | `event.channel` (override with attribute `nodeverdict.channel`) |
| `span.spanContext().spanId` | `event.operationId` |
| `span.startTime` / `span.endTime` | `event.timestamp` / `event.duration` |
| `span.status.code === ERROR` | `eventType: 'error'` + `event.error` |
| `span.attributes` | `event.context` |

## Building

```bash
npm install
npm run build     # bundles to dist/index.js
npm run typecheck
```

The viewer's browser tooling understands this output because it uses the exact
same `TracingEvent` model defined in `src/shared/types`.