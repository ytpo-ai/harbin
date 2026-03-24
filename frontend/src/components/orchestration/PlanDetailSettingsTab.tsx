import React from 'react';
import { OrchestrationTask, PlanMode } from '../../services/orchestrationService';
import PlanPromptEditor from './PlanPromptEditor';
import TaskList from './TaskList';

interface PlanDetailSettingsTabProps {
  modeDraft: PlanMode;
  promptDraft: string;
  promptHint: string;
  setModeDraft: (value: PlanMode) => void;
  setPromptDraft: (value: string) => void;
  tasks: OrchestrationTask[];
  planStatus: string;
  isPlanEditable: boolean;
  taskHint: string;
  debugTaskId: string;
  streamTaskIds: string[];
  dirtyCount: number;
  isAddLoading: boolean;
  isBatchSaving: boolean;
  isReordering: boolean;
  isDuplicating: boolean;
  isRemoving: boolean;
  onOpenAddTask: () => void;
  onSaveBatch: () => void;
  onMoveTask: (taskId: string, direction: 'up' | 'down') => void;
  onDuplicateTask: (taskId: string) => void;
  onRemoveTask: (taskId: string) => void;
  onOpenTaskEdit: (taskId: string) => void;
  onOpenDebug: (taskId: string) => void;
  onCompleteHuman: (taskId: string) => void;
  onRetryTask: (taskId: string) => void;
}

const PlanDetailSettingsTab: React.FC<PlanDetailSettingsTabProps> = ({
  modeDraft,
  promptDraft,
  promptHint,
  setModeDraft,
  setPromptDraft,
  tasks,
  planStatus,
  isPlanEditable,
  taskHint,
  debugTaskId,
  streamTaskIds,
  dirtyCount,
  isAddLoading,
  isBatchSaving,
  isReordering,
  isDuplicating,
  isRemoving,
  onOpenAddTask,
  onSaveBatch,
  onMoveTask,
  onDuplicateTask,
  onRemoveTask,
  onOpenTaskEdit,
  onOpenDebug,
  onCompleteHuman,
  onRetryTask,
}) => {
  return (
    <>
      <PlanPromptEditor
        modeDraft={modeDraft}
        promptDraft={promptDraft}
        promptHint={promptHint}
        setModeDraft={setModeDraft}
        setPromptDraft={setPromptDraft}
      />
      <TaskList
        tasks={tasks}
        planStatus={planStatus}
        isPlanEditable={isPlanEditable}
        taskHint={taskHint}
        debugTaskId={debugTaskId}
        streamTaskIds={streamTaskIds}
        dirtyCount={dirtyCount}
        isAddLoading={isAddLoading}
        isBatchSaving={isBatchSaving}
        isReordering={isReordering}
        isDuplicating={isDuplicating}
        isRemoving={isRemoving}
        onOpenAddTask={onOpenAddTask}
        onSaveBatch={onSaveBatch}
        onMoveTask={onMoveTask}
        onDuplicateTask={onDuplicateTask}
        onRemoveTask={onRemoveTask}
        onOpenTaskEdit={onOpenTaskEdit}
        onOpenDebug={onOpenDebug}
        onCompleteHuman={onCompleteHuman}
        onRetryTask={onRetryTask}
      />
    </>
  );
};

export default PlanDetailSettingsTab;
