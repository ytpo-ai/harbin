import { useCallback } from 'react';
import { useMutation, useQueryClient } from 'react-query';
import {
  OrchestrationPlan,
  PlanMode,
  RunPlanAcceptedResponse,
  orchestrationService,
} from '../services/orchestrationService';
import { useReplanMutation } from './useReplanMutation';

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

  const refreshPlanData = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries('orchestration-plans'),
      queryClient.invalidateQueries(['orchestration-plan', planId]),
      queryClient.invalidateQueries(['orchestration-plan-runs', planId]),
      queryClient.invalidateQueries(['orchestration-plan-latest-run', planId]),
      queryClient.invalidateQueries(['orchestration-run-detail']),
      queryClient.invalidateQueries(['orchestration-run-tasks']),
    ]);
  }, [planId, queryClient]);

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

  const stopGenerationMutation = useMutation(
    ({ targetPlanId, reason }: { targetPlanId: string; reason?: string }) =>
      orchestrationService.stopPlanGeneration(targetPlanId, reason),
    {
      onMutate: () => {
        setStreamHint('正在停止任务生成...');
      },
      onSuccess: async (result) => {
        if (result?.stopped) {
          setPromptHint('已手动停止任务生成');
          setStreamHint('已手动停止任务生成');
        } else {
          setPromptHint('当前没有可停止的生成流程');
          setStreamHint('当前没有可停止的生成流程');
        }
        await refreshPlanData();
      },
      onError: (error) => {
        const message = error instanceof Error ? error.message : '停止生成失败，请稍后重试';
        setPromptHint(message);
        setStreamHint(message);
      },
    },
  );

  const deletePlanMutation = useMutation(
    (targetPlanId: string) => orchestrationService.deletePlan(targetPlanId),
    {
      onSuccess: async () => {
        await queryClient.invalidateQueries('orchestration-plans');
      },
    },
  );

  const replanPlanMutation = useReplanMutation({
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
    stopGenerationMutation,
    deletePlanMutation,
    replanPlanMutation,
    runPlan,
    savePlanPrompt,
    replanPlan,
  };
};

export type UsePlanMutationsReturn = ReturnType<typeof usePlanMutations>;
export type PlanRunResult = RunPlanAcceptedResponse;
