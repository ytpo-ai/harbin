import React from 'react';
import { OrchestrationTask } from '../../services/orchestrationService';
import { TaskEditableDraft } from './constants';
import AddTaskModal from './AddTaskModal';
import TaskDependencyModal from './TaskDependencyModal';
import TaskEditDrawer from './TaskEditDrawer';

interface PlanDetailTaskOverlaysProps {
  planId?: string;
  planStatus: string;
  planTasks: OrchestrationTask[];
  isAddTaskModalOpen: boolean;
  newTaskTitle: string;
  newTaskDescription: string;
  newTaskPriority: 'low' | 'medium' | 'high' | 'urgent';
  newTaskInsertAfterTaskId: string;
  addTaskLoading: boolean;
  dependencyModalTask: OrchestrationTask | null;
  dependencyModalCandidates: OrchestrationTask[];
  dependencyModalDraftIds: string[];
  taskEditDrawerOpen: boolean;
  editingTask: OrchestrationTask | null;
  editingTaskDraft: TaskEditableDraft | null;
  onCloseAddModal: () => void;
  onChangeNewTaskTitle: (value: string) => void;
  onChangeNewTaskDescription: (value: string) => void;
  onChangeNewTaskPriority: (value: 'low' | 'medium' | 'high' | 'urgent') => void;
  onChangeNewTaskInsertAfter: (value: string) => void;
  onSubmitAddTask: () => void;
  onCloseDependencyModal: () => void;
  onToggleDependency: (taskId: string) => void;
  onClearDependency: () => void;
  onApplyDependency: () => void;
  onCloseTaskEditDrawer: () => void;
  onUpdateTaskEditDraft: (patch: Partial<TaskEditableDraft>) => void;
  onOpenDependencyFromTaskEdit: () => void;
}

const PlanDetailTaskOverlays: React.FC<PlanDetailTaskOverlaysProps> = ({
  planTasks,
  planStatus,
  isAddTaskModalOpen,
  newTaskTitle,
  newTaskDescription,
  newTaskPriority,
  newTaskInsertAfterTaskId,
  addTaskLoading,
  dependencyModalTask,
  dependencyModalCandidates,
  dependencyModalDraftIds,
  taskEditDrawerOpen,
  editingTask,
  editingTaskDraft,
  onCloseAddModal,
  onChangeNewTaskTitle,
  onChangeNewTaskDescription,
  onChangeNewTaskPriority,
  onChangeNewTaskInsertAfter,
  onSubmitAddTask,
  onCloseDependencyModal,
  onToggleDependency,
  onClearDependency,
  onApplyDependency,
  onCloseTaskEditDrawer,
  onUpdateTaskEditDraft,
  onOpenDependencyFromTaskEdit,
}) => {
  return (
    <>
      <AddTaskModal
        open={isAddTaskModalOpen}
        title={newTaskTitle}
        description={newTaskDescription}
        priority={newTaskPriority}
        insertAfterTaskId={newTaskInsertAfterTaskId}
        planTasks={planTasks}
        isLoading={addTaskLoading}
        onClose={onCloseAddModal}
        onChangeTitle={onChangeNewTaskTitle}
        onChangeDescription={onChangeNewTaskDescription}
        onChangePriority={onChangeNewTaskPriority}
        onChangeInsertAfterTaskId={onChangeNewTaskInsertAfter}
        onSubmit={onSubmitAddTask}
      />

      <TaskDependencyModal
        open={Boolean(dependencyModalTask)}
        task={dependencyModalTask}
        candidates={dependencyModalCandidates}
        draftIds={dependencyModalDraftIds}
        onClose={onCloseDependencyModal}
        onToggle={onToggleDependency}
        onClear={onClearDependency}
        onApply={onApplyDependency}
      />

      <TaskEditDrawer
        open={taskEditDrawerOpen}
        task={editingTask}
        planStatus={planStatus}
        draft={editingTaskDraft}
        onClose={onCloseTaskEditDrawer}
        onUpdateDraft={onUpdateTaskEditDraft}
        onOpenDependencyModal={onOpenDependencyFromTaskEdit}
      />
    </>
  );
};

export default PlanDetailTaskOverlays;
