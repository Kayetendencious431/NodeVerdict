#!/usr/bin/env node
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/lz-string/libs/lz-string.js
var require_lz_string = __commonJS({
  "node_modules/lz-string/libs/lz-string.js"(exports, module) {
    var LZString2 = (function() {
      var f = String.fromCharCode;
      var keyStrBase64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
      var keyStrUriSafe = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-$";
      var baseReverseDic = {};
      function getBaseValue(alphabet, character) {
        if (!baseReverseDic[alphabet]) {
          baseReverseDic[alphabet] = {};
          for (var i = 0; i < alphabet.length; i++) {
            baseReverseDic[alphabet][alphabet.charAt(i)] = i;
          }
        }
        return baseReverseDic[alphabet][character];
      }
      var LZString3 = {
        compressToBase64: function(input) {
          if (input == null) return "";
          var res = LZString3._compress(input, 6, function(a) {
            return keyStrBase64.charAt(a);
          });
          switch (res.length % 4) {
            // To produce valid Base64
            default:
            // When could this happen ?
            case 0:
              return res;
            case 1:
              return res + "===";
            case 2:
              return res + "==";
            case 3:
              return res + "=";
          }
        },
        decompressFromBase64: function(input) {
          if (input == null) return "";
          if (input == "") return null;
          return LZString3._decompress(input.length, 32, function(index) {
            return getBaseValue(keyStrBase64, input.charAt(index));
          });
        },
        compressToUTF16: function(input) {
          if (input == null) return "";
          return LZString3._compress(input, 15, function(a) {
            return f(a + 32);
          }) + " ";
        },
        decompressFromUTF16: function(compressed) {
          if (compressed == null) return "";
          if (compressed == "") return null;
          return LZString3._decompress(compressed.length, 16384, function(index) {
            return compressed.charCodeAt(index) - 32;
          });
        },
        //compress into uint8array (UCS-2 big endian format)
        compressToUint8Array: function(uncompressed) {
          var compressed = LZString3.compress(uncompressed);
          var buf = new Uint8Array(compressed.length * 2);
          for (var i = 0, TotalLen = compressed.length; i < TotalLen; i++) {
            var current_value = compressed.charCodeAt(i);
            buf[i * 2] = current_value >>> 8;
            buf[i * 2 + 1] = current_value % 256;
          }
          return buf;
        },
        //decompress from uint8array (UCS-2 big endian format)
        decompressFromUint8Array: function(compressed) {
          if (compressed === null || compressed === void 0) {
            return LZString3.decompress(compressed);
          } else {
            var buf = new Array(compressed.length / 2);
            for (var i = 0, TotalLen = buf.length; i < TotalLen; i++) {
              buf[i] = compressed[i * 2] * 256 + compressed[i * 2 + 1];
            }
            var result = [];
            buf.forEach(function(c) {
              result.push(f(c));
            });
            return LZString3.decompress(result.join(""));
          }
        },
        //compress into a string that is already URI encoded
        compressToEncodedURIComponent: function(input) {
          if (input == null) return "";
          return LZString3._compress(input, 6, function(a) {
            return keyStrUriSafe.charAt(a);
          });
        },
        //decompress from an output of compressToEncodedURIComponent
        decompressFromEncodedURIComponent: function(input) {
          if (input == null) return "";
          if (input == "") return null;
          input = input.replace(/ /g, "+");
          return LZString3._decompress(input.length, 32, function(index) {
            return getBaseValue(keyStrUriSafe, input.charAt(index));
          });
        },
        compress: function(uncompressed) {
          return LZString3._compress(uncompressed, 16, function(a) {
            return f(a);
          });
        },
        _compress: function(uncompressed, bitsPerChar, getCharFromInt) {
          if (uncompressed == null) return "";
          var i, value, context_dictionary = {}, context_dictionaryToCreate = {}, context_c = "", context_wc = "", context_w = "", context_enlargeIn = 2, context_dictSize = 3, context_numBits = 2, context_data = [], context_data_val = 0, context_data_position = 0, ii;
          for (ii = 0; ii < uncompressed.length; ii += 1) {
            context_c = uncompressed.charAt(ii);
            if (!Object.prototype.hasOwnProperty.call(context_dictionary, context_c)) {
              context_dictionary[context_c] = context_dictSize++;
              context_dictionaryToCreate[context_c] = true;
            }
            context_wc = context_w + context_c;
            if (Object.prototype.hasOwnProperty.call(context_dictionary, context_wc)) {
              context_w = context_wc;
            } else {
              if (Object.prototype.hasOwnProperty.call(context_dictionaryToCreate, context_w)) {
                if (context_w.charCodeAt(0) < 256) {
                  for (i = 0; i < context_numBits; i++) {
                    context_data_val = context_data_val << 1;
                    if (context_data_position == bitsPerChar - 1) {
                      context_data_position = 0;
                      context_data.push(getCharFromInt(context_data_val));
                      context_data_val = 0;
                    } else {
                      context_data_position++;
                    }
                  }
                  value = context_w.charCodeAt(0);
                  for (i = 0; i < 8; i++) {
                    context_data_val = context_data_val << 1 | value & 1;
                    if (context_data_position == bitsPerChar - 1) {
                      context_data_position = 0;
                      context_data.push(getCharFromInt(context_data_val));
                      context_data_val = 0;
                    } else {
                      context_data_position++;
                    }
                    value = value >> 1;
                  }
                } else {
                  value = 1;
                  for (i = 0; i < context_numBits; i++) {
                    context_data_val = context_data_val << 1 | value;
                    if (context_data_position == bitsPerChar - 1) {
                      context_data_position = 0;
                      context_data.push(getCharFromInt(context_data_val));
                      context_data_val = 0;
                    } else {
                      context_data_position++;
                    }
                    value = 0;
                  }
                  value = context_w.charCodeAt(0);
                  for (i = 0; i < 16; i++) {
                    context_data_val = context_data_val << 1 | value & 1;
                    if (context_data_position == bitsPerChar - 1) {
                      context_data_position = 0;
                      context_data.push(getCharFromInt(context_data_val));
                      context_data_val = 0;
                    } else {
                      context_data_position++;
                    }
                    value = value >> 1;
                  }
                }
                context_enlargeIn--;
                if (context_enlargeIn == 0) {
                  context_enlargeIn = Math.pow(2, context_numBits);
                  context_numBits++;
                }
                delete context_dictionaryToCreate[context_w];
              } else {
                value = context_dictionary[context_w];
                for (i = 0; i < context_numBits; i++) {
                  context_data_val = context_data_val << 1 | value & 1;
                  if (context_data_position == bitsPerChar - 1) {
                    context_data_position = 0;
                    context_data.push(getCharFromInt(context_data_val));
                    context_data_val = 0;
                  } else {
                    context_data_position++;
                  }
                  value = value >> 1;
                }
              }
              context_enlargeIn--;
              if (context_enlargeIn == 0) {
                context_enlargeIn = Math.pow(2, context_numBits);
                context_numBits++;
              }
              context_dictionary[context_wc] = context_dictSize++;
              context_w = String(context_c);
            }
          }
          if (context_w !== "") {
            if (Object.prototype.hasOwnProperty.call(context_dictionaryToCreate, context_w)) {
              if (context_w.charCodeAt(0) < 256) {
                for (i = 0; i < context_numBits; i++) {
                  context_data_val = context_data_val << 1;
                  if (context_data_position == bitsPerChar - 1) {
                    context_data_position = 0;
                    context_data.push(getCharFromInt(context_data_val));
                    context_data_val = 0;
                  } else {
                    context_data_position++;
                  }
                }
                value = context_w.charCodeAt(0);
                for (i = 0; i < 8; i++) {
                  context_data_val = context_data_val << 1 | value & 1;
                  if (context_data_position == bitsPerChar - 1) {
                    context_data_position = 0;
                    context_data.push(getCharFromInt(context_data_val));
                    context_data_val = 0;
                  } else {
                    context_data_position++;
                  }
                  value = value >> 1;
                }
              } else {
                value = 1;
                for (i = 0; i < context_numBits; i++) {
                  context_data_val = context_data_val << 1 | value;
                  if (context_data_position == bitsPerChar - 1) {
                    context_data_position = 0;
                    context_data.push(getCharFromInt(context_data_val));
                    context_data_val = 0;
                  } else {
                    context_data_position++;
                  }
                  value = 0;
                }
                value = context_w.charCodeAt(0);
                for (i = 0; i < 16; i++) {
                  context_data_val = context_data_val << 1 | value & 1;
                  if (context_data_position == bitsPerChar - 1) {
                    context_data_position = 0;
                    context_data.push(getCharFromInt(context_data_val));
                    context_data_val = 0;
                  } else {
                    context_data_position++;
                  }
                  value = value >> 1;
                }
              }
              context_enlargeIn--;
              if (context_enlargeIn == 0) {
                context_enlargeIn = Math.pow(2, context_numBits);
                context_numBits++;
              }
              delete context_dictionaryToCreate[context_w];
            } else {
              value = context_dictionary[context_w];
              for (i = 0; i < context_numBits; i++) {
                context_data_val = context_data_val << 1 | value & 1;
                if (context_data_position == bitsPerChar - 1) {
                  context_data_position = 0;
                  context_data.push(getCharFromInt(context_data_val));
                  context_data_val = 0;
                } else {
                  context_data_position++;
                }
                value = value >> 1;
              }
            }
            context_enlargeIn--;
            if (context_enlargeIn == 0) {
              context_enlargeIn = Math.pow(2, context_numBits);
              context_numBits++;
            }
          }
          value = 2;
          for (i = 0; i < context_numBits; i++) {
            context_data_val = context_data_val << 1 | value & 1;
            if (context_data_position == bitsPerChar - 1) {
              context_data_position = 0;
              context_data.push(getCharFromInt(context_data_val));
              context_data_val = 0;
            } else {
              context_data_position++;
            }
            value = value >> 1;
          }
          while (true) {
            context_data_val = context_data_val << 1;
            if (context_data_position == bitsPerChar - 1) {
              context_data.push(getCharFromInt(context_data_val));
              break;
            } else context_data_position++;
          }
          return context_data.join("");
        },
        decompress: function(compressed) {
          if (compressed == null) return "";
          if (compressed == "") return null;
          return LZString3._decompress(compressed.length, 32768, function(index) {
            return compressed.charCodeAt(index);
          });
        },
        _decompress: function(length, resetValue, getNextValue) {
          var dictionary = [], next, enlargeIn = 4, dictSize = 4, numBits = 3, entry = "", result = [], i, w, bits, resb, maxpower, power, c, data = { val: getNextValue(0), position: resetValue, index: 1 };
          for (i = 0; i < 3; i += 1) {
            dictionary[i] = i;
          }
          bits = 0;
          maxpower = Math.pow(2, 2);
          power = 1;
          while (power != maxpower) {
            resb = data.val & data.position;
            data.position >>= 1;
            if (data.position == 0) {
              data.position = resetValue;
              data.val = getNextValue(data.index++);
            }
            bits |= (resb > 0 ? 1 : 0) * power;
            power <<= 1;
          }
          switch (next = bits) {
            case 0:
              bits = 0;
              maxpower = Math.pow(2, 8);
              power = 1;
              while (power != maxpower) {
                resb = data.val & data.position;
                data.position >>= 1;
                if (data.position == 0) {
                  data.position = resetValue;
                  data.val = getNextValue(data.index++);
                }
                bits |= (resb > 0 ? 1 : 0) * power;
                power <<= 1;
              }
              c = f(bits);
              break;
            case 1:
              bits = 0;
              maxpower = Math.pow(2, 16);
              power = 1;
              while (power != maxpower) {
                resb = data.val & data.position;
                data.position >>= 1;
                if (data.position == 0) {
                  data.position = resetValue;
                  data.val = getNextValue(data.index++);
                }
                bits |= (resb > 0 ? 1 : 0) * power;
                power <<= 1;
              }
              c = f(bits);
              break;
            case 2:
              return "";
          }
          dictionary[3] = c;
          w = c;
          result.push(c);
          while (true) {
            if (data.index > length) {
              return "";
            }
            bits = 0;
            maxpower = Math.pow(2, numBits);
            power = 1;
            while (power != maxpower) {
              resb = data.val & data.position;
              data.position >>= 1;
              if (data.position == 0) {
                data.position = resetValue;
                data.val = getNextValue(data.index++);
              }
              bits |= (resb > 0 ? 1 : 0) * power;
              power <<= 1;
            }
            switch (c = bits) {
              case 0:
                bits = 0;
                maxpower = Math.pow(2, 8);
                power = 1;
                while (power != maxpower) {
                  resb = data.val & data.position;
                  data.position >>= 1;
                  if (data.position == 0) {
                    data.position = resetValue;
                    data.val = getNextValue(data.index++);
                  }
                  bits |= (resb > 0 ? 1 : 0) * power;
                  power <<= 1;
                }
                dictionary[dictSize++] = f(bits);
                c = dictSize - 1;
                enlargeIn--;
                break;
              case 1:
                bits = 0;
                maxpower = Math.pow(2, 16);
                power = 1;
                while (power != maxpower) {
                  resb = data.val & data.position;
                  data.position >>= 1;
                  if (data.position == 0) {
                    data.position = resetValue;
                    data.val = getNextValue(data.index++);
                  }
                  bits |= (resb > 0 ? 1 : 0) * power;
                  power <<= 1;
                }
                dictionary[dictSize++] = f(bits);
                c = dictSize - 1;
                enlargeIn--;
                break;
              case 2:
                return result.join("");
            }
            if (enlargeIn == 0) {
              enlargeIn = Math.pow(2, numBits);
              numBits++;
            }
            if (dictionary[c]) {
              entry = dictionary[c];
            } else {
              if (c === dictSize) {
                entry = w + w.charAt(0);
              } else {
                return null;
              }
            }
            result.push(entry);
            dictionary[dictSize++] = w + entry.charAt(0);
            enlargeIn--;
            w = entry;
            if (enlargeIn == 0) {
              enlargeIn = Math.pow(2, numBits);
              numBits++;
            }
          }
        }
      };
      return LZString3;
    })();
    if (typeof define === "function" && define.amd) {
      define(function() {
        return LZString2;
      });
    } else if (typeof module !== "undefined" && module != null) {
      module.exports = LZString2;
    } else if (typeof angular !== "undefined" && angular != null) {
      angular.module("LZString", []).factory("LZString", function() {
        return LZString2;
      });
    }
  }
});

// cli/check.ts
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// src/shared/engine/tracing-parser.ts
function normalize(events) {
  return events.filter((e) => e.channel && e.eventType && typeof e.timestamp === "number").sort((a, b) => a.timestamp - b.timestamp);
}
function pairOperations(events) {
  const startMap = /* @__PURE__ */ new Map();
  const operations = [];
  for (const event of events) {
    const key = event.operationId ?? `${event.channel}:${event.timestamp}`;
    if (event.eventType === "start") {
      startMap.set(key, event);
    } else if (event.eventType === "end" || event.eventType === "error") {
      const start = startMap.get(key);
      if (start) {
        startMap.delete(key);
        operations.push({
          channel: event.channel,
          operationId: key,
          start,
          [event.eventType]: event,
          duration: event.timestamp - start.timestamp,
          status: event.eventType === "error" ? "error" : "success"
        });
      } else {
        operations.push({
          channel: event.channel,
          operationId: key,
          start: event,
          [event.eventType]: event,
          duration: 0,
          status: event.eventType === "error" ? "error" : "incomplete"
        });
      }
    }
  }
  for (const [key, start] of startMap) {
    operations.push({
      channel: start.channel,
      operationId: key,
      start,
      duration: 0,
      status: "incomplete"
    });
  }
  return operations;
}
function computeStats(operations) {
  const grouped = /* @__PURE__ */ new Map();
  const counts = /* @__PURE__ */ new Map();
  for (const op of operations) {
    const ch = op.channel;
    if (!grouped.has(ch)) grouped.set(ch, []);
    if (!counts.has(ch)) counts.set(ch, { success: 0, error: 0, incomplete: 0 });
    const c = counts.get(ch);
    if (op.status === "success") c.success++;
    else if (op.status === "error") c.error++;
    else c.incomplete++;
    if (op.duration > 0) grouped.get(ch).push(op.duration);
  }
  return Array.from(grouped.entries()).map(([channel, durations]) => {
    const sorted = [...durations].sort((a, b) => a - b);
    const c = counts.get(channel);
    const total = c.success + c.error + c.incomplete;
    return {
      channel,
      totalOperations: total,
      successCount: c.success,
      errorCount: c.error,
      incompleteCount: c.incomplete,
      avgDuration: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
      p50Duration: percentile(sorted, 50),
      p95Duration: percentile(sorted, 95),
      p99Duration: percentile(sorted, 99),
      minDuration: sorted[0] ?? 0,
      maxDuration: sorted[sorted.length - 1] ?? 0
    };
  });
}
function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil(p / 100 * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}
function indexEvents(events) {
  const byChannel = /* @__PURE__ */ new Map();
  const byOperationId = /* @__PURE__ */ new Map();
  for (const event of events) {
    const ch = byChannel.get(event.channel) ?? [];
    ch.push(event);
    byChannel.set(event.channel, ch);
    if (event.operationId) {
      const ops = byOperationId.get(event.operationId) ?? [];
      ops.push(event);
      byOperationId.set(event.operationId, ops);
    }
  }
  return { byChannel, byOperationId };
}
function analyzeTracingEvents(rawEvents) {
  const events = normalize(rawEvents);
  const operations = pairOperations(events);
  const channelStats = computeStats(operations);
  const indexed = indexEvents(events);
  const channels = Array.from(new Set(events.map((e) => e.channel))).sort();
  const errorCount = operations.filter((o) => o.status === "error").length;
  return {
    events,
    operations,
    channelStats,
    totalEvents: events.length,
    totalOperations: operations.length,
    errorRate: operations.length ? errorCount / operations.length : 0,
    timeRange: events.length ? { start: events[0].timestamp, end: events[events.length - 1].timestamp } : { start: 0, end: 0 },
    channels,
    ...indexed
  };
}

// src/shared/engine/trace-aggregator.ts
function buildWaterfall(operations, events) {
  const asyncStarts = /* @__PURE__ */ new Map();
  for (const event of events) {
    if (event.eventType === "asyncStart" && event.operationId) {
      asyncStarts.set(event.operationId, event);
    }
  }
  const spans = [];
  for (const op of operations) {
    const span = {
      id: op.operationId,
      operationId: op.operationId,
      channel: op.channel,
      label: op.channel,
      startTime: op.start.timestamp,
      endTime: op.end?.timestamp ?? op.start.timestamp,
      duration: op.duration,
      depth: 0,
      children: [],
      status: op.status,
      metadata: op.start.context
    };
    const asyncStart = asyncStarts.get(op.operationId);
    if (asyncStart) {
      span.metadata = { ...span.metadata, ...asyncStart.context };
    }
    if (op.status === "error" && op.error?.error) {
      span.metadata = { ...span.metadata, error: op.error.error };
    }
    spans.push(span);
  }
  spans.sort((a, b) => a.startTime - b.startTime);
  for (let i = 0; i < spans.length; i++) {
    for (let j = i - 1; j >= 0; j--) {
      if (spans[j].startTime <= spans[i].startTime && spans[j].endTime >= spans[i].endTime) {
        spans[i].parentId = spans[j].id;
        spans[j].children.push(spans[i]);
        spans[i].depth = spans[j].depth + 1;
        break;
      }
    }
  }
  return spans.filter((s) => !s.parentId);
}

// src/shared/engine/report-generator.ts
var import_lz_string = __toESM(require_lz_string(), 1);

// src/shared/engine/otel-adapter.ts
function extractServiceName(resource) {
  const found = resource?.attributes?.find((a) => a.key === "service.name");
  return found?.value?.stringValue;
}
function timeToMs(value) {
  if (value === void 0 || value === "") return 0;
  const n = typeof value === "string" ? Number(value) : value;
  if (n === 0) return 0;
  if (n >= 1e16) return n / 1e6;
  if (n >= 1e13) return n / 1e3;
  return n;
}
function attrValue(v) {
  if (v.stringValue !== void 0) return v.stringValue;
  if (v.intValue !== void 0) return v.intValue;
  if (v.doubleValue !== void 0) return String(v.doubleValue);
  if (v.boolValue !== void 0) return String(v.boolValue);
  return "";
}
function findAttr(attrs, key) {
  const found = attrs?.find((a) => a.key === key);
  return found ? attrValue(found.value) : "";
}
function spanToEvents(span, serviceName) {
  const channel = findAttr(span.attributes ?? [], "nodeverdict.channel") || span.name || span.operationName || "otel.span";
  const operationId = span.spanId || span.name || span.operationName || `otel:${Math.random().toString(36).slice(2)}`;
  const parentSpanId = span.parentSpanId;
  let start = timeToMs(span.startTimeUnixNano);
  let end = timeToMs(span.endTimeUnixNano);
  let duration = end > start ? end - start : 0;
  if (span.duration !== void 0 && span.duration > 0) {
    const jaegerStart = timeToMs(span.startTime);
    duration = span.duration / 1e3;
    start = jaegerStart;
    end = jaegerStart + duration;
  }
  const statusCode = span.status?.code ?? 1;
  const isError = statusCode === 2;
  const context = {};
  for (const a of span.attributes ?? []) {
    context[a.key] = attrValue(a.value);
  }
  if (parentSpanId) context.parentSpanId = parentSpanId;
  context.traceId = span.traceId;
  context.kind = span.kind;
  context.statusMessage = span.status?.message;
  if (serviceName) context.serviceName = serviceName;
  const events = [];
  events.push({
    channel,
    eventType: "start",
    context,
    timestamp: start,
    duration,
    operationId
  });
  if (isError) {
    events.push({
      channel,
      eventType: "error",
      context,
      timestamp: end,
      duration,
      operationId,
      error: { name: span.status?.message ?? "OTel error", message: span.status?.message ?? "OTel error" }
    });
  } else {
    events.push({
      channel,
      eventType: "end",
      context,
      timestamp: end,
      duration,
      operationId
    });
  }
  return events;
}
function extractOtlpGroups(obj) {
  const groups = [];
  const resourceSpans = obj.resourceSpans;
  if (Array.isArray(resourceSpans)) {
    for (const rs of resourceSpans) {
      const serviceName = extractServiceName(rs.resource);
      for (const ss of rs.scopeSpans ?? []) {
        const spans = ss.spans ?? [];
        if (spans.length === 0) continue;
        groups.push({ serviceName, spans });
      }
    }
    return groups;
  }
  if (Array.isArray(obj.spans)) return [{ spans: obj.spans }];
  const data = obj.data;
  if (Array.isArray(data)) {
    for (const d of data) {
      const spans = d.spans ?? [];
      if (spans.length === 0) continue;
      groups.push({ serviceName: d.process?.serviceName, spans });
    }
  }
  return groups;
}
function isOtelExport(obj) {
  if (!obj || typeof obj !== "object") return false;
  const o = obj;
  return Array.isArray(o.resourceSpans) || Array.isArray(o.spans) || Array.isArray(o.data) && typeof o.data[0]?.spans !== "undefined";
}
function convertOtelToTracingEvents(obj) {
  const groups = extractOtlpGroups(obj);
  const events = [];
  for (const group of groups) {
    for (const span of group.spans) events.push(...spanToEvents(span, group.serviceName));
  }
  return events.sort((a, b) => a.timestamp - b.timestamp);
}

// src/shared/engine/ndv-codec.ts
var VERSION = 1;
var HEADER_SIZE = 16;
var EVENT_START = 0;
var EVENT_END = 1;
var EVENT_ASYNC_START = 2;
var EVENT_ASYNC_END = 3;
var FLAG_HAS_DURATION = 1;
var FLAG_HAS_OPERATION_ID = 2;
var FLAG_HAS_ERROR = 4;
var FLAG_HAS_CONTEXT = 8;
var numToEventType = (n) => {
  switch (n) {
    case EVENT_START:
      return "start";
    case EVENT_END:
      return "end";
    case EVENT_ASYNC_START:
      return "asyncStart";
    case EVENT_ASYNC_END:
      return "asyncEnd";
    default:
      return "error";
  }
};
var NdvError = class extends Error {
};
var encoder = new TextEncoder();
var decoder = new TextDecoder();
function decodeNdv(input) {
  const view = input instanceof DataView ? input : new DataView(
    input instanceof ArrayBuffer ? input : input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength)
  );
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  if (view.byteLength < HEADER_SIZE) throw new NdvError("Truncated .ndv header");
  if (bytes[0] !== 78 || bytes[1] !== 68 || bytes[2] !== 86) {
    throw new NdvError("Not a .ndv file (bad magic)");
  }
  const version = bytes[3];
  if (version !== VERSION) throw new NdvError(`Unsupported .ndv version ${version}`);
  const stringCount = view.getUint32(8, true);
  const eventCount = view.getUint32(12, true);
  const strings = [];
  let offset = HEADER_SIZE;
  for (let i = 0; i < stringCount; i++) {
    if (offset + 4 > view.byteLength) throw new NdvError("Truncated string table");
    const len = view.getUint32(offset, true);
    offset += 4;
    if (offset + len > view.byteLength) throw new NdvError("Truncated string data");
    strings.push(decoder.decode(bytes.subarray(offset, offset + len)));
    offset += len;
  }
  const events = [];
  for (let i = 0; i < eventCount; i++) {
    if (offset + 14 > view.byteLength) throw new NdvError("Truncated event record");
    const typeNum = view.getUint8(offset);
    const channelIdx = view.getUint32(offset + 1, true);
    const timestamp = view.getFloat64(offset + 5, true);
    const flags = view.getUint8(offset + 13);
    offset += 14;
    let duration;
    if (flags & FLAG_HAS_DURATION) {
      duration = view.getFloat64(offset, true);
      offset += 8;
    }
    let operationId;
    if (flags & FLAG_HAS_OPERATION_ID) {
      operationId = strings[view.getUint32(offset, true)];
      offset += 4;
    }
    let error;
    if (flags & FLAG_HAS_ERROR) {
      const errStr = strings[view.getUint32(offset, true)];
      offset += 4;
      const idx = errStr.indexOf(": ");
      error = idx >= 0 ? { name: errStr.slice(0, idx), message: errStr.slice(idx + 2) } : { message: errStr };
    }
    let context = {};
    if (flags & FLAG_HAS_CONTEXT) {
      const ctxStr = strings[view.getUint32(offset, true)];
      offset += 4;
      try {
        const parsed = JSON.parse(ctxStr);
        if (parsed && typeof parsed === "object") context = parsed;
      } catch {
      }
    }
    const event = {
      channel: strings[channelIdx] ?? `channel:${channelIdx}`,
      eventType: numToEventType(typeNum),
      context,
      timestamp
    };
    if (duration !== void 0) event.duration = duration;
    if (operationId !== void 0) event.operationId = operationId;
    if (error !== void 0) event.error = error;
    events.push(event);
  }
  return events;
}

// src/shared/engine/data-loader.ts
function stripBom(content) {
  return content.charCodeAt(0) === 65279 ? content.slice(1) : content;
}
function detectTraceFormat(content) {
  let parsed;
  try {
    parsed = JSON.parse(stripBom(content));
  } catch {
    throw new Error("File is not valid JSON");
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const obj = parsed;
    if (typeof obj.format === "string" && obj.format === "ndv") return "ndv";
    if (isOtelExport(obj)) return "otel";
  }
  return "nodeverdict";
}
function isEventArray(value) {
  if (!Array.isArray(value)) return false;
  if (value.length === 0) return true;
  const first = value[0];
  return !!first && typeof first === "object" && typeof first.channel === "string" && typeof first.eventType === "string" && typeof first.timestamp === "number";
}
function loadTracingData(content) {
  const format = detectTraceFormat(content);
  if (format === "ndv") {
    throw new Error("This looks like a .ndv binary file. Please use the .ndv importer.");
  }
  const parsed = JSON.parse(stripBom(content));
  if (format === "otel") {
    return convertOtelToTracingEvents(parsed);
  }
  if (!isEventArray(parsed)) {
    throw new Error("Unrecognized trace format. Expected a TracingEvent[] array or an OpenTelemetry export.");
  }
  return parsed;
}
function loadNdvBuffer(buffer) {
  return decodeNdv(buffer);
}

// src/shared/gate/performance-gate.ts
var defaultGateConfig = {
  p99MaxMs: 500,
  n1SqlMaxCount: 3,
  eventLoopDelayMaxMs: 20
};
var SQL_CHANNEL_RE = /(mysql|pg|postgres|sqlite|mssql|query|knex|sequelize)/i;
var EVENT_LOOP_CHANNEL_RE = /event[\s-]?loop/i;
function percentile2(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil(p / 100 * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}
function flattenSpans(spans, depth) {
  const out = [];
  for (const s of spans) {
    out.push({ span: s, depth });
    out.push(...flattenSpans(s.children, depth + 1));
  }
  return out;
}
function computeGateMetrics(events, config = {}) {
  const n1Threshold = config.n1SqlMaxCount ?? defaultGateConfig.n1SqlMaxCount;
  const analysis = analyzeTracingEvents(events);
  const spans = buildWaterfall(analysis.operations, analysis.events);
  const durations = analysis.operations.filter((o) => o.duration > 0).map((o) => o.duration).sort((a, b) => a - b);
  const p99LatencyMs = percentile2(durations, 99);
  const n1SqlInstances = [];
  for (const { span } of flattenSpans(spans, 0)) {
    const sqlChildren = span.children.filter((c) => SQL_CHANNEL_RE.test(c.channel));
    const byType = /* @__PURE__ */ new Map();
    for (const c of sqlChildren) {
      const key = c.channel.toLowerCase();
      byType.set(key, (byType.get(key) ?? 0) + 1);
    }
    for (const [type, count] of byType) {
      if (count >= n1Threshold) {
        n1SqlInstances.push({ parentChannel: span.channel, parentId: span.operationId, queries: count });
      }
    }
  }
  const delays = [];
  for (const e of events) {
    if (!EVENT_LOOP_CHANNEL_RE.test(e.channel)) continue;
    const latency = e.context?.latency ?? e.context?.delay ?? e.context?.lag;
    if (typeof latency === "number" && latency > 0) delays.push(latency);
  }
  const eventLoopDelayP99Ms = delays.length > 0 ? percentile2(delays.sort((a, b) => a - b), 99) : null;
  return {
    p99LatencyMs,
    n1SqlInstances,
    eventLoopDelayP99Ms,
    totalOperations: analysis.totalOperations,
    totalEvents: analysis.totalEvents,
    errorRate: analysis.errorRate
  };
}
function evaluateGate(metrics, config = {}) {
  const cfg = { ...defaultGateConfig, ...config };
  const rules = [];
  rules.push({
    id: "p99-latency",
    description: "P99 latency",
    status: metrics.p99LatencyMs <= cfg.p99MaxMs ? "pass" : "fail",
    actual: metrics.p99LatencyMs,
    threshold: cfg.p99MaxMs,
    unit: "ms"
  });
  const n1Count = metrics.n1SqlInstances.length;
  rules.push({
    id: "n1-sql",
    description: "N+1 SQL query pattern",
    status: n1Count === 0 ? "pass" : "fail",
    actual: n1Count,
    threshold: 0,
    unit: "instances",
    detail: n1Count > 0 ? metrics.n1SqlInstances.map((i) => `${i.parentChannel} (${i.queries} queries)`).join(", ") : void 0
  });
  if (metrics.eventLoopDelayP99Ms === null) {
    rules.push({
      id: "event-loop-delay",
      description: "Event loop delay",
      status: "skipped",
      actual: 0,
      threshold: cfg.eventLoopDelayMaxMs,
      unit: "ms",
      detail: "No event-loop channel data in trace"
    });
  } else {
    rules.push({
      id: "event-loop-delay",
      description: "Event loop delay",
      status: metrics.eventLoopDelayP99Ms <= cfg.eventLoopDelayMaxMs ? "pass" : "fail",
      actual: metrics.eventLoopDelayP99Ms,
      threshold: cfg.eventLoopDelayMaxMs,
      unit: "ms"
    });
  }
  return {
    passed: rules.every((r) => r.status === "pass" || r.status === "skipped"),
    config: cfg,
    metrics,
    rules
  };
}
function evaluateTraceGate(content, config) {
  const events = typeof content === "string" ? loadTracingData(content) : loadNdvBuffer(content);
  const metrics = computeGateMetrics(events, config);
  return evaluateGate(metrics, config);
}
function formatGateReport(result, sourceName) {
  const lines = [];
  lines.push(`# NodeVerdict Performance Gate${sourceName ? ` \u2014 ${sourceName}` : ""}`);
  lines.push("");
  lines.push(`**Result: ${result.passed ? "PASS" : "FAIL"}**`);
  lines.push("");
  lines.push("| Rule | Status | Actual | Threshold |");
  lines.push("|---|---|---|---|");
  for (const r of result.rules) {
    const status = r.status === "pass" ? "\u2705 pass" : r.status === "fail" ? "\u274C fail" : "\u23ED skip";
    const unit = r.unit && r.unit !== "ms" ? ` ${r.unit}` : r.unit;
    lines.push(`| ${r.description} | ${status} | ${r.actual.toLocaleString()}${unit} | ${r.threshold.toLocaleString()}${unit} |`);
  }
  lines.push("");
  lines.push(`Trace: ${result.metrics.totalEvents} events, ${result.metrics.totalOperations} operations, error rate ${(result.metrics.errorRate * 100).toFixed(2)}%.`);
  if (result.metrics.n1SqlInstances.length > 0) {
    lines.push("");
    lines.push("N+1 SQL suspects:");
    for (const n1 of result.metrics.n1SqlInstances) {
      lines.push(`- ${n1.parentChannel} (${n1.parentId}): ${n1.queries} sequential SQL queries`);
    }
  }
  return lines.join("\n");
}

// cli/check.ts
function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json" || arg === "-j") flags.json = true;
    else if (arg === "--help" || arg === "-h") flags.help = true;
    else if (arg.startsWith("--config=")) flags.config = arg.slice("--config=".length);
    else if (arg === "--config") flags.config = argv[++i];
    else if (arg.startsWith("--report=")) flags.report = arg.slice("--report=".length);
    else if (arg === "--report") flags.report = argv[++i];
    else if (arg.startsWith("--threshold=")) flags.threshold = arg.slice("--threshold=".length);
    else positional.push(arg);
  }
  return { positional, flags };
}
function printHelp() {
  console.log(`node-verdict check \u2014 CI performance gate

Usage:
  node-verdict check <trace.json|trace.ndv> [options]

Options:
  --config <file>       JSON file overriding gate thresholds
  --json                Output machine-readable JSON result
  --report <file.md>    Write a markdown report to the given file
  --threshold=k=v       Override a single threshold (e.g. p99MaxMs=250)

Exit codes:
  0  gate PASS
  1  gate FAIL (a rule was violated)
  2  usage or input error
`);
}
function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  if (flags.help) {
    printHelp();
    process.exit(0);
  }
  const fileArg = positional[0] === "check" ? positional[1] : positional[0];
  const file = fileArg;
  if (positional.length === 0 || positional[0] === "check" && positional.length === 1) {
    console.error("error: missing trace file. Run `node-verdict check --help`.");
    process.exit(2);
  }
  if (!file) {
    console.error("error: missing trace file.");
    process.exit(2);
  }
  let raw;
  try {
    raw = readFileSync(file);
  } catch (err) {
    console.error(`error: cannot read file ${file}: ${err.message}`);
    process.exit(2);
  }
  const content = /\.ndv$/i.test(file) ? raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) : raw.toString("utf-8");
  const config = {};
  if (typeof flags.config === "string") {
    try {
      Object.assign(config, JSON.parse(readFileSync(flags.config, "utf-8")));
    } catch (err) {
      console.error(`error: cannot read config ${flags.config}: ${err.message}`);
      process.exit(2);
    }
  }
  if (typeof flags.threshold === "string") {
    const parts = flags.threshold.split("=");
    if (parts.length === 2 && parts[0] in defaultGateConfig) {
      config[parts[0]] = Number(parts[1]);
    } else {
      console.error(`error: invalid threshold override "${flags.threshold}". Expected one of: p99MaxMs, n1SqlMaxCount, eventLoopDelayMaxMs`);
      process.exit(2);
    }
  }
  let result;
  try {
    result = evaluateTraceGate(content, config);
  } catch (err) {
    console.error(`error: failed to analyze trace: ${err.message}`);
    process.exit(2);
  }
  const sourceName = file.split(/[\\/]/).pop();
  const report = formatGateReport(result, sourceName);
  if (flags.report) {
    try {
      writeFileSync(resolve(flags.report), report);
    } catch (err) {
      console.error(`error: cannot write report ${flags.report}: ${err.message}`);
      process.exit(2);
    }
  }
  if (flags.json) {
    console.log(JSON.stringify({ passed: result.passed, rules: result.rules, metrics: result.metrics }, null, 2));
  } else {
    console.log(report);
  }
  process.exit(result.passed ? 0 : 1);
}
main();
