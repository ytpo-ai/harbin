import React from 'react';
import { OrchestrationTask, PlanMode } from '../../services/orchestrationService';
import PlanPromptEditor from './PlanPromptEditor';
import TaskList from './TaskList';

interface PlanDetailSettingsTabProps {
  modeDraft: PlanMode;
  promptDraft: string;
  promptHint: string;
  plannerAgentId?: string;
  plannerAgentName?: string;
  setModeDraft: (value: PlanMode) => void;
  setPromptDraft: (value: string) => void;
  tasks: OrchestrationTask[];
  agentNameById?: Record<string, string>;
  planStatus: string;
  isPlanEditable: boolean;
  taskHint: string;
  debugTaskId: string;
  streamTaskIds: string[];
  isAddLoading: boolean;
  isReordering: boolean;
  isDuplicating: boolean;
  isRemoving: boolean;
  onOpenAddTask: () => void;
  onMoveTask: (taskId: string, direction: 'up' | 'down') => void;
  onDuplicateTask: (taskId: string) => void;
  onRemoveTask: (taskId: string) => void;
  onOpenTaskEdit: (taskId: string) => void;
  onCompleteHuman: (taskId: string) => void;
  onRetryTask: (taskId: string) => void;
}

const PlanDetailSettingsTab: React.FC<PlanDetailSettingsTabProps> = ({
  modeDraft,
  promptDraft,
  promptHint,
  plannerAgentId,
  plannerAgentName,
  setModeDraft,
  setPromptDraft,
  tasks,
  agentNameById,
  planStatus,
  isPlanEditable,
  taskHint,
  debugTaskId,
  streamTaskIds,
  isAddLoading,
  isReordering,
  isDuplicating,
  isRemoving,
  onOpenAddTask,
  onMoveTask,
  onDuplicateTask,
  onRemoveTask,
  onOpenTaskEdit,
  onCompleteHuman,
  onRetryTask,
}) => {
  return (
    <>
      <PlanPromptEditor
        modeDraft={modeDraft}
        promptDraft={promptDraft}
        promptHint={promptHint}
        plannerAgentId={plannerAgentId}
        plannerAgentName={plannerAgentName}
        setModeDraft={setModeDraft}
        setPromptDraft={setPromptDraft}
      />
      <TaskList
        tasks={tasks}
        agentNameById={agentNameById}
        planStatus={planStatus}
        isPlanEditable={isPlanEditable}
        taskHint={taskHint}
        debugTaskId={debugTaskId}
        streamTaskIds={streamTaskIds}
        isAddLoading={isAddLoading}
        isReordering={isReordering}
        isDuplicating={isDuplicating}
        isRemoving={isRemoving}
        onOpenAddTask={onOpenAddTask}
        onMoveTask={onMoveTask}
        onDuplicateTask={onDuplicateTask}
        onRemoveTask={onRemoveTask}
        onOpenTaskEdit={onOpenTaskEdit}
        onCompleteHuman={onCompleteHuman}
        onRetryTask={onRetryTask}
      />
    </>
  );
};

export default PlanDetailSettingsTab;
