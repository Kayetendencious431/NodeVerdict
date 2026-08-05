/**
 * Browser-side Source Map resolver (Source Map V3).
 *
 * Decodes the `mappings` segment of a `.map` file (VLQ/base64) and supports
 * both directions:
 *   forward  — generated (compiled) position -> original source position
 *   reverse  — original source line -> the generated lines it corresponds to
 * (used to overlay trace hot-spots / diff highlights on the original source).
 *
 * The mapping is stored in a compact array-of-arrays form so a project's maps
 * can be held in memory and queried repeatedly without re-parsing. Pure
 * functions only — no DOM/browser APIs, so it is unit-testable in Node.
 */

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_LOOKUP = new Map<string, number>();
for (let i = 0; i < BASE64_CHARS.length; i++) BASE64_LOOKUP.set(BASE64_CHARS[i], i);

/** A single source-map entry. */
export interface SourceMapEntry {
  /** zero-based generated column (accumulated within its generated line). */
  generatedColumn: number;
  /** index into `sources[]`. */
  sourceIndex: number;
  /** zero-based line in the *original* source. */
  originalLine: number;
  /** zero-based column in the *original* source. */
  originalColumn: number;
  /** index into `names[]` (optional). */
  nameIndex?: number;
}

/** Maps a generated line index to its decoded entries (columns ascending). */
export type DecodedMappings = SourceMapEntry[][];

export interface SourceMapData {
  version?: number;
  sources: string[];
  names: string[];
  sourceRoot?: string;
  mappings: DecodedMappings;
  sourcesContent?: Array<string | null>;
}

/** Decode a single base64-VLQ value, returning [value, nextIndex]. */
function decodeVlqSegment(str: string, start: number): [number, number] {
  let result = 0;
  let shift = 0;
  let index = start;
  for (;;) {
    const b64 = BASE64_LOOKUP.get(str[index]);
    if (b64 === undefined) throw new Error(`Invalid base64 VLQ digit at index ${index}`);
    index++;
    const digit = b64 & 0b11111; // low 5 bits: value payload
    const cont = (b64 & 0b100000) !== 0; // 6th bit: continuation
    result += digit << shift;
    if (!cont) break;
    shift += 5;
  }
  // Sign bit is the low bit of the accumulator.
  const negate = (result & 1) === 1;
  result >>>= 1;
  if (negate) result = -result;
  return [result, index];
}

/** Converts a 1-based line number to the zero-based index used internally. */
function toIndex0(line1: number): number {
  return line1 - 1;
}
function toLine1(index0: number): number {
  return index0 + 1;
}

/**
 * Parse a Source Map V3 document into `SourceMapData`.
 * @param raw the parsed `.map` JSON object.
 */
export function parseSourceMap(raw: {
  version?: number;
  sources?: string[];
  names?: string[];
  sourceRoot?: string;
  mappings?: string;
  sourcesContent?: Array<string | null>;
}): SourceMapData {
  const sources = raw.sources ?? [];
  const names = raw.names ?? [];
  const mappings: DecodedMappings = [];
  const rawMappings = raw.mappings ?? '';

  // Running offsets following the spec's delta semantics. Generated columns
  // reset to 0 at the start of every generated line; the other four fields
  // carry across the whole file.
  let srcIdx = 0;
  let origLine = 0;
  let origCol = 0;
  let nameIdx = 0;

  let generatedCol = 0;
  let currentLine: SourceMapEntry[] = [];
  mappings.push(currentLine);

  let i = 0;
  while (i < rawMappings.length) {
    const c = rawMappings[i];

    if (c === ';') {
      // Advance to the next generated line; reset generated column.
      generatedCol = 0;
      currentLine = [];
      mappings.push(currentLine);
      i++;
      continue;
    }
    if (c === ',') {
      i++;
      continue;
    }

    // [generatedColumn] [sourceIndex] [originalLine] [originalColumn] [nameIndex]
    let res = decodeVlqSegment(rawMappings, i);
    generatedCol += res[0];
    i = res[1];

    if (i < rawMappings.length && rawMappings[i] !== ';' && rawMappings[i] !== ',') {
      res = decodeVlqSegment(rawMappings, i);
      i = res[1];
      srcIdx += res[0];
    } else {
      continue; // entry with only a generated column (a "hole" segment)
    }
    if (i < rawMappings.length && rawMappings[i] !== ';' && rawMappings[i] !== ',') {
      res = decodeVlqSegment(rawMappings, i);
      i = res[1];
      origLine += res[0];
    }
    if (i < rawMappings.length && rawMappings[i] !== ';' && rawMappings[i] !== ',') {
      res = decodeVlqSegment(rawMappings, i);
      i = res[1];
      origCol += res[0];
    }
    const entry: SourceMapEntry = {
      generatedColumn: generatedCol,
      sourceIndex: srcIdx,
      originalLine: origLine,
      originalColumn: origCol,
    };
    if (i < rawMappings.length && rawMappings[i] !== ';' && rawMappings[i] !== ',') {
      res = decodeVlqSegment(rawMappings, i);
      i = res[1];
      nameIdx += res[0];
      entry.nameIndex = nameIdx;
    }
    currentLine.push(entry);
  }

  return {
    version: raw.version,
    sources,
    names,
    sourceRoot: raw.sourceRoot,
    mappings,
    sourcesContent: raw.sourcesContent,
  };
}

/**
 * Resolve a generated position to its corresponding original source position.
 * Returns undefined if the generated position has no mapping.
 */
export function originalPositionFor(
  map: SourceMapData,
  generatedLine1: number,
  generatedCol0: number,
): { source: string; line1: number; col0: number; name?: string } | undefined {
  const lineIdx = toIndex0(generatedLine1);
  if (lineIdx < 0 || lineIdx >= map.mappings.length) return undefined;
  const entries = map.mappings[lineIdx];
  if (entries.length === 0) return undefined;

  // Columns are ascending; find the last entry with col <= generatedCol.
  let lo = 0;
  let hi = entries.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (entries[mid].generatedColumn <= generatedCol0) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (best < 0) return undefined;
  const e = entries[best];
  const source = map.sources[e.sourceIndex] ?? '';
  return {
    source,
    line1: toLine1(e.originalLine),
    col0: e.originalColumn,
    name: e.nameIndex !== undefined ? map.names[e.nameIndex] : undefined,
  };
}

/**
 * Reverse lookup: given an original source + line, return the generated
 * (compiled) lines that call into it. Used to overlay hot-spots on source.
 */
export function generatedLinesForOriginal(
  map: SourceMapData,
  sourcePath: string,
  originalLine1: number,
): number[] {
  const srcIdx = map.sources.indexOf(sourcePath);
  if (srcIdx < 0) return [];
  const out: number[] = [];
  for (let i = 0; i < map.mappings.length; i++) {
    const entries = map.mappings[i];
    if (entries.length === 0) continue;
    for (const e of entries) {
      if (e.sourceIndex === srcIdx && e.originalLine === toIndex0(originalLine1)) {
        out.push(i + 1);
        break;
      }
    }
  }
  return out;
}

/** Convenience: does the map cover the given generated line at all? */
export function hasMapping(map: SourceMapData, generatedLine1: number): boolean {
  const lineIdx = toIndex0(generatedLine1);
  return lineIdx >= 0 && lineIdx < map.mappings.length && map.mappings[lineIdx].length > 0;
}