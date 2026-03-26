import React from 'react';
import { memoKindOptions, memoTypeOptions, todoStatusOptions } from './constants';
import { UseMemoStateResult } from './hooks/useMemoState';

interface MemoEditorModalProps {
  state: UseMemoStateResult;
  agentName?: string;
}

export const MemoEditorModal: React.FC<MemoEditorModalProps> = ({ state, agentName }) => {
  if (!state.memoEditorOpen) return null;

  return (
    <div className="fixed inset-0 z-50">
      <button
        className="absolute inset-0 bg-black/40"
        onClick={() => state.setMemoEditorOpen(false)}
        aria-label="关闭弹窗"
      />
      <div className="absolute left-1/2 top-1/2 w-[94vw] max-w-3xl -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <div>
            <p className="text-base font-semibold text-gray-900">{state.editingMemo ? '编辑备忘录' : '新建备忘录'}</p>
            <p className="text-xs text-gray-500">Agent: {agentName || '-'}</p>
          </div>
          <button onClick={() => state.setMemoEditorOpen(false)} className="text-sm text-gray-500">
            关闭
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="mb-1 block text-sm text-gray-600">标题</label>
              <input
                value={state.memoDraft.title}
                onChange={(e) => state.setMemoDraft((prev) => ({ ...prev, title: e.target.value }))}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-gray-600">种类</label>
              <select
                value={state.memoDraft.memoKind}
                onChange={(e) => state.setMemoDraft((prev) => ({ ...prev, memoKind: e.target.value }))}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">不指定</option>
                {memoKindOptions.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm text-gray-600">类型</label>
              <select
                value={state.memoDraft.memoType}
                onChange={(e) => state.setMemoDraft((prev) => ({ ...prev, memoType: e.target.value }))}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">不指定</option>
                {memoTypeOptions.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm text-gray-600">类别</label>
              <input
                value={state.memoDraft.category}
                onChange={(e) => state.setMemoDraft((prev) => ({ ...prev, category: e.target.value }))}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-gray-600">Topic</label>
              <input
                value={state.memoDraft.topic}
                onChange={(e) => state.setMemoDraft((prev) => ({ ...prev, topic: e.target.value }))}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-gray-600">Todo 状态</label>
              <select
                value={state.memoDraft.todoStatus}
                onChange={(e) => state.setMemoDraft((prev) => ({ ...prev, todoStatus: e.target.value }))}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">不指定</option>
                {todoStatusOptions.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm text-gray-600">标签 (逗号分隔)</label>
              <input
                value={state.memoDraft.tags}
                onChange={(e) => state.setMemoDraft((prev) => ({ ...prev, tags: e.target.value }))}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-sm text-gray-600">内容</label>
              <textarea
                rows={8}
                value={state.memoDraft.content}
                onChange={(e) => state.setMemoDraft((prev) => ({ ...prev, content: e.target.value }))}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-5 py-4">
          <button
            onClick={() => state.setMemoEditorOpen(false)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700"
          >
            取消
          </button>
          <button
            onClick={state.handleSaveMemo}
            disabled={state.createMemoMutation.isLoading || state.updateMemoMutation.isLoading}
            className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60"
          >
            {state.createMemoMutation.isLoading || state.updateMemoMutation.isLoading ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
};
