/**
 * Node.js ecosystem best-practice knowledge base for the AI root-cause engine.
 * Each rule is grounded in documented behavior of the corresponding library.
 * The system prompt is assembled from these rules so the LLM reasons against
 * real Node.js semantics instead of generic web knowledge.
 */

export interface EcosystemRule {
  library: string;
  symptom: string;
  likelyCause: string;
  fix: string;
}

export const NODE_ECOSYSTEM_KNOWLEDGE: EcosystemRule[] = [
  {
    library: 'mysql2',
    symptom: 'mysql2:query latency spikes or timeouts under concurrency',
    likelyCause: 'Connection pool exhaustion (pool.max reached), all connections checked out without release, lock wait timeouts, or slow index scans.',
    fix: 'Raise pool.max, ensure connection.release() in finally blocks, use connectionLimit matching worker count, add indexes on WHERE/JOIN columns, enable `debug` or slow query logging.',
  },
  {
    library: 'redis / ioredis',
    symptom: 'ioredis:command or redis:command slow, blocking event loop',
    likelyCause: 'KEYS/MGET/SCAN over huge keyspace, large payloads, pipeline not used, or blocking commands (BLPOP/SUBSCRIBE) stalling the client.',
    fix: 'Use SCAN instead of KEYS, pipeline batch reads/writes, avoid large values, check maxRetriesPerRequest, ensure `lazyConnect` for pub/sub.',
  },
  {
    library: 'express',
    symptom: 'express:request high P95/P99, queuing before handler',
    likelyCause: 'Synchronous CPU work in handlers, blocking middleware (e.g. heavy JSON body parsing), or event-loop starvation from other channels.',
    fix: 'Move heavy work to worker threads, defer body parsing when possible, profile handler CPU with the CPU Profiler, check event-loop delay.',
  },
  {
    library: 'pg / postgres',
    symptom: 'pg:query slow or connection errors',
    likelyCause: 'Missing indexes, N+1 queries, connection pool saturation, or unindexed foreign-key lookups.',
    fix: 'Add indexes, batch queries, increase pool size, use prepared statements, examine EXPLAIN ANALYZE output.',
  },
  {
    library: 'kafkajs',
    symptom: 'kafkajs:producer/consumer latency or rebalances',
    likelyCause: 'Large batch sizes, slow consumer processing (no async offload), broker network latency, or frequent rebalances due to slow processing.',
    fix: 'Tune maxBytes, batch size, linger.ms; process records asynchronously; check consumer group rebalance events.',
  },
  {
    library: 'http / fetch',
    symptom: 'HTTP request latency, socket starvation',
    likelyCause: 'Keep-alive not used, connection limit (agent maxSockets) too low, DNS lookup latency, or external API slow under load.',
    fix: 'Reuse agents with keep-alive, raise maxSockets, enable connection pooling, check external service P95.',
  },
  {
    library: 'event-loop',
    symptom: 'High event loop delay even when operation durations are short',
    likelyCause: 'CPU-bound synchronous code, excessive GC pauses, or many timers/polling callbacks blocking the loop.',
    fix: 'Use the CPU Profiler to find hot functions, move parsing/serialization off-thread, reduce timer churn, check GC log for pause spikes.',
  },
];

/** Compact text used inside the system prompt (English, stable for reasoning). */
export function buildKnowledgeSection(): string {
  return NODE_ECOSYSTEM_KNOWLEDGE
    .map(r => `- ${r.library}: symptom="${r.symptom}"; likely cause="${r.likelyCause}"; fix="${r.fix}".`)
    .join('\n');
}
