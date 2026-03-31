import React from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { Employee } from '../../../../services/employeeService';
import {
  OrchestrationPlan,
  OrchestrationRun,
  OrchestrationTask,
  PlanMode,
} from '../../../../services/orchestrationService';
import { PlanDrawerTab, RunStatusFilter, RunTriggerFilter, TaskBatchUpdateItem, TaskEditableDraft } from '../../constants';
import HistoryTab from './HistoryTab';
import SettingsTab from './SettingsTab';

type AgentOption = { id: string; name: string };

type Props = {
  open: boolean;
  selectedPlanId: string;
  planDetail?: OrchestrationPlan;
  planDetailLoading: boolean;
  activePlanDrawerTab: PlanDrawerTab;
  currentPromptDraft: string;
  planHint: string;
  taskHint: string;
  planModeDraft: PlanMode;
  planTasks: OrchestrationTask[];
  isPlanEditable: boolean;
  debugTaskId: string;
  dirtyTaskUpdates: TaskBatchUpdateItem[];
  latestRunSummary: OrchestrationRun | null;
  latestRunLoading: boolean;
  runTriggerFilter: RunTriggerFilter;
  runStatusFilter: RunStatusFilter;
  planRunsLoading: boolean;
  planRunsError: unknown;
  filteredPlanRuns: OrchestrationRun[];
  agents: AgentOption[];
  employees: Employee[];
  savePlanPromptLoading: boolean;
  replanPlanLoading: boolean;
  runPlanLoading: boolean;
  stopGenerationLoading: boolean;
  addTaskLoading: boolean;
  batchUpdateTasksLoading: boolean;
  reorderTaskLoading: boolean;
  duplicateTaskLoading: boolean;
  removeTaskLoading: boolean;
  retryTaskLoading: boolean;
  onClose: () => void;
  onTabChange: (tab: PlanDrawerTab) => void;
  onPromptDraftChange: (value: string) => void;
  onPlanModeDraftChange: (value: PlanMode) => void;
  onSavePrompt: () => void;
  onReplan: () => void;
  onCopyToCreate: () => void;
  onRunPlan: () => void;
  onStopGeneration: () => void;
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
  onOpenRunDetail: (runId: string) => void;
  onRunTriggerFilterChange: (value: RunTriggerFilter) => void;
  onRunStatusFilterChange: (value: RunStatusFilter) => void;
};

const PlanDetailDrawer: React.FC<Props> = ({
  open,
  selectedPlanId,
  planDetail,
  planDetailLoading,
  activePlanDrawerTab,
  currentPromptDraft,
  planHint,
  taskHint,
  planModeDraft,
  planTasks,
  isPlanEditable,
  debugTaskId,
  dirtyTaskUpdates,
  latestRunSummary,
  latestRunLoading,
  runTriggerFilter,
  runStatusFilter,
  planRunsLoading,
  planRunsError,
  filteredPlanRuns,
  agents,
  employees,
  savePlanPromptLoading,
  replanPlanLoading,
  runPlanLoading,
  stopGenerationLoading,
  addTaskLoading,
  batchUpdateTasksLoading,
  reorderTaskLoading,
  duplicateTaskLoading,
  removeTaskLoading,
  retryTaskLoading,
  onClose,
  onTabChange,
  onPromptDraftChange,
  onPlanModeDraftChange,
  onSavePrompt,
  onReplan,
  onCopyToCreate,
  onRunPlan,
  onStopGeneration,
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
  onOpenRunDetail,
  onRunTriggerFilterChange,
  onRunStatusFilterChange,
}) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40">
      <button
        className="absolute inset-0 bg-black/30"
        onClick={onClose}
        aria-label="关闭详情抽屉"
      />
      <aside className="absolute right-0 top-0 h-full w-full max-w-5xl overflow-y-auto bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">{planDetail?.title || '计划详情'}</p>
            <p className="text-xs text-slate-500">mode: {planDetail?.strategy?.mode || '-'}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="关闭抽屉"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-3 p-4">
          {!selectedPlanId ? (
            <p className="text-sm text-slate-500">未选择计划。</p>
          ) : planDetailLoading && !planDetail ? (
            <p className="text-sm text-slate-500">加载中...</p>
          ) : !planDetail ? (
            <p className="text-sm text-slate-500">未获取到计划详情。</p>
          ) : (
            <>
              <div className="rounded-lg border border-slate-200 bg-white p-2">
                <div className="inline-flex items-center gap-2">
                  <button
                    onClick={() => onTabChange('settings')}
                    className={`rounded-md px-3 py-1.5 text-xs ${activePlanDrawerTab === 'settings' ? 'bg-primary-100 text-primary-700' : 'text-slate-600 hover:bg-slate-100'}`}
                  >
                    任务设置
                  </button>
                  <button
                    onClick={() => onTabChange('history')}
                    className={`rounded-md px-3 py-1.5 text-xs ${activePlanDrawerTab === 'history' ? 'bg-primary-100 text-primary-700' : 'text-slate-600 hover:bg-slate-100'}`}
                  >
                    执行历史
                  </button>
                </div>
              </div>

              {activePlanDrawerTab === 'settings' ? (
                <SettingsTab
                  selectedPlanId={selectedPlanId}
                  planDetail={planDetail}
                  currentPromptDraft={currentPromptDraft}
                  planHint={planHint}
                  taskHint={taskHint}
                  planModeDraft={planModeDraft}
                  planTasks={planTasks}
                  isPlanEditable={isPlanEditable}
                  agents={agents}
                  employees={employees}
                  debugTaskId={debugTaskId}
                  dirtyTaskUpdates={dirtyTaskUpdates}
                  savePlanPromptLoading={savePlanPromptLoading}
                  replanPlanLoading={replanPlanLoading}
                  runPlanLoading={runPlanLoading}
                  stopGenerationLoading={stopGenerationLoading}
                  addTaskLoading={addTaskLoading}
                  batchUpdateTasksLoading={batchUpdateTasksLoading}
                  reorderTaskLoading={reorderTaskLoading}
                  duplicateTaskLoading={duplicateTaskLoading}
                  removeTaskLoading={removeTaskLoading}
                  retryTaskLoading={retryTaskLoading}
                  onPromptDraftChange={onPromptDraftChange}
                  onPlanModeDraftChange={onPlanModeDraftChange}
                  onSavePrompt={onSavePrompt}
                  onReplan={onReplan}
                  onCopyToCreate={onCopyToCreate}
                  onRunPlan={onRunPlan}
                  onStopGeneration={onStopGeneration}
                  onDeletePlan={onDeletePlan}
                  onOpenAddTaskModal={onOpenAddTaskModal}
                  onSaveTaskEdits={onSaveTaskEdits}
                  getEffectiveTaskDraft={getEffectiveTaskDraft}
                  onUpdateTaskDraftField={onUpdateTaskDraftField}
                  onMoveTask={onMoveTask}
                  onDuplicateTask={onDuplicateTask}
                  onRemoveTask={onRemoveTask}
                  onOpenDebugDrawer={onOpenDebugDrawer}
                  onOpenDependencyModal={onOpenDependencyModal}
                  onReassignTask={onReassignTask}
                  onCompleteHumanTask={onCompleteHumanTask}
                  onRetryTask={onRetryTask}
                  onOpenSessionTab={onOpenSessionTab}
                />
              ) : (
                <HistoryTab
                  latestRunSummary={latestRunSummary}
                  latestRunLoading={latestRunLoading}
                  runTriggerFilter={runTriggerFilter}
                  runStatusFilter={runStatusFilter}
                  planRunsLoading={planRunsLoading}
                  planRunsError={planRunsError}
                  filteredPlanRuns={filteredPlanRuns}
                  onOpenRunDetail={onOpenRunDetail}
                  onRunTriggerFilterChange={onRunTriggerFilterChange}
                  onRunStatusFilterChange={onRunStatusFilterChange}
                />
              )}
            </>
          )}
        </div>
      </aside>
    </div>
  );
};

export default PlanDetailDrawer;
