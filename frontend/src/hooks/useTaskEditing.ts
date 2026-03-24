import { useCallback, useMemo, useState } from 'react';
import { OrchestrationTask } from '../services/orchestrationService';
import {
  TaskEditableDraft,
  getTaskEditableDraft,
  isSameIdList,
  normalizeIdList,
} from '../components/orchestration/constants';

type DirtyTaskUpdate = {
  taskId: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  dependencyTaskIds: string[];
};

export const useTaskEditing = (planTasks: OrchestrationTask[]) => {
  const [taskEdits, setTaskEdits] = useState<Record<string, TaskEditableDraft>>({});

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
        } satisfies DirtyTaskUpdate;
      })
      .filter(Boolean) as DirtyTaskUpdate[];
  }, [planTasks, taskEdits]);

  const getEffectiveTaskDraft = useCallback((task: OrchestrationTask): TaskEditableDraft => {
    return taskEdits[task._id] || getTaskEditableDraft(task);
  }, [taskEdits]);

  const updateTaskDraftField = useCallback((task: OrchestrationTask, patch: Partial<TaskEditableDraft>) => {
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
  }, []);

  const removeTaskEdit = useCallback((taskId: string) => {
    setTaskEdits((previous) => {
      const next = { ...previous };
      delete next[taskId];
      return next;
    });
  }, []);

  const pruneTaskEdits = useCallback((nextTasks: OrchestrationTask[]) => {
    setTaskEdits((previous) => {
      const taskIdSet = new Set(nextTasks.map((task) => task._id));
      const nextEntries = Object.entries(previous).filter(([taskId]) => taskIdSet.has(taskId));
      if (nextEntries.length === Object.keys(previous).length) {
        return previous;
      }
      return Object.fromEntries(nextEntries);
    });
  }, []);

  return {
    taskEdits,
    setTaskEdits,
    dirtyTaskUpdates,
    getEffectiveTaskDraft,
    updateTaskDraftField,
    removeTaskEdit,
    pruneTaskEdits,
  };
};
