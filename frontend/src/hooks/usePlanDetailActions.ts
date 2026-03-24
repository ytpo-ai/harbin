import { useCallback } from 'react';
import { DebugRuntimeTaskTypeOverride, OrchestrationPlan, OrchestrationTask } from '../services/orchestrationService';
import { buildPlanTasksMarkdown } from '../components/orchestration/constants';

interface UsePlanDetailActionsOptions {
  planId?: string;
  planDetail?: OrchestrationPlan;
  planTasks: OrchestrationTask[];
  reorderInProgress: boolean;
  dirtyTaskUpdates: Array<{
    taskId: string;
    title: string;
    description: string;
    priority: 'low' | 'medium' | 'high' | 'urgent';
    dependencyTaskIds: string[];
  }>;
  onReorderTasks: (taskIds: string[]) => void;
  onBatchSave: (updates: Array<{
    taskId: string;
    title: string;
    description: string;
    priority: 'low' | 'medium' | 'high' | 'urgent';
    dependencyTaskIds: string[];
  }>) => void;
  onCancelRun: (runId: string, reason?: string) => void;
  setTaskHint: (value: string) => void;
  setPromptHint: (value: string) => void;
  runDebugTask: (payload: {
    debugTask: OrchestrationTask;
    debugAgentId: string;
    debugTitle: string;
    debugDescription: string;
    debugRuntimeTaskType: 'auto' | DebugRuntimeTaskTypeOverride;
  }) => Promise<void>;
}

export const usePlanDetailActions = ({
  planId,
  planDetail,
  planTasks,
  reorderInProgress,
  dirtyTaskUpdates,
  onReorderTasks,
  onBatchSave,
  onCancelRun,
  setTaskHint,
  setPromptHint,
  runDebugTask,
}: UsePlanDetailActionsOptions) => {
  const handleCopyPlanTasksMarkdown = useCallback(async () => {
    if (!planDetail) return;
    const markdown = buildPlanTasksMarkdown(planDetail);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(markdown);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = markdown;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setPromptHint('已复制到剪贴板');
    } catch {
      setPromptHint('复制失败，请稍后重试');
    }
  }, [planDetail, setPromptHint]);

  const handleMoveTask = useCallback((taskId: string, direction: 'up' | 'down') => {
    if (!planId || !planTasks.length || reorderInProgress) {
      return;
    }
    const currentTaskIds = planTasks.map((task) => task._id);
    const index = currentTaskIds.indexOf(taskId);
    if (index < 0) {
      return;
    }
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= currentTaskIds.length) {
      return;
    }

    const nextTaskIds = [...currentTaskIds];
    const [movedTaskId] = nextTaskIds.splice(index, 1);
    nextTaskIds.splice(targetIndex, 0, movedTaskId);
    onReorderTasks(nextTaskIds);
  }, [onReorderTasks, planId, planTasks, reorderInProgress]);

  const handleSaveTaskEdits = useCallback(() => {
    if (!planId) {
      return;
    }
    if (!dirtyTaskUpdates.length) {
      setTaskHint('没有待保存的任务改动');
      return;
    }
    onBatchSave(dirtyTaskUpdates);
  }, [dirtyTaskUpdates, onBatchSave, planId, setTaskHint]);

  const confirmAndCancelRun = useCallback((runId: string, reason: string) => {
    const ok = window.confirm('确认取消该次运行？进行中的任务将被中止。');
    if (!ok) {
      return;
    }
    onCancelRun(runId, reason);
  }, [onCancelRun]);

  const handleDebugRun = useCallback(async (
    debugTask: OrchestrationTask | undefined,
    debugAgentId: string,
    debugTitle: string,
    debugDescription: string,
    debugRuntimeTaskType: 'auto' | DebugRuntimeTaskTypeOverride,
  ) => {
    if (!debugTask) {
      return;
    }
    await runDebugTask({
      debugTask,
      debugAgentId,
      debugTitle,
      debugDescription,
      debugRuntimeTaskType,
    });
  }, [runDebugTask]);

  return {
    handleCopyPlanTasksMarkdown,
    handleMoveTask,
    handleSaveTaskEdits,
    confirmAndCancelRun,
    handleDebugRun,
  };
};
