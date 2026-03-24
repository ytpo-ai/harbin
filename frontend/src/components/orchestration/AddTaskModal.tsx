import React from 'react';
import { PlusIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { OrchestrationTask } from '../../services/orchestrationService';

interface AddTaskModalProps {
  open: boolean;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  insertAfterTaskId: string;
  planTasks: OrchestrationTask[];
  isLoading: boolean;
  onClose: () => void;
  onChangeTitle: (value: string) => void;
  onChangeDescription: (value: string) => void;
  onChangePriority: (value: 'low' | 'medium' | 'high' | 'urgent') => void;
  onChangeInsertAfterTaskId: (value: string) => void;
  onSubmit: () => void;
}

const AddTaskModal: React.FC<AddTaskModalProps> = ({
  open,
  title,
  description,
  priority,
  insertAfterTaskId,
  planTasks,
  isLoading,
  onClose,
  onChangeTitle,
  onChangeDescription,
  onChangePriority,
  onChangeInsertAfterTaskId,
  onSubmit,
}) => {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[92] flex items-center justify-center bg-slate-900/40 p-4">
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
            value={title}
            onChange={(event) => onChangeTitle(event.target.value)}
            placeholder="任务标题"
            className="w-full rounded-md border border-slate-300 px-2 py-2 text-sm"
          />
          <textarea
            value={description}
            onChange={(event) => onChangeDescription(event.target.value)}
            placeholder="任务描述"
            className="min-h-[120px] w-full rounded-md border border-slate-300 px-2 py-2 text-sm"
          />
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <select
              value={priority}
              onChange={(event) => onChangePriority(event.target.value as 'low' | 'medium' | 'high' | 'urgent')}
              className="rounded-md border border-slate-300 px-2 py-2 text-sm"
            >
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
              <option value="urgent">urgent</option>
            </select>
            <select
              value={insertAfterTaskId}
              onChange={(event) => onChangeInsertAfterTaskId(event.target.value)}
              className="rounded-md border border-slate-300 px-2 py-2 text-sm"
            >
              <option value="">追加到末尾</option>
              {planTasks.map((task) => (
                <option key={task._id} value={task._id}>
                  在 #{task.order + 1} 后插入
                </option>
              ))}
            </select>
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
            onClick={onSubmit}
            disabled={isLoading}
            className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700 disabled:bg-slate-300"
          >
            <PlusIcon className="h-4 w-4" /> {isLoading ? '添加中...' : '确认添加'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AddTaskModal;
