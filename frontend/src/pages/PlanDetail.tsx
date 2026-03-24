import React, { useEffect, useMemo } from 'react';
import { useQuery } from 'react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import { agentService } from '../services/agentService';
import {
  AgentSession,
  orchestrationService,
  OrchestrationPlan,
} from '../services/orchestrationService';
import PlanHeader from '../components/orchestration/PlanHeader';
import PlanDetailMainContent from '../components/orchestration/PlanDetailMainContent';
import PlanDetailTaskOverlays from '../components/orchestration/PlanDetailTaskOverlays';
import PlanDetailRuntimeOverlays from '../components/orchestration/PlanDetailRuntimeOverlays';
import {
  STREAMING_PLAN_STATUS,
  FULLY_EDITABLE_PLAN_STATUS,
} from '../components/orchestration/constants';
import { useTaskEditing } from '../hooks/useTaskEditing';
import { usePlanRunHistory } from '../hooks/usePlanRunHistory';
import { usePlanMutations } from '../hooks/usePlanMutations';
import { useTaskMutations } from '../hooks/useTaskMutations';
import { useTaskDrawerState } from '../hooks/useTaskDrawerState';
import { usePlanStreaming } from '../hooks/usePlanStreaming';
import { usePlanDetailViewState } from '../hooks/usePlanDetailViewState';
import { usePlanDetailActions } from '../hooks/usePlanDetailActions';

const PlanDetail: React.FC = () => {
  const { id: planId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const {
    promptDraft,
    setPromptDraft,
    modeDraft,
    setModeDraft,
    promptHint,
    setPromptHint,
    isReplanModalOpen,
    setIsReplanModalOpen,
    replanPlannerAgentId,
    setReplanPlannerAgentId,
    replanAutoGenerate,
    setReplanAutoGenerate,
    isReplanPending,
    setIsReplanPending,
    lastAsyncReplanError,
    setLastAsyncReplanError,
    debugDrawerOpen,
    setDebugDrawerOpen,
    debugTaskId,
    setDebugTaskId,
    debugTitle,
    setDebugTitle,
    debugDescription,
    setDebugDescription,
    debugRuntimeTaskType,
    setDebugRuntimeTaskType,
    debugHint,
    setDebugHint,
    debugSessionId,
    setDebugSessionId,
    debugAgentId,
    setDebugAgentId,
    activeDrawerTab,
    setActiveDrawerTab,
    activeTab,
    setActiveTab,
    runDrawerOpen,
    setRunDrawerOpen,
    selectedRunId,
    streamHint,
    setStreamHint,
    streamConnected,
    setStreamConnected,
    streamTaskIds,
    setStreamTaskIds,
    taskHint,
    setTaskHint,
    isAddTaskModalOpen,
    setIsAddTaskModalOpen,
    newTaskTitle,
    setNewTaskTitle,
    newTaskDescription,
    setNewTaskDescription,
    newTaskPriority,
    setNewTaskPriority,
    newTaskInsertAfterTaskId,
    setNewTaskInsertAfterTaskId,
    openDebugDrawer,
    openRunDetailDrawer,
    syncDebugDraftFromTask,
    resetForPlanSwitch,
  } = usePlanDetailViewState(planId);

  const { data: planDetail, isLoading: planLoading, error: planError } = useQuery<OrchestrationPlan>(
    ['orchestration-plan', planId],
    () => orchestrationService.getPlanById(planId!),
    {
      enabled: Boolean(planId),
      refetchInterval: (data) => {
        if (!planId) return false;
        if (isReplanPending) return 2000;
        const status = (data as any)?.status as string | undefined;
        if (!status) return false;
        if (STREAMING_PLAN_STATUS.has(status)) return 2500;
        if (status === 'planned' || status === 'draft' || status === 'production') return false;
        return false;
      },
    },
  );

  const {
    runStatusFilter,
    setRunStatusFilter,
    runTriggerFilter,
    setRunTriggerFilter,
    planRunsLoading,
    planRunsError,
    latestRun,
    latestRunLoading,
    runDetail,
    runDetailLoading,
    runDetailError,
    runTasks,
    runTasksLoading,
    runTasksError,
    filteredPlanRuns,
  } = usePlanRunHistory(planId, activeTab, runDrawerOpen, selectedRunId);

  const { data: agents = [] } = useQuery('plan-detail-agents', () => agentService.getAssignableAgents());
  const debugTask = useMemo(
    () => planDetail?.tasks?.find((task) => task._id === debugTaskId),
    [planDetail?.tasks, debugTaskId],
  );
  const planTasks = planDetail?.tasks ?? [];
  const isPlanEditable = useMemo(
    () => Boolean(planDetail?.status && FULLY_EDITABLE_PLAN_STATUS.has(planDetail.status)),
    [planDetail?.status],
  );
  const isProductionPlan = planDetail?.status === 'production';
  const {
    setTaskEdits,
    dirtyTaskUpdates,
    getEffectiveTaskDraft,
    updateTaskDraftField,
    removeTaskEdit,
    pruneTaskEdits,
  } = useTaskEditing(planTasks);

  const {
    dependencyModalDraftIds,
    taskEditDrawerOpen,
    dependencyModalTask,
    dependencyModalCandidates,
    editingTask,
    setDependencyModalDraftIds,
    openDependencyModal,
    closeDependencyModal,
    toggleDependencyDraftId,
    applyDependencyDraft,
    openTaskEditDrawer,
    closeTaskEditDrawer,
    resetTaskDrawerState,
  } = useTaskDrawerState({
    planTasks,
    getEffectiveTaskDraft,
    updateTaskDraftField,
    setTaskHint,
  });

  const latestRunSummary = latestRun ?? planDetail?.lastRun ?? null;

  const { data: debugSessionDetail, isFetching: debugSessionLoading } = useQuery<AgentSession>(
    ['orchestration-debug-session', debugSessionId],
    () => orchestrationService.getSessionById(debugSessionId),
    {
      enabled: debugDrawerOpen && Boolean(debugSessionId),
      refetchInterval: debugDrawerOpen && debugSessionId ? 3000 : false,
    },
  );

  useEffect(() => {
    if (planDetail?._id) {
      setPromptDraft(planDetail.sourcePrompt || '');
      setModeDraft(planDetail.strategy?.mode || 'hybrid');
    }
  }, [planDetail?._id, planDetail?.sourcePrompt, planDetail?.strategy?.mode]);

  useEffect(() => {
    syncDebugDraftFromTask(debugTask, agents[0]?.id);
  }, [agents, debugTask, syncDebugDraftFromTask]);

  useEffect(() => {
    setRunStatusFilter('all');
    setRunTriggerFilter('all');
    resetForPlanSwitch(() => {
      setTaskEdits({});
      resetTaskDrawerState();
    });
  }, [planId, resetForPlanSwitch, resetTaskDrawerState, setRunStatusFilter, setRunTriggerFilter, setTaskEdits]);

  useEffect(() => {
    pruneTaskEdits(planTasks);
  }, [planTasks, pruneTaskEdits]);

  const {
    refreshPlanData,
    savePlanPromptMutation,
    runPlanMutation,
    cancelRunMutation,
    publishPlanMutation,
    unlockPlanMutation,
    generateNextMutation,
    replanPlanMutation,
    runPlan,
    savePlanPrompt,
    replanPlan,
  } = usePlanMutations({
    planId,
    modeDraft,
    planDetail,
    setPromptHint,
    setIsReplanModalOpen,
    setIsReplanPending,
    setLastAsyncReplanError,
    setStreamTaskIds,
    setStreamHint,
    setDebugDrawerOpen,
    setDebugTaskId,
    setDebugHint,
  });

  usePlanStreaming({
    planId,
    isReplanPending,
    lastAsyncReplanError,
    planDetail,
    setStreamConnected,
    setStreamTaskIds,
    setStreamHint,
    setPromptHint,
    setIsReplanPending,
    refreshPlanData,
  });

  const {
    retryTaskMutation,
    reassignMutation,
    completeHumanTaskMutation,
    addTaskMutation,
    removeTaskMutation,
    duplicateTaskMutation,
    reorderTaskMutation,
    batchUpdateTasksMutation,
    saveTaskDraftMutation,
    debugStepMutation,
    runDebugTask,
  } = useTaskMutations({
    planId,
    setTaskHint,
    setIsAddTaskModalOpen,
    setNewTaskTitle,
    setNewTaskDescription,
    setNewTaskPriority,
    setNewTaskInsertAfterTaskId,
    setDebugHint,
    setDebugSessionId,
    onRefreshPlanData: refreshPlanData,
    clearTaskEditsAfterBatchSave: () => setTaskEdits({}),
  });

  const {
    handleCopyPlanTasksMarkdown,
    handleMoveTask,
    handleSaveTaskEdits,
    confirmAndCancelRun,
    handleDebugRun,
  } = usePlanDetailActions({
    planId,
    planDetail,
    planTasks,
    reorderInProgress: reorderTaskMutation.isLoading,
    dirtyTaskUpdates,
    onReorderTasks: (taskIds) => {
      if (!planId) {
        return;
      }
      reorderTaskMutation.mutate({ targetPlanId: planId, taskIds });
    },
    onBatchSave: (updates) => {
      if (!planId) {
        return;
      }
      batchUpdateTasksMutation.mutate({ targetPlanId: planId, updates });
    },
    onCancelRun: (runId, reason) => cancelRunMutation.mutate({ runId, reason }),
    setTaskHint,
    setPromptHint,
    runDebugTask,
  });

  if (planLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-slate-500">加载中...</p>
      </div>
    );
  }

  if (planError || !planDetail) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <p className="text-rose-600">获取计划详情失败</p>
        <button
          onClick={() => navigate('/orchestration')}
          className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
        >
          <ArrowLeftIcon className="h-4 w-4" /> 返回计划列表
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <PlanHeader
        planDetail={planDetail}
        planId={planId}
        promptDraft={promptDraft}
        latestRunSummary={latestRunSummary}
        isPlanEditable={isPlanEditable}
        isProductionPlan={isProductionPlan}
        runPlanLoading={runPlanMutation.isLoading}
        replanLoading={replanPlanMutation.isLoading}
        replanPending={isReplanPending}
        savePromptLoading={savePlanPromptMutation.isLoading}
        generateLoading={generateNextMutation.isLoading}
        generationCompleted={Boolean(planDetail.generationState?.isComplete)}
        cancelRunLoading={cancelRunMutation.isLoading}
        publishLoading={publishPlanMutation.isLoading}
        unlockLoading={unlockPlanMutation.isLoading}
        onBack={() => navigate('/orchestration')}
        onRefresh={() => { void refreshPlanData(); }}
        onGenerateNext={() => {
          if (planId) {
            generateNextMutation.mutate(planId);
          }
        }}
        onSavePrompt={() => {
          if (!planId) return;
          const nextPrompt = promptDraft.trim();
          if (!nextPrompt) {
            setPromptHint('Prompt 不能为空');
            return;
          }
          savePlanPrompt(planId, nextPrompt, modeDraft);
        }}
        onOpenReplan={() => {
          const nextPrompt = promptDraft.trim();
          if (!nextPrompt) {
            setPromptHint('Prompt 不能为空');
            return;
          }
          setReplanPlannerAgentId(planDetail?.strategy?.plannerAgentId || '');
          setReplanAutoGenerate(true);
          setIsReplanModalOpen(true);
        }}
        onRunPlan={() => {
          if (planId) {
            runPlan(planId, true);
          }
        }}
        onCancelRun={(runId) => confirmAndCancelRun(runId, '用户在计划详情页停止运行')}
        onPublish={() => {
          if (planId) {
            publishPlanMutation.mutate(planId);
          }
        }}
        onUnlock={() => {
          if (planId) {
            unlockPlanMutation.mutate(planId);
          }
        }}
        onCopyMarkdown={() => { void handleCopyPlanTasksMarkdown(); }}
      />

      <PlanDetailMainContent
        planId={planId}
        planDetail={planDetail}
        latestRunSummary={latestRunSummary}
        streamHint={streamHint}
        streamConnected={streamConnected}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        modeDraft={modeDraft}
        promptDraft={promptDraft}
        promptHint={promptHint}
        setModeDraft={setModeDraft}
        setPromptDraft={setPromptDraft}
        isPlanEditable={isPlanEditable}
        taskHint={taskHint}
        debugTaskId={debugTaskId}
        streamTaskIds={streamTaskIds}
        dirtyTaskCount={dirtyTaskUpdates.length}
        isAddLoading={addTaskMutation.isLoading}
        isBatchSaving={batchUpdateTasksMutation.isLoading}
        isReordering={reorderTaskMutation.isLoading}
        isDuplicating={duplicateTaskMutation.isLoading}
        isRemoving={removeTaskMutation.isLoading}
        onOpenAddTask={() => setIsAddTaskModalOpen(true)}
        onSaveBatch={handleSaveTaskEdits}
        onMoveTask={handleMoveTask}
        onDuplicateTask={(taskId) => {
          if (planId) {
            duplicateTaskMutation.mutate({ targetPlanId: planId, taskId });
          }
        }}
        onRemoveTask={(taskId) => {
          const ok = window.confirm('确认删除该任务？依赖此任务的下游任务将自动解除依赖。');
          if (!ok) {
            return;
          }
          removeTaskMutation.mutate(taskId);
          removeTaskEdit(taskId);
        }}
        onOpenTaskEdit={openTaskEditDrawer}
        onOpenDebug={(taskId) => openDebugDrawer(taskId, 'debug')}
        onCompleteHuman={(taskId) => {
          const summary = window.prompt('请输入人工完成说明', '由人工完成') || undefined;
          completeHumanTaskMutation.mutate({ taskId, summary });
        }}
        onRetryTask={(taskId) => retryTaskMutation.mutate(taskId)}
        filteredPlanRuns={filteredPlanRuns}
        latestRunLoading={latestRunLoading}
        planRunsLoading={planRunsLoading}
        planRunsError={Boolean(planRunsError)}
        runTriggerFilter={runTriggerFilter}
        runStatusFilter={runStatusFilter}
        cancelRunLoading={cancelRunMutation.isLoading}
        onChangeTriggerFilter={setRunTriggerFilter}
        onChangeStatusFilter={setRunStatusFilter}
        onOpenRunDetail={openRunDetailDrawer}
        onCancelRunFromHistory={(runId) => confirmAndCancelRun(runId, '用户在执行历史中取消运行')}
      />

      <PlanDetailTaskOverlays
        planId={planId}
        planStatus={planDetail.status}
        planTasks={planTasks}
        isAddTaskModalOpen={isAddTaskModalOpen}
        newTaskTitle={newTaskTitle}
        newTaskDescription={newTaskDescription}
        newTaskPriority={newTaskPriority}
        newTaskInsertAfterTaskId={newTaskInsertAfterTaskId}
        addTaskLoading={addTaskMutation.isLoading}
        dependencyModalTask={dependencyModalTask}
        dependencyModalCandidates={dependencyModalCandidates}
        dependencyModalDraftIds={dependencyModalDraftIds}
        taskEditDrawerOpen={taskEditDrawerOpen}
        editingTask={editingTask}
        editingTaskDraft={editingTask ? getEffectiveTaskDraft(editingTask) : null}
        onCloseAddModal={() => setIsAddTaskModalOpen(false)}
        onChangeNewTaskTitle={setNewTaskTitle}
        onChangeNewTaskDescription={setNewTaskDescription}
        onChangeNewTaskPriority={setNewTaskPriority}
        onChangeNewTaskInsertAfter={setNewTaskInsertAfterTaskId}
        onSubmitAddTask={() => {
          if (!planId) {
            return;
          }
          const title = newTaskTitle.trim();
          const description = newTaskDescription.trim();
          if (!title || !description) {
            setTaskHint('任务标题和描述不能为空');
            return;
          }
          addTaskMutation.mutate({
            targetPlanId: planId,
            title,
            description,
            priority: newTaskPriority,
            insertAfterTaskId: newTaskInsertAfterTaskId || undefined,
          });
        }}
        onCloseDependencyModal={closeDependencyModal}
        onToggleDependency={toggleDependencyDraftId}
        onClearDependency={() => setDependencyModalDraftIds([])}
        onApplyDependency={applyDependencyDraft}
        onCloseTaskEditDrawer={closeTaskEditDrawer}
        onUpdateTaskEditDraft={(patch) => {
          if (!editingTask) {
            return;
          }
          setTaskHint('');
          updateTaskDraftField(editingTask, patch);
        }}
        onOpenDependencyFromTaskEdit={() => {
          if (!editingTask) {
            return;
          }
          openDependencyModal(editingTask);
        }}
      />

      <PlanDetailRuntimeOverlays
        planId={planId}
        runDrawerOpen={runDrawerOpen}
        selectedRunId={selectedRunId}
        runDetail={runDetail}
        runDetailLoading={runDetailLoading}
        runDetailError={Boolean(runDetailError)}
        runTasks={runTasks}
        runTasksLoading={runTasksLoading}
        runTasksError={Boolean(runTasksError)}
        cancelRunLoading={cancelRunMutation.isLoading}
        onCloseRunDrawer={() => setRunDrawerOpen(false)}
        onCancelRunInRunDetail={(runId) => confirmAndCancelRun(runId, '用户在 run 详情中取消运行')}
        debugDrawerOpen={debugDrawerOpen}
        debugTask={debugTask || null}
        activeDrawerTab={activeDrawerTab}
        debugAgentId={debugAgentId}
        debugTitle={debugTitle}
        debugDescription={debugDescription}
        debugRuntimeTaskType={debugRuntimeTaskType}
        debugHint={debugHint}
        debugSessionId={debugSessionId}
        debugSessionDetail={debugSessionDetail}
        debugSessionLoading={debugSessionLoading}
        agents={agents}
        debugSaving={saveTaskDraftMutation.isLoading}
        debugRunning={debugStepMutation.isLoading}
        reassignRunning={reassignMutation.isLoading}
        onCloseDebugDrawer={() => setDebugDrawerOpen(false)}
        onTabChange={setActiveDrawerTab}
        onChangeAgentId={setDebugAgentId}
        onChangeTitle={setDebugTitle}
        onChangeDescription={setDebugDescription}
        onChangeRuntimeType={setDebugRuntimeTaskType}
        onSaveDraft={() => {
          if (!debugTask) {
            return;
          }
          const nextTitle = debugTitle.trim();
          const nextDescription = debugDescription.trim();
          const originalTitle = String(debugTask.title || '').trim();
          const originalDescription = String(debugTask.description || '').trim();
          saveTaskDraftMutation.mutate({
            taskId: debugTask._id,
            title: nextTitle && nextTitle !== originalTitle ? nextTitle : undefined,
            description: nextDescription && nextDescription !== originalDescription ? nextDescription : undefined,
            runtimeTaskType:
              debugRuntimeTaskType !== (debugTask.runtimeTaskType || 'auto')
                ? debugRuntimeTaskType
                : undefined,
          });
        }}
        onRunDebug={() => {
          void handleDebugRun(
            debugTask,
            debugAgentId,
            debugTitle,
            debugDescription,
            debugRuntimeTaskType,
          );
        }}
        isReplanModalOpen={isReplanModalOpen}
        replanPlannerAgentId={replanPlannerAgentId}
        replanAutoGenerate={replanAutoGenerate}
        replanLoading={replanPlanMutation.isLoading}
        replanPending={isReplanPending}
        onCloseReplanModal={() => {
          if (replanPlanMutation.isLoading) return;
          setIsReplanModalOpen(false);
        }}
        onChangeReplanPlannerAgentId={setReplanPlannerAgentId}
        onChangeReplanAutoGenerate={setReplanAutoGenerate}
        onSubmitReplan={() => {
          if (!planId) return;
          const nextPrompt = promptDraft.trim() || planDetail?.sourcePrompt?.trim() || '';
          if (!nextPrompt) {
            setPromptHint('Prompt 不能为空');
            return;
          }
          replanPlan(
            planId,
            nextPrompt,
            replanPlannerAgentId || undefined,
            replanAutoGenerate,
          );
        }}
      />
    </div>
  );
};

export default PlanDetail;
