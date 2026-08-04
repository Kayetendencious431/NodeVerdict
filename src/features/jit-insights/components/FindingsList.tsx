import type { JitFinding, FindingSeverity } from '../../../shared/types/jit';

const SEVERITY_STYLE: Record<FindingSeverity, string> = {
  critical: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',
  warning: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800',
  info: 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700',
};

const SEVERITY_BADGE: Record<FindingSeverity, string> = {
  critical: 'bg-red-500',
  warning: 'bg-amber-500',
  info: 'bg-gray-400',
};

const RULE_LABEL: Record<JitFinding['rule'], string> = {
  'megamorphic-ic': 'Megamorphic IC',
  'deopt-storm': 'Deopt storm',
  'hidden-class-fragmentation': 'Hidden-class fragmentation',
  'optimization-suppressed': 'Optimization suppressed',
  'deopt-loop': 'Optimize/deopt loop',
};

interface Props {
  findings: JitFinding[];
}

export function FindingsList({ findings }: Props) {
  const sorted = [...findings].sort((a, b) => b.score - a.score);

  if (sorted.length === 0) {
    return (
      <div className="p-6 text-sm text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
        No JIT anti-patterns detected — this trace looks V8-friendly.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {sorted.map(f => (
        <div key={f.id} className={`p-4 rounded-lg border ${SEVERITY_STYLE[f.severity]}`}>
          <div className="flex items-start gap-3">
            <span className={`mt-0.5 w-2.5 h-2.5 rounded-full shrink-0 ${SEVERITY_BADGE[f.severity]}`} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">{f.title}</h3>
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-white/60 dark:bg-gray-700/60 text-gray-500 dark:text-gray-400">
                  {RULE_LABEL[f.rule]}
                </span>
                <span className="text-[10px] font-mono text-gray-400 dark:text-gray-500">impact {Math.round(f.score * 100)}%</span>
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-300 mt-1.5 leading-relaxed">{f.detail}</p>
              {f.evidence.length > 0 && (
                <details className="mt-2">
                  <summary className="text-[11px] text-indigo-600 dark:text-indigo-400 cursor-pointer">Trace evidence</summary>
                  <pre className="mt-2 p-2 bg-gray-50 dark:bg-gray-900 rounded text-[10px] font-mono text-gray-600 dark:text-gray-300 overflow-x-auto max-h-40">
                    {f.evidence.join('\n')}
                  </pre>
                </details>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
