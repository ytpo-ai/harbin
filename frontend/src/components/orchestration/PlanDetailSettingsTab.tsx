import React from 'react';
import { OrchestrationTask, PlanMode } from '../../services/orchestrationService';
import PlanPromptEditor from './PlanPromptEditor';
import PlanSettingsModal, { PlanSettingsFormValues } from './PlanSettingsModal';
import TaskList from './TaskList';

type AgentOption = {
  id: string;
  name: string;
};

interface PlanDetailSettingsTabProps {
  modeDraft: PlanMode;
  promptDraft: string;
  promptHint: string;
  plannerAgentId?: string;
  plannerAgentName?: string;
  runMode?: string;
  domainType?: string;
  isPlanEditable: boolean;
  settingsModalOpen: boolean;
  settingsModalSaving: boolean;
  settingsFormValues: PlanSettingsFormValues;
  agents: AgentOption[];
  onOpenSettings: () => void;
  onCloseSettings: () => void;
  onSaveSettings: (values: PlanSettingsFormValues) => void;
  tasks: OrchestrationTask[];
  agentNameById?: Record<string, string>;
  planStatus: string;
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
  runMode,
  domainType,
  isPlanEditable,
  settingsModalOpen,
  settingsModalSaving,
  settingsFormValues,
  agents,
  onOpenSettings,
  onCloseSettings,
  onSaveSettings,
  tasks,
  agentNameById,
  planStatus,
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
        runMode={runMode}
        domainType={domainType}
        isPlanEditable={isPlanEditable}
        onOpenSettings={onOpenSettings}
      />
      <PlanSettingsModal
        open={settingsModalOpen}
        saving={settingsModalSaving}
        agents={agents}
        initialValues={settingsFormValues}
        onClose={onCloseSettings}
        onSave={onSaveSettings}
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
