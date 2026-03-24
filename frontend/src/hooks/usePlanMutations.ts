import { useMutation, useQueryClient } from 'react-query';
import {
  OrchestrationPlan,
  PlanMode,
  RunPlanAcceptedResponse,
  orchestrationService,
} from '../services/orchestrationService';

interface UsePlanMutationsOptions {
  planId?: string;
  modeDraft: PlanMode;
  planDetail?: OrchestrationPlan;
  setPromptHint: (value: string) => void;
  setIsReplanModalOpen: (value: boolean) => void;
  setIsReplanPending: (value: boolean) => void;
  setLastAsyncReplanError: (value: string) => void;
  setStreamTaskIds: (value: string[]) => void;
  setStreamHint: (value: string) => void;
  setDebugDrawerOpen: (value: boolean) => void;
  setDebugTaskId: (value: string) => void;
  setDebugHint: (value: string) => void;
}

export const usePlanMutations = ({
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
}: UsePlanMutationsOptions) => {
  const queryClient = useQueryClient();

  const refreshPlanData = async () => {
    await Promise.all([
      queryClient.invalidateQueries('orchestration-plans'),
      queryClient.invalidateQueries(['orchestration-plan', planId]),
      queryClient.invalidateQueries(['orchestration-plan-runs', planId]),
      queryClient.invalidateQueries(['orchestration-plan-latest-run', planId]),
      queryClient.invalidateQueries(['orchestration-run-detail']),
      queryClient.invalidateQueries(['orchestration-run-tasks']),
    ]);
  };

  const savePlanPromptMutation = useMutation(
    ({ targetPlanId, sourcePrompt, mode }: { targetPlanId: string; sourcePrompt: string; mode: PlanMode }) =>
      orchestrationService.updatePlan(targetPlanId, { sourcePrompt, mode }),
    {
      onSuccess: async () => {
        setPromptHint('计划设置已保存');
        await Promise.all([
          queryClient.invalidateQueries('orchestration-plans'),
          queryClient.invalidateQueries(['orchestration-plan', planId]),
        ]);
      },
      onError: () => {
        setPromptHint('保存计划设置失败，请稍后重试');
      },
    },
  );

  const runPlanMutation = useMutation(
    ({ targetPlanId, continueOnFailure }: { targetPlanId: string; continueOnFailure: boolean }) =>
      orchestrationService.runPlan(targetPlanId, continueOnFailure),
    {
      onSuccess: async () => {
        await Promise.all([
          queryClient.invalidateQueries('orchestration-plans'),
          queryClient.invalidateQueries(['orchestration-plan', planId]),
          queryClient.invalidateQueries(['orchestration-plan-runs', planId]),
          queryClient.invalidateQueries(['orchestration-plan-latest-run', planId]),
        ]);
      },
    },
  );

  const cancelRunMutation = useMutation(
    ({ runId, reason }: { runId: string; reason?: string }) => orchestrationService.cancelRun(runId, reason),
    {
      onSuccess: async () => {
        setPromptHint('已取消运行');
        await refreshPlanData();
      },
      onError: (error) => {
        const message = error instanceof Error ? error.message : '取消运行失败，请稍后重试';
        setPromptHint(message);
      },
    },
  );

  const publishPlanMutation = useMutation(
    (targetPlanId: string) => orchestrationService.publishPlan(targetPlanId),
    {
      onSuccess: async () => {
        setPromptHint('计划已发布为 production，编辑入口已锁定');
        await Promise.all([
          queryClient.invalidateQueries('orchestration-plans'),
          queryClient.invalidateQueries(['orchestration-plan', planId]),
        ]);
      },
    },
  );

  const unlockPlanMutation = useMutation(
    (targetPlanId: string) => orchestrationService.unlockPlan(targetPlanId),
    {
      onSuccess: async () => {
        setPromptHint('计划已解锁，可继续编辑');
        await Promise.all([
          queryClient.invalidateQueries('orchestration-plans'),
          queryClient.invalidateQueries(['orchestration-plan', planId]),
        ]);
      },
    },
  );

  const generateNextMutation = useMutation(
    (targetPlanId: string) => orchestrationService.generateNext(targetPlanId),
    {
      onMutate: () => {
        setPromptHint('已触发单步生成，等待任务更新...');
      },
      onSuccess: async () => {
        await Promise.all([
          queryClient.invalidateQueries('orchestration-plans'),
          queryClient.invalidateQueries(['orchestration-plan', planId]),
        ]);
      },
      onError: (error) => {
        const message = error instanceof Error ? error.message : '单步生成失败，请稍后重试';
        setPromptHint(message);
      },
    },
  );

  const replanPlanMutation = useMutation(
    ({
      targetPlanId,
      prompt,
      plannerAgentId,
      autoGenerate,
    }: {
      targetPlanId: string;
      prompt: string;
      plannerAgentId?: string;
      autoGenerate?: boolean;
    }) =>
      orchestrationService.replanPlan(targetPlanId, {
        prompt,
        mode: modeDraft,
        plannerAgentId,
        autoGenerate,
      }),
    {
      onMutate: (variables) => {
        setIsReplanModalOpen(false);
        setPromptHint('正在重新编排：正在清空旧任务...');
        setIsReplanPending(Boolean(variables?.autoGenerate));
        setLastAsyncReplanError(String(planDetail?.metadata?.asyncReplanError || ''));
        setStreamTaskIds([]);
        setStreamHint(
          variables?.autoGenerate
            ? '重新编排已启动，等待新任务流式返回...'
            : '重新编排已完成重置，请手动点击“生成下一步”开始增量任务生成。',
        );
        queryClient.setQueryData(['orchestration-plan', planId], (prev: any) => {
          if (!prev) {
            return prev;
          }
          return {
            ...prev,
            status: 'drafting',
            taskIds: [],
            tasks: [],
            stats: {
              ...(prev.stats || {}),
              totalTasks: 0,
              completedTasks: 0,
              failedTasks: 0,
              waitingHumanTasks: 0,
            },
          };
        });
        void queryClient.invalidateQueries(['orchestration-plan', planId]);
      },
      onSuccess: async (_result, variables) => {
        setPromptHint(
          variables?.autoGenerate
            ? '重新编排任务已提交，正在后台处理中...'
            : '重新编排已完成重置，可手动逐步生成任务。',
        );
        setDebugDrawerOpen(false);
        setDebugTaskId('');
        setDebugHint('');
        if (!variables?.autoGenerate) {
          setIsReplanPending(false);
        }
        await queryClient.invalidateQueries(['orchestration-plan', planId]);
      },
      onError: (error) => {
        setIsReplanPending(false);
        const message = error instanceof Error ? error.message : '重新编排失败，请稍后重试';
        setPromptHint(message);
      },
    },
  );

  const runPlan = (targetPlanId: string, continueOnFailure = true) => {
    runPlanMutation.mutate({ targetPlanId, continueOnFailure });
  };

  const savePlanPrompt = (targetPlanId: string, sourcePrompt: string, mode: PlanMode) => {
    savePlanPromptMutation.mutate({ targetPlanId, sourcePrompt, mode });
  };

  const replanPlan = (targetPlanId: string, prompt: string, plannerAgentId?: string, autoGenerate?: boolean) => {
    replanPlanMutation.mutate({
      targetPlanId,
      prompt,
      plannerAgentId,
      autoGenerate,
    });
  };

  return {
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
  };
};

export type UsePlanMutationsReturn = ReturnType<typeof usePlanMutations>;
export type PlanRunResult = RunPlanAcceptedResponse;
