import React from 'react';
import {
  BeakerIcon,
  DocumentDuplicateIcon,
  PencilSquareIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { OrchestrationTask } from '../../services/orchestrationService';
import {
  STATUS_COLOR,
  TASK_RUNTIME_TYPE_LABEL,
  formatExecutor,
  isTaskEditable,
} from './constants';

interface TaskCardProps {
  task: OrchestrationTask;
  planStatus: string;
  planTaskCount: number;
  highlightDebug: boolean;
  highlightStream: boolean;
  isRemoving: boolean;
  isDuplicating: boolean;
  isReordering: boolean;
  onMoveTask: (taskId: string, direction: 'up' | 'down') => void;
  onDuplicateTask: (taskId: string) => void;
  onRemoveTask: (taskId: string) => void;
  onOpenTaskEdit: (taskId: string) => void;
  onOpenDebug: (taskId: string) => void;
  onCompleteHuman: (taskId: string) => void;
  onRetryTask: (taskId: string) => void;
}

const TaskCard: React.FC<TaskCardProps> = ({
  task,
  planStatus,
  planTaskCount,
  highlightDebug,
  highlightStream,
  isRemoving,
  isDuplicating,
  isReordering,
  onMoveTask,
  onDuplicateTask,
  onRemoveTask,
  onOpenTaskEdit,
  onOpenDebug,
  onCompleteHuman,
  onRetryTask,
}) => {
  const editable = isTaskEditable(planStatus);

  return (
    <div
      className={`rounded-lg border bg-white p-4 ${highlightDebug ? 'border-primary-300 bg-primary-50/40' : 'border-slate-200'} ${highlightStream ? 'ring-1 ring-amber-300' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-slate-400">任务 #{task.order + 1}</p>
          <p className="mt-1 text-sm font-medium text-slate-900">{task.title || '未命名任务'}</p>
          <p className="mt-1 text-xs text-slate-500 line-clamp-2">{task.description || '-'}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs px-1.5 py-0.5 rounded ${STATUS_COLOR[task.status] || STATUS_COLOR.pending}`}>
            {task.status}
          </span>
          <span className="text-xs px-1.5 py-0.5 rounded bg-cyan-50 text-cyan-700 border border-cyan-200">
            type: {task.runtimeTaskType ? TASK_RUNTIME_TYPE_LABEL[task.runtimeTaskType] : 'auto'}
          </span>
          <button
            onClick={() => onOpenTaskEdit(task._id)}
            disabled={!editable}
            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-indigo-200 text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
          >
            <PencilSquareIcon className="h-3.5 w-3.5" /> 编辑
          </button>
          <button
            onClick={() => onMoveTask(task._id, 'up')}
            disabled={!editable || isReordering || task.order <= 0}
            className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            ↑
          </button>
          <button
            onClick={() => onMoveTask(task._id, 'down')}
            disabled={!editable || isReordering || task.order >= planTaskCount - 1}
            className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            ↓
          </button>
          <button
            onClick={() => onDuplicateTask(task._id)}
            disabled={!editable || isDuplicating}
            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <DocumentDuplicateIcon className="h-3.5 w-3.5" /> 复制
          </button>
          <button
            onClick={() => onRemoveTask(task._id)}
            disabled={!editable || isRemoving}
            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-rose-200 text-rose-700 hover:bg-rose-50 disabled:opacity-50"
          >
            <TrashIcon className="h-3.5 w-3.5" /> 删除
          </button>
          <button
            onClick={() => onOpenDebug(task._id)}
            disabled={!editable}
            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-primary-200 text-primary-700 hover:bg-primary-50 disabled:opacity-50"
          >
            <BeakerIcon className="h-3.5 w-3.5" /> 调试
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-600">
        <span className="inline-flex rounded border border-slate-200 bg-slate-50 px-2 py-1">
          优先级: {task.priority || 'medium'}
        </span>
        <span className="inline-flex rounded border border-slate-200 bg-slate-50 px-2 py-1">
          执行者: {formatExecutor(task)}
        </span>
        <span className="inline-flex rounded border border-slate-200 bg-slate-50 px-2 py-1">
          依赖: {(task.dependencyTaskIds || []).length}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {task.status === 'waiting_human' && (
          <button
            onClick={() => onCompleteHuman(task._id)}
            disabled={!editable}
            className="text-xs px-2 py-1.5 rounded bg-emerald-600 text-white disabled:opacity-50"
          >
            人工完成
          </button>
        )}
        {task.status === 'failed' && (
          <button
            onClick={() => onRetryTask(task._id)}
            disabled={!editable}
            className="text-xs px-2 py-1.5 rounded bg-blue-600 text-white disabled:opacity-50"
          >
            重试
          </button>
        )}
      </div>
    </div>
  );
};

export default TaskCard;
