import { describe, it, expect } from 'vitest';
import {
  parseSourceMap,
  originalPositionFor,
  generatedLinesForOriginal,
  hasMapping,
} from '../src/shared/source/source-map-resolver';
import { parseStack, linkStackTrace, isRuntimeFrame, isNativeFrame, type StackFrame } from '../src/shared/source/code-linker';
import { fromMemory } from '../src/shared/source/fs-access-bridge';

/**
 * A hand-built V3 source map:
 *   sources: ["src/app.ts"], names: ["render"]
 *   mappings: "AAAA;AACA"
 *     line 1 (index 0): genCol 0 -> src 0, origLine 0, origCol 0  (AAAA)
 *     line 2 (index 1): genCol 0 -> src 0, origLine +1, origCol 0 (AACA)
 */
const SAMPLE_MAP = {
  version: 3,
  file: 'app.min.js',
  sources: ['src/app.ts'],
  names: ['render'],
  mappings: 'AAAA;AACA',
};

describe('source-map-resolver', () => {
  it('parses mappings and resolves a generated position to original', () => {
    const map = parseSourceMap(SAMPLE_MAP);
    const orig = originalPositionFor(map, 1, 0)!;
    expect(orig.source).toBe('src/app.ts');
    expect(orig.line1).toBe(1);
    expect(orig.col0).toBe(0);

    const orig2 = originalPositionFor(map, 2, 0)!;
    expect(orig2.source).toBe('src/app.ts');
    expect(orig2.line1).toBe(2);
  });

  it('decodes negative deltas and multiple segments on a line', () => {
    // generated line 1: two segments.
    //   seg1: genCol 0, src 0, line 0, col 0  = AAAA
    //   seg2: genCol +1(C), src 0(A), line +1(C), col -1(D) = CACD
    const map = parseSourceMap({ sources: ['a.ts'], names: [], mappings: 'AAAA,CACD' });
    const first = originalPositionFor(map, 1, 0)!;
    expect(first.line1).toBe(1); // maps back to original line 1
    expect(first.source).toBe('a.ts');
    const second = originalPositionFor(map, 1, 1)!;
    expect(second.line1).toBe(2); // delta +1 from original line 1
    // Column-past-the-last still resolves to the last applicable segment.
    expect(originalPositionFor(map, 1, 9)!.line1).toBe(2);
  });

  it('returns undefined when the generated line has no mapping', () => {
    const map = parseSourceMap(SAMPLE_MAP);
    expect(originalPositionFor(map, 99, 0)).toBeUndefined();
    expect(hasMapping(map, 1)).toBe(true);
    expect(hasMapping(map, 5)).toBe(false);
  });

  it('reverse-maps original source lines back to generated lines', () => {
    const map = parseSourceMap(SAMPLE_MAP);
    const gen = generatedLinesForOriginal(map, 'src/app.ts', 2);
    expect(gen).toContain(2); // original line 2 appears in generated line 2
  });

  it('round-trips through a real-ish VLQ stream without throwing', () => {
    // A longer map mimicking a small bundled output with several generated lines.
    const raw = {
      version: 3,
      sources: ['lib/a.js', 'lib/b.js'],
      names: [],
      mappings: 'AAAA;AACA;ACAA;AACAAA',
    };
    const map = parseSourceMap(raw);
    expect(map.mappings.length).toBe(4);
    expect(originalPositionFor(map, 1, 0)?.source).toBe('lib/a.js');
  });
});

describe('code-linker', () => {
  const SAMPLE_STACK = [
    'Error: boom',
    '    at render (app.min.js:1:5)',
    '    at handler (app.min.js:2:1)',
    '    at Router.handle (node_modules/express/lib/router/index.js:234:5)',
    '    at node:internal/modules/cjs/loader:1030:14',
    '    at * internalBinding * (node:events)',
    '    at node::ProcessWrap::OnExit (node:internal:process)',
  ].join('\n');

  it('parses V8 frames and extracts file:line:col', () => {
    const frames = parseStack(SAMPLE_STACK);
    expect(frames.length).toBe(6);
    const top = frames[0];
    expect(top.functionName).toBe('render');
    expect(top.file).toBe('app.min.js');
    expect(top.line1).toBe(1);
    expect(top.col0).toBe(5);
  });

  it('filters runtime and native frames per the Node filter rules', () => {
    const frames = parseStack(SAMPLE_STACK);
    expect(isRuntimeFrame('node:internal/foo')).toBe(true);
    expect(isRuntimeFrame('node_modules/express/lib/router/index.js')).toBe(false);
    expect(isNativeFrame('node:internal', 'node::ProcessWrap::OnExit')).toBe(true);
    expect(isNativeFrame('x.js', 'render')).toBe(false);

    const flagged = frames.filter((f) => f.filtered).map((f) => f.functionName);
    expect(flagged).toContain('* internalBinding *');
    expect(flagged).toContain('[anonymous]'); // node:internal loader frame
    // node_modules is user app code -> must NOT be flagged.
    expect(flagged).not.toContain('Router.handle');
  });

  it('resolves frames through the in-memory source map loader', async () => {
    const map = parseSourceMap(SAMPLE_MAP);
    const loader = fromMemory({ 'app.min.js': map });
    const resolved = await linkStackTrace(SAMPLE_STACK, loader);
    const render = resolved.frames.find((f) => f.functionName === 'render')!;
    expect(render.original?.source).toBe('src/app.ts');
    expect(render.original?.line1).toBe(1);
    // node_modules frame stays app code and un-linked (no map registered).
    const express = resolved.frames.find((f) => f.file.includes('express'))!;
    expect(express.original).toBeUndefined();
  });

  it('handles anonymous and native-only frames gracefully', () => {
    const frames = parseStack([
      '    at app.min.js:5:10',
      '    at node:events (native)',
    ].join('\n'));
    expect(frames[0].functionName).toBe('[anonymous]');
    expect(frames[0].line1).toBe(5);
    expect(frames[1].filtered).toBe(true);
  });
});
