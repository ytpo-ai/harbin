import React from 'react';
import {
  OrchestrationPlan,
  OrchestrationRun,
  PlanMode,
} from '../../services/orchestrationService';
import PlanSummaryCards from './PlanSummaryCards';
import PlanDraftingBanner from './PlanDraftingBanner';
import PlanTabBar from './PlanTabBar';
import PlanDetailSettingsTab from './PlanDetailSettingsTab';
import PlanHistoryTab from './PlanHistoryTab';
import { PlanDetailTab } from './constants';

interface PlanDetailMainContentProps {
  planId?: string;
  planDetail: OrchestrationPlan;
  latestRunSummary: OrchestrationRun | null;
  streamHint: string;
  streamConnected: boolean;
  activeTab: PlanDetailTab;
  setActiveTab: (tab: PlanDetailTab) => void;
  modeDraft: PlanMode;
  promptDraft: string;
  promptHint: string;
  setModeDraft: (mode: PlanMode) => void;
  setPromptDraft: (value: string) => void;
  isPlanEditable: boolean;
  taskHint: string;
  debugTaskId: string;
  streamTaskIds: string[];
  dirtyTaskCount: number;
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
  filteredPlanRuns: OrchestrationRun[];
  latestRunLoading: boolean;
  planRunsLoading: boolean;
  planRunsError: boolean;
  runTriggerFilter: 'all' | 'manual' | 'schedule' | 'autorun';
  runStatusFilter: 'all' | 'running' | 'completed' | 'failed' | 'cancelled';
  cancelRunLoading: boolean;
  onChangeTriggerFilter: (value: 'all' | 'manual' | 'schedule' | 'autorun') => void;
  onChangeStatusFilter: (value: 'all' | 'running' | 'completed' | 'failed' | 'cancelled') => void;
  onOpenRunDetail: (runId: string) => void;
  onCancelRunFromHistory: (runId: string) => void;
}

const PlanDetailMainContent: React.FC<PlanDetailMainContentProps> = ({
  planDetail,
  latestRunSummary,
  streamHint,
  streamConnected,
  activeTab,
  setActiveTab,
  modeDraft,
  promptDraft,
  promptHint,
  setModeDraft,
  setPromptDraft,
  isPlanEditable,
  taskHint,
  debugTaskId,
  streamTaskIds,
  dirtyTaskCount,
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
  filteredPlanRuns,
  latestRunLoading,
  planRunsLoading,
  planRunsError,
  runTriggerFilter,
  runStatusFilter,
  cancelRunLoading,
  onChangeTriggerFilter,
  onChangeStatusFilter,
  onOpenRunDetail,
  onCancelRunFromHistory,
}) => {
  return (
    <div className="max-w-7xl mx-auto p-4 space-y-4">
      <PlanSummaryCards planDetail={planDetail} latestRunSummary={latestRunSummary} />

      {planDetail.status === 'drafting' && (
        <PlanDraftingBanner streamHint={streamHint} streamConnected={streamConnected} />
      )}

      {planDetail.status === 'production' && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <p className="font-medium">Production 状态已启用</p>
          <p className="mt-1 text-xs text-emerald-700">
            当前计划编辑入口已锁定，点击顶部“解锁编辑”后方可修改任务与 Prompt。
          </p>
        </div>
      )}

      <PlanTabBar activeTab={activeTab} onChange={setActiveTab} />

      {activeTab === 'settings' ? (
        <PlanDetailSettingsTab
          modeDraft={modeDraft}
          promptDraft={promptDraft}
          promptHint={promptHint}
          setModeDraft={setModeDraft}
          setPromptDraft={setPromptDraft}
          tasks={planDetail.tasks || []}
          planStatus={planDetail.status}
          isPlanEditable={isPlanEditable}
          taskHint={taskHint}
          debugTaskId={debugTaskId}
          streamTaskIds={streamTaskIds}
          dirtyCount={dirtyTaskCount}
          isAddLoading={isAddLoading}
          isBatchSaving={isBatchSaving}
          isReordering={isReordering}
          isDuplicating={isDuplicating}
          isRemoving={isRemoving}
          onOpenAddTask={onOpenAddTask}
          onSaveBatch={onSaveBatch}
          onMoveTask={onMoveTask}
          onDuplicateTask={onDuplicateTask}
          onRemoveTask={onRemoveTask}
          onOpenTaskEdit={onOpenTaskEdit}
          onOpenDebug={onOpenDebug}
          onCompleteHuman={onCompleteHuman}
          onRetryTask={onRetryTask}
        />
      ) : (
        <PlanHistoryTab
          latestRunSummary={latestRunSummary}
          latestRunLoading={latestRunLoading}
          filteredPlanRuns={filteredPlanRuns}
          planRunsLoading={planRunsLoading}
          planRunsError={planRunsError}
          runTriggerFilter={runTriggerFilter}
          runStatusFilter={runStatusFilter}
          cancelRunLoading={cancelRunLoading}
          onChangeTriggerFilter={onChangeTriggerFilter}
          onChangeStatusFilter={onChangeStatusFilter}
          onOpenRunDetail={onOpenRunDetail}
          onCancelRun={onCancelRunFromHistory}
        />
      )}
    </div>
  );
};

export default PlanDetailMainContent;
