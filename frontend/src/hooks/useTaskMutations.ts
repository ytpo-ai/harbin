import { useMutation, useQueryClient } from 'react-query';
import {
  DebugRuntimeTaskTypeOverride,
  OrchestrationTask,
  orchestrationService,
} from '../services/orchestrationService';

interface UseTaskMutationsOptions {
  planId?: string;
  setTaskHint: (value: string) => void;
  setIsAddTaskModalOpen: (value: boolean) => void;
  setNewTaskTitle: (value: string) => void;
  setNewTaskDescription: (value: string) => void;
  setNewTaskPriority: (value: 'low' | 'medium' | 'high' | 'urgent') => void;
  setNewTaskInsertAfterTaskId: (value: string) => void;
  setDebugHint: (value: string) => void;
  setDebugSessionId: (value: string) => void;
  onRefreshPlanData: () => Promise<void>;
  clearTaskEditsAfterBatchSave: () => void;
}

export const useTaskMutations = ({
  planId,
  setTaskHint,
  setIsAddTaskModalOpen,
  setNewTaskTitle,
  setNewTaskDescription,
  setNewTaskPriority,
  setNewTaskInsertAfterTaskId,
  setDebugHint,
  setDebugSessionId,
  onRefreshPlanData,
  clearTaskEditsAfterBatchSave,
}: UseTaskMutationsOptions) => {
  const queryClient = useQueryClient();

  const retryTaskMutation = useMutation((taskId: string) => orchestrationService.retryTask(taskId), {
    onSuccess: onRefreshPlanData,
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
      onSuccess: onRefreshPlanData,
    },
  );

  const completeHumanTaskMutation = useMutation(
    ({ taskId, summary }: { taskId: string; summary?: string }) =>
      orchestrationService.completeHumanTask(taskId, { summary }),
    {
      onSuccess: onRefreshPlanData,
    },
  );

  const addTaskMutation = useMutation(
    ({
      targetPlanId,
      title,
      description,
      priority,
      insertAfterTaskId,
    }: {
      targetPlanId: string;
      title: string;
      description: string;
      priority: 'low' | 'medium' | 'high' | 'urgent';
      insertAfterTaskId?: string;
    }) =>
      orchestrationService.addTaskToPlan(targetPlanId, {
        title,
        description,
        priority,
        insertAfterTaskId,
      }),
    {
      onSuccess: async () => {
        setTaskHint('任务已添加');
        setIsAddTaskModalOpen(false);
        setNewTaskTitle('');
        setNewTaskDescription('');
        setNewTaskPriority('medium');
        setNewTaskInsertAfterTaskId('');
        await onRefreshPlanData();
      },
    },
  );

  const removeTaskMutation = useMutation((taskId: string) => orchestrationService.deleteTask(taskId), {
    onSuccess: async () => {
      setTaskHint('任务已删除');
      await onRefreshPlanData();
    },
  });

  const duplicateTaskMutation = useMutation(
    ({ targetPlanId, taskId }: { targetPlanId: string; taskId: string }) =>
      orchestrationService.duplicateTask(targetPlanId, taskId),
    {
      onSuccess: async () => {
        setTaskHint('任务已复制');
        await onRefreshPlanData();
      },
    },
  );

  const reorderTaskMutation = useMutation(
    ({ targetPlanId, taskIds }: { targetPlanId: string; taskIds: string[] }) =>
      orchestrationService.reorderTasks(targetPlanId, taskIds),
    {
      onSuccess: async () => {
        setTaskHint('任务顺序已更新');
        await onRefreshPlanData();
      },
    },
  );

  const batchUpdateTasksMutation = useMutation(
    ({
      targetPlanId,
      updates,
    }: {
      targetPlanId: string;
      updates: Array<{
        taskId: string;
        title: string;
        description: string;
        priority: 'low' | 'medium' | 'high' | 'urgent';
        dependencyTaskIds: string[];
      }>;
    }) => orchestrationService.batchUpdateTasks(targetPlanId, updates),
    {
      onSuccess: async () => {
        setTaskHint('任务修改已保存');
        clearTaskEditsAfterBatchSave();
        await onRefreshPlanData();
      },
    },
  );

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
  };
};
