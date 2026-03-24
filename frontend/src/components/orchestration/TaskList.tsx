import React from 'react';
import { PencilSquareIcon, PlusIcon } from '@heroicons/react/24/outline';
import { OrchestrationTask } from '../../services/orchestrationService';
import TaskCard from './TaskCard';

interface TaskListProps {
  tasks: OrchestrationTask[];
  planStatus: string;
  isPlanEditable: boolean;
  taskHint: string;
  debugTaskId: string;
  streamTaskIds: string[];
  dirtyCount: number;
  isAddLoading: boolean;
  isBatchSaving: boolean;
  isReordering: boolean;
  isDuplicating: boolean;
  isRemoving: boolean;
  onOpenAddTask: () => void;
  onSaveBatch: () => void;
  onMoveTask: (taskId: string, direction: 'up' | 'down') => void;
  onDuplicateTask: (taskId: string) => void;
  onRemoveTask: (taskId: string) => void;
  onOpenTaskEdit: (taskId: string) => void;
  onOpenDebug: (taskId: string) => void;
  onCompleteHuman: (taskId: string) => void;
  onRetryTask: (taskId: string) => void;
}

const TaskList: React.FC<TaskListProps> = ({
  tasks,
  planStatus,
  isPlanEditable,
  taskHint,
  debugTaskId,
  streamTaskIds,
  dirtyCount,
  isAddLoading,
  isBatchSaving,
  isReordering,
  isDuplicating,
  isRemoving,
  onOpenAddTask,
  onSaveBatch,
  onMoveTask,
  onDuplicateTask,
  onRemoveTask,
  onOpenTaskEdit,
  onOpenDebug,
  onCompleteHuman,
  onRetryTask,
}) => {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-800">任务列表</p>
        <div className="flex items-center gap-2">
          <button
            onClick={onOpenAddTask}
            disabled={!isPlanEditable || isAddLoading}
            className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <PlusIcon className="h-3.5 w-3.5" /> 添加任务
          </button>
          <button
            onClick={onSaveBatch}
            disabled={!dirtyCount || isBatchSaving}
            className="inline-flex items-center gap-1 rounded-md border border-indigo-200 px-2.5 py-1.5 text-xs text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
          >
            <PencilSquareIcon className="h-3.5 w-3.5" />
            {isBatchSaving ? '保存中...' : `批量保存(${dirtyCount})`}
          </button>
        </div>
      </div>

      {taskHint ? <p className="text-xs text-indigo-700">{taskHint}</p> : null}

      {tasks.length === 0 ? (
        <p className="py-4 text-sm text-slate-400">该计划暂无任务</p>
      ) : (
        tasks.map((task) => (
          <TaskCard
            key={task._id}
            task={task}
            planStatus={planStatus}
            planTaskCount={tasks.length}
            highlightDebug={debugTaskId === task._id}
            highlightStream={streamTaskIds.includes(task._id)}
            isRemoving={isRemoving}
            isDuplicating={isDuplicating}
            isReordering={isReordering}
            onMoveTask={onMoveTask}
            onDuplicateTask={onDuplicateTask}
            onRemoveTask={onRemoveTask}
            onOpenTaskEdit={onOpenTaskEdit}
            onOpenDebug={onOpenDebug}
            onCompleteHuman={onCompleteHuman}
            onRetryTask={onRetryTask}
          />
        ))
      )}
    </div>
  );
};

export default TaskList;
