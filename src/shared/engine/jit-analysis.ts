import type {
  V8Trace, JitAnalysis, JitFinding, FindingSeverity, IcSiteSummary, FunctionSummary,
  IcGraphNode, IcGraphEdge, IcState,
} from '../types/jit';
import { icSiteKey } from './jit-parser';

/** Rule configuration. Exposed so the UI / CLI can tune thresholds. */
export interface JitAnalysisOptions {
  /** A call site with more than this many distinct hidden classes is megamorphic. */
  megamorphicMapThreshold: number;
  /** A function deoptimizing this many times within `stormWindow` events is a storm. */
  stormThreshold: number;
  /** Deopt storm window in trace-event units (trace lines have no wall-clock time). */
  stormWindow: number;
  /** A source line whose store sites observe this many distinct maps is fragmented. */
  fragmentationThreshold: number;
}

export const DEFAULT_JIT_OPTIONS: JitAnalysisOptions = {
  megamorphicMapThreshold: 4,
  stormThreshold: 3,
  stormWindow: 40,
  fragmentationThreshold: 3,
};

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function severityFromScore(score: number): FindingSeverity {
  if (score >= 0.7) return 'critical';
  if (score >= 0.35) return 'warning';
  return 'info';
}

/** Max deopts inside any sliding window of `windowSize` events. */
function maxBurst(seqs: number[], windowSize: number): number {
  if (seqs.length === 0) return 0;
  const sorted = [...seqs].sort((a, b) => a - b);
  let max = 1;
  let lo = 0;
  for (let hi = 0; hi < sorted.length; hi++) {
    while (sorted[hi] - sorted[lo] > windowSize) lo++;
    max = Math.max(max, hi - lo + 1);
  }
  return max;
}

export function analyzeJit(trace: V8Trace, options: JitAnalysisOptions = DEFAULT_JIT_OPTIONS): JitAnalysis {
  // ---- 1. Aggregate IC sites -------------------------------------------------
  const siteMap = new Map<string, IcSiteSummary>();
  for (const ev of trace.icEvents) {
    const id = icSiteKey(ev.kind, ev.site);
    let site = siteMap.get(id);
    if (!site) {
      site = {
        id,
        kind: ev.kind,
        site: ev.site,
        offset: ev.offset,
        maps: [],
        hits: 0,
        state: 'uninitialized',
        keys: [],
      };
      siteMap.set(id, site);
    }
    site.hits++;
    for (const m of ev.maps) {
      if (!site.maps.includes(m)) site.maps.push(m);
    }
    if (ev.key && !site.keys.includes(ev.key)) site.keys.push(ev.key);
    site.state = deriveSiteState(site.maps.length);
  }
  const sites = Array.from(siteMap.values()).sort((a, b) => b.hits - a.hits);

  // ---- 2. Aggregate functions ------------------------------------------------
  const fnMap = new Map<string, FunctionSummary>();
  const fnDeoptSeqs = new Map<string, number[]>();
  const fnKeyByAddr = new Map<string, string>();
  const getFn = (address: string | null, name: string | null): string => {
    if (address && fnKeyByAddr.has(address)) return fnKeyByAddr.get(address)!;
    const key = address ?? name ?? 'unknown';
    if (!fnMap.has(key)) {
      fnMap.set(key, {
        name: name ?? address ?? 'unknown',
        address,
        optCount: 0,
        deoptCount: 0,
        reoptCount: 0,
        compiler: null,
        status: 'none',
        reasons: [],
        maxDeoptBurst: 0,
      });
      if (address) fnKeyByAddr.set(address, key);
    }
    return key;
  };

  const optSeqsByFn = new Map<string, number[]>();
  for (const ev of trace.optEvents) {
    const key = getFn(ev.address, ev.name);
    const fn = fnMap.get(key)!;
    if (ev.kind === 'optimized' || ev.kind === 'osr' || ev.kind === 'reoptimize') {
      fn.optCount++;
      if (ev.compiler) fn.compiler = ev.compiler;
      const arr = optSeqsByFn.get(key) ?? [];
      arr.push(ev.seq);
      optSeqsByFn.set(key, arr);
      fn.status = 'optimized';
    }
    if (ev.kind === 'disabled') {
      fn.status = 'disabled';
      if (ev.reason) fn.reasons.push(ev.reason);
    }
    if (ev.kind === 'marking' && ev.reason && !fn.reasons.includes(ev.reason)) {
      fn.reasons.push(ev.reason);
    }
    if (ev.reason === 'NeverOptimize') fn.status = 'never';
  }

  for (const ev of trace.deoptEvents) {
    // Each V8 deopt produces a begin/end pair — count one deopt per begin.
    if (!ev.raw.includes('begin')) continue;
    const key = getFn(ev.address, ev.name);
    const fn = fnMap.get(key)!;
    fn.deoptCount++;
    const arr = fnDeoptSeqs.get(key) ?? [];
    arr.push(ev.seq);
    fnDeoptSeqs.set(key, arr);
    if (ev.reason && !fn.reasons.includes(ev.reason)) fn.reasons.push(ev.reason);
  }

  const functions: FunctionSummary[] = [];
  for (const [key, fn] of fnMap) {
    fn.maxDeoptBurst = maxBurst(fnDeoptSeqs.get(key) ?? [], options.stormWindow);
    // reopt cycle: deopts that happen after at least one optimization
    const optSeqs = optSeqsByFn.get(key) ?? [];
    const deoptSeqs = (fnDeoptSeqs.get(key) ?? []).sort((a, b) => a - b);
    let deoptsAfterOpt = 0;
    if (optSeqs.length > 0) {
      const firstOpt = Math.min(...optSeqs);
      deoptsAfterOpt = deoptSeqs.filter(s => s > firstOpt).length;
    }
    fn.reoptCount = Math.min(fn.optCount, deoptsAfterOpt);
    functions.push(fn);
  }
  functions.sort((a, b) => (b.deoptCount + b.optCount) - (a.deoptCount + a.optCount));

  // ---- 3. Build IC-state / hidden-class migration graph ----------------------
  const graph = buildGraph(trace, sites);

  // ---- 4. Findings -----------------------------------------------------------
  const findings: JitFinding[] = [];

  // Megamorphic IC
  for (const site of sites) {
    if (site.maps.length > options.megamorphicMapThreshold) {
      const excess = site.maps.length - options.megamorphicMapThreshold;
      const score = clamp01(excess / 4);
      findings.push({
        id: `megamorphic-${site.id}`,
        rule: 'megamorphic-ic',
        severity: severityFromScore(score),
        score,
        title: `Megamorphic IC at ${site.site ?? site.kind}`,
        detail: `${site.kind} call site observes ${site.maps.length} distinct hidden classes across ${site.hits} hits (V8 megamorphic threshold is ${options.megamorphicMapThreshold}). The polymorphic dispatch cost applies on every call.`,
        target: site.site ?? site.kind,
        evidence: trace.icEvents.filter(e => icSiteKey(e.kind, e.site) === site.id).slice(0, 3).map(e => e.raw),
      });
    }
  }

  // Deopt storm + deopt loop
  for (const fn of functions) {
    if (fn.deoptCount === 0) continue;
    if (fn.maxDeoptBurst >= options.stormThreshold) {
      const score = clamp01(fn.maxDeoptBurst / 10);
      findings.push({
        id: `deopt-storm-${fn.name}`,
        rule: 'deopt-storm',
        severity: severityFromScore(score),
        score,
        title: `Deopt storm in function ${fn.name}`,
        detail: `${fn.name} deoptimized ${fn.deoptCount} times total, with a burst of ${fn.maxDeoptBurst} deopts within ${options.stormWindow} trace events (threshold ${options.stormThreshold}). Re-execution through the slow interpreter path is likely dominating this hot function.`,
        target: fn.name,
        evidence: trace.deoptEvents.filter(e => (e.address ?? e.name) === (fn.address ?? fn.name)).slice(0, 3).map(e => e.raw),
      });
    }
    if (fn.reoptCount >= 2) {
      findings.push({
        id: `deopt-loop-${fn.name}`,
        rule: 'deopt-loop',
        severity: 'warning',
        score: clamp01(0.4 + fn.reoptCount * 0.05),
        title: `Optimize/deoptimize loop in ${fn.name}`,
        detail: `${fn.name} was optimized ${fn.optCount} times and re-deoptimized after optimization ${fn.reoptCount} times. V8 keeps paying compile + bailout costs.`,
        target: fn.name,
        evidence: [],
      });
    }
  }

  // Hidden-class fragmentation
  const lineBuckets = new Map<string, { siteIds: string[]; maps: string[]; hits: number }>();
  for (const site of sites) {
    const pos = site.site ?? '';
    const line = pos.split(':').slice(0, 2).join(':');
    if (!line) continue;
    let bucket = lineBuckets.get(line);
    if (!bucket) {
      bucket = { siteIds: [], maps: [], hits: 0 };
      lineBuckets.set(line, bucket);
    }
    bucket.siteIds.push(site.id);
    bucket.hits += site.hits;
    for (const m of site.maps) {
      if (!bucket.maps.includes(m)) bucket.maps.push(m);
    }
  }
  for (const [line, bucket] of lineBuckets) {
    if (bucket.maps.length > options.fragmentationThreshold) {
      const score = clamp01(bucket.maps.length / 8);
      findings.push({
        id: `fragmentation-${line}`,
        rule: 'hidden-class-fragmentation',
        severity: severityFromScore(score),
        score,
        title: `Hidden-class fragmentation near ${line}`,
        detail: `Objects built near ${line} drift across ${bucket.maps.length} distinct hidden classes (${bucket.hits} hits). The creation path likely adds properties in inconsistent order or with mixed value types, so every object gets its own map and no store IC ever stays monomorphic.`,
        target: line,
        evidence: trace.mapTransitions.filter(mt => (mt.site ?? '').startsWith(line)).slice(0, 3).map(m => m.raw),
      });
    }
  }

  // Optimization suppressed
  for (const fn of functions) {
    if (fn.status === 'never' || fn.status === 'disabled') {
      findings.push({
        id: `opt-suppressed-${fn.name}`,
        rule: 'optimization-suppressed',
        severity: 'warning',
        score: 0.8,
        title: `Optimization suppressed for ${fn.name}`,
        detail: `${fn.name} is excluded from TurboFan optimization${fn.reasons.length ? ` (reason: ${fn.reasons.join(', ')})` : ''}. It will always run on the interpreter.`,
        target: fn.name,
        evidence: trace.optEvents.filter(e => (e.address ?? e.name) === (fn.address ?? fn.name) && (e.kind === 'disabled')).slice(0, 2).map(e => e.raw),
      });
    }
  }

  // ---- 5. Overall health -----------------------------------------------------
  const totalScore = findings.reduce((s, f) => s + f.score, 0);
  const healthScore = clamp01(1 - totalScore * 0.12);

  return { trace, sites, functions, graph, findings, patches: [], healthScore };
}

function deriveSiteState(mapCount: number): IcState {
  if (mapCount === 0) return 'uninitialized';
  if (mapCount === 1) return 'monomorphic';
  if (mapCount <= 4) return 'polymorphic';
  return 'megamorphic';
}

function buildGraph(trace: V8Trace, sites: IcSiteSummary[]): JitAnalysis['graph'] {
  const nodeById = new Map<string, IcGraphNode>();
  const edgeKey = new Set<string>();
  const edges: IcGraphEdge[] = [];
  const pushEdge = (source: string, target: string, kind: 'observed' | 'transition', property: string | null, weight: number) => {
    const key = `${source}->${target}:${kind}`;
    if (edgeKey.has(key)) {
      const e = edges.find(x => `${x.source}->${x.target}:${x.kind}` === key);
      if (e) e.weight += weight;
      return;
    }
    edgeKey.add(key);
    edges.push({ source, target, kind, property, weight });
  };
  const ensureNode = (id: string, make: () => IcGraphNode): IcGraphNode => {
    let n = nodeById.get(id);
    if (!n) {
      n = make();
      nodeById.set(id, n);
    }
    return n;
  };

  const mapKeyCount = new Map<string, number>();
  for (const ev of trace.icEvents) {
    for (const m of ev.maps) mapKeyCount.set(m, (mapKeyCount.get(m) ?? 0) + 1);
  }

  for (const site of sites) {
    ensureNode(site.id, () => ({
      id: site.id,
      type: 'site',
      label: `${site.kind} ${site.site ?? ''}`.trim(),
      props: site.keys,
      ref: site.id,
      count: site.hits,
      state: site.state,
      file: site.site ? site.site.split(':')[0] : null,
    }));
    for (const m of site.maps) {
      ensureNode(m, () => ({
        id: m,
        type: 'map',
        label: m,
        props: [],
        ref: m,
        count: mapKeyCount.get(m) ?? 0,
        state: null,
        file: null,
      }));
      pushEdge(site.id, m, 'observed', null, 1);
    }
    // Union of keys observed on this site's maps.
    for (const m of site.maps) {
      const node = nodeById.get(m);
      if (!node) continue;
      for (const k of site.keys) {
        if (!node.props.includes(k)) node.props.push(k);
      }
    }
  }

  for (const mt of trace.mapTransitions) {
    ensureNode(mt.from, () => ({
      id: mt.from, type: 'map', label: mt.from, props: [], ref: mt.from, count: 0, state: null, file: null,
    }));
    ensureNode(mt.to, () => ({
      id: mt.to, type: 'map', label: mt.to, props: [], ref: mt.to, count: 0, state: null, file: null,
    }));
    if (mt.property) {
      const to = nodeById.get(mt.to)!;
      if (!to.props.includes(mt.property)) to.props.push(mt.property);
    }
    pushEdge(mt.from, mt.to, 'transition', mt.property, 1);
  }

  return { nodes: Array.from(nodeById.values()), edges };
}
