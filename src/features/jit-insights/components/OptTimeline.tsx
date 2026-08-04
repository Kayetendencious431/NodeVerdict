import { useMemo } from 'react';
import type { V8Trace, FunctionSummary } from '../../../shared/types/jit';

/**
 * Per-function optimize / deoptimize timeline. Sequence index (line number) is
 * used as the time axis because V8 JIT trace lines carry no wall-clock time.
 */

interface Props {
  trace: V8Trace;
  functions: FunctionSummary[];
}

const OPT_COLOR = '#10b981';
const DEOPT_COLOR = '#ef4444';
const DISABLED_COLOR = '#f59e0b';

export function OptTimeline({ trace, functions }: Props) {
  const maxSeq = useMemo(() => {
    let m = 1;
    for (const e of trace.optEvents) m = Math.max(m, e.seq);
    for (const e of trace.deoptEvents) m = Math.max(m, e.seq);
    return m;
  }, [trace]);

  const rows = useMemo(() => {
    return functions.filter(f => f.optCount > 0 || f.deoptCount > 0).slice(0, 12);
  }, [functions]);

  if (rows.length === 0) {
    return (
      <div className="p-6 text-sm text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
        No optimization or deoptimization events in this trace.
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 text-sm font-semibold text-gray-700 dark:text-gray-200">
        Optimization / Deoptimization timeline
      </div>
      <div className="p-4 space-y-2">
        {rows.map(fn => {
          const optSeqs = trace.optEvents.filter(e => (e.address ?? e.name) === (fn.address ?? fn.name)).map(e => e.seq);
          const deoptSeqs = trace.deoptEvents.filter(e => (e.address ?? e.name) === (fn.address ?? fn.name) && e.raw.includes('begin')).map(e => e.seq);
          const disabled = fn.status === 'disabled' || fn.status === 'never';
          return (
            <div key={fn.name} className="flex items-center gap-3">
              <div className="w-40 shrink-0 truncate font-mono text-xs text-gray-700 dark:text-gray-200">{fn.name}</div>
              <div className="relative flex-1 h-6 bg-gray-100 dark:bg-gray-900 rounded">
                {optSeqs.map(seq => (
                  <div
                    key={`o-${seq}`}
                    title={`optimized at line ${seq + 1}${fn.compiler ? ` (${fn.compiler})` : ''}`}
                    className="absolute top-1 bottom-1 w-1.5 rounded-sm"
                    style={{ left: `${(seq / maxSeq) * 100}%`, background: OPT_COLOR }}
                  />
                ))}
                {deoptSeqs.map(seq => (
                  <div
                    key={`d-${seq}`}
                    title={`deoptimized at line ${seq + 1}`}
                    className="absolute top-1 bottom-1 w-1.5 rounded-sm"
                    style={{ left: `${(seq / maxSeq) * 100}%`, background: DEOPT_COLOR }}
                  />
                ))}
                {disabled && <div className="absolute inset-x-0 top-1/2 h-px bg-amber-500 opacity-60" />}
              </div>
              <div className="w-32 shrink-0 text-right text-[10px] text-gray-500 dark:text-gray-400 font-mono">
                {fn.optCount} opt · {fn.deoptCount} deopt
                {disabled && <span className="text-amber-500"> · blocked</span>}
              </div>
            </div>
          );
        })}
      </div>
      <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-800 flex items-center gap-4 text-[11px] text-gray-500 dark:text-gray-400">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm" style={{ background: OPT_COLOR }} /> optimized</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm" style={{ background: DEOPT_COLOR }} /> deoptimized</span>
        <span className="flex items-center gap-1"><span className="w-4 h-px bg-amber-500" /> optimization blocked</span>
      </div>
    </div>
  );
}
