import React from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { OrchestrationTask } from '../../services/orchestrationService';
import { TaskEditableDraft, isTaskEditable, formatExecutor } from './constants';

interface TaskEditDrawerProps {
  open: boolean;
  task: OrchestrationTask | null;
  planStatus: string;
  draft: TaskEditableDraft | null;
  onClose: () => void;
  onUpdateDraft: (patch: Partial<TaskEditableDraft>) => void;
  onOpenDependencyModal: () => void;
}

const TaskEditDrawer: React.FC<TaskEditDrawerProps> = ({
  open,
  task,
  planStatus,
  draft,
  onClose,
  onUpdateDraft,
  onOpenDependencyModal,
}) => {
  if (!open || !task || !draft) {
    return null;
  }

  const editable = isTaskEditable(planStatus);

  return (
    <div className="fixed inset-0 z-[94]">
      <button
        className="absolute inset-0 bg-black/30"
        onClick={onClose}
        aria-label="关闭任务编辑抽屉"
      />
      <aside className="absolute right-0 top-0 h-full w-full border-l border-slate-200 bg-white shadow-2xl sm:w-[92vw] lg:w-[520px]">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">编辑任务</p>
            <p className="mt-0.5 text-xs text-slate-500">#{task.order + 1} {task.title || '未命名任务'}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="h-[calc(100%-61px)] space-y-4 overflow-y-auto p-4">
          <div>
            <p className="mb-1 text-xs text-slate-600">任务标题</p>
            <input
              value={draft.title}
              onChange={(event) => onUpdateDraft({ title: event.target.value })}
              disabled={!editable}
              className={`w-full rounded border px-2 py-1.5 text-sm ${editable ? 'border-slate-300' : 'border-slate-200 bg-slate-50 text-slate-500'}`}
            />
          </div>

          <div>
            <p className="mb-1 text-xs text-slate-600">优先级</p>
            <select
              value={draft.priority}
              onChange={(event) => onUpdateDraft({ priority: event.target.value as TaskEditableDraft['priority'] })}
              disabled={!editable}
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-50"
            >
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
              <option value="urgent">urgent</option>
            </select>
          </div>

          <div>
            <p className="mb-1 text-xs text-slate-600">任务描述</p>
            <textarea
              value={draft.description}
              onChange={(event) => onUpdateDraft({ description: event.target.value })}
              disabled={!editable}
              className={`min-h-[160px] w-full rounded border px-2 py-1.5 text-sm ${editable ? 'border-slate-300' : 'border-slate-200 bg-slate-50 text-slate-500'}`}
            />
          </div>

          <div className="rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
            <p><span className="font-medium text-slate-700">依赖数量：</span>{draft.dependencyTaskIds.length}</p>
            <p className="mt-1"><span className="font-medium text-slate-700">执行者：</span>{formatExecutor(task)}</p>
            <button
              onClick={onOpenDependencyModal}
              disabled={!editable}
              className="mt-2 inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              依赖设置
            </button>
          </div>

          <div className="flex items-center justify-end">
            <button
              onClick={onClose}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
            >
              完成
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
};

export default TaskEditDrawer;
