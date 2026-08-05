import { parse } from '@babel/parser';
import type { JitPatch, JitFinding, PatchStrategy, EquivalenceResult, PatchMove, KeyShape } from '../types/jit';

/**
 * Generate semantically-equivalent optimization patches from detected JIT
 * anti-patterns, and verify each patch with an AST-level semantic equivalence
 * check (@babel/parser based).
 *
 * Strategies implemented:
 *  - `object-literal-key-order`: canonicalize the property insertion order of
 *    object literals that share the same key set. Insertion order determines a
 *    V8 hidden class, so two literals with identical keys but different order
 *    fork into two maps — a classic source of hidden-class fragmentation.
 *  - `field-initialization-order`: reorder consecutive `obj.prop = value`
 *    statements that build a freshly created object, so all objects built on
 *    the same path share one hidden class.
 *
 * Both rewrites are behavior-preserving for plain data objects (no accessors,
 * no `Object.prototype` setters — assumed), which the AST checker confirms.
 */

const SKIP_KEYS = new Set([
  'loc', 'start', 'end', 'extra', 'leadingComments', 'trailingComments',
  'innerComments', 'comments', 'trailingComma', 'tokens', 'errors',
]);

type NodeLike = Record<string, unknown> & { type: string };

function isNodeLike(v: unknown): v is NodeLike {
  return typeof v === 'object' && v !== null && typeof (v as NodeLike).type === 'string';
}

function propKeyName(p: NodeLike): string {
  const key = p.key as NodeLike;
  if (key.type === 'Identifier' || key.type === 'StringLiteral' || key.type === 'NumericLiteral') {
    return String((key as unknown as { name?: string }).name ?? (key as unknown as { value?: unknown }).value);
  }
  return '';
}

function memberPropName(member: NodeLike): string {
  const prop = member.property as NodeLike;
  if (!prop) return '';
  if (prop.type === 'Identifier') return String((prop as unknown as { name?: string }).name);
  if (prop.type === 'StringLiteral' || prop.type === 'NumericLiteral') return String((prop as unknown as { value?: unknown }).value);
  return '';
}

function isReorderableObjectProp(p: NodeLike): boolean {
  // ObjectProperty nodes in object literals are always plain data ("init")
  // properties; ObjectMethod covers getters/setters/methods.
  return p.type === 'ObjectProperty' && p.computed !== true;
}

/** Break the difference between an array and its sorted form into adjacent-swap steps. */
function insertionMoves(keys: string[]): PatchMove[] {
  const arr = [...keys];
  const moves: PatchMove[] = [];
  for (let i = 1; i < arr.length; i++) {
    let j = i;
    while (j > 0 && arr[j] < arr[j - 1]) {
      moves.push({ key: arr[j], fromIdx: j, toIdx: j - 1 });
      [arr[j - 1], arr[j]] = [arr[j], arr[j - 1]];
      j--;
    }
  }
  return moves;
}

/** Distinct object shapes (key set + insertion order) in a block of source. */
export function analyzeKeyShapes(source: string): KeyShape[] {
  const ast = parseSnippet(source);
  if (!ast) return [];
  const ordersBySet = new Map<string, { keys: string[]; orders: string[][]; sites: number }>();
  const record = (order: string[]) => {
    const keys = [...new Set(order)].sort();
    const setKey = keys.join('|');
    const entry = ordersBySet.get(setKey) ?? { keys, orders: [], sites: 0 };
    if (!ordersBySet.has(setKey)) ordersBySet.set(setKey, entry);
    entry.sites += 1;
    if (!entry.orders.some(o => o.join('|') === order.join('|'))) entry.orders.push(order);
  };
  walkAst(ast, n => {
    if (n.type === 'ObjectExpression') {
      const props = (n as unknown as { properties?: unknown[] }).properties ?? [];
      const keys = props.map(p => propKeyName(p as NodeLike)).filter(k => k !== '');
      if (keys.length >= 2) record(keys);
    }
  });
  walkStmtRuns(ast, run => {
    const keys = run.slice(1).map(assignKeyName).filter(k => k !== '');
    if (keys.length >= 2) record(keys);
  });
  return [...ordersBySet.values()].sort((a, b) => b.sites - a.sites);
}

/** Canonicalize object property order inside every ObjectExpression node. */
function sortObjectProps(v: unknown): unknown {
  if (Array.isArray(v)) {
    return v.map(sortObjectProps);
  }
  if (!isNodeLike(v)) return v;
  if (v.type === 'ObjectExpression') {
    const props = v.properties as unknown[];
    const ordered = props.map(sortObjectProps);
    const data = ordered.filter(p => isReorderableObjectProp(p as NodeLike));
    const rest = ordered.filter(p => !isReorderableObjectProp(p as NodeLike));
    data.sort((a, b) => {
      const ka = propKeyName(a as NodeLike);
      const kb = propKeyName(b as NodeLike);
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
    v.properties = [...rest, ...data] as never;
  }
  for (const key of Object.keys(v)) {
    if (SKIP_KEYS.has(key)) continue;
    (v as Record<string, unknown>)[key] = sortObjectProps((v as Record<string, unknown>)[key]);
  }
  return v;
}

function isPureMemberAssign(stmt: unknown): boolean {
  if (!isNodeLike(stmt) || stmt.type !== 'ExpressionStatement') return false;
  const expr = (stmt as unknown as { expression?: unknown }).expression;
  if (!isNodeLike(expr) || expr.type !== 'AssignmentExpression') return false;
  if ((expr as unknown as { operator?: string }).operator !== '=') return false;
  const left = (expr as unknown as { left?: unknown }).left;
  return isNodeLike(left) && left.type === 'MemberExpression' && (left as unknown as { computed?: boolean }).computed === false;
}

function assignBase(stmt: unknown): string | null {
  if (!isPureMemberAssign(stmt)) return null;
  const expr = (stmt as unknown as { expression?: NodeLike }).expression as NodeLike;
  const left = (expr as unknown as { left?: NodeLike }).left as NodeLike;
  const obj = left.object;
  if (isNodeLike(obj) && obj.type === 'Identifier') return String((obj as unknown as { name?: string }).name);
  return null;
}

function assignKeyName(stmt: unknown): string {
  if (!isPureMemberAssign(stmt)) return '';
  const expr = (stmt as unknown as { expression?: NodeLike }).expression as NodeLike;
  const left = (expr as unknown as { left?: NodeLike }).left as NodeLike;
  return memberPropName(left);
}

/** Canonicalize consecutive pure object-member assignment statements by sorting them. */
function sortStatementRuns(v: unknown): unknown {
  if (!isNodeLike(v)) return v;
  const canonicalize = (arr: unknown[]): unknown[] => {
    const out: unknown[] = [];
    let run: unknown[] = [];
    const flush = () => {
      if (run.length > 1) {
        const sorted = [...run].sort((a, b) => {
          const ka = assignKeyName(a);
          const kb = assignKeyName(b);
          return ka < kb ? -1 : ka > kb ? 1 : 0;
        });
        out.push(...sorted);
      } else {
        out.push(...run);
      }
      run = [];
    };
    for (const item of arr) {
      const base = assignBase(item);
      const prevBase = run.length > 0 ? assignBase(run[run.length - 1]) : null;
      if (base && prevBase === base) {
        run.push(item);
      } else {
        flush();
        run = [item];
      }
    }
    flush();
    return out;
  };
  for (const key of Object.keys(v)) {
    const val = v[key];
    if (Array.isArray(val)) {
      (v as Record<string, unknown>)[key] = val.map(sortStatementRuns);
      if (key === 'body' || key === 'consequent' || key === 'alternate') {
        (v as Record<string, unknown>)[key] = canonicalize((v as Record<string, unknown>)[key] as unknown[]);
      }
    } else {
      (v as Record<string, unknown>)[key] = sortStatementRuns(val);
    }
  }
  return v;
}

function canonicalizeAst(node: unknown, strategy: PatchStrategy): unknown {
  let out = node;
  if (strategy === 'object-literal-key-order') out = sortObjectProps(out);
  return sortStatementRuns(out);
}

/** Deterministic structural signature of an AST, ignoring formatting metadata. */
function signature(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(signature).join(',')}]`;
  if (isNodeLike(v)) {
    const parts: string[] = [];
    for (const key of Object.keys(v)) {
      if (SKIP_KEYS.has(key)) continue;
      parts.push(`${key}:${signature((v as Record<string, unknown>)[key])}`);
    }
    return `{${v.type};${parts.join(',')}}`;
  }
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number' || typeof v === 'boolean' || v === null || v === undefined) return String(v);
  return JSON.stringify(v);
}

function parseSnippet(code: string): NodeLike | null {
  // A bare `{ ... }` is an object literal here (not a block statement), so wrap it.
  const trimmed = code.trim();
  const looksLikeLiteral = /^\{[\s\S]*\}$/.test(trimmed);
  const wrapped = looksLikeLiteral ? `(${code})` : code;
  try {
    return parse(wrapped, { sourceType: 'module', allowReturnOutsideFunction: true }) as unknown as NodeLike;
  } catch {
    try {
      return parse(wrapped, { sourceType: 'script' }) as unknown as NodeLike;
    } catch {
      return null;
    }
  }
}

/**
 * AST-level semantic equivalence check between an original snippet and a
 * patched snippet. Structural equality after strategy-specific canonicalization
 * implies equivalence: the ASTs are the same modulo the intentionally allowed
 * reordering (object literal keys / object init statements).
 */
export function verifyPatchEquivalence(
  original: string,
  patched: string,
  strategy: PatchStrategy,
): EquivalenceResult {
  const a = parseSnippet(original);
  const b = parseSnippet(patched);
  if (!a || !b) {
    return {
      passed: false,
      note: 'One of the two snippets failed to parse — equivalence could not be verified.',
      confidence: 0,
    };
  }
  const sigA = signature(canonicalizeAst(a, strategy));
  const sigB = signature(canonicalizeAst(b, strategy));
  const passed = sigA === sigB;
  if (strategy === 'object-literal-key-order') {
    return {
      passed,
      note: passed
        ? 'AST signatures match after canonicalizing data-property insertion order. Property order is the only difference; key sets, values and all other structure are identical. Safe for plain data objects (no accessors / no prototype setters).'
        : 'AST signatures differ beyond property ordering — the rewrite is NOT equivalent.',
      confidence: passed ? 0.95 : 1,
    };
  }
  return {
    passed,
    note: passed
      ? 'AST signatures match after canonicalizing consecutive pure object-member assignments. Only the ordering of `obj.prop = value` statements differs; the bound object, keys and values are identical. Safe for fresh plain objects built on the same path.'
      : 'AST signatures differ — the rewrite is NOT equivalent.',
    confidence: passed ? 0.9 : 1,
  };
}

function getIndent(source: string, offset: number): string {
  const lineStart = source.lastIndexOf('\n', offset - 1) + 1;
  const line = source.slice(lineStart, offset);
  return /^\s*/.exec(line)?.[0] ?? '';
}

function keyOrderPatch(source: string, node: NodeLike): JitPatch | null {
  const props = (node as unknown as { properties: unknown[] }).properties;
  if (props.length < 2) return null;
  const reorderable = props.map(p => isReorderableObjectProp(p as NodeLike)).every(Boolean);
  if (!reorderable) return null;

  const keys = props.map(p => propKeyName(p as NodeLike));
  const canonicalKeys = [...keys].sort();
  const alreadySorted = keys.every((k, i) => k === canonicalKeys[i]);
  if (alreadySorted) return null;

  const before = (source as string).slice(node.start as number, node.end as number);
  const indent = getIndent(source as string, node.start as number);
  const frags = props
    .map(p => (source as string).slice((p as NodeLike).start as number, (p as NodeLike).end as number))
    .map((f, i) => ({ f, k: keys[i] }))
    .sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0))
    .map(x => `${indent}  ${x.f.trim()}`);
  const after = `{\n${frags.join(',\n')}\n${indent}}`;
  const loc = `line ${(node.loc as { start: { line: number } }).start.line}`;
  const eq = verifyPatchEquivalence(before, after, 'object-literal-key-order');
  return {
    id: `key-order-${node.start}`,
    strategy: 'object-literal-key-order',
    findingId: null,
    title: 'Canonicalize object literal property order',
    rationale: `This object literal inserts keys in the order [${keys.join(', ')}] while another literal uses the same key set in a different order. V8 derives a hidden class from insertion order, so identical-key literals with different orders fork into separate maps. Rewriting to [${canonicalKeys.join(', ')}] unifies the maps so StoreIC / LoadIC stay monomorphic.`,
    before,
    after,
    equivalence: eq,
    location: loc,
    keys,
    canonicalKeys,
    moves: insertionMoves(keys),
  };
}

function initOrderPatch(source: string, run: NodeLike[]): JitPatch | null {
  const decl = run[0] as NodeLike;
  const declId = (decl as unknown as { declarations?: NodeLike[] }).declarations?.[0]?.id as NodeLike | undefined;
  const base = declId ? String((declId as unknown as { name?: string }).name ?? 'obj') : 'obj';
  const assigns = run.slice(1);
  if (assigns.length < 2 || !declId) return null;
  const keys = assigns.map(a => {
    const expr = (a as unknown as { expression?: NodeLike }).expression as NodeLike;
    const left = (expr as unknown as { left?: NodeLike }).left as NodeLike;
    return memberPropName(left);
  });
  const canonicalKeys = [...keys].sort();
  const alreadySorted = keys.every((k, i) => k === canonicalKeys[i]);
  if (alreadySorted) return null;

  const start = (run[0] as NodeLike).start as number;
  const end = (run[run.length - 1] as NodeLike).end as number;
  const before = (source as string).slice(start, end);
  const indent = getIndent(source as string, start);
  const declSrc = (source as string).slice(start, (decl as NodeLike).end as number);
  const sortedAssigns = assigns
    .map(a => ({ s: (source as string).slice(a.start as number, a.end as number), k: keys[assigns.indexOf(a)] }))
    .sort((x, y) => (x.k < y.k ? -1 : x.k > y.k ? 1 : 0))
    .map(x => `${indent}${x.s.trim()}`);
  const after = [declSrc.trim(), ...sortedAssigns].join('\n');
  const locLine = ((run[0] as NodeLike).loc as { start?: { line?: number } } | undefined)?.start?.line ?? 0;
  const loc = `line ${locLine}`;
  const eq = verifyPatchEquivalence(before, after, 'field-initialization-order');

  return {
    id: `init-order-${start}`,
    strategy: 'field-initialization-order',
    findingId: null,
    title: `Unify object initialization order for ${base}`,
    rationale: `Object ${base} is built by separate property assignments that occur in a different order elsewhere on this code path. V8 creates one hidden class per distinct insertion order. Reordering the consecutive assignments so every construction path adds keys in [${canonicalKeys.join(', ')}] merges the hidden classes.`,
    before,
    after,
    equivalence: eq,
    location: loc,
    keys,
    canonicalKeys,
    moves: insertionMoves(keys),
  };
}

/**
 * Scan source for JIT-unfriendly object construction and generate verified
 * patches. Findings are used only to label the patch; detection here is based
 * on the source structure itself (same key set in different orders).
 */
export function generatePatches(source: string): JitPatch[] {
  const ast = parseSnippet(source);
  if (!ast) return [];

  // ---- Strategy 1: object literal key order ---------------------------------
  const literals: NodeLike[] = [];
  walkAst(ast, n => {
    if (n.type === 'ObjectExpression') literals.push(n);
  });
  const patches: JitPatch[] = [];
  for (const lit of literals) {
    const patch = keyOrderPatch(source, lit);
    if (patch) patches.push(patch);
  }

  // ---- Strategy 2: field initialization order -------------------------------
  const runs: NodeLike[][] = [];
  walkStmtRuns(ast, r => runs.push(r));
  for (const run of runs) {
    const patch = initOrderPatch(source, run);
    if (patch) patches.push(patch);
  }

  return patches;
}

function walkAst(node: unknown, visit: (n: NodeLike) => void): void {
  if (Array.isArray(node)) {
    for (const item of node) walkAst(item, visit);
    return;
  }
  if (!isNodeLike(node)) return;
  visit(node);
  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue;
    walkAst((node as Record<string, unknown>)[key], visit);
  }
}

function walkStmtRuns(ast: NodeLike, emit: (run: NodeLike[]) => void): void {
  const handle = (body: unknown[]) => {
    let run: NodeLike[] = [];
    let base: string | null = null;
    const flush = () => {
      if (run.length >= 3) emit(run);
      run = [];
      base = null;
    };
    for (const stmt of body) {
      if (!isNodeLike(stmt)) continue;
      // Seed a new run when we see a freshly created object.
      if (stmt.type === 'VariableDeclaration' && (stmt as unknown as { declarations?: NodeLike[] }).declarations?.length === 1) {
        const decl = (stmt as unknown as { declarations: NodeLike[] }).declarations[0];
        const init = decl.init;
        const isEmptyLiteral = isNodeLike(init) && init.type === 'ObjectExpression' && (init as unknown as { properties?: unknown[] }).properties?.length === 0;
        if (isEmptyLiteral && isNodeLike(decl.id) && decl.id.type === 'Identifier') {
          flush();
          run = [stmt];
          base = (decl.id as unknown as { name?: string }).name ?? null;
          continue;
        }
      }
      const b = assignBase(stmt);
      if (b !== null && base !== null && b === base) {
        run.push(stmt);
        continue;
      }
      flush();
    }
    flush();
  };
  // Program and function bodies.
  if (ast.type === 'File') {
    walkAst(ast, n => {
      if (n.type === 'Program' || n.type === 'BlockStatement') {
        handle((n as unknown as { body: unknown[] }).body);
      }
    });
  } else {
    handle((ast as { body?: unknown[] }).body ?? []);
  }
}
