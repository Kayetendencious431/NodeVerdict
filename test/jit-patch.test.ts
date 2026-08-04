import { describe, it, expect } from 'vitest';
import { generatePatches, verifyPatchEquivalence } from '../src/shared/engine/jit-patch';

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
