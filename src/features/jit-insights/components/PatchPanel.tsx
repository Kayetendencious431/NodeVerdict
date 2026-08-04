import { useState } from 'react';
import { generatePatches } from '../../../shared/engine';
import type { JitPatch, PatchStrategy } from '../../../shared/types/jit';
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

const STRATEGY_LABEL: Record<PatchStrategy, string> = {
  'object-literal-key-order': 'Object literal key order',
  'field-initialization-order': 'Object init order',
  'shape-dispatch-split': 'Shape dispatch split',
};

export function PatchPanel() {
  const { t } = useI18n();
  const [source, setSource] = useState(DEFAULT_SOURCE);
  const [patches, setPatches] = useState<JitPatch[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run() {
    setError(null);
    try {
      const result = generatePatches(source);
      setPatches(result);
      if (result.length === 0) setError(t('jitPatches.none'));
    } catch (err) {
      setError((err as Error).message);
      setPatches([]);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">{t('jitPatches.sourceTitle')}</h3>
          <button
            onClick={run}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
          >
            {t('jitPatches.generate')}
          </button>
        </div>
        <textarea
          value={source}
          onChange={e => { setSource(e.target.value); setPatches(null); }}
          spellCheck={false}
          className="w-full h-72 font-mono text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg p-3 text-gray-800 dark:text-gray-100 resize-y"
        />
        {error && <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">{error}</p>}
        <p className="mt-2 text-[11px] text-gray-400 dark:text-gray-500">{t('jitPatches.hint')}</p>
      </div>

      <div className="space-y-3 max-h-[560px] overflow-y-auto pr-1">
        {patches === null ? (
          <div className="p-6 text-sm text-gray-400 dark:text-gray-500 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
            {t('jitPatches.empty')}
          </div>
        ) : patches.length === 0 ? (
          <div className="p-6 text-sm text-gray-400 dark:text-gray-500 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
            {t('jitPatches.clean')}
          </div>
        ) : (
          patches.map(p => (
            <div key={p.id} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
              <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <h4 className="text-xs font-semibold text-gray-800 dark:text-gray-100 truncate">{p.title}</h4>
                  <span className="text-[10px] text-gray-400 dark:text-gray-500">
                    {STRATEGY_LABEL[p.strategy]} · {p.location}
                  </span>
                </div>
                <span className={`shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full ${p.equivalence.passed ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300'}`}>
                  {p.equivalence.passed ? 'equivalent ✓' : 'not equivalent ✗'}
                </span>
              </div>
              <p className="px-3 py-2 text-[11px] text-gray-600 dark:text-gray-300 leading-relaxed border-b border-gray-100 dark:border-gray-800">
                {p.rationale}
              </p>
              <div className="grid grid-cols-2 gap-px bg-gray-100 dark:bg-gray-700">
                <div>
                  <div className="px-2 py-1 text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase">before</div>
                  <pre className="px-2 pb-2 font-mono text-[10px] text-gray-700 dark:text-gray-200 overflow-x-auto whitespace-pre-wrap">{p.before}</pre>
                </div>
                <div>
                  <div className="px-2 py-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400 uppercase">after</div>
                  <pre className="px-2 pb-2 font-mono text-[10px] text-emerald-800 dark:text-emerald-200 overflow-x-auto whitespace-pre-wrap">{p.after}</pre>
                </div>
              </div>
              <div className="px-3 py-2 bg-gray-50 dark:bg-gray-900">
                <div className="flex items-center gap-2 text-[10px]">
                  <span className="text-gray-400 dark:text-gray-500">AST equivalence</span>
                  <span className={`font-medium ${p.equivalence.passed ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                    confidence {Math.round(p.equivalence.confidence * 100)}%
                  </span>
                </div>
                <p className="mt-1 text-[10px] text-gray-400 dark:text-gray-500 leading-relaxed">{p.equivalence.note}</p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
