import React from 'react';
import { PlayIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { DebugRuntimeTaskTypeOverride, OrchestrationTask } from '../../services/orchestrationService';
import { DEBUG_RUNTIME_TYPE_OPTIONS, TaskEditableDraft, isTaskEditable, formatExecutor } from './constants';

interface TaskEditDrawerProps {
  open: boolean;
  task: OrchestrationTask | null;
  planStatus: string;
  draft: TaskEditableDraft | null;
  debugAgentId: string;
  debugRuntimeTaskType: 'auto' | DebugRuntimeTaskTypeOverride;
  debugHint: string;
  agents: Array<{ id: string; name: string }>;
  debugRunning: boolean;
  reassignRunning: boolean;
  onClose: () => void;
  onUpdateDraft: (patch: Partial<TaskEditableDraft>) => void;
  onOpenDependencyModal: () => void;
  onChangeExecutorType: (value: 'agent' | 'unassigned') => void;
  onChangeExecutorAgentId: (value: string) => void;
  onChangeDebugAgentId: (value: string) => void;
  onChangeDebugRuntimeType: (value: 'auto' | DebugRuntimeTaskTypeOverride) => void;
  onRunDebug: () => void;
}

const TaskEditDrawer: React.FC<TaskEditDrawerProps> = ({
  open,
  task,
  planStatus,
  draft,
  debugAgentId,
  debugRuntimeTaskType,
  debugHint,
  agents,
  debugRunning,
  reassignRunning,
  onClose,
  onUpdateDraft,
  onOpenDependencyModal,
  onChangeExecutorType,
  onChangeExecutorAgentId,
  onChangeDebugAgentId,
  onChangeDebugRuntimeType,
  onRunDebug,
}) => {
  if (!open || !task || !draft) {
    return null;
  }

  const editable = isTaskEditable(planStatus);
  const executorType: 'agent' | 'unassigned' = task.assignment?.executorType === 'agent' ? 'agent' : 'unassigned';
  const executorAgentId = executorType === 'agent'
    ? (task.assignment?.executorId || debugAgentId)
    : '';

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

        <div className="border-b border-slate-200 px-4 py-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-slate-500">修改后可直接调试执行当前任务模板</p>
            <button
              onClick={onRunDebug}
              disabled={!editable || debugRunning || reassignRunning}
              className="inline-flex items-center gap-1 rounded bg-slate-900 px-3 py-1.5 text-xs text-white disabled:bg-slate-300"
            >
              <PlayIcon className="h-3.5 w-3.5" /> 调试执行
            </button>
          </div>
          {debugHint ? <p className="mt-1 text-xs text-primary-700">{debugHint}</p> : null}
        </div>

        <div className="h-[calc(100%-109px)] space-y-4 overflow-y-auto p-4">
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
            <p className="mb-1 text-xs text-slate-600">执行类型</p>
            <select
              value={executorType}
              onChange={(event) => {
                const nextType = event.target.value as 'agent' | 'unassigned';
                onChangeExecutorType(nextType);
                if (nextType === 'unassigned') {
                  onChangeDebugAgentId('');
                }
              }}
              disabled={!editable || reassignRunning}
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-50"
            >
              <option value="agent">agent</option>
              <option value="unassigned">unassigned</option>
            </select>
          </div>

          {executorType === 'agent' && (
            <div>
              <p className="mb-1 text-xs text-slate-600">执行 Agent</p>
              <select
                value={executorAgentId}
                onChange={(event) => {
                  const nextAgentId = event.target.value;
                  onChangeExecutorAgentId(nextAgentId);
                  onChangeDebugAgentId(nextAgentId);
                }}
                disabled={!editable || reassignRunning}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-50"
              >
                <option value="">请选择 Agent</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>{agent.name}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <p className="mb-1 text-xs text-slate-600">任务类型</p>
            <select
              value={debugRuntimeTaskType}
              onChange={(event) => onChangeDebugRuntimeType(event.target.value as 'auto' | DebugRuntimeTaskTypeOverride)}
              disabled={!editable}
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-50"
            >
              {DEBUG_RUNTIME_TYPE_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
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
