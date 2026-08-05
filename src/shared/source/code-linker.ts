import { originalPositionFor, type SourceMapData } from './source-map-resolver';

/**
 * Trace-to-Code reverse mapping.
 *
 * Parses V8 error stack traces into structured frames and links each frame to
 * source locations, resolving through an optional Source Map so that
 * minified/bundled frames (`app.min.js:1:42`) point back at the authored file.
 *
 * Node.js-specific filtering:
 *   - `node:internal/...` and `internal/...` frames (built-in machinery)
 *   - `[eval]` / `node:...` pseudo files
 *   - C++ / native frames like `node::...`, `* internalBinding *` — the issue's
 *     "C++ 绑定帧过滤" requirement
 *
 * The resolver is a pure interface: the browser passes a `SourceMapLoader` that
 * reads `.map` files (via File System Access API in the bridge layer); the
 * linker itself is testable in Node with plain SourceMapData objects.
 */

export interface StackFrame {
  /** Function/method name, or '[anonymous]' / '[C++]' when unknown. */
  functionName: string;
  /** Path portion of the frame's file. */
  file: string;
  /** 1-based line in the *generated* (as-written) file. */
  line1?: number;
  /** 0-based column in the generated file. */
  col0?: number;
  /** true for frames the engine should not surface (built-ins, internals). */
  filtered: boolean;
  /** The original, raw line of the stack trace. */
  raw: string;
  /** After source-map resolution: original authored location. */
  original?: { source: string; line1: number; col0: number; name?: string };
}

export interface ResolvedStack {
  frames: StackFrame[];
  /** Number of frames that were hidden by filtering. */
  filteredCount: number;
  /** Number of frames successfully linked to an original source. */
  linkedCount: number;
}

/** Loads a `.map` for a generated file, if any. Pure interface — impl lives in the bridge. */
export interface SourceMapLoader {
  load(filePath: string): SourceMapData | undefined | Promise<SourceMapData | undefined>;
}

const INTERNAL_PREFIXES = ['node:internal/', 'internal/'];
const FILTER_SUBSTRINGS = [' [eval]', 'node:', 'node::'];

/** Does the file belong to the Node runtime / built-in machinery? */
export function isRuntimeFrame(file: string): boolean {
  if (!file) return true;
  if (file.startsWith('internal/') || file.startsWith('node:internal/')) return true;
  if (file === '[eval]' || file === '<anonymous>') return true;
  if (file.includes('node_modules/')) return false; // user deps are app code
  if (file.includes('node:')) return true;
  return false;
}

/** Is this a native/C++ frame (e.g. `node::StreamBase::...`)? */
export function isNativeFrame(file: string, functionName: string): boolean {
  if (file.includes('native')) return true;
  if (functionName.includes('node::')) return true;
  if (functionName.includes('*')) return true; // `* internalBinding *`
  if (functionName.endsWith('::') || functionName.includes('::')) return true;
  return false;
}

/**
 * Parse a V8 stack string into frames.
 * Handles the two V8 shapes:
 *   `    at fn (file:line:col)`
 *   `    at file:line:col`
 *   `    at fn (native)` / `at node:...`
 *   `    at eval at fn (file:line:col)`
 */
export function parseStack(stack: string | undefined): StackFrame[] {
  if (!stack) return [];
  const frames: StackFrame[] = [];
  for (const rawLine of stack.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (!line.startsWith('at ')) continue;
    const body = line.slice(3).trim();

    let functionName = '[anonymous]';
    let file = '';
    let line1: number | undefined;
    let col0: number | undefined;

    // Pattern: `fn (file:line:col)` or `fn (native)`
    const parenMatch = /^(.*?)\s*\(([^)]*)\)$/.exec(body);
    if (parenMatch) {
      functionName = parenMatch[1].trim() || '[anonymous]';
      const loc = parenMatch[2].trim();
      const locMatch = /^(.*?):(\d+):(\d+)$/.exec(loc);
      if (locMatch) {
        file = locMatch[1];
        line1 = Number(locMatch[2]);
        col0 = Number(locMatch[3]);
      } else {
        file = loc;
      }
    } else {
      // Pattern: `file:line:col` (anonymous frame)
      const locMatch = /^(.*?):(\d+):(\d+)$/.exec(body);
      if (locMatch) {
        file = locMatch[1];
        line1 = Number(locMatch[2]);
        col0 = Number(locMatch[3]);
      } else {
        file = body;
      }
    }

    const filtered = isRuntimeFrame(file) || isNativeFrame(file, functionName);
    frames.push({ functionName, file, line1, col0, filtered, raw: rawLine });
  }
  return frames;
}

/**
 * Link a parsed frame to its authored source via the map loader.
 * Resolves source maps for frames that point into bundled/minified files.
 */
export async function resolveFrames(
  frames: StackFrame[],
  loader: SourceMapLoader,
): Promise<ResolvedStack> {
  let filteredCount = 0;
  let linkedCount = 0;
  const cache = new Map<string, SourceMapData | undefined>();

  for (const frame of frames) {
    if (frame.filtered) {
      filteredCount++;
      continue;
    }
    if (frame.line1 === undefined || !frame.file) continue;

    let map = cache.get(frame.file);
    if (map === undefined && !cache.has(frame.file)) {
      try {
        map = await loader.load(frame.file);
      } catch {
        map = undefined;
      }
      cache.set(frame.file, map);
    }
    if (!map) continue;

    const orig = originalPositionFor(map, frame.line1, frame.col0 ?? 0);
    if (orig && orig.source !== frame.file) {
      frame.original = orig;
      linkedCount++;
    }
  }

  return { frames, filteredCount, linkedCount };
}

/** Convenience wrapper: parse then resolve. */
export async function linkStackTrace(
  stack: string | undefined,
  loader: SourceMapLoader,
): Promise<ResolvedStack> {
  return resolveFrames(parseStack(stack), loader);
}