import type {
  V8Trace, IcEvent, IcKind, IcState, MapTransition, OptEvent, DeoptEvent,
} from '../types/jit';

/**
 * Tolerant parser for combined V8 JIT trace output
 * (`--trace-ic`, `--trace-opt`, `--trace-deopt`, and optionally `--trace-maps`).
 *
 * V8's log format has changed across versions, so every matcher is permissive:
 * unknown lines are skipped, and fields are best-effort.
 */

const IC_KIND_RE = /\b([A-Za-z]+(?:IC|BCH|MEG))\b/;
const SITE_RE = /\bat\s+(\S+)/;
const OFFSET_RE = /\boffset\s+(\d+)/;
const KEY_RE = /\[key:\s*([^\]]*)\]/;
const HEX_RE = /0x[0-9a-f]+/gi;

/** Remove the IC object address that follows the kind, e.g. "(0x2e1c...)". */
function stripIcObjectAddress(line: string): string {
  return line.replace(/^\s*\[?\s*[A-Za-z]+(?:IC|BCH|MEG)\s*(?:\[\d+\])?\s*(?:in optimized code)?\s*\]?\s*\(0x[0-9a-f]+\)/, '');
}

function collectMaps(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of text.matchAll(HEX_RE)) {
    const addr = m[0];
    if (!seen.has(addr)) {
      seen.add(addr);
      out.push(addr);
    }
  }
  return out;
}

function deriveIcState(mapCount: number): IcState {
  if (mapCount === 0) return 'uninitialized';
  if (mapCount === 1) return 'monomorphic';
  if (mapCount <= 4) return 'polymorphic';
  return 'megamorphic';
}

function parseIcLine(line: string, seq: number): IcEvent | null {
  const kindMatch = line.match(IC_KIND_RE);
  if (!kindMatch) return null;
  const kind = kindMatch[1] as IcKind | string;

  const siteMatch = line.match(SITE_RE);
  const offsetMatch = line.match(OFFSET_RE);
  const keyMatch = line.match(KEY_RE);

  const stripped = stripIcObjectAddress(line);
  const maps = collectMaps(stripped);

  let state: IcState = deriveIcState(maps.length);
  const stateWord = line.match(/\b(slow|megamorphic|polymorphic|monomorphic|uninitialized|generic)\b/i);
  if (stateWord) {
    const w = stateWord[1].toLowerCase();
    if (w === 'slow' || w === 'generic') state = 'megamorphic';
    else state = w as IcState;
  }

  return {
    seq,
    kind,
    site: siteMatch ? siteMatch[1] : null,
    offset: offsetMatch ? parseInt(offsetMatch[1], 10) : null,
    key: keyMatch ? keyMatch[1].trim() : null,
    state,
    maps,
    raw: line.trim(),
  };
}

const OPT_REs = [
  { kind: 'marking' as const, re: /^\[marking (0x[0-9a-f]+) <SharedFunctionInfo ([^>]*)>.*reason:\s*([^,\]]+)/ },
  { kind: 'disabled' as const, re: /^\[disabled optimization for (0x[0-9a-f]+) <SharedFunctionInfo ([^>]*)>.*reason:\s*([^,\]]+)/ },
  { kind: 'compiling' as const, re: /^\[compiling method (0x[0-9a-f]+) <SharedFunctionInfo ([^>]*)> using ([A-Za-z]+)\]/ },
  { kind: 'optimized' as const, re: /^\[optimizing (0x[0-9a-f]+) <SharedFunctionInfo ([^>]*)>\s*(?:-\s*took ([0-9.]+) ms)?\]/ },
  { kind: 'reoptimize' as const, re: /^\[reoptimizing (0x[0-9a-f]+) <SharedFunctionInfo ([^>]*)>/ },
];

function parseOptLine(line: string, seq: number): OptEvent | null {
  for (const { kind, re } of OPT_REs) {
    const m = line.match(re);
    if (!m) continue;
    const isOsr = /\bOSR\b/.test(line);
    return {
      seq,
      kind: isOsr && kind === 'compiling' ? 'osr' : kind,
      address: m[1],
      name: m[2] || null,
      compiler: m[3] && /^[A-Za-z]+$/.test(m[3]) && m[3] !== 'SharedFunctionInfo' ? m[3] : null,
      reason: m[3] && /^[A-Za-z]+$/.test(m[3]) ? m[3] : m[3] ?? null,
      tookMs: kind === 'optimized' && m[3] ? parseFloat(m[3]) : null,
      raw: line.trim(),
    };
  }
  return null;
}

const DEOPT_BEGIN_RE = /^\[deoptimizing \(DEOPT (\w+)\): begin (0x[0-9a-f]+) <([^>]*)>(?:\s+at\s+(\S+))?\]/;
const DEOPT_END_RE = /^\[deoptimizing \(DEOPT (\w+)\): end (0x[0-9a-f]+) <([^>]*)>/;
const BAILOUT_RE = /^\[bailout \(kind: deopt-(\w+), reason: ([^)\]]+)\)\]/;

function parseDeoptLine(line: string, seq: number, pendingReason: string | null): DeoptEvent | null {
  const begin = line.match(DEOPT_BEGIN_RE);
  if (begin) {
    return {
      seq,
      kind: begin[1],
      address: begin[2],
      name: begin[3],
      site: begin[4] || null,
      reason: pendingReason,
      raw: line.trim(),
    };
  }
  const end = line.match(DEOPT_END_RE);
  if (end) {
    return {
      seq,
      kind: end[1],
      address: end[2],
      name: end[3],
      site: null,
      reason: pendingReason,
      raw: line.trim(),
    };
  }
  return null;
}

const MAP_TRANSITION_RE = /transition from (0x[0-9a-f]+) to (0x[0-9a-f]+)(?:\s+for\s+"([^"]+)")?(?:\s+at\s+(\S+))?/;

function parseMapTransition(line: string, seq: number): MapTransition | null {
  if (!/^Map.*transition/.test(line)) return null;
  const m = line.match(MAP_TRANSITION_RE);
  if (!m) return null;
  return {
    seq,
    from: m[1],
    to: m[2],
    property: m[3] || null,
    site: m[4] || null,
    raw: line.trim(),
  };
}

/** Parse a combined V8 --trace-ic / --trace-opt / --trace-deopt log. */
export function parseV8Trace(raw: string): V8Trace {
  const lines = raw.split(/\r?\n/);
  const icEvents: IcEvent[] = [];
  const optEvents: OptEvent[] = [];
  const deoptEvents: DeoptEvent[] = [];
  const mapTransitions: MapTransition[] = [];
  const files = new Set<string>();
  let pendingReason: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const seq = i;

    const bailout = line.match(BAILOUT_RE);
    if (bailout) {
      pendingReason = bailout[2];
      // Attach the reason to the most recent begin event (V8 prints the bailout
      // line either before or right after the begin line).
      for (let j = deoptEvents.length - 1; j >= 0; j--) {
        const prev = deoptEvents[j];
        if (!prev.raw.includes('begin')) break;
        if (prev.reason === null) prev.reason = pendingReason;
        break;
      }
      continue;
    }

    const ic = parseIcLine(line, seq);
    if (ic) {
      if (ic.site) {
        const file = ic.site.split(':')[0];
        if (file) files.add(file);
      }
      icEvents.push(ic);
      continue;
    }

    const opt = parseOptLine(line, seq);
    if (opt) {
      optEvents.push(opt);
      continue;
    }

    const deopt = parseDeoptLine(line, seq, pendingReason);
    if (deopt) {
      if (deopt.site) {
        const file = deopt.site.split(':')[0];
        if (file) files.add(file);
      }
      if (/end/.test(line)) pendingReason = null;
      deoptEvents.push(deopt);
      continue;
    }

    const mt = parseMapTransition(line, seq);
    if (mt) {
      if (mt.site) {
        const file = mt.site.split(':')[0];
        if (file) files.add(file);
      }
      mapTransitions.push(mt);
    }
  }

  return {
    icEvents,
    optEvents,
    deoptEvents,
    mapTransitions,
    lineCount: lines.length,
    files: Array.from(files),
  };
}

/** Extract the site key used to aggregate IC events across the trace. */
export function icSiteKey(kind: string, site: string | null): string {
  return `${kind}@${site ?? '<anonymous>'}`;
}
