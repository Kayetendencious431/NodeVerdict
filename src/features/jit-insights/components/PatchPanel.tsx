import { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { generatePatches, analyzeKeyShapes } from '../../../shared/engine';
import type { JitPatch, KeyShape } from '../../../shared/types/jit';
import { useI18n } from '../../../shared/i18n/useI18n';

const DEFAULT_SOURCE = `// Paste a hot function here to generate JIT-safe rewrites.
// Example below shows the hidden-class fragmentation the tool looks for:
// object literals with identical keys but different insertion order.
function makeUser(id, name) {
  const a = { id, name, age: 0 };
  const b = { name, age: 0, id };
  const c = {};
  c.id = id;
  c.name = name;
  c.age = 0;
  return [a, b, c];
}
`;

const STRATEGY_LABEL: Record<JitPatch['strategy'], string> = {
  'object-literal-key-order': 'Object literal key order',
  'field-initialization-order': 'Object init order',
  'shape-dispatch-split': 'Shape dispatch split',
};

/** Apply `count` adjacent moves to a key board. */
function applyMoves(keys: string[], moves: JitPatch['moves'], count: number): string[] {
  const b = [...keys];
  for (let i = 0; i < count && i < moves.length; i++) {
    const m = moves[i];
    const t = b[m.toIdx];
    b[m.toIdx] = b[m.fromIdx];
    b[m.fromIdx] = t;
  }
  return b;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Read-only source with changed regions highlighted. */
function HighlightedSource({ code, regions }: { code: string; regions: { start: number; end: number; kind: 'added' | 'changed' }[] }) {
  const sorted = [...regions].sort((a, b) => a.start - b.start);
  const cls = 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-900 dark:text-emerald-100';
  const changedCls = 'bg-rose-100 dark:bg-rose-900/40 text-rose-900 dark:text-rose-100 line-through';
  let html = '';
  let cursor = 0;
  for (const r of sorted) {
    html += escapeHtml(code.slice(cursor, r.start));
    html += `<span class="${r.kind === 'added' ? cls : changedCls} px-0.5 rounded">${escapeHtml(code.slice(r.start, r.end))}</span>`;
    cursor = r.end;
  }
  html += escapeHtml(code.slice(cursor));
  return <pre className="whitespace-pre-wrap font-mono text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-3 text-gray-700 dark:text-gray-300 overflow-x-auto" dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Step-through animation of the key reordering. */
function StepPlayer({ patch, onDone }: { patch: JitPatch; onDone: (unified: boolean) => void }) {
  const { t } = useI18n();
  const [step, setStep] = useState(0);
  const done = step >= patch.moves.length;
  const board = useMemo(() => applyMoves(patch.keys, patch.moves, step), [patch, step]);
  const [running, setRunning] = useState(false);
  const timer = useRef<number | null>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const reset = useCallback(() => { setRunning(false); setStep(0); onDoneRef.current(false); }, []);
  const stepForward = useCallback(() => {
    setStep(s => {
      const next = s + 1;
      if (next >= patch.moves.length) {
        setRunning(false);
        onDoneRef.current(true);
      }
      return Math.min(next, patch.moves.length);
    });
  }, [patch]);

  useEffect(() => {
    if (!running) return;
    if (done) { setRunning(false); return; }
    const id = window.setTimeout(stepForward, 600);
    return () => window.clearTimeout(id);
  }, [running, done, step, stepForward]);

  const current = step < patch.moves.length ? patch.moves[step] : null;

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 bg-white dark:bg-gray-800">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
        <div className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t('jitPatches.stepTitle')}</div>
        <div className="text-[10px] font-mono text-gray-400 dark:text-gray-500">{t('jitPatches.stepOf').replace('{s}', String(Math.min(step + (done ? 1 : 0), patch.moves.length))).replace('{n}', String(patch.moves.length))}</div>
      </div>
      <div className="flex items-center gap-1 mb-3 flex-wrap">
        <IconBtn label="⏮" onClick={reset} disabled={step === 0} title={t('jitPatches.reset')} />
        <IconBtn label="◀" onClick={() => { setRunning(false); setStep(s => Math.max(0, s - 1)); }} disabled={step === 0} title={t('jitPatches.prev')} />
        <button
          onClick={() => { if (done) reset(); else setRunning(r => !r); }}
          className="px-3 py-1 text-xs font-medium rounded-md bg-indigo-600 text-white hover:bg-indigo-700 min-w-[64px]"
        >
          {running ? '⏸' : done ? '↺' : '▶'}
        </button>
        <IconBtn label="▶" onClick={stepForward} disabled={done} title={t('jitPatches.next')} />
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        {board.map((k, i) => (
          <div key={`${k}-${i}`} className={`px-1.5 py-0.5 rounded text-[11px] font-mono transition-all duration-300 ${done ? 'bg-emerald-50 text-emerald-700 border border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700' : current && i === current.fromIdx ? 'bg-rose-100 text-rose-700 border-2 border-rose-400 dark:bg-rose-900/40 dark:text-rose-300' : 'bg-gray-100 text-gray-700 border border-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600'}`}>
              {k}
            </div>
        ))}
      </div>
      {done && <div className="mt-2 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">{t('jitPatches.unifiedNow')}</div>}
      {!done && current && <div className="mt-2 text-[11px] text-gray-400 dark:text-gray-500">{t('jitPatches.moving').replace('{key}', current.key)}</div>}
    </div>
  );
}

function IconBtn({ label, onClick, disabled, title }: { label: string; onClick: () => void; disabled?: boolean; title?: string }) {
  return (
    <button onClick={onClick} disabled={disabled} title={title}
      className={`px-2 h-7 text-xs rounded-md border border-gray-200 dark:border-gray-600 ${disabled ? 'opacity-40 cursor-not-allowed text-gray-400' : 'text-gray-600 dark:text-gray-200 hover:bg-white dark:hover:bg-gray-700'}`}>
      {label}
    </button>
  );
}

/** Hidden-class fragmentation → unification visualizer. */
function UnionViz({ patch, shapes, unified }: { patch: JitPatch; shapes: KeyShape[]; unified: boolean }) {
  const { t } = useI18n();
  const canonical = patch.canonicalKeys.join(', ');
  const matching = shapes.filter(s => s.keys.join('|') === patch.canonicalKeys.join('|'));
  const orders = matching.length ? matching[0].orders : [patch.keys];
  const n = orders.length;
  const W = 560, H = 190;
  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 bg-white dark:bg-gray-800 overflow-x-auto">
      <div className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-2">{t('jitPatches.unionTitle')}</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[560px]">
        {/* Before: distinct maps */}
        <text x={16} y={18} fontSize="11" fill="#94a3b8" fontFamily="monospace">{t('jitPatches.before')}</text>
        {orders.map((ord, i) => {
          const rowH = H / (n + 1);
          const cy = 42 + i * rowH;
          return (
            <g key={i} opacity={unified ? 0.15 : 1} style={{ transition: 'opacity 500ms' }}>
              <rect x={16} y={cy - 12} width={170} height={40} rx={9} fill={unified ? '#fde047' : '#f97316'} opacity={0.9} />
              <text x={101} y={cy + 4} textAnchor="middle" fontSize="11" fill="#fff" fontFamily="monospace">{ord.map(k => k as string).slice(0, 4).join(', ')}</text>
              <text x={101} y={cy + 20} textAnchor="middle" fontSize="9" fill="#fff" opacity={0.85}>map #{i + 1}</text>
            </g>
          );
        })}

        {/* Arrow */}
        <line x1={200} y1={H / 2} x2={330} y2={H / 2} stroke={unified ? '#10b981' : '#cbd5e1'} strokeWidth={unified ? 3 : 2} markerEnd="url(#nvv-arrow)" />
        <defs>
          <marker id="nvv-arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill={unified ? '#10b981' : '#cbd5e1'} />
          </marker>
        </defs>

        {/* After: unified map */}
        <text x={344} y={18} fontSize="11" fill="#94a3b8" fontFamily="monospace">{t('jitPatches.after')}</text>
        <circle cx={440} cy={H / 2} r={unified ? 38 : 34} fill={unified ? '#10b981' : '#22c55e'} opacity={unified ? 1 : 0.5} style={{ transition: 'all 500ms' }} />
        <text x={440} y={H / 2 - 8} textAnchor="middle" fontSize="11" fill="#fff" fontFamily="monospace">{canonical.slice(0, 14)}</text>
        <text x={440} y={H / 2 + 10} textAnchor="middle" fontSize="9" fill="#fff" opacity={0.9}>{unified ? '1 map ✓' : t('jitPatches.expected')}</text>
      </svg>
      <div className="mt-2 flex items-center gap-2 text-[11px]">
        {n > 1 ? (
          <span className="text-rose-500 font-medium">{t('jitPatches.fragmentCount').replace('{n}', String(n))}</span>
        ) : (
          <span className="text-gray-400 dark:text-gray-500">{t('jitPatches.singleShape')}</span>
        )}
        <span className="text-gray-300 dark:text-gray-600">→</span>
        <span className="text-emerald-600 dark:text-emerald-400 font-medium">{t('jitPatches.unifyInto')}</span>
      </div>
    </div>
  );
}

export function PatchPanel() {
  const { t } = useI18n();
  const [source, setSource] = useState(DEFAULT_SOURCE);
  const [patches, setPatches] = useState<JitPatch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [appliedSource, setAppliedSource] = useState<string | null>(null);
  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set());
  const [unifiedKeys, setUnifiedKeys] = useState<Record<string, string>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [runId, setRunId] = useState(0);

  const shapes = useMemo(() => (source ? analyzeKeyShapes(source) : []), [source]);
  const selected = patches?.find(p => p.id === selectedId) ?? null;
  const displaySource = appliedSource ?? source;

  function run() {
    setError(null);
    try {
      const result = generatePatches(source);
      setPatches(result);
      setAppliedSource(null);
      setAppliedIds(new Set());
      setUnifiedKeys({});
      setSelectedId(result[0]?.id ?? null);
      setRunId(id => id + 1);
      if (result.length === 0) setError(t('jitPatches.none'));
    } catch (err) {
      setError((err as Error).message);
      setPatches([]);
    }
  }

  function applyPatch(p: JitPatch) {
    if (appliedIds.has(p.id)) return;
    setAppliedSource(cur => {
      const base = cur ?? source;
      if (!base.includes(p.before)) return base;
      return base.replace(p.before, p.after);
    });
    setAppliedIds(prev => new Set(prev).add(p.id));
  }

  function revertAll() {
    setAppliedSource(null);
    setAppliedIds(new Set());
    setUnifiedKeys({});
  }

  const highlightRegions = useMemo(() => {
    const regions: { start: number; end: number; kind: 'added' | 'changed' }[] = [];
    if (!displaySource) return regions;
    const add = (needle: string, kind: 'added' | 'changed') => {
      const idx = displaySource.indexOf(needle);
      if (idx >= 0) regions.push({ start: idx, end: idx + needle.length, kind });
    };
    patches?.forEach(p => {
      if (appliedIds.has(p.id)) add(p.after, 'added');
      else if (p.id === selectedId) add(p.before, 'changed');
    });
    return regions;
  }, [displaySource, patches, appliedIds, selectedId]);

  const sourcePreviewOpen = appliedSource !== null || (patches?.length ?? 0) > 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
      {/* Left: editor + generate */}
      <div className="lg:col-span-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">{t('jitPatches.sourceTitle')}</h3>
          <button onClick={run} className="px-3 py-1.5 text-xs font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">
            {t('jitPatches.generate')}
          </button>
        </div>
        <textarea
          value={source}
          onChange={e => { setSource(e.target.value); setPatches(null); setAppliedSource(null); setAppliedIds(new Set()); setUnifiedKeys({}); }}
          spellCheck={false}
          className="w-full h-72 font-mono text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg p-3 text-gray-800 dark:text-gray-100 resize-y"
        />
        {error && <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">{error}</p>}
        <p className="mt-2 text-[11px] text-gray-400 dark:text-gray-500">{t('jitPatches.hint')}</p>
        {shapes.length > 0 && (
          <div className="mt-3">
            <div className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-1">{t('jitPatches.shapesFound')}</div>
            <div className="space-y-1">
              {shapes.slice(0, 4).map((s, i) => (
                <div key={i} className="flex items-center gap-2 text-[11px] font-mono">
                  <span className={`px-1.5 py-0.5 rounded ${s.orders.length > 1 ? 'bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-300' : 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300'}`}>
                    {s.orders.length} map{s.orders.length > 1 ? 's' : ''}
                  </span>
                  <span className="text-gray-600 dark:text-gray-300 truncate">{`{ ${s.keys.join(', ')} }`}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Right: workspace */}
      <div className="lg:col-span-3 space-y-3 max-h-[640px] overflow-y-auto pr-1">
        {patches === null ? (
          <div className="p-6 text-sm text-gray-400 dark:text-gray-500 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
            {t('jitPatches.empty')}
          </div>
        ) : patches.length === 0 ? (
          <div className="p-6 text-sm text-gray-400 dark:text-gray-500 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
            {t('jitPatches.clean')}
          </div>
        ) : (
          <>
            {/* Status bar */}
            <div className="flex items-center justify-between gap-2 px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
              <div className="text-xs text-gray-600 dark:text-gray-300">
                {t('jitPatches.appliedCount').replace('{n}', String(appliedIds.size)).replace('{m}', String(patches.length))}
              </div>
              {appliedIds.size > 0 && (
                <button onClick={revertAll} className="text-xs text-rose-500 hover:text-rose-600 font-medium">{t('jitPatches.revert')}</button>
              )}
            </div>

            {/* Patch cards */}
            <div className="space-y-2">
              {patches.map(p => (
                <div key={p.id} className={`bg-white dark:bg-gray-800 border rounded-lg overflow-hidden transition-colors ${selectedId === p.id ? 'border-indigo-400 dark:border-indigo-600 ring-1 ring-indigo-200 dark:ring-indigo-900' : 'border-gray-200 dark:border-gray-700'}`}>
                  <div className="px-3 py-2 flex items-center justify-between gap-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800" onClick={() => setSelectedId(p.id)}>
                    <div className="min-w-0">
                      <h4 className="text-xs font-semibold text-gray-800 dark:text-gray-100 truncate">{p.title}</h4>
                      <span className="text-[10px] text-gray-400 dark:text-gray-500">{STRATEGY_LABEL[p.strategy]} · {p.location}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${p.equivalence.passed ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300'}`}>
                        {p.equivalence.passed ? 'equivalent ✓' : 'not equivalent ✗'}
                      </span>
                      <button
                        onClick={e => { e.stopPropagation(); applyPatch(p); }}
                        disabled={appliedIds.has(p.id)}
                        className={`px-2.5 py-1 text-[11px] font-medium rounded-md ${appliedIds.has(p.id) ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 cursor-default' : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200 hover:bg-indigo-50 dark:hover:bg-gray-600'}`}
                      >
                        {appliedIds.has(p.id) ? t('jitPatches.applied') : t('jitPatches.apply')}
                      </button>
                    </div>
                  </div>
                  {selectedId === p.id && (
                    <div className="px-3 pb-3 space-y-3 border-t border-gray-100 dark:border-gray-800 pt-3">
                      <UnionViz key={`union-${runId}`} patch={p} shapes={shapes} unified={!!unifiedKeys[p.id]} />
                      <StepPlayer key={`step-${runId}`} patch={p} onDone={u => setUnifiedKeys(cur => (u ? { ...cur, [p.id]: '1' } : cur))} />
                      <div className="grid grid-cols-2 gap-px bg-gray-100 dark:bg-gray-700 rounded overflow-hidden">
                        <div>
                          <div className="px-2 py-1 text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase bg-gray-50 dark:bg-gray-900">before</div>
                          <pre className="px-2 pb-2 pt-1 font-mono text-[10px] text-gray-700 dark:text-gray-200 overflow-x-auto whitespace-pre-wrap">{p.before}</pre>
                        </div>
                        <div>
                          <div className="px-2 py-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400 uppercase bg-gray-50 dark:bg-gray-900">after</div>
                          <pre className="px-2 pb-2 pt-1 font-mono text-[10px] text-emerald-800 dark:text-emerald-200 overflow-x-auto whitespace-pre-wrap">{p.after}</pre>
                        </div>
                      </div>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">{p.rationale}</p>
                      <div className="flex items-center gap-2 text-[10px]">
                        <span className="text-gray-400 dark:text-gray-500">AST</span>
                        <span className={`font-medium ${p.equivalence.passed ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>confidence {Math.round(p.equivalence.confidence * 100)}%</span>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Applied source preview with highlights */}
            {sourcePreviewOpen && (
              <details open className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
                <summary className="px-3 py-2 cursor-pointer text-xs font-semibold text-gray-600 dark:text-gray-300">
                  {t('jitPatches.sourcePreview')}
                  {appliedIds.size > 0 && <span className="ml-2 text-emerald-500 font-mono">✓ {appliedIds.size}</span>}
                </summary>
                <div className="px-3 pb-3">
                  <HighlightedSource code={displaySource} regions={highlightRegions} />
                </div>
              </details>
            )}
          </>
        )}
      </div>
    </div>
  );
}