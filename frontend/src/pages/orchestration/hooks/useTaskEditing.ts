import { useMemo, useState } from 'react';
import { OrchestrationTask } from '../../../services/orchestrationService';
import { TaskBatchUpdateItem, TaskEditableDraft } from '../constants';
import { getTaskEditableDraft, isSameIdList, normalizeIdList } from '../utils';

type Params = {
  selectedPlanId: string;
  planTasks: OrchestrationTask[];
  setTaskHint: (value: string) => void;
  reorderTask: (payload: { planId: string; taskIds: string[] }) => void;
  reorderTaskLoading: boolean;
  batchUpdateTasks: (payload: { planId: string; updates: TaskBatchUpdateItem[] }) => Promise<unknown>;
  batchUpdateTasksLoading: boolean;
};

export const useTaskEditing = ({
  selectedPlanId,
  planTasks,
  setTaskHint,
  reorderTask,
  reorderTaskLoading,
  batchUpdateTasks,
  batchUpdateTasksLoading,
}: Params) => {
  const [taskEdits, setTaskEdits] = useState<Record<string, TaskEditableDraft>>({});
  const [dependencyModalTaskId, setDependencyModalTaskId] = useState('');
  const [dependencyModalDraftIds, setDependencyModalDraftIds] = useState<string[]>([]);

  const dependencyModalTask = useMemo(
    () => planTasks.find((task) => task._id === dependencyModalTaskId) || null,
    [dependencyModalTaskId, planTasks],
  );

  const dependencyModalCandidates = useMemo(() => {
    if (!dependencyModalTask) {
      return [];
    }
    return planTasks.filter((task) => task._id !== dependencyModalTask._id);
  }, [dependencyModalTask, planTasks]);

  const dirtyTaskUpdates = useMemo(() => {
    return planTasks
      .map((task) => {
        const edited = taskEdits[task._id];
        if (!edited) {
          return null;
        }
        const original = getTaskEditableDraft(task);
        const titleChanged = edited.title.trim() !== original.title.trim();
        const descriptionChanged = edited.description.trim() !== original.description.trim();
        const priorityChanged = edited.priority !== original.priority;
        const depsChanged = !isSameIdList(edited.dependencyTaskIds, original.dependencyTaskIds);
        if (!titleChanged && !descriptionChanged && !priorityChanged && !depsChanged) {
          return null;
        }

        return {
          taskId: task._id,
          title: edited.title.trim(),
          description: edited.description.trim(),
          priority: edited.priority,
          dependencyTaskIds: normalizeIdList(edited.dependencyTaskIds),
        };
      })
      .filter(Boolean) as TaskBatchUpdateItem[];
  }, [planTasks, taskEdits]);

  const getEffectiveTaskDraft = (task: OrchestrationTask): TaskEditableDraft => {
    return taskEdits[task._id] || getTaskEditableDraft(task);
  };

  const updateTaskDraftField = (task: OrchestrationTask, patch: Partial<TaskEditableDraft>) => {
    setTaskHint('');
    setTaskEdits((previous) => {
      const base = previous[task._id] || getTaskEditableDraft(task);
      return {
        ...previous,
        [task._id]: {
          ...base,
          ...patch,
        },
      };
    });
  };

  const removeTaskEdit = (taskId: string) => {
    setTaskEdits((previous) => {
      const next = { ...previous };
      delete next[taskId];
      return next;
    });
  };

  const openDependencyModal = (task: OrchestrationTask) => {
    const draft = getEffectiveTaskDraft(task);
    setDependencyModalTaskId(task._id);
    setDependencyModalDraftIds(normalizeIdList(draft.dependencyTaskIds || []));
  };

  const closeDependencyModal = () => {
    setDependencyModalTaskId('');
    setDependencyModalDraftIds([]);
  };

  const toggleDependencyDraftId = (dependencyTaskId: string) => {
    setDependencyModalDraftIds((previous) => {
      if (previous.includes(dependencyTaskId)) {
        return previous.filter((item) => item !== dependencyTaskId);
      }
      return normalizeIdList([...previous, dependencyTaskId]);
    });
  };

  const applyDependencyDraft = () => {
    if (!dependencyModalTask) {
      closeDependencyModal();
      return;
    }
    updateTaskDraftField(dependencyModalTask, {
      dependencyTaskIds: normalizeIdList(dependencyModalDraftIds),
    });
    closeDependencyModal();
  };

  const handleMoveTask = (taskId: string, direction: 'up' | 'down') => {
    if (!selectedPlanId || !planTasks.length || reorderTaskLoading) {
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
    reorderTask({
      planId: selectedPlanId,
      taskIds: nextTaskIds,
    });
  };

  const handleSaveTaskEdits = async () => {
    if (!selectedPlanId) {
      return;
    }
    if (!dirtyTaskUpdates.length) {
      setTaskHint('没有待保存的任务改动');
      return;
    }
    try {
      await batchUpdateTasks({
        planId: selectedPlanId,
        updates: dirtyTaskUpdates,
      });
      setTaskEdits({});
    } catch {
      // keep edits when save fails
    }
  };

  return {
    taskEdits,
    setTaskEdits,
    dependencyModalTaskId,
    setDependencyModalTaskId,
    dependencyModalDraftIds,
    setDependencyModalDraftIds,
    dependencyModalTask,
    dependencyModalCandidates,
    dirtyTaskUpdates,
    getEffectiveTaskDraft,
    updateTaskDraftField,
    removeTaskEdit,
    openDependencyModal,
    closeDependencyModal,
    toggleDependencyDraftId,
    applyDependencyDraft,
    handleMoveTask,
    handleSaveTaskEdits,
    batchUpdateTasksLoading,
  };
};
