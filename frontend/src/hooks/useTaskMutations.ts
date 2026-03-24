import { useMutation } from 'react-query';
import { orchestrationService } from '../services/orchestrationService';
import { useTaskDebugMutations } from './useTaskDebugMutations';

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

  const {
    saveTaskDraftMutation,
    debugStepMutation,
    runDebugTask,
  } = useTaskDebugMutations({
    planId,
    setDebugHint,
    setDebugSessionId,
    reassignMutation: {
      mutateAsync: reassignMutation.mutateAsync,
      isLoading: reassignMutation.isLoading,
    },
  });

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
