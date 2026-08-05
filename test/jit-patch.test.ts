import { describe, it, expect } from 'vitest';
import {
  generatePatches, verifyPatchEquivalence, analyzeKeyShapes,
  scanFunctions, fixSourceForFindings, applySourcePatches,
} from '../src/shared/engine/jit-patch';
import type { JitFinding } from '../src/shared/types/jit';

describe('object-literal-key-order patches', () => {
  const src = `function makeUser(id, name) {
  const a = { id, name, age: 0 };
  const b = { name, age: 0, id };
  const c = { id, name, age: 0 };
  return [a, b, c];
}`;

  it('generates a patch that canonicalizes property order', () => {
    const patches = generatePatches(src);
    const keyOrder = patches.filter(p => p.strategy === 'object-literal-key-order');
    expect(keyOrder.length).toBeGreaterThanOrEqual(1);
    for (const p of keyOrder) {
      expect(p.equivalence.passed).toBe(true);
      expect(p.after).toContain('id');
      expect(p.after).toContain('name');
      expect(p.after).toContain('age');
      // canonical order should be alphabetic: age, id, name
      const aPos = p.after.indexOf('age');
      const iPos = p.after.indexOf('id');
      const nPos = p.after.indexOf('name');
      expect(aPos).toBeLessThan(iPos);
      expect(iPos).toBeLessThan(nPos);
    }
  });
});

describe('field-initialization-order patches', () => {
  const src = `function buildPoint(x, y) {
  const p = {};
  p.y = y;
  p.x = x;
  return p;
}`;

  it('reorders consecutive object-member assignments', () => {
    const patches = generatePatches(src);
    const init = patches.filter(p => p.strategy === 'field-initialization-order');
    expect(init.length).toBeGreaterThanOrEqual(1);
    const p = init[0];
    expect(p.equivalence.passed).toBe(true);
    // x must be assigned before y in the rewritten run
    expect(p.after.indexOf('p.x = x')).toBeLessThan(p.after.indexOf('p.y = y'));
  });

  it('does not touch already-ordered code', () => {
    const ok = `function buildPoint(x, y) {
  const p = {};
  p.x = x;
  p.y = y;
  return p;
}`;
    const patches = generatePatches(ok);
    expect(patches.filter(p => p.strategy === 'field-initialization-order')).toHaveLength(0);
  });
});

describe('verifyPatchEquivalence', () => {
  it('passes for key-order rewrites', () => {
    const before = 'const o = { b: 1, a: 2 };';
    const after = 'const o = { a: 2, b: 1 };';
    expect(verifyPatchEquivalence(before, after, 'object-literal-key-order').passed).toBe(true);
  });

  it('fails when values change', () => {
    const before = 'const o = { b: 1, a: 2 };';
    const after = 'const o = { a: 3, b: 1 };';
    expect(verifyPatchEquivalence(before, after, 'object-literal-key-order').passed).toBe(false);
  });

  it('fails when keys are dropped', () => {
    const before = 'const o = { b: 1, a: 2 };';
    const after = 'const o = { b: 1 };';
    expect(verifyPatchEquivalence(before, after, 'object-literal-key-order').passed).toBe(false);
  });

  it('passes for init-order rewrites', () => {
    const before = 'const p = {}; p.y = y; p.x = x;';
    const after = 'const p = {}; p.x = x; p.y = y;';
    expect(verifyPatchEquivalence(before, after, 'field-initialization-order').passed).toBe(true);
  });

  it('handles parse failures gracefully', () => {
    const res = verifyPatchEquivalence('const = =', 'const x = 1', 'object-literal-key-order');
    expect(res.passed).toBe(false);
    expect(res.confidence).toBe(0);
  });

  it('ignores nested object literal order differences only for data keys', () => {
    const before = 'const o = { outer: { z: 1, y: 2 }, a: 3 }';
    const after = 'const o = { outer: { y: 2, z: 1 }, a: 3 }';
    expect(verifyPatchEquivalence(before, after, 'object-literal-key-order').passed).toBe(true);
  });
});

describe('generatePatches robustness', () => {
  it('returns an empty list for invalid source', () => {
    expect(generatePatches('const = = =')).toHaveLength(0);
  });

  it('returns an empty list for clean code', () => {
    expect(generatePatches('function f() { return 42; }')).toHaveLength(0);
  });
});

describe('patch metadata for visualization', () => {
  it('exposes keys, canonicalKeys and insertion moves', () => {
    const src = `const a = { b: 1, a: 2, c: 3 };
const b = { a: 2, c: 3, b: 1 };`;
    const p = generatePatches(src).find(x => x.strategy === 'object-literal-key-order');
    expect(p).toBeDefined();
    expect(p!.keys).toEqual(['b', 'a', 'c']);
    expect(p!.canonicalKeys).toEqual(['a', 'b', 'c']);
    expect(p!.moves.length).toBeGreaterThan(0);
    // applying the moves to keys must reproduce the canonical order
    const board = [...p!.keys];
    for (const m of p!.moves) {
      const tmp = board[m.toIdx];
      board[m.toIdx] = board[m.fromIdx];
      board[m.fromIdx] = tmp;
    }
    expect(board).toEqual(p!.canonicalKeys);
  });

  it('analyzeKeyShapes groups identical key sets across insertion orders', () => {
    const src = `const a = { id, name, age: 0 };
const b = { name, age: 0, id };
const c = { age: 0, name, id };
const other = { x: 1, y: 2 };`;
    const shapes = analyzeKeyShapes(src);
    const user = shapes.find(s => s.keys.join('|') === 'age|id|name');
    expect(user).toBeDefined();
    expect(user!.sites).toBe(3);
    expect(user!.orders.length).toBeGreaterThanOrEqual(2);
  });
});

describe('scanFunctions', () => {
  it('finds named functions with line spans', () => {
    const src = `function buildUser(id) { return { id }; }
const make = function makeThing() { return 1; };
const obj = { method() { return 2; } };
class C { go() { return 3; } }
const anon = () => 4;`;
    const fns = scanFunctions(src);
    const names = fns.map(f => f.name).sort();
    // anon arrow has no id -> skipped
    expect(names).toContain('buildUser');
    expect(names).toContain('makeThing');
    expect(names).toContain('method');
    expect(names).toContain('go');
    expect(names).not.toContain('anon');
    const bu = fns.find(f => f.name === 'buildUser')!;
    expect(bu.startLine).toBe(1);
  });
});

describe('fixSourceForFindings (end-to-end)', () => {
  const finding = (over: Partial<JitFinding> & { target: string; id: string }): JitFinding => ({
    rule: 'hidden-class-fragmentation',
    severity: 'warning',
    score: 0.4,
    title: 't',
    detail: 'd',
    evidence: [],
    ...over,
  });

  it('locates a function by name and scopes patches to it', () => {
    const src = `function makeUser(id, name) {
  const a = { id, name, age: 0 };
  const b = { name, age: 0, id };
  return a.id + b.name;
}
function buildUser(id, name) {
  const c = { name, id };
  const d = {};
  d.age = id;
  d.b = name;
  return c.value + d.b;
}`;
    const files = [{ name: 'demo.js', code: src }];
    const fix = fixSourceForFindings(files, [finding({ id: 'frag-1', target: 'buildUser' })])[0];
    expect(fix.scope).toBe('function');
    expect(fix.functionName).toBe('buildUser');
    expect(fix.filename).toBe('demo.js');
    expect(fix.patches.length).toBeGreaterThan(0);
    for (const p of fix.patches) expect(p.findingId).toBe('frag-1');
    // all patch locations must be within buildUser's lines (4-11)
    const fn = scanFunctions(src).find(f => f.name === 'buildUser')!;
    for (const p of fix.patches) {
      const line = Number(/line\s+(\d+)/.exec(p.location)?.[1]);
      expect(line).toBeGreaterThanOrEqual(fn.startLine);
      expect(line).toBeLessThanOrEqual(fn.endLine);
    }
  });

  it('locates by file:line and falls back to file scope when a function is ambiguous', () => {
    const src = `const a = { id, name, age: 0 };
const b = { name, age: 0, id };
const c = { age, name, id };
module.exports = a;`;
    // no function wraps these lines, so top-level -> file scope
    const files = [{ name: 'demo.js', code: src }];
    const fix = fixSourceForFindings(files, [finding({ id: 'frag-2', target: 'demo.js:1' })])[0];
    expect(fix.filename).toBe('demo.js');
    expect(fix.scope).toBe('file');
    expect(fix.patches.length).toBeGreaterThan(0);
  });

  it('reports missingSource when no file matches', () => {
    const files = [{ name: 'other.js', code: 'function makeUser(id){ return {id}; }' }];
    const fix = fixSourceForFindings(files, [finding({ id: 'meg-1', target: 'demo.js:8:25' })])[0];
    expect(fix.missingSource).toBe(true);
    expect(fix.patches).toHaveLength(0);
    expect(fix.scope).toBe('none');
  });
});

describe('applySourcePatches', () => {
  it('rewrites changed regions and leaves the rest intact', () => {
    const src = `const a = { id, name, age: 0 };
const b = { name, age: 0, id };
module.exports = [a, b];`;
    const patches = generatePatches(src);
    expect(patches.length).toBeGreaterThan(0);
    const out = applySourcePatches(src, patches);
    // canonical key order age -> id -> name must be respected
    expect(out).not.toBe(src);
    const agePos = out.indexOf('age: 0');
    const idPos = out.indexOf('id');
    const namePos = out.indexOf('name');
    expect(agePos).toBeLessThan(idPos);
    expect(idPos).toBeLessThan(namePos);
    // count of keys preserved
    expect((out.match(/\bid\b/g) || []).length).toBe((src.match(/\bid\b/g) || []).length);
  });

  it('is idempotent for already-applied patches', () => {
    const src = `const a = { id, name };
const b = { name, id };`;
    const patches = generatePatches(src);
    const once = applySourcePatches(src, patches);
    const twice = applySourcePatches(once, patches);
    expect(twice).toBe(once);
  });
});
