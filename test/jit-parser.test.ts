import { describe, it, expect } from 'vitest';
import { parseV8Trace, icSiteKey } from '../src/shared/engine/jit-parser';

const SAMPLE = `# demo
LoadIC[0] (0x1c000000) at demo.js:8:25 offset 17: [key: name] map 0x02d800000001
LoadIC[0] (0x1c000000) at demo.js:8:25 offset 17: [key: name] map 0x02d80000000a
StoreIC (0x1d000000) at demo.js:6:13 offset 42: [key: id] map 0x02d800000038 0x02d800000041
KeyedStoreIC[1] at demo.js:30:10 offset 4: [key: 0] map 0x02d8000000b1 [slow]
CallIC (0x1e000000) at demo.js:9:31 offset 66: [key: getUser] map 0x02d800000001
[marking 0x02c800000001 <SharedFunctionInfo buildUser> for optimized recompilation, reason: SmallFunction]
[compiling method 0x02c800000001 <SharedFunctionInfo buildUser> using TurboFan]
[optimizing 0x02c800000001 <SharedFunctionInfo buildUser> - took 0.012 ms]
[disabled optimization for 0x02c800000003 <SharedFunctionInfo legacyWrap>, reason: NeverOptimize]
[deoptimizing (DEOPT eager): begin 0x02c800000001 <buildUser> at demo.js:6:13]
[bailout (kind: deopt-eager, reason: Map check)]
[deoptimizing (DEOPT eager): end 0x02c800000001 <buildUser>]
Map transition from 0x02d800000038 to 0x02d800000041 for "name" at demo.js:6:13
unrelated line that should be ignored
`;

describe('parseV8Trace', () => {
  it('parses IC events with kind, site, key and maps', () => {
    const trace = parseV8Trace(SAMPLE);
    expect(trace.icEvents.length).toBe(5);

    const load = trace.icEvents[0];
    expect(load.kind).toBe('LoadIC');
    expect(load.site).toBe('demo.js:8:25');
    expect(load.offset).toBe(17);
    expect(load.key).toBe('name');
    expect(load.maps).toEqual(['0x02d800000001']);
    expect(load.state).toBe('monomorphic');
  });

  it('derives polymorphic state from multiple maps', () => {
    const trace = parseV8Trace(SAMPLE);
    const store = trace.icEvents[2];
    expect(store.maps).toEqual(['0x02d800000038', '0x02d800000041']);
    expect(store.state).toBe('polymorphic');
  });

  it('honours explicit slow/megamorphic state words', () => {
    const trace = parseV8Trace(SAMPLE);
    const keyed = trace.icEvents[3];
    expect(keyed.state).toBe('megamorphic');
  });

  it('parses opt events including disabled/NeverOptimize', () => {
    const trace = parseV8Trace(SAMPLE);
    expect(trace.optEvents.length).toBe(4);
    const optimized = trace.optEvents.find(e => e.kind === 'optimized');
    expect(optimized?.name).toBe('buildUser');
    expect(optimized?.tookMs).toBe(0.012);
    const disabled = trace.optEvents.find(e => e.kind === 'disabled');
    expect(disabled?.reason).toBe('NeverOptimize');
  });

  it('parses deopt begin/end pairs and attaches bailout reason', () => {
    const trace = parseV8Trace(SAMPLE);
    const begins = trace.deoptEvents.filter(e => e.raw.includes('begin'));
    expect(begins.length).toBe(1);
    expect(begins[0].name).toBe('buildUser');
    expect(begins[0].site).toBe('demo.js:6:13');
    expect(begins[0].reason).toBe('Map check');
  });

  it('parses map transitions', () => {
    const trace = parseV8Trace(SAMPLE);
    expect(trace.mapTransitions.length).toBe(1);
    expect(trace.mapTransitions[0].from).toBe('0x02d800000038');
    expect(trace.mapTransitions[0].to).toBe('0x02d800000041');
    expect(trace.mapTransitions[0].property).toBe('name');
  });

  it('tracks files and ignores unrelated lines', () => {
    const trace = parseV8Trace(SAMPLE);
    expect(trace.files).toContain('demo.js');
    expect(trace.lineCount).toBeGreaterThan(0);
  });

  it('icSiteKey includes kind and site', () => {
    expect(icSiteKey('LoadIC', 'demo.js:8:25')).toBe('LoadIC@demo.js:8:25');
  });
});
