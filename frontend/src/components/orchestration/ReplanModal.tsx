import React from 'react';
import { ArrowPathIcon, XMarkIcon } from '@heroicons/react/24/outline';

interface ReplanModalProps {
  open: boolean;
  plannerAgentId: string;
  autoGenerate: boolean;
  loading: boolean;
  isPending: boolean;
  disabled: boolean;
  agents: Array<{ id: string; name: string }>;
  onClose: () => void;
  onChangePlannerAgentId: (value: string) => void;
  onChangeAutoGenerate: (value: boolean) => void;
  onSubmit: () => void;
}

const ReplanModal: React.FC<ReplanModalProps> = ({
  open,
  plannerAgentId,
  autoGenerate,
  loading,
  isPending,
  disabled,
  agents,
  onClose,
  onChangePlannerAgentId,
  onChangeAutoGenerate,
  onSubmit,
}) => {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <p className="text-sm font-semibold text-slate-900">选择 Planner 后重新编排</p>
          <button
            onClick={onClose}
            disabled={loading}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
            aria-label="关闭重新编排弹窗"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-3 px-4 py-4">
          <p className="text-xs text-slate-600">确认后将覆盖当前任务结构，并按所选 Planner 重新编排。</p>
          <select
            value={plannerAgentId}
            onChange={(event) => onChangePlannerAgentId(event.target.value)}
            disabled={loading}
            className="w-full rounded-md border border-slate-300 px-2 py-2 text-sm disabled:opacity-50"
          >
            <option value="">默认 Planner</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
          <label className="inline-flex items-center gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={autoGenerate}
              onChange={(event) => onChangeAutoGenerate(event.target.checked)}
              disabled={loading}
            />
            重排后自动持续生成任务
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
          <button
            onClick={onClose}
            disabled={loading}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={onSubmit}
            disabled={disabled || loading || isPending}
            className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700 disabled:bg-slate-300"
          >
            <ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            {loading ? '重新编排中...' : '确定并重排'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ReplanModal;
