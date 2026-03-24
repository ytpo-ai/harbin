import { useMutation, useQueryClient } from 'react-query';
import { OrchestrationPlan, PlanMode, orchestrationService } from '../services/orchestrationService';

interface UseReplanMutationOptions {
  planId?: string;
  modeDraft: PlanMode;
  planDetail?: OrchestrationPlan;
  setIsReplanModalOpen: (value: boolean) => void;
  setPromptHint: (value: string) => void;
  setIsReplanPending: (value: boolean) => void;
  setLastAsyncReplanError: (value: string) => void;
  setStreamTaskIds: (value: string[]) => void;
  setStreamHint: (value: string) => void;
  setDebugDrawerOpen: (value: boolean) => void;
  setDebugTaskId: (value: string) => void;
  setDebugHint: (value: string) => void;
}

type ReplanPayload = {
  targetPlanId: string;
  prompt: string;
  plannerAgentId?: string;
  autoGenerate?: boolean;
};

export const useReplanMutation = ({
  planId,
  modeDraft,
  planDetail,
  setIsReplanModalOpen,
  setPromptHint,
  setIsReplanPending,
  setLastAsyncReplanError,
  setStreamTaskIds,
  setStreamHint,
  setDebugDrawerOpen,
  setDebugTaskId,
  setDebugHint,
}: UseReplanMutationOptions) => {
  const queryClient = useQueryClient();

  return useMutation(
    ({ targetPlanId, prompt, plannerAgentId, autoGenerate }: ReplanPayload) =>
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
          if (!prev) return prev;
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
          queryClient.setQueryData(['orchestration-plan', planId], (prev: any) => {
            if (!prev) return prev;
            return {
              ...prev,
              status: 'draft',
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
          await queryClient.invalidateQueries('orchestration-plans');
          return;
        }
        await queryClient.invalidateQueries('orchestration-plans');
      },
      onError: (error) => {
        setIsReplanPending(false);
        const message = error instanceof Error ? error.message : '重新编排失败，请稍后重试';
        setPromptHint(message);
        void queryClient.invalidateQueries(['orchestration-plan', planId]);
      },
    },
  );
};
