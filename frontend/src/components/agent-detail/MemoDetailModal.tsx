import React from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { AgentMemo } from '../../types';

interface MemoDetailModalProps {
  memo: AgentMemo | null;
  onClose: () => void;
}

export const MemoDetailModal: React.FC<MemoDetailModalProps> = ({ memo, onClose }) => {
  if (!memo) return null;

  return (
    <div className="fixed inset-0 z-50">
      <button className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" onClick={onClose} aria-label="关闭弹窗" />
      <div className="absolute left-1/2 top-1/2 w-[94vw] max-w-3xl -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200/50">
        <div className="flex items-center justify-between border-b border-slate-200/60 bg-slate-50/30 px-6 py-5">
          <div>
            <p className="text-lg font-semibold text-slate-900">{memo.title}</p>
            <p className="mt-1.5 text-xs text-slate-500">
              <span
                className={`mr-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                  memo.memoKind === 'identity'
                    ? 'bg-blue-50 text-blue-600'
                    : memo.memoKind === 'todo'
                      ? 'bg-amber-50 text-amber-600'
                      : memo.memoKind === 'achievement'
                        ? 'bg-emerald-50 text-emerald-600'
                        : memo.memoKind === 'criticism'
                          ? 'bg-rose-50 text-rose-600'
                          : memo.memoKind === 'topic'
                            ? 'bg-purple-50 text-purple-600'
                            : 'bg-slate-100 text-slate-600'
                }`}
              >
                {memo.memoKind || 'topic'}
              </span>
              {memo.memoType || '-'} · {memo.category || '-'}
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
        <div className="max-h-[65vh] overflow-y-auto px-6 py-5">
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-slate-700">{memo.content}</pre>
        </div>
      </div>
    </div>
  );
};
