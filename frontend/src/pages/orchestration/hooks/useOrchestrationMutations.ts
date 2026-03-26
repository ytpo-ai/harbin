import { useMutation, useQueryClient } from 'react-query';
import { NavigateFunction } from 'react-router-dom';
import {
  DebugRuntimeTaskTypeOverride,
  orchestrationService,
  PlanDomainType,
  PlanMode,
  PlanRunMode,
} from '../../../services/orchestrationService';
import { PLAN_PROMPT_DRAFT_STORAGE_KEY, TaskBatchUpdateItem, TaskPriority } from '../constants';

type Params = {
  navigate: NavigateFunction;
  selectedPlanId: string;
  planModeDraft: PlanMode;
  planDomainType: PlanDomainType;
  planRunMode: PlanRunMode;
  plannerAgentId?: string;
  setPrompt: (value: string) => void;
  setTitle: (value: string) => void;
  setDomainType: (value: PlanDomainType) => void;
  setRunMode: (value: PlanRunMode) => void;
  setSelectedPlanId: (value: string) => void;
  setIsDetailDrawerOpen: (value: boolean) => void;
  setIsCreateModalOpen: (value: boolean) => void;
  setPlanHint: (value: string) => void;
  setDebugDrawerOpen: (value: boolean) => void;
  setDebugTaskId: (value: string) => void;
  setDebugHint: (value: string) => void;
  setDebugSessionId: (value: string) => void;
  setPromptDrafts: (updater: (prev: Record<string, string>) => Record<string, string>) => void;
  setTaskHint: (value: string) => void;
  setIsAddTaskModalOpen: (value: boolean) => void;
  setNewTaskTitle: (value: string) => void;
  setNewTaskDescription: (value: string) => void;
  setNewTaskPriority: (value: TaskPriority) => void;
  setNewTaskInsertAfterTaskId: (value: string) => void;
};

export const useOrchestrationMutations = ({
  navigate,
  selectedPlanId,
  planModeDraft,
  planDomainType,
  planRunMode,
  plannerAgentId,
  setPrompt,
  setTitle,
  setDomainType,
  setRunMode,
  setSelectedPlanId,
  setIsDetailDrawerOpen,
  setIsCreateModalOpen,
  setPlanHint,
  setDebugDrawerOpen,
  setDebugTaskId,
  setDebugHint,
  setDebugSessionId,
  setPromptDrafts,
  setTaskHint,
  setIsAddTaskModalOpen,
  setNewTaskTitle,
  setNewTaskDescription,
  setNewTaskPriority,
  setNewTaskInsertAfterTaskId,
}: Params) => {
  const queryClient = useQueryClient();

  const refreshPlanData = async () => {
    await Promise.all([
      queryClient.invalidateQueries('orchestration-plans'),
      queryClient.invalidateQueries(['orchestration-plan', selectedPlanId]),
      queryClient.invalidateQueries(['orchestration-plan-runs', selectedPlanId]),
      queryClient.invalidateQueries(['orchestration-plan-latest-run', selectedPlanId]),
      queryClient.invalidateQueries(['orchestration-run-detail']),
      queryClient.invalidateQueries(['orchestration-run-tasks']),
    ]);
  };

  const createPlanMutation = useMutation(orchestrationService.createPlanFromPrompt, {
    onSuccess: async (created) => {
      setPrompt('');
      setTitle('');
      setDomainType('general');
      setRunMode('multi');
      await queryClient.invalidateQueries('orchestration-plans');
      if (created?._id) {
        setSelectedPlanId(created._id);
        setIsDetailDrawerOpen(false);
        navigate(`/orchestration/plans/${created._id}`);
      }
      setIsCreateModalOpen(false);
    },
  });

  const runPlanMutation = useMutation(
    ({ planId, continueOnFailure }: { planId: string; continueOnFailure: boolean }) =>
      orchestrationService.runPlan(planId, continueOnFailure),
    {
      onSuccess: async (_, vars) => {
        await Promise.all([
          queryClient.invalidateQueries('orchestration-plans'),
          queryClient.invalidateQueries(['orchestration-plan', vars.planId]),
          queryClient.invalidateQueries(['orchestration-plan-runs', vars.planId]),
          queryClient.invalidateQueries(['orchestration-plan-latest-run', vars.planId]),
        ]);
      },
    },
  );

  const savePlanPromptMutation = useMutation(
    ({ planId, sourcePrompt, mode: nextMode }: { planId: string; sourcePrompt: string; mode: PlanMode }) =>
      orchestrationService.updatePlan(planId, { sourcePrompt, mode: nextMode }),
    {
      onSuccess: async (updated) => {
        setPlanHint('计划设置已保存');
        if (updated?._id) {
          setPromptDrafts((prev) => {
            const next = {
              ...prev,
              [updated._id]: updated.sourcePrompt || '',
            };
            window.localStorage.setItem(PLAN_PROMPT_DRAFT_STORAGE_KEY, JSON.stringify(next));
            return next;
          });
        }
        await Promise.all([
          queryClient.invalidateQueries('orchestration-plans'),
          queryClient.invalidateQueries(['orchestration-plan', selectedPlanId]),
        ]);
      },
      onError: () => {
        setPlanHint('保存计划设置失败，请稍后重试');
      },
    },
  );

  const replanPlanMutation = useMutation(
    ({ planId, prompt }: { planId: string; prompt: string }) =>
      orchestrationService.replanPlan(planId, {
        prompt,
        domainType: planDomainType,
        mode: planModeDraft,
        runMode: planRunMode,
        plannerAgentId,
      }),
    {
      onSuccess: async () => {
        setPlanHint('重新编排请求已提交，正在后台处理');
        setDebugDrawerOpen(false);
        setDebugTaskId('');
        setDebugHint('');
        await Promise.all([
          queryClient.invalidateQueries('orchestration-plans'),
          queryClient.invalidateQueries(['orchestration-plan', selectedPlanId]),
        ]);
      },
      onError: (error) => {
        const message = error instanceof Error ? error.message : '重新编排失败，请稍后重试';
        setPlanHint(message);
      },
    },
  );

  const retryTaskMutation = useMutation((taskId: string) => orchestrationService.retryTask(taskId), {
    onSuccess: refreshPlanData,
  });

  const saveTaskDraftMutation = useMutation(
    ({
      taskId,
      title,
      description,
      runtimeTaskType,
    }: {
      taskId: string;
      title?: string;
      description?: string;
      runtimeTaskType?: DebugRuntimeTaskTypeOverride | 'auto';
    }) =>
      orchestrationService.updateTaskDraft(taskId, {
        title,
        description,
        runtimeTaskType,
      }),
    {
      onSuccess: async () => {
        setDebugHint('草稿已保存，可继续单步调试');
        await Promise.all([
          queryClient.invalidateQueries('orchestration-plans'),
          queryClient.invalidateQueries(['orchestration-plan', selectedPlanId]),
        ]);
      },
    },
  );

  const debugStepMutation = useMutation(
    ({
      taskId,
      title,
      description,
      runtimeTaskTypeOverride,
    }: {
      taskId: string;
      title?: string;
      description?: string;
      runtimeTaskTypeOverride?: DebugRuntimeTaskTypeOverride;
    }) =>
      orchestrationService.debugTaskStep(taskId, {
        title,
        description,
        resetResult: true,
        runtimeTaskTypeOverride,
      }),
    {
      onSuccess: async (result) => {
        if (result.task?.sessionId) {
          setDebugSessionId(result.task.sessionId);
        }
        setDebugHint(result.execution?.error ? `调试失败：${result.execution.error}` : '单步调试已完成，可继续编辑后重试');
        await Promise.all([
          queryClient.invalidateQueries('orchestration-plans'),
          queryClient.invalidateQueries(['orchestration-plan', selectedPlanId]),
          queryClient.invalidateQueries(['orchestration-debug-session', result.task?.sessionId]),
        ]);
      },
    },
  );

  const deletePlanMutation = useMutation((planId: string) => orchestrationService.deletePlan(planId), {
    onSuccess: async (_, deletedPlanId) => {
      await queryClient.invalidateQueries('orchestration-plans');
      const latestPlans = await orchestrationService.getPlans();
      if (!latestPlans.length) {
        setSelectedPlanId('');
        setIsDetailDrawerOpen(false);
        return;
      }
      const next = latestPlans.find((plan) => plan._id !== deletedPlanId) || latestPlans[0];
      setSelectedPlanId(next._id);
      queryClient.invalidateQueries(['orchestration-plan', next._id]);
    },
  });

  const reassignMutation = useMutation(
    ({
      taskId,
      executorType,
      executorId,
    }: {
      taskId: string;
      executorType: 'agent' | 'employee' | 'unassigned';
      executorId?: string;
    }) => orchestrationService.reassignTask(taskId, { executorType, executorId }),
    {
      onSuccess: refreshPlanData,
    },
  );

  const completeHumanTaskMutation = useMutation(
    ({ taskId, summary }: { taskId: string; summary?: string }) => orchestrationService.completeHumanTask(taskId, { summary }),
    {
      onSuccess: refreshPlanData,
    },
  );

  const addTaskMutation = useMutation(
    ({
      planId,
      title,
      description,
      priority,
      insertAfterTaskId,
    }: {
      planId: string;
      title: string;
      description: string;
      priority: TaskPriority;
      insertAfterTaskId?: string;
    }) => orchestrationService.addTaskToPlan(planId, { title, description, priority, insertAfterTaskId }),
    {
      onSuccess: async () => {
        setTaskHint('任务已添加');
        setIsAddTaskModalOpen(false);
        setNewTaskTitle('');
        setNewTaskDescription('');
        setNewTaskPriority('medium');
        setNewTaskInsertAfterTaskId('');
        await refreshPlanData();
      },
    },
  );

  const removeTaskMutation = useMutation((taskId: string) => orchestrationService.deleteTask(taskId), {
    onSuccess: async () => {
      setTaskHint('任务已删除');
      await refreshPlanData();
    },
  });

  const duplicateTaskMutation = useMutation(
    ({ planId, taskId }: { planId: string; taskId: string }) => orchestrationService.duplicateTask(planId, taskId),
    {
      onSuccess: async () => {
        setTaskHint('任务已复制');
        await refreshPlanData();
      },
    },
  );

  const reorderTaskMutation = useMutation(
    ({ planId, taskIds }: { planId: string; taskIds: string[] }) => orchestrationService.reorderTasks(planId, taskIds),
    {
      onSuccess: async () => {
        setTaskHint('任务顺序已更新');
        await refreshPlanData();
      },
    },
  );

  const batchUpdateTasksMutation = useMutation(
    ({ planId, updates }: { planId: string; updates: TaskBatchUpdateItem[] }) =>
      orchestrationService.batchUpdateTasks(planId, updates),
    {
      onSuccess: async () => {
        setTaskHint('任务修改已保存');
        await refreshPlanData();
      },
    },
  );

  return {
    refreshPlanData,
    createPlanMutation,
    runPlanMutation,
    savePlanPromptMutation,
    replanPlanMutation,
    retryTaskMutation,
    saveTaskDraftMutation,
    debugStepMutation,
    deletePlanMutation,
    reassignMutation,
    completeHumanTaskMutation,
    addTaskMutation,
    removeTaskMutation,
    duplicateTaskMutation,
    reorderTaskMutation,
    batchUpdateTasksMutation,
  };
};
