import React from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { OrchestrationTask } from '../../../services/orchestrationService';

type Props = {
  dependencyModalTask: OrchestrationTask | null;
  dependencyModalCandidates: OrchestrationTask[];
  dependencyModalDraftIds: string[];
  onClose: () => void;
  onClear: () => void;
  onToggle: (dependencyTaskId: string) => void;
  onApply: () => void;
};

const DependencyModal: React.FC<Props> = ({
  dependencyModalTask,
  dependencyModalCandidates,
  dependencyModalDraftIds,
  onClose,
  onClear,
  onToggle,
  onApply,
}) => {
  if (!dependencyModalTask) return null;

  return (
    <div className="fixed inset-0 z-[96] flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-xl rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">设置任务依赖</p>
            <p className="mt-0.5 text-xs text-slate-500">
              #{dependencyModalTask.order + 1} {dependencyModalTask.title || '未命名任务'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="关闭依赖设置弹窗"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-3 px-4 py-4">
          <div className="max-h-72 space-y-2 overflow-y-auto rounded-md border border-slate-200 p-3">
            {dependencyModalCandidates.length === 0 ? (
              <p className="text-xs text-slate-500">暂无可依赖任务，请先新增其他任务。</p>
            ) : (
              dependencyModalCandidates.map((candidate) => (
                <label
                  key={candidate._id}
                  className="flex cursor-pointer items-start gap-2 rounded border border-slate-200 px-2 py-1.5 hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    checked={dependencyModalDraftIds.includes(candidate._id)}
                    onChange={() => onToggle(candidate._id)}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                  />
                  <span className="text-xs text-slate-700">#{candidate.order + 1} {candidate.title || '未命名任务'}</span>
                </label>
              ))
            )}
          </div>
          <p className="text-xs text-slate-500">已选择 {dependencyModalDraftIds.length} 项依赖</p>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-slate-200 px-4 py-3">
          <button
            onClick={onClear}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          >
            清空依赖
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
            >
              取消
            </button>
            <button
              onClick={onApply}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700"
            >
              确认
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DependencyModal;
