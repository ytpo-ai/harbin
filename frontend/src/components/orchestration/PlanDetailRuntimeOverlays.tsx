import React from 'react';
import { AgentSession, DebugRuntimeTaskTypeOverride, OrchestrationRun, OrchestrationRunTask, OrchestrationTask } from '../../services/orchestrationService';
import DebugDrawer from './DebugDrawer';
import ReplanModal from './ReplanModal';
import RunDetailDrawer from './RunDetailDrawer';

interface PlanDetailRuntimeOverlaysProps {
  planId?: string;
  runDrawerOpen: boolean;
  selectedRunId: string;
  runDetail: OrchestrationRun | undefined;
  runDetailLoading: boolean;
  runDetailError: boolean;
  runTasks: OrchestrationRunTask[];
  runTasksLoading: boolean;
  runTasksError: boolean;
  cancelRunLoading: boolean;
  onCloseRunDrawer: () => void;
  onCancelRunInRunDetail: (runId: string) => void;
  debugDrawerOpen: boolean;
  debugTask: OrchestrationTask | null;
  activeDrawerTab: 'debug' | 'session';
  debugAgentId: string;
  debugTitle: string;
  debugDescription: string;
  debugRuntimeTaskType: 'auto' | DebugRuntimeTaskTypeOverride;
  debugHint: string;
  debugSessionId: string;
  debugSessionDetail?: AgentSession;
  debugSessionLoading: boolean;
  agents: Array<{ id: string; name: string }>;
  debugSaving: boolean;
  debugRunning: boolean;
  reassignRunning: boolean;
  debugEditable: boolean;
  onCloseDebugDrawer: () => void;
  onTabChange: (tab: 'debug' | 'session') => void;
  onChangeAgentId: (value: string) => void;
  onChangeTitle: (value: string) => void;
  onChangeDescription: (value: string) => void;
  onChangeRuntimeType: (value: 'auto' | DebugRuntimeTaskTypeOverride) => void;
  onSaveDraft: () => void;
  onRunDebug: () => void;
  isReplanModalOpen: boolean;
  replanPlannerAgentId: string;
  replanAutoGenerate: boolean;
  replanLoading: boolean;
  replanPending: boolean;
  onCloseReplanModal: () => void;
  onChangeReplanPlannerAgentId: (value: string) => void;
  onChangeReplanAutoGenerate: (value: boolean) => void;
  onSubmitReplan: () => void;
}

const PlanDetailRuntimeOverlays: React.FC<PlanDetailRuntimeOverlaysProps> = ({
  planId,
  runDrawerOpen,
  selectedRunId,
  runDetail,
  runDetailLoading,
  runDetailError,
  runTasks,
  runTasksLoading,
  runTasksError,
  cancelRunLoading,
  onCloseRunDrawer,
  onCancelRunInRunDetail,
  debugDrawerOpen,
  debugTask,
  activeDrawerTab,
  debugAgentId,
  debugTitle,
  debugDescription,
  debugRuntimeTaskType,
  debugHint,
  debugSessionId,
  debugSessionDetail,
  debugSessionLoading,
  agents,
  debugSaving,
  debugRunning,
  reassignRunning,
  debugEditable,
  onCloseDebugDrawer,
  onTabChange,
  onChangeAgentId,
  onChangeTitle,
  onChangeDescription,
  onChangeRuntimeType,
  onSaveDraft,
  onRunDebug,
  isReplanModalOpen,
  replanPlannerAgentId,
  replanAutoGenerate,
  replanLoading,
  replanPending,
  onCloseReplanModal,
  onChangeReplanPlannerAgentId,
  onChangeReplanAutoGenerate,
  onSubmitReplan,
}) => {
  return (
    <>
      <RunDetailDrawer
        open={runDrawerOpen}
        selectedRunId={selectedRunId}
        runDetail={runDetail}
        runDetailLoading={runDetailLoading}
        hasRunDetailError={runDetailError}
        runTasks={runTasks}
        runTasksLoading={runTasksLoading}
        hasRunTasksError={runTasksError}
        isCancelling={cancelRunLoading}
        onClose={onCloseRunDrawer}
        onCancelRun={onCancelRunInRunDetail}
      />

      <DebugDrawer
        open={debugDrawerOpen}
        task={debugTask}
        activeDrawerTab={activeDrawerTab}
        debugAgentId={debugAgentId}
        debugTitle={debugTitle}
        debugDescription={debugDescription}
        debugRuntimeTaskType={debugRuntimeTaskType}
        debugHint={debugHint}
        debugSessionId={debugSessionId}
        debugSessionDetail={debugSessionDetail}
        debugSessionLoading={debugSessionLoading}
        agents={agents}
        debugSaving={debugSaving}
        debugRunning={debugRunning}
        reassignRunning={reassignRunning}
        editable={debugEditable}
        onClose={onCloseDebugDrawer}
        onTabChange={onTabChange}
        onChangeAgentId={onChangeAgentId}
        onChangeTitle={onChangeTitle}
        onChangeDescription={onChangeDescription}
        onChangeRuntimeType={onChangeRuntimeType}
        onSaveDraft={onSaveDraft}
        onRunDebug={onRunDebug}
      />

      <ReplanModal
        open={isReplanModalOpen}
        plannerAgentId={replanPlannerAgentId}
        autoGenerate={replanAutoGenerate}
        loading={replanLoading}
        isPending={replanPending}
        disabled={!planId}
        agents={agents}
        onClose={onCloseReplanModal}
        onChangePlannerAgentId={onChangeReplanPlannerAgentId}
        onChangeAutoGenerate={onChangeReplanAutoGenerate}
        onSubmit={onSubmitReplan}
      />
    </>
  );
};

export default PlanDetailRuntimeOverlays;
