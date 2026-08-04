import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseV8Trace } from '../src/shared/engine/jit-parser';
import { analyzeJit } from '../src/shared/engine/jit-analysis';

const demoRaw = readFileSync(resolve(__dirname, '../examples/v8-jit-trace.log'), 'utf8');

describe('analyzeJit on the bundled demo trace', () => {
  const trace = parseV8Trace(demoRaw);
  const analysis = analyzeJit(trace);

  it('aggregates IC sites and derives megamorphic state', () => {
    expect(analysis.sites.length).toBeGreaterThanOrEqual(4);
    const hot = analysis.sites.find(s => s.kind === 'LoadIC' && s.site === 'demo.js:8:25');
    expect(hot).toBeDefined();
    expect(hot!.maps.length).toBe(8);
    expect(hot!.state).toBe('megamorphic');
    expect(hot!.hits).toBe(8);
  });

  it('detects the megamorphic IC anti-pattern', () => {
    const megamorphic = analysis.findings.filter(f => f.rule === 'megamorphic-ic');
    expect(megamorphic.length).toBeGreaterThanOrEqual(1);
    const hot = megamorphic.find(f => f.target.includes('demo.js:8:25'))!;
    expect(hot.severity).toBe('critical');
    expect(hot.evidence.length).toBeGreaterThan(0);
  });

  it('detects the deopt storm in buildUser', () => {
    const storm = analysis.findings.find(f => f.rule === 'deopt-storm');
    expect(storm).toBeDefined();
    expect(storm!.detail).toContain('buildUser');
    const fn = analysis.functions.find(f => f.name === 'buildUser');
    expect(fn?.deoptCount).toBe(4);
    expect(fn?.maxDeoptBurst).toBeGreaterThanOrEqual(3);
  });

  it('detects the optimize/deopt loop in aggregate', () => {
    const loop = analysis.findings.find(f => f.rule === 'deopt-loop');
    expect(loop).toBeDefined();
    expect(loop!.target).toBe('aggregate');
  });

  it('detects hidden-class fragmentation near the store site', () => {
    const frag = analysis.findings.find(f => f.rule === 'hidden-class-fragmentation');
    expect(frag).toBeDefined();
    expect(frag!.target).toBe('demo.js:6');
    expect(frag!.evidence.some(e => e.includes('Map transition'))).toBe(true);
  });

  it('detects optimization suppression for legacyWrap', () => {
    const suppressed = analysis.findings.find(f => f.rule === 'optimization-suppressed');
    expect(suppressed).toBeDefined();
    expect(suppressed!.target).toBe('legacyWrap');
  });

  it('builds a graph with map and site nodes plus transitions', () => {
    const { nodes, edges } = analysis.graph;
    expect(nodes.some(n => n.type === 'site')).toBe(true);
    expect(nodes.some(n => n.type === 'map')).toBe(true);
    expect(edges.some(e => e.kind === 'transition')).toBe(true);
    expect(edges.some(e => e.kind === 'observed')).toBe(true);
    // Map count ≥ number of distinct map addresses in the trace
    expect(nodes.length).toBeGreaterThanOrEqual(15);
  });

  it('computes a health score', () => {
    expect(analysis.healthScore).toBeGreaterThan(0);
    expect(analysis.healthScore).toBeLessThanOrEqual(1);
  });

  it('aggregates all functions mentioned in opt/deopt', () => {
    const names = analysis.functions.map(f => f.name);
    expect(names).toContain('buildUser');
    expect(names).toContain('renderUser');
    expect(names).toContain('legacyWrap');
    expect(names).toContain('aggregate');
  });
});

describe('analyzeJit with relaxed thresholds', () => {
  it('stops flagging storms when threshold is above the observed burst', () => {
    const trace = parseV8Trace(demoRaw);
    const analysis = analyzeJit(trace, { stormThreshold: 10, stormWindow: 100, megamorphicMapThreshold: 20, fragmentationThreshold: 20 });
    expect(analysis.findings.some(f => f.rule === 'deopt-storm')).toBe(false);
    expect(analysis.findings.some(f => f.rule === 'megamorphic-ic')).toBe(false);
  });
});
