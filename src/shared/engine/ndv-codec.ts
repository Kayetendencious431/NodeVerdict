import type { TracingEvent } from '../types';

/**
 * .ndv binary trace codec.
 *
 * A compact, memory-map friendly binary format for tracing events. Designed to
 * be trivially portable to WebAssembly/Rust: the layout is flat (little-endian,
 * fixed header + string table + fixed-record event rows), so a Rust/wasmbindgen
 * module can decode the same ArrayBuffer with zero FFI conversion beyond the
 * initial buffer copy.
 *
 * ## Layout (little-endian)
 *
 *   Header (16 bytes):
 *     0  u8   magic[0] = 'N'
 *     1  u8   magic[1] = 'D'
 *     2  u8   magic[2] = 'V'
 *     3  u8   version = 1
 *     4  u8   flags (bit0 = hasContextStrings)
 *     5  u8   reserved
 *     6  u16  reserved
 *     8  u32  stringCount
 *     12 u32  eventCount
 *
 *   String table (stringCount entries):
 *     u32 byteLength, utf8 bytes  (repeated)
 *
 *   Events (eventCount records):
 *     u8   eventType (0=start,1=end,2=asyncStart,3=asyncEnd,4=error)
 *     u32  channelIdx
 *     f64  timestamp (ms, monotonic)
 *     u8   flags (bit0=hasDuration, bit1=hasOperationId, bit2=hasError, bit3=hasContext)
 *     if bit0: f64 duration
 *     if bit1: u32 operationIdIdx
 *     if bit2: u32 errorIdx        (string "name: message")
 *     if bit3: u32 contextIdx      (JSON-serialized context)
 *
 * Strings (channels, operation ids, error summaries, serialized contexts) are
 * interned once in the string table. Repeated operation ids and channels cost a
 * single u32 each, which is where the bulk of the size win over JSON comes from.
 */

const VERSION = 1;
const HEADER_SIZE = 16;

const EVENT_START = 0;
const EVENT_END = 1;
const EVENT_ASYNC_START = 2;
const EVENT_ASYNC_END = 3;
const EVENT_ERROR = 4;

const FLAG_HAS_DURATION = 0x01;
const FLAG_HAS_OPERATION_ID = 0x02;
const FLAG_HAS_ERROR = 0x04;
const FLAG_HAS_CONTEXT = 0x08;

const eventTypeToNum = (et: TracingEvent['eventType']): number => {
  switch (et) {
    case 'start': return EVENT_START;
    case 'end': return EVENT_END;
    case 'asyncStart': return EVENT_ASYNC_START;
    case 'asyncEnd': return EVENT_ASYNC_END;
    case 'error': return EVENT_ERROR;
  }
};

const numToEventType = (n: number): TracingEvent['eventType'] => {
  switch (n) {
    case EVENT_START: return 'start';
    case EVENT_END: return 'end';
    case EVENT_ASYNC_START: return 'asyncStart';
    case EVENT_ASYNC_END: return 'asyncEnd';
    default: return 'error';
  }
};

export class NdvError extends Error {}

interface StringPool {
  list: string[];
  index: Map<string, number>;
}

function makePool(): StringPool {
  return { list: [], index: new Map() };
}

function intern(pool: StringPool, value: string | undefined): number {
  if (!value) return 0;
  const existing = pool.index.get(value);
  if (existing !== undefined) return existing;
  const idx = pool.list.length;
  pool.list.push(value);
  pool.index.set(value, idx);
  return idx;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Encodes tracing events into the .ndv binary format (Uint8Array). */
export function encodeNdv(events: TracingEvent[]): Uint8Array {
  const pool = makePool();
  // Pre-compute event record sizes and string table so we can allocate once.
  const ctxStrings: (string | undefined)[] = [];
  const errStrings: (string | undefined)[] = [];
  const opStrings: (string | undefined)[] = [];

  for (const e of events) {
    intern(pool, e.channel);
    const op = e.operationId;
    opStrings.push(op);
    intern(pool, op);
    let ctx: string | undefined;
    if (Object.keys(e.context).length > 0) {
      ctx = JSON.stringify(e.context);
      ctxStrings.push(ctx);
      intern(pool, ctx);
    } else {
      ctxStrings.push(undefined);
    }
    let err: string | undefined;
    if (e.error) {
      err = `${e.error.name ?? 'Error'}: ${e.error.message}`;
      errStrings.push(err);
      intern(pool, err);
    } else {
      errStrings.push(undefined);
    }
  }

  let strBytes = 0;
  for (const s of pool.list) strBytes += 4 + encoder.encode(s).length;

  const recordSizes = events.map((e, i) => {
    let size = 1 + 4 + 8 + 1;
    if (e.duration !== undefined) size += 8;
    if (opStrings[i] !== undefined) size += 4;
    if (errStrings[i] !== undefined) size += 4;
    if (ctxStrings[i] !== undefined) size += 4;
    return size;
  });
  const total = HEADER_SIZE + strBytes + recordSizes.reduce((a, b) => a + b, 0);

  const buf = new ArrayBuffer(total);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);

  view.setUint8(0, 0x4e); // 'N'
  view.setUint8(1, 0x44); // 'D'
  view.setUint8(2, 0x56); // 'V'
  view.setUint8(3, VERSION);
  view.setUint8(4, 0x01); // flags
  view.setUint32(8, pool.list.length, true);
  view.setUint32(12, events.length, true);

  let offset = HEADER_SIZE;
  const writeStr = (s: string) => {
    const enc = encoder.encode(s);
    view.setUint32(offset, enc.length, true);
    offset += 4;
    bytes.set(enc, offset);
    offset += enc.length;
  };
  for (const s of pool.list) writeStr(s);

  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const op = opStrings[i];
    const err = errStrings[i];
    const ctx = ctxStrings[i];

    let flags = 0;
    if (e.duration !== undefined) flags |= FLAG_HAS_DURATION;
    if (op !== undefined) flags |= FLAG_HAS_OPERATION_ID;
    if (err !== undefined) flags |= FLAG_HAS_ERROR;
    if (ctx !== undefined) flags |= FLAG_HAS_CONTEXT;

    view.setUint8(offset, eventTypeToNum(e.eventType));
    offset += 1;
    view.setUint32(offset, pool.index.get(e.channel)!, true);
    offset += 4;
    view.setFloat64(offset, e.timestamp, true);
    offset += 8;
    view.setUint8(offset, flags);
    offset += 1;
    if (flags & FLAG_HAS_DURATION) {
      view.setFloat64(offset, e.duration!, true);
      offset += 8;
    }
    if (flags & FLAG_HAS_OPERATION_ID) {
      view.setUint32(offset, pool.index.get(op!)!, true);
      offset += 4;
    }
    if (flags & FLAG_HAS_ERROR) {
      view.setUint32(offset, pool.index.get(err!)!, true);
      offset += 4;
    }
    if (flags & FLAG_HAS_CONTEXT) {
      view.setUint32(offset, pool.index.get(ctx!)!, true);
      offset += 4;
    }
  }

  return bytes;
}

/** Decodes .ndv binary data (ArrayBuffer | Uint8Array | DataView) into TracingEvent[]. */
export function decodeNdv(input: ArrayBuffer | Uint8Array | DataView): TracingEvent[] {
  const view = input instanceof DataView ? input : new DataView(
    input instanceof ArrayBuffer ? input : input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength),
  );
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);

  if (view.byteLength < HEADER_SIZE) throw new NdvError('Truncated .ndv header');
  if (bytes[0] !== 0x4e || bytes[1] !== 0x44 || bytes[2] !== 0x56) {
    throw new NdvError('Not a .ndv file (bad magic)');
  }
  const version = bytes[3];
  if (version !== VERSION) throw new NdvError(`Unsupported .ndv version ${version}`);

  const stringCount = view.getUint32(8, true);
  const eventCount = view.getUint32(12, true);
  const strings: string[] = [];
  let offset = HEADER_SIZE;

  for (let i = 0; i < stringCount; i++) {
    if (offset + 4 > view.byteLength) throw new NdvError('Truncated string table');
    const len = view.getUint32(offset, true);
    offset += 4;
    if (offset + len > view.byteLength) throw new NdvError('Truncated string data');
    strings.push(decoder.decode(bytes.subarray(offset, offset + len)));
    offset += len;
  }

  const events: TracingEvent[] = [];
  for (let i = 0; i < eventCount; i++) {
    if (offset + 14 > view.byteLength) throw new NdvError('Truncated event record');
    const typeNum = view.getUint8(offset);
    const channelIdx = view.getUint32(offset + 1, true);
    const timestamp = view.getFloat64(offset + 5, true);
    const flags = view.getUint8(offset + 13);
    offset += 14;

    let duration: number | undefined;
    if (flags & FLAG_HAS_DURATION) {
      duration = view.getFloat64(offset, true);
      offset += 8;
    }
    let operationId: string | undefined;
    if (flags & FLAG_HAS_OPERATION_ID) {
      operationId = strings[view.getUint32(offset, true)];
      offset += 4;
    }
    let error: { message: string; name?: string; stack?: string } | undefined;
    if (flags & FLAG_HAS_ERROR) {
      const errStr = strings[view.getUint32(offset, true)];
      offset += 4;
      const idx = errStr.indexOf(': ');
      error = idx >= 0
        ? { name: errStr.slice(0, idx), message: errStr.slice(idx + 2) }
        : { message: errStr };
    }
    let context: Record<string, unknown> = {};
    if (flags & FLAG_HAS_CONTEXT) {
      const ctxStr = strings[view.getUint32(offset, true)];
      offset += 4;
      try {
        const parsed = JSON.parse(ctxStr) as Record<string, unknown>;
        if (parsed && typeof parsed === 'object') context = parsed;
      } catch {
        // keep empty context
      }
    }

    events.push({
      channel: strings[channelIdx] ?? `channel:${channelIdx}`,
      eventType: numToEventType(typeNum),
      context,
      timestamp,
      duration,
      error,
      operationId,
    });
  }

  return events;
}

/** Convenience for browsers: decode an uploaded file's ArrayBuffer. */
export function decodeNdvFromArrayBuffer(buffer: ArrayBuffer): TracingEvent[] {
  return decodeNdv(buffer);
}
