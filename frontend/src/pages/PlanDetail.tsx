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
import PlanDetailScaffold from '../components/orchestration/PlanDetailScaffold';
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
  const view = usePlanDetailViewState(planId);

  const { data: planDetail, isLoading: planLoading, error: planError } = useQuery<OrchestrationPlan>(
    ['orchestration-plan', planId],
    () => orchestrationService.getPlanById(planId!),
    {
      enabled: Boolean(planId),
      refetchInterval: (data) => {
        if (!planId) return false;
        if (view.isReplanPending) return 2000;
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
  } = usePlanRunHistory(planId, view.activeTab, view.runDrawerOpen, view.selectedRunId);

  const { data: agents = [] } = useQuery('plan-detail-agents', () => agentService.getAssignableAgents());
  const agentNameById = useMemo(
    () => Object.fromEntries(agents.map((agent) => [agent.id, agent.name])),
    [agents],
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
    setTaskHint: view.setTaskHint,
  });

  const latestRunSummary = latestRun ?? planDetail?.lastRun ?? null;

  const { data: debugSessionDetail, isFetching: debugSessionLoading } = useQuery<AgentSession>(
    ['orchestration-debug-session', view.debugSessionId],
    () => orchestrationService.getSessionById(view.debugSessionId),
    {
      enabled: view.debugDrawerOpen && Boolean(view.debugSessionId),
      refetchInterval: view.debugDrawerOpen && view.debugSessionId ? 3000 : false,
    },
  );

  useEffect(() => {
    if (planDetail?._id) {
      view.setPromptDraft(planDetail.sourcePrompt || '');
      view.setModeDraft(planDetail.strategy?.mode || 'hybrid');
    }
  }, [planDetail?._id, planDetail?.sourcePrompt, planDetail?.strategy?.mode]);

  useEffect(() => {
    view.syncDebugDraftFromTask(editingTask || undefined, agents[0]?.id);
  }, [agents, editingTask]);

  useEffect(() => {
    setRunStatusFilter('all');
    setRunTriggerFilter('all');
    view.resetForPlanSwitch(() => {
      setTaskEdits({});
      resetTaskDrawerState();
    });
  }, [planId]);

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
    modeDraft: view.modeDraft,
    planDetail,
    setPromptHint: view.setPromptHint,
    setIsReplanModalOpen: view.setIsReplanModalOpen,
    setIsReplanPending: view.setIsReplanPending,
    setLastAsyncReplanError: view.setLastAsyncReplanError,
    setStreamTaskIds: view.setStreamTaskIds,
    setStreamHint: view.setStreamHint,
    setDebugDrawerOpen: view.setDebugDrawerOpen,
    setDebugTaskId: view.setDebugTaskId,
    setDebugHint: view.setDebugHint,
  });

  usePlanStreaming({
    planId,
    isReplanPending: view.isReplanPending,
    lastAsyncReplanError: view.lastAsyncReplanError,
    planDetail,
    setStreamConnected: view.setStreamConnected,
    setStreamTaskIds: view.setStreamTaskIds,
    setStreamHint: view.setStreamHint,
    setPromptHint: view.setPromptHint,
    setIsReplanPending: view.setIsReplanPending,
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
    setTaskHint: view.setTaskHint,
    setIsAddTaskModalOpen: view.setIsAddTaskModalOpen,
    setNewTaskTitle: view.setNewTaskTitle,
    setNewTaskDescription: view.setNewTaskDescription,
    setNewTaskPriority: view.setNewTaskPriority,
    setNewTaskInsertAfterTaskId: view.setNewTaskInsertAfterTaskId,
    setDebugHint: view.setDebugHint,
    setDebugSessionId: view.setDebugSessionId,
    onRefreshPlanData: refreshPlanData,
    clearTaskEditsAfterBatchSave: () => setTaskEdits({}),
  });

  const {
    handleCopyPlanTasksMarkdown,
    handleMoveTask,
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
    setTaskHint: view.setTaskHint,
    setPromptHint: view.setPromptHint,
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

  const headerProps = {
    planDetail,
    planId,
    promptDraft: view.promptDraft,
    latestRunSummary,
    isPlanEditable,
    isProductionPlan,
    runPlanLoading: runPlanMutation.isLoading,
    replanLoading: replanPlanMutation.isLoading,
    replanPending: view.isReplanPending,
    savePromptLoading: savePlanPromptMutation.isLoading,
    generateLoading: generateNextMutation.isLoading,
    generationCompleted: Boolean(planDetail.generationState?.isComplete),
    cancelRunLoading: cancelRunMutation.isLoading,
    publishLoading: publishPlanMutation.isLoading,
    unlockLoading: unlockPlanMutation.isLoading,
    onBack: () => navigate('/orchestration'),
    onRefresh: () => { void refreshPlanData(); },
    onGenerateNext: () => { if (planId) generateNextMutation.mutate(planId); },
    onSavePrompt: () => {
      if (!planId) return;
      const nextPrompt = view.promptDraft.trim();
      if (!nextPrompt) return view.setPromptHint('Prompt 不能为空');
      savePlanPrompt(planId, nextPrompt, view.modeDraft);
    },
    onOpenReplan: () => {
      const nextPrompt = view.promptDraft.trim();
      if (!nextPrompt) return view.setPromptHint('Prompt 不能为空');
      view.setReplanPlannerAgentId(planDetail?.strategy?.plannerAgentId || '');
      view.setReplanAutoGenerate(true);
      view.setIsReplanModalOpen(true);
    },
    onRunPlan: () => { if (planId) runPlan(planId, true); },
    runPlanDisabled: planDetail?.strategy?.runMode === 'once',
    runPlanDisabledReason: planDetail?.strategy?.runMode === 'once'
      ? 'once 模式仅在生成任务过程中执行，不支持手动运行'
      : undefined,
    onCancelRun: (runId: string) => confirmAndCancelRun(runId, '用户在计划详情页停止运行'),
    onPublish: () => { if (planId) publishPlanMutation.mutate(planId); },
    onUnlock: () => { if (planId) unlockPlanMutation.mutate(planId); },
    onCopyMarkdown: () => { void handleCopyPlanTasksMarkdown(); },
  };

  const mainContentProps = {
    planId,
    planDetail,
    agentNameById,
    latestRunSummary,
    streamHint: view.streamHint,
    streamConnected: view.streamConnected,
    activeTab: view.activeTab,
    setActiveTab: view.setActiveTab,
    modeDraft: view.modeDraft,
    promptDraft: view.promptDraft,
    promptHint: view.promptHint,
    setModeDraft: view.setModeDraft,
    setPromptDraft: view.setPromptDraft,
    isPlanEditable,
    taskHint: view.taskHint,
    debugTaskId: view.debugTaskId,
    streamTaskIds: view.streamTaskIds,
    isAddLoading: addTaskMutation.isLoading,
    isReordering: reorderTaskMutation.isLoading,
    isDuplicating: duplicateTaskMutation.isLoading,
    isRemoving: removeTaskMutation.isLoading,
    onOpenAddTask: () => view.setIsAddTaskModalOpen(true),
    onMoveTask: handleMoveTask,
    onDuplicateTask: (taskId: string) => { if (planId) duplicateTaskMutation.mutate({ targetPlanId: planId, taskId }); },
    onRemoveTask: (taskId: string) => {
      if (!window.confirm('确认删除该任务？依赖此任务的下游任务将自动解除依赖。')) return;
      removeTaskMutation.mutate(taskId);
      removeTaskEdit(taskId);
    },
    onOpenTaskEdit: openTaskEditDrawer,
    onCompleteHuman: (taskId: string) => {
      const summary = window.prompt('请输入人工完成说明', '由人工完成') || undefined;
      completeHumanTaskMutation.mutate({ taskId, summary });
    },
    onRetryTask: (taskId: string) => retryTaskMutation.mutate(taskId),
    filteredPlanRuns,
    latestRunLoading,
    planRunsLoading,
    planRunsError: Boolean(planRunsError),
    runTriggerFilter,
    runStatusFilter,
    cancelRunLoading: cancelRunMutation.isLoading,
    onChangeTriggerFilter: setRunTriggerFilter,
    onChangeStatusFilter: setRunStatusFilter,
    onOpenRunDetail: view.openRunDetailDrawer,
    onCancelRunFromHistory: (runId: string) => confirmAndCancelRun(runId, '用户在执行历史中取消运行'),
  };

  const taskOverlayProps = {
    planId,
    planStatus: planDetail.status,
    planTasks,
    isAddTaskModalOpen: view.isAddTaskModalOpen,
    newTaskTitle: view.newTaskTitle,
    newTaskDescription: view.newTaskDescription,
    newTaskPriority: view.newTaskPriority,
    newTaskInsertAfterTaskId: view.newTaskInsertAfterTaskId,
    addTaskLoading: addTaskMutation.isLoading,
    dependencyModalTask,
    dependencyModalCandidates,
    dependencyModalDraftIds,
    taskEditDrawerOpen,
    editingTask,
    editingTaskDraft: editingTask ? getEffectiveTaskDraft(editingTask) : null,
    debugAgentId: view.debugAgentId,
    debugRuntimeTaskType: view.debugRuntimeTaskType,
    debugHint: view.debugHint,
    agents,
    debugRunning: debugStepMutation.isLoading,
    reassignRunning: reassignMutation.isLoading,
    onCloseAddModal: () => view.setIsAddTaskModalOpen(false),
    onChangeNewTaskTitle: view.setNewTaskTitle,
    onChangeNewTaskDescription: view.setNewTaskDescription,
    onChangeNewTaskPriority: view.setNewTaskPriority,
    onChangeNewTaskInsertAfter: view.setNewTaskInsertAfterTaskId,
    onSubmitAddTask: () => {
      if (!planId) return;
      const title = view.newTaskTitle.trim();
      const description = view.newTaskDescription.trim();
      if (!title || !description) return view.setTaskHint('任务标题和描述不能为空');
      addTaskMutation.mutate({
        targetPlanId: planId,
        title,
        description,
        priority: view.newTaskPriority,
        insertAfterTaskId: view.newTaskInsertAfterTaskId || undefined,
      });
    },
    onCloseDependencyModal: closeDependencyModal,
    onToggleDependency: toggleDependencyDraftId,
    onClearDependency: () => setDependencyModalDraftIds([]),
    onApplyDependency: applyDependencyDraft,
    onCloseTaskEditDrawer: closeTaskEditDrawer,
    onUpdateTaskEditDraft: (patch: any) => {
      if (!editingTask) return;
      view.setTaskHint('');
      updateTaskDraftField(editingTask, patch);
    },
    onOpenDependencyFromTaskEdit: () => {
      if (editingTask) openDependencyModal(editingTask);
    },
    onChangeExecutorType: (executorType: 'agent' | 'unassigned') => {
      if (!editingTask) {
        return;
      }
      if (executorType === 'unassigned') {
        reassignMutation.mutate({ taskId: editingTask._id, executorType: 'unassigned' });
        return;
      }

      const fallbackAgentId =
        (editingTask.assignment?.executorType === 'agent' ? editingTask.assignment.executorId : '')
        || view.debugAgentId
        || agents[0]?.id
        || '';
      if (!fallbackAgentId) {
        view.setDebugHint('请先选择执行 Agent');
        return;
      }

      view.setDebugAgentId(fallbackAgentId);
      reassignMutation.mutate({
        taskId: editingTask._id,
        executorType: 'agent',
        executorId: fallbackAgentId,
      });
    },
    onChangeExecutorAgentId: (agentId: string) => {
      if (!editingTask) {
        return;
      }
      const nextAgentId = agentId.trim();
      if (!nextAgentId) {
        return;
      }
      view.setDebugAgentId(nextAgentId);
      reassignMutation.mutate({
        taskId: editingTask._id,
        executorType: 'agent',
        executorId: nextAgentId,
      });
    },
    onChangeDebugAgentId: view.setDebugAgentId,
    onChangeDebugRuntimeType: view.setDebugRuntimeTaskType,
    onRunDebugFromTaskEdit: () => {
      void handleDebugRun(
        editingTask || undefined,
        view.debugAgentId,
        editingTask ? getEffectiveTaskDraft(editingTask).title : '',
        editingTask ? getEffectiveTaskDraft(editingTask).description : '',
        view.debugRuntimeTaskType,
      );
    },
  };

  const runtimeOverlayProps = {
    planId,
    runDrawerOpen: view.runDrawerOpen,
    selectedRunId: view.selectedRunId,
    runDetail,
    runDetailLoading,
    runDetailError: Boolean(runDetailError),
    runTasks,
    runTasksLoading,
    runTasksError: Boolean(runTasksError),
    cancelRunLoading: cancelRunMutation.isLoading,
    onCloseRunDrawer: () => view.setRunDrawerOpen(false),
    onCancelRunInRunDetail: (runId: string) => confirmAndCancelRun(runId, '用户在 run 详情中取消运行'),
    debugDrawerOpen: view.debugDrawerOpen,
    debugTask: editingTask || null,
    activeDrawerTab: view.activeDrawerTab,
    debugAgentId: view.debugAgentId,
    debugTitle: view.debugTitle,
    debugDescription: view.debugDescription,
    debugRuntimeTaskType: view.debugRuntimeTaskType,
    debugHint: view.debugHint,
    debugSessionId: view.debugSessionId,
    debugSessionDetail,
    debugSessionLoading,
    agents,
    debugSaving: saveTaskDraftMutation.isLoading,
    debugRunning: debugStepMutation.isLoading,
    reassignRunning: reassignMutation.isLoading,
    debugEditable: isPlanEditable,
    onCloseDebugDrawer: () => view.setDebugDrawerOpen(false),
    onTabChange: view.setActiveDrawerTab,
    onChangeAgentId: view.setDebugAgentId,
    onChangeTitle: view.setDebugTitle,
    onChangeDescription: view.setDebugDescription,
    onChangeRuntimeType: view.setDebugRuntimeTaskType,
    onSaveDraft: () => {
      if (!editingTask) return;
      const nextTitle = view.debugTitle.trim();
      const nextDescription = view.debugDescription.trim();
      const originalTitle = String(editingTask.title || '').trim();
      const originalDescription = String(editingTask.description || '').trim();
      saveTaskDraftMutation.mutate({
        taskId: editingTask._id,
        title: nextTitle && nextTitle !== originalTitle ? nextTitle : undefined,
        description: nextDescription && nextDescription !== originalDescription ? nextDescription : undefined,
        runtimeTaskType: view.debugRuntimeTaskType !== (editingTask.runtimeTaskType || 'auto') ? view.debugRuntimeTaskType : undefined,
      });
    },
    onRunDebug: () => {
      void handleDebugRun(editingTask || undefined, view.debugAgentId, view.debugTitle, view.debugDescription, view.debugRuntimeTaskType);
    },
    isReplanModalOpen: view.isReplanModalOpen,
    replanPlannerAgentId: view.replanPlannerAgentId,
    replanAutoGenerate: view.replanAutoGenerate,
    replanLoading: replanPlanMutation.isLoading,
    replanPending: view.isReplanPending,
    onCloseReplanModal: () => {
      if (!replanPlanMutation.isLoading) view.setIsReplanModalOpen(false);
    },
    onChangeReplanPlannerAgentId: view.setReplanPlannerAgentId,
    onChangeReplanAutoGenerate: view.setReplanAutoGenerate,
    onSubmitReplan: () => {
      if (!planId) return;
      const nextPrompt = view.promptDraft.trim() || planDetail?.sourcePrompt?.trim() || '';
      if (!nextPrompt) return view.setPromptHint('Prompt 不能为空');
      replanPlan(planId, nextPrompt, view.replanPlannerAgentId || undefined, view.replanAutoGenerate);
    },
  };

  return <PlanDetailScaffold headerProps={headerProps} mainContentProps={mainContentProps} taskOverlayProps={taskOverlayProps} runtimeOverlayProps={runtimeOverlayProps} />;
};

export default PlanDetail;
