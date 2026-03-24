import { useMutation, useQueryClient } from 'react-query';
import {
  DebugRuntimeTaskTypeOverride,
  OrchestrationTask,
  orchestrationService,
} from '../services/orchestrationService';

interface UseTaskDebugMutationsOptions {
  planId?: string;
  setDebugHint: (value: string) => void;
  setDebugSessionId: (value: string) => void;
  reassignMutation: {
    mutateAsync: (payload: {
      taskId: string;
      executorType: 'agent' | 'employee' | 'unassigned';
      executorId?: string;
    }) => Promise<unknown>;
    isLoading: boolean;
  };
}

export const useTaskDebugMutations = ({
  planId,
  setDebugHint,
  setDebugSessionId,
  reassignMutation,
}: UseTaskDebugMutationsOptions) => {
  const queryClient = useQueryClient();

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
    }) => orchestrationService.updateTaskDraft(taskId, { title, description, runtimeTaskType }),
    {
      onSuccess: async () => {
        setDebugHint('草稿已保存，可继续单步调试');
        await Promise.all([
          queryClient.invalidateQueries('orchestration-plans'),
          queryClient.invalidateQueries(['orchestration-plan', planId]),
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
          queryClient.invalidateQueries(['orchestration-plan', planId]),
          queryClient.invalidateQueries(['orchestration-debug-session', result.task?.sessionId]),
        ]);
      },
    },
  );

  const runDebugTask = async ({
    debugTask,
    debugAgentId,
    debugTitle,
    debugDescription,
    debugRuntimeTaskType,
  }: {
    debugTask: OrchestrationTask;
    debugAgentId: string;
    debugTitle: string;
    debugDescription: string;
    debugRuntimeTaskType: 'auto' | DebugRuntimeTaskTypeOverride;
  }) => {
    const targetAgentId = debugAgentId.trim();
    if (!targetAgentId) {
      setDebugHint('请先选择 Agent 再执行调试');
      return;
    }
    try {
      if (
        debugTask.assignment?.executorType !== 'agent'
        || debugTask.assignment?.executorId !== targetAgentId
      ) {
        await reassignMutation.mutateAsync({
          taskId: debugTask._id,
          executorType: 'agent',
          executorId: targetAgentId,
        });
      }
      const nextTitle = debugTitle.trim();
      const nextDescription = debugDescription.trim();
      const originalTitle = String(debugTask.title || '').trim();
      const originalDescription = String(debugTask.description || '').trim();
      await debugStepMutation.mutateAsync({
        taskId: debugTask._id,
        title: nextTitle && nextTitle !== originalTitle ? nextTitle : undefined,
        description: nextDescription && nextDescription !== originalDescription ? nextDescription : undefined,
        runtimeTaskTypeOverride: debugRuntimeTaskType === 'auto' ? undefined : debugRuntimeTaskType,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '调试执行失败，请稍后重试';
      setDebugHint(message);
    }
  };

  return {
    saveTaskDraftMutation,
    debugStepMutation,
    runDebugTask,
  };
};
