import React from 'react';
import { EyeIcon, PencilIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { MemoDetailModal } from './MemoDetailModal';
import { MemoEditorModal } from './MemoEditorModal';
import { useMemoState } from './hooks/useMemoState';

interface MemoTabProps {
  agentId: string;
  agentName?: string;
}

export const MemoTab: React.FC<MemoTabProps> = ({ agentId, agentName }) => {
  const state = useMemoState(agentId);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200/50 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-3">
          <div className="inline-flex rounded-lg bg-slate-100/50 p-1 ring-1 ring-slate-200/30">
            <button
              onClick={() => {
                state.setMemoCategory('standard');
                state.setMemoPage(1);
              }}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-all duration-200 ${
                state.memoCategory === 'standard' ? 'bg-white text-primary-600 shadow-sm' : 'text-slate-600 hover:text-slate-800'
              }`}
            >
              标准
            </button>
            <button
              onClick={() => {
                state.setMemoCategory('topic');
                state.setMemoPage(1);
              }}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-all duration-200 ${
                state.memoCategory === 'topic' ? 'bg-white text-primary-600 shadow-sm' : 'text-slate-600 hover:text-slate-800'
              }`}
            >
              主题
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              value={state.memoSearch}
              onChange={(e) => {
                state.setMemoSearch(e.target.value);
                state.setMemoPage(1);
              }}
              className="w-full rounded-lg border border-slate-200 bg-slate-50/50 px-4 py-2.5 text-sm transition-all focus:border-primary-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-100 sm:w-64"
              placeholder={state.memoCategory === 'topic' ? '搜索主题备忘录' : '搜索标准备忘录'}
            />
          </div>
        </div>
        <button
          onClick={() => {
            state.setEditingMemo(null);
            state.setMemoEditorOpen(true);
          }}
          className="inline-flex items-center rounded-lg bg-gradient-to-r from-primary-500 to-primary-600 px-4 py-2.5 text-sm font-medium text-white shadow-md shadow-primary-500/20 transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-primary-500/30"
        >
          <PlusIcon className="mr-1.5 h-4 w-4" />
          新建备忘录
        </button>
      </div>

      <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200/50">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-slate-600">共 {state.memoQuery.data?.total || 0} 条</span>
          <div className="flex flex-wrap gap-2">
            {Object.entries(state.memoSummary).map(([key, count]) => (
              <span key={key} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-200/60">
                {key}: {count}
              </span>
            ))}
          </div>
        </div>

        {state.memoQuery.isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary-200 border-t-primary-600" />
          </div>
        ) : state.displayedMemos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400">
            <div className="mb-2 text-4xl">📝</div>
            <p className="text-sm">暂无备忘录</p>
          </div>
        ) : (
          <div className="space-y-3">
            {state.displayedMemos.map((memo, index) => (
              <div
                key={memo.id}
                className="group relative overflow-hidden rounded-xl border border-slate-200/60 bg-white p-4 transition-all duration-200 hover:border-slate-300 hover:shadow-md hover:shadow-slate-200/50"
                style={{ animationDelay: `${index * 30}ms` }}
              >
                <div className="absolute inset-0 bg-gradient-to-r from-primary-50/0 via-primary-50/30 to-primary-50/0 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                <div className="relative flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1.5 flex items-center gap-2">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                          memo.memoKind === 'identity'
                            ? 'bg-blue-50 text-blue-600 ring-1 ring-blue-200/60'
                            : memo.memoKind === 'todo'
                              ? 'bg-amber-50 text-amber-600 ring-1 ring-amber-200/60'
                              : memo.memoKind === 'achievement'
                                ? 'bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200/60'
                                : memo.memoKind === 'criticism'
                                  ? 'bg-rose-50 text-rose-600 ring-1 ring-rose-200/60'
                                  : memo.memoKind === 'topic'
                                    ? 'bg-purple-50 text-purple-600 ring-1 ring-purple-200/60'
                                    : 'bg-slate-50 text-slate-600 ring-1 ring-slate-200/60'
                        }`}
                      >
                        {memo.memoKind || 'topic'}
                      </span>
                      <span className="text-xs text-slate-400">{memo.memoType || '-'}</span>
                    </div>
                    <p className="truncate text-base font-semibold text-slate-900">{memo.title}</p>
                    <p className="mt-1.5 line-clamp-2 text-xs text-slate-500">{memo.content}</p>
                    <p className="mt-2 text-xs text-slate-400">
                      {memo.category || '-'} · {memo.updatedAt ? new Date(memo.updatedAt).toLocaleString() : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5 sm:flex-col">
                    <button
                      onClick={() => state.setSelectedMemo(memo)}
                      className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-all hover:border-slate-300 hover:bg-slate-50"
                    >
                      <EyeIcon className="mr-1.5 h-3.5 w-3.5" />
                      查看
                    </button>
                    <button
                      onClick={() => {
                        state.setEditingMemo(memo);
                        state.setMemoEditorOpen(true);
                      }}
                      className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-all hover:border-slate-300 hover:bg-slate-50"
                    >
                      <PencilIcon className="mr-1.5 h-3.5 w-3.5" />
                      编辑
                    </button>
                    <button
                      onClick={() => {
                        if (window.confirm('确定要删除这条备忘录吗？')) {
                          state.deleteMemoMutation.mutate(memo.id);
                        }
                      }}
                      className="inline-flex items-center rounded-lg border border-red-200/60 bg-white px-3 py-1.5 text-xs font-medium text-red-500 transition-all hover:border-red-300 hover:bg-red-50/50"
                    >
                      <TrashIcon className="mr-1.5 h-3.5 w-3.5" />
                      删除
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {state.totalMemoPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-500">
            第 {state.memoPage} / {state.totalMemoPages} 页
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => state.setMemoPage((prev) => Math.max(1, prev - 1))}
              disabled={state.memoPage <= 1}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition-all hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              上一页
            </button>
            <button
              onClick={() => state.setMemoPage((prev) => Math.min(state.totalMemoPages, prev + 1))}
              disabled={state.memoPage >= state.totalMemoPages}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition-all hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              下一页
            </button>
          </div>
        </div>
      )}

      <MemoDetailModal memo={state.selectedMemo} onClose={() => state.setSelectedMemo(null)} />
      <MemoEditorModal state={state} agentName={agentName} />
    </div>
  );
};
