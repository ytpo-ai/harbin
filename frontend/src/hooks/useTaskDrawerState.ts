import { useMemo, useState } from 'react';
import { OrchestrationTask } from '../services/orchestrationService';
import { TaskEditableDraft, normalizeIdList } from '../components/orchestration/constants';

interface UseTaskDrawerStateOptions {
  planTasks: OrchestrationTask[];
  getEffectiveTaskDraft: (task: OrchestrationTask) => TaskEditableDraft;
  updateTaskDraftField: (task: OrchestrationTask, patch: Partial<TaskEditableDraft>) => void;
  setTaskHint: (value: string) => void;
}

export const useTaskDrawerState = ({
  planTasks,
  getEffectiveTaskDraft,
  updateTaskDraftField,
  setTaskHint,
}: UseTaskDrawerStateOptions) => {
  const [dependencyModalTaskId, setDependencyModalTaskId] = useState('');
  const [dependencyModalDraftIds, setDependencyModalDraftIds] = useState<string[]>([]);
  const [taskEditDrawerOpen, setTaskEditDrawerOpen] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState('');

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

  const editingTask = useMemo(
    () => planTasks.find((task) => task._id === editingTaskId) || null,
    [planTasks, editingTaskId],
  );

  const openDependencyModal = (task: OrchestrationTask) => {
    setTaskHint('');
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

  const openTaskEditDrawer = (taskId: string) => {
    setEditingTaskId(taskId);
    setTaskEditDrawerOpen(true);
    setTaskHint('');
  };

  const closeTaskEditDrawer = () => {
    setTaskEditDrawerOpen(false);
    setEditingTaskId('');
  };

  const resetTaskDrawerState = () => {
    setDependencyModalTaskId('');
    setDependencyModalDraftIds([]);
    setTaskEditDrawerOpen(false);
    setEditingTaskId('');
  };

  return {
    dependencyModalTaskId,
    dependencyModalDraftIds,
    taskEditDrawerOpen,
    editingTaskId,
    dependencyModalTask,
    dependencyModalCandidates,
    editingTask,
    setDependencyModalDraftIds,
    openDependencyModal,
    closeDependencyModal,
    toggleDependencyDraftId,
    applyDependencyDraft,
    openTaskEditDrawer,
    closeTaskEditDrawer,
    resetTaskDrawerState,
  };
};
