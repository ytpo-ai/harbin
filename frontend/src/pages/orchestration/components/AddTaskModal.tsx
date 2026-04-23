import React from 'react';
import { PlusIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { OrchestrationTask } from '../../../services/orchestrationService';
import { TaskPriority } from '../constants';

type ExecutorType = 'agent' | 'employee' | 'unassigned';

type Props = {
  open: boolean;
  planTasks: OrchestrationTask[];
  newTaskTitle: string;
  newTaskDescription: string;
  newTaskPriority: TaskPriority;
  newTaskInsertAfterTaskId: string;
  newTaskParentTaskId: string;
  newTaskExecutorType: ExecutorType;
  newTaskExecutorId: string;
  agents: Array<{ id: string; name: string }>;
  employees: Array<{ id: string; name?: string }>;
  addTaskLoading: boolean;
  onClose: () => void;
  onTitleChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onPriorityChange: (value: TaskPriority) => void;
  onInsertAfterTaskIdChange: (value: string) => void;
  onExecutorTypeChange: (value: ExecutorType) => void;
  onExecutorIdChange: (value: string) => void;
  onConfirm: () => void;
};

const AddTaskModal: React.FC<Props> = ({
  open,
  planTasks,
  newTaskTitle,
  newTaskDescription,
  newTaskPriority,
  newTaskInsertAfterTaskId,
  newTaskParentTaskId,
  newTaskExecutorType,
  newTaskExecutorId,
  agents,
  employees,
  addTaskLoading,
  onClose,
  onTitleChange,
  onDescriptionChange,
  onPriorityChange,
  onInsertAfterTaskIdChange,
  onExecutorTypeChange,
  onExecutorIdChange,
  onConfirm,
}) => {
  if (!open) return null;

  const parentTask = newTaskParentTaskId ? planTasks.find((task) => task._id === newTaskParentTaskId) : null;

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <p className="text-sm font-semibold text-slate-900">添加任务</p>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="关闭添加任务弹窗"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-3 px-4 py-4">
          <input
            value={newTaskTitle}
            onChange={(event) => onTitleChange(event.target.value)}
            placeholder="任务标题"
            className="w-full rounded-md border border-slate-300 px-2 py-2 text-sm"
          />
          <textarea
            value={newTaskDescription}
            onChange={(event) => onDescriptionChange(event.target.value)}
            placeholder="任务描述"
            className="min-h-[120px] w-full rounded-md border border-slate-300 px-2 py-2 text-sm"
          />
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <select
              value={newTaskPriority}
              onChange={(event) => onPriorityChange(event.target.value as TaskPriority)}
              className="rounded-md border border-slate-300 px-2 py-2 text-sm"
            >
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
              <option value="urgent">urgent</option>
            </select>
            <select
              value={newTaskInsertAfterTaskId}
              onChange={(event) => onInsertAfterTaskIdChange(event.target.value)}
              disabled={Boolean(newTaskParentTaskId)}
              className="rounded-md border border-slate-300 px-2 py-2 text-sm disabled:bg-slate-100"
            >
              <option value="">追加到末尾</option>
              {planTasks.map((task) => (
                <option key={task._id} value={task._id}>
                  在 #{task.order + 1} 后插入
                </option>
              ))}
            </select>
          </div>

          {parentTask ? (
            <p className="text-xs text-emerald-700">
              将创建为补充任务，父任务：#{parentTask.order + 1} {parentTask.title || '未命名任务'}
            </p>
          ) : null}

          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <select
              value={newTaskExecutorType}
              onChange={(event) => onExecutorTypeChange(event.target.value as ExecutorType)}
              className="rounded-md border border-slate-300 px-2 py-2 text-sm"
            >
              <option value="agent">Agent</option>
              <option value="employee">Employee</option>
              <option value="unassigned">Unassigned</option>
            </select>

            {newTaskExecutorType === 'agent' ? (
              <select
                value={newTaskExecutorId}
                onChange={(event) => onExecutorIdChange(event.target.value)}
                className="rounded-md border border-slate-300 px-2 py-2 text-sm"
              >
                <option value="">选择 Agent</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>{agent.name}</option>
                ))}
              </select>
            ) : newTaskExecutorType === 'employee' ? (
              <select
                value={newTaskExecutorId}
                onChange={(event) => onExecutorIdChange(event.target.value)}
                className="rounded-md border border-slate-300 px-2 py-2 text-sm"
              >
                <option value="">选择员工</option>
                {employees.map((employee) => (
                  <option key={employee.id} value={employee.id}>{employee.name || employee.id}</option>
                ))}
              </select>
            ) : (
              <div className="flex items-center rounded-md border border-dashed border-slate-300 px-2 py-2 text-xs text-slate-500">
                未分配执行者
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
          <button
            onClick={onClose}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            disabled={addTaskLoading}
            className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700 disabled:bg-slate-300"
          >
            <PlusIcon className="h-4 w-4" /> {addTaskLoading ? '添加中...' : '确认添加'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AddTaskModal;
