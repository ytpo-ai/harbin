import React from 'react';
import {
  ArrowPathIcon,
  BeakerIcon,
  ChevronRightIcon,
  PencilSquareIcon,
  PlayIcon,
  PlusIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { Employee } from '../../../../services/employeeService';
import {
  DebugRuntimeTaskTypeOverride,
  OrchestrationPlan,
  OrchestrationTask,
  PlanMode,
} from '../../../../services/orchestrationService';
import {
  STATUS_COLOR,
  TaskBatchUpdateItem,
  TASK_RUNTIME_TYPE_LABEL,
  TaskEditableDraft,
} from '../../constants';
import { isTaskEditable } from '../../utils';

type AgentOption = { id: string; name: string };

type Props = {
  selectedPlanId: string;
  planDetail: OrchestrationPlan;
  currentPromptDraft: string;
  planHint: string;
  taskHint: string;
  planModeDraft: PlanMode;
  planTasks: OrchestrationTask[];
  isPlanEditable: boolean;
  agents: AgentOption[];
  employees: Employee[];
  debugTaskId: string;
  dirtyTaskUpdates: TaskBatchUpdateItem[];
  savePlanPromptLoading: boolean;
  replanPlanLoading: boolean;
  runPlanLoading: boolean;
  addTaskLoading: boolean;
  batchUpdateTasksLoading: boolean;
  reorderTaskLoading: boolean;
  duplicateTaskLoading: boolean;
  removeTaskLoading: boolean;
  retryTaskLoading: boolean;
  onPromptDraftChange: (value: string) => void;
  onPlanModeDraftChange: (value: PlanMode) => void;
  onSavePrompt: () => void;
  onReplan: () => void;
  onCopyToCreate: () => void;
  onRunPlan: () => void;
  onDeletePlan: () => void;
  onOpenAddTaskModal: () => void;
  onSaveTaskEdits: () => void;
  getEffectiveTaskDraft: (task: OrchestrationTask) => TaskEditableDraft;
  onUpdateTaskDraftField: (task: OrchestrationTask, patch: Partial<TaskEditableDraft>) => void;
  onMoveTask: (taskId: string, direction: 'up' | 'down') => void;
  onDuplicateTask: (taskId: string) => void;
  onRemoveTask: (task: OrchestrationTask) => void;
  onOpenDebugDrawer: (taskId: string, tab?: 'debug' | 'session') => void;
  onOpenDependencyModal: (task: OrchestrationTask) => void;
  onReassignTask: (payload: { taskId: string; executorType: 'agent' | 'employee' | 'unassigned'; executorId?: string }) => void;
  onCompleteHumanTask: (taskId: string) => void;
  onRetryTask: (taskId: string) => void;
  onOpenSessionTab: (taskId: string, sessionId?: string) => void;
};

const SettingsTab: React.FC<Props> = ({
  selectedPlanId,
  planDetail,
  currentPromptDraft,
  planHint,
  taskHint,
  planModeDraft,
  planTasks,
  isPlanEditable,
  agents,
  employees,
  debugTaskId,
  dirtyTaskUpdates,
  savePlanPromptLoading,
  replanPlanLoading,
  runPlanLoading,
  addTaskLoading,
  batchUpdateTasksLoading,
  reorderTaskLoading,
  duplicateTaskLoading,
  removeTaskLoading,
  retryTaskLoading,
  onPromptDraftChange,
  onPlanModeDraftChange,
  onSavePrompt,
  onReplan,
  onCopyToCreate,
  onRunPlan,
  onDeletePlan,
  onOpenAddTaskModal,
  onSaveTaskEdits,
  getEffectiveTaskDraft,
  onUpdateTaskDraftField,
  onMoveTask,
  onDuplicateTask,
  onRemoveTask,
  onOpenDebugDrawer,
  onOpenDependencyModal,
  onReassignTask,
  onCompleteHumanTask,
  onRetryTask,
  onOpenSessionTab,
}) => {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={onSavePrompt}
          disabled={!selectedPlanId || savePlanPromptLoading}
          className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <PencilSquareIcon className="h-3.5 w-3.5" /> 保存 Prompt
        </button>
        <button
          onClick={onReplan}
          disabled={!selectedPlanId || replanPlanLoading || runPlanLoading}
          className="inline-flex items-center gap-1 rounded-md border border-indigo-200 px-3 py-1.5 text-xs text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
        >
          <ArrowPathIcon className="h-3.5 w-3.5" /> 重新编排
        </button>
        <button
          onClick={onCopyToCreate}
          className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
        >
          <PencilSquareIcon className="h-3.5 w-3.5" /> 复制到新建
        </button>
        <button
          onClick={onRunPlan}
          disabled={!selectedPlanId || runPlanLoading || planDetail?.strategy?.runMode === 'once'}
          title={planDetail?.strategy?.runMode === 'once' ? 'once 模式仅在生成任务过程中执行，不支持手动运行' : undefined}
          className="inline-flex items-center gap-1 rounded-md border border-cyan-200 px-3 py-1.5 text-xs text-cyan-700 hover:bg-cyan-50 disabled:opacity-50"
        >
          <PlayIcon className="h-3.5 w-3.5" /> 运行计划
        </button>
        <button
          onClick={onDeletePlan}
          className="inline-flex items-center gap-1 rounded-md border border-rose-200 px-3 py-1.5 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-50"
        >
          <TrashIcon className="h-3.5 w-3.5" /> 删除计划
        </button>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 text-xs text-slate-700">
        <p>
          <span className="font-medium">Planner Agent:</span> {planDetail.strategy?.plannerAgentId || '默认'}
        </p>
        <div className="mt-2">
          <p className="mb-1 font-medium">计划模式</p>
          <select
            value={planModeDraft}
            onChange={(event) => onPlanModeDraftChange(event.target.value as PlanMode)}
            className="w-full rounded border border-slate-200 bg-white p-2 text-xs text-slate-700"
          >
            <option value="sequential">串行</option>
            <option value="parallel">并行</option>
            <option value="hybrid">混合</option>
          </select>
        </div>
        <div className="mt-2">
          <p className="mb-1 font-medium">Prompt（支持编辑与保持）</p>
          <textarea
            value={currentPromptDraft}
            onChange={(event) => onPromptDraftChange(event.target.value)}
            className="min-h-[120px] w-full rounded border border-slate-200 bg-white p-2 text-xs text-slate-600"
          />
        </div>
        {planHint && <p className="mt-2 text-xs text-indigo-700">{planHint}</p>}
      </div>

      <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3 text-xs text-slate-700 md:grid-cols-4">
        <div>总任务: {planDetail.stats?.totalTasks ?? '-'}</div>
        <div>已完成: {planDetail.stats?.completedTasks ?? '-'}</div>
        <div>失败: {planDetail.stats?.failedTasks ?? '-'}</div>
        <div>待人工: {planDetail.stats?.waitingHumanTasks ?? '-'}</div>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold text-slate-700">任务列表</p>
          <div className="flex items-center gap-2">
            <button
              onClick={onOpenAddTaskModal}
              disabled={!isPlanEditable || addTaskLoading}
              className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <PlusIcon className="h-3.5 w-3.5" /> 添加任务
            </button>
            <button
              onClick={onSaveTaskEdits}
              disabled={!dirtyTaskUpdates.length || batchUpdateTasksLoading}
              className="inline-flex items-center gap-1 rounded-md border border-indigo-200 px-2 py-1 text-xs text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
            >
              <PencilSquareIcon className="h-3.5 w-3.5" />
              {batchUpdateTasksLoading ? '保存中...' : `批量保存(${dirtyTaskUpdates.length})`}
            </button>
          </div>
        </div>
        {taskHint ? <p className="text-xs text-indigo-700">{taskHint}</p> : null}

        {planTasks.length === 0 ? (
          <p className="text-sm text-slate-400">该计划暂无任务</p>
        ) : (
          planTasks.map((task) => {
            const editable = isTaskEditable(planDetail.status, task.status);
            const draft = getEffectiveTaskDraft(task);
            const isDirty = dirtyTaskUpdates.some((item) => item.taskId === task._id);
            return (
              <div
                key={task._id}
                className={`space-y-2 rounded-lg border p-3 ${debugTaskId === task._id ? 'border-primary-300 bg-primary-50/40' : 'border-gray-200'}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] uppercase tracking-wide text-slate-400">任务 #{task.order + 1}</p>
                    <input
                      value={draft.title}
                      onChange={(event) => onUpdateTaskDraftField(task, { title: event.target.value })}
                      disabled={!editable}
                      className={`mt-1 w-full rounded border px-2 py-1 text-sm font-medium text-slate-900 ${editable ? 'border-slate-300 bg-white' : 'border-slate-200 bg-slate-50 text-slate-600'}`}
                    />
                    {isDirty ? <p className="mt-1 text-[11px] text-indigo-600">有未保存改动</p> : null}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={`rounded px-1.5 py-0.5 text-xs ${STATUS_COLOR[task.status] || STATUS_COLOR.pending}`}>
                      {task.status}
                    </span>
                    <span className="rounded border border-cyan-200 bg-cyan-50 px-1.5 py-0.5 text-xs text-cyan-700">
                      type: {task.runtimeTaskType ? TASK_RUNTIME_TYPE_LABEL[task.runtimeTaskType as DebugRuntimeTaskTypeOverride] : 'auto'}
                    </span>
                    <button
                      onClick={() => onMoveTask(task._id, 'up')}
                      disabled={!editable || reorderTaskLoading || task.order <= 0}
                      className="hidden rounded border border-slate-300 px-1.5 py-0.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => onMoveTask(task._id, 'down')}
                      disabled={!editable || reorderTaskLoading || task.order >= planTasks.length - 1}
                      className="hidden rounded border border-slate-300 px-1.5 py-0.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      ↓
                    </button>
                    <button
                      onClick={() => onDuplicateTask(task._id)}
                      disabled={!editable || duplicateTaskLoading || !selectedPlanId}
                      className="hidden rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      复制
                    </button>
                    <button
                      onClick={() => onRemoveTask(task)}
                      disabled={!editable || removeTaskLoading}
                      className="rounded border border-rose-200 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                    >
                      删除
                    </button>
                    <button
                      onClick={() => onOpenDebugDrawer(task._id, 'debug')}
                      className="inline-flex items-center gap-1 rounded border border-primary-200 px-2 py-1 text-xs text-primary-700 hover:bg-primary-50"
                    >
                      <BeakerIcon className="h-3.5 w-3.5" /> 调试
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 items-center gap-2 md:grid-cols-4">
                  <select
                    value={draft.priority}
                    onChange={(event) => onUpdateTaskDraftField(task, { priority: event.target.value as TaskEditableDraft['priority'] })}
                    disabled={!editable}
                    className="rounded border border-gray-300 px-2 py-1.5 text-xs disabled:bg-slate-50"
                  >
                    <option value="low">low</option>
                    <option value="medium">medium</option>
                    <option value="high">high</option>
                    <option value="urgent">urgent</option>
                  </select>

                  <select
                    value={task.assignment?.executorType || 'unassigned'}
                    onChange={(event) => {
                      const executorType = event.target.value as 'agent' | 'employee' | 'unassigned';
                      onReassignTask({ taskId: task._id, executorType });
                    }}
                    disabled={!editable}
                    className="rounded border border-gray-300 px-2 py-1.5 text-xs disabled:bg-slate-50"
                  >
                    <option value="agent">Agent</option>
                    <option value="employee">Employee</option>
                    <option value="unassigned">Unassigned</option>
                  </select>

                  {task.assignment?.executorType === 'agent' ? (
                    <select
                      value={task.assignment.executorId || ''}
                      onChange={(event) => onReassignTask({ taskId: task._id, executorType: 'agent', executorId: event.target.value })}
                      disabled={!editable}
                      className="rounded border border-gray-300 px-2 py-1.5 text-xs disabled:bg-slate-50"
                    >
                      <option value="">选择 Agent</option>
                      {agents.map((agent) => (
                        <option key={agent.id} value={agent.id}>
                          {agent.name}
                        </option>
                      ))}
                    </select>
                  ) : task.assignment?.executorType === 'employee' ? (
                    <select
                      value={task.assignment.executorId || ''}
                      onChange={(event) => onReassignTask({ taskId: task._id, executorType: 'employee', executorId: event.target.value })}
                      disabled={!editable}
                      className="rounded border border-gray-300 px-2 py-1.5 text-xs disabled:bg-slate-50"
                    >
                      <option value="">选择员工</option>
                      {employees.map((employee) => (
                        <option key={employee.id} value={employee.id}>
                          {employee.name || employee.id}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="text-xs text-gray-400">未分配执行者</div>
                  )}

                  <div className="flex items-center gap-2 rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs">
                    <button
                      onClick={() => onOpenDependencyModal(task)}
                      disabled={!editable}
                      className="inline-flex shrink-0 items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      依赖
                    </button>
                    <p className="min-w-0 truncate text-[11px] text-slate-500">
                      {draft.dependencyTaskIds.length ? `已选 ${draft.dependencyTaskIds.length} 项` : '无依赖'}
                    </p>
                  </div>
                </div>

                <div className="space-y-2 rounded border border-gray-200 bg-gray-50/70 p-2">
                  <p className="text-[11px] font-semibold text-gray-700">任务上下文</p>
                  <textarea
                    value={draft.description}
                    onChange={(event) => onUpdateTaskDraftField(task, { description: event.target.value })}
                    disabled={!editable}
                    className={`min-h-[72px] w-full rounded border px-2 py-1.5 text-xs ${editable ? 'border-slate-300 bg-white text-slate-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}
                  />
                  <p className="text-xs text-gray-600">
                    <span className="font-medium text-gray-700">输出:</span> {task.result?.output || task.result?.summary || '-'}
                  </p>
                  <p className="text-xs text-gray-600">
                    <span className="font-medium text-gray-700">错误:</span> {task.result?.error || '-'}
                  </p>
                  <p className="inline-flex items-center gap-1 text-xs text-gray-600">
                    <span className="font-medium text-gray-700">Session:</span>
                    {task.sessionId ? (
                      <button
                        onClick={() => onOpenSessionTab(task._id, task.sessionId)}
                        className="inline-flex items-center gap-1 text-primary-700 hover:underline"
                      >
                        {task.sessionId}
                        <ChevronRightIcon className="h-3.5 w-3.5" />
                      </button>
                    ) : (
                      <span>-</span>
                    )}
                  </p>
                </div>

                <div className="text-right">
                  {task.status === 'waiting_human' && (
                    <button
                      onClick={() => onCompleteHumanTask(task._id)}
                      className="rounded bg-emerald-600 px-2 py-1.5 text-xs text-white"
                    >
                      人工完成
                    </button>
                  )}
                  {task.status === 'failed' && (
                    <button
                      onClick={() => onRetryTask(task._id)}
                      disabled={retryTaskLoading}
                      className="rounded bg-blue-600 px-2 py-1.5 text-xs text-white disabled:bg-gray-300"
                    >
                      重试
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </>
  );
};

export default SettingsTab;
