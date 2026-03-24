import { useEffect, useState } from 'react';
import { DebugRuntimeTaskTypeOverride, OrchestrationTask, PlanMode } from '../services/orchestrationService';
import { DrawerTab, PlanDetailTab } from '../components/orchestration/constants';

export const usePlanDetailViewState = (planId?: string) => {
  const [promptDraft, setPromptDraft] = useState('');
  const [modeDraft, setModeDraft] = useState<PlanMode>('hybrid');
  const [promptHint, setPromptHint] = useState('');

  const [isReplanModalOpen, setIsReplanModalOpen] = useState(false);
  const [replanPlannerAgentId, setReplanPlannerAgentId] = useState('');
  const [replanAutoGenerate, setReplanAutoGenerate] = useState(true);
  const [isReplanPending, setIsReplanPending] = useState(false);
  const [lastAsyncReplanError, setLastAsyncReplanError] = useState('');

  const [debugDrawerOpen, setDebugDrawerOpen] = useState(false);
  const [debugTaskId, setDebugTaskId] = useState('');
  const [debugTitle, setDebugTitle] = useState('');
  const [debugDescription, setDebugDescription] = useState('');
  const [debugRuntimeTaskType, setDebugRuntimeTaskType] = useState<'auto' | DebugRuntimeTaskTypeOverride>('auto');
  const [debugHint, setDebugHint] = useState('');
  const [debugSessionId, setDebugSessionId] = useState('');
  const [debugAgentId, setDebugAgentId] = useState('');
  const [activeDrawerTab, setActiveDrawerTab] = useState<DrawerTab>('debug');

  const [activeTab, setActiveTab] = useState<PlanDetailTab>('settings');
  const [runDrawerOpen, setRunDrawerOpen] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState('');

  const [streamHint, setStreamHint] = useState('');
  const [streamConnected, setStreamConnected] = useState(false);
  const [streamTaskIds, setStreamTaskIds] = useState<string[]>([]);

  const [taskHint, setTaskHint] = useState('');
  const [isAddTaskModalOpen, setIsAddTaskModalOpen] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDescription, setNewTaskDescription] = useState('');
  const [newTaskPriority, setNewTaskPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('medium');
  const [newTaskInsertAfterTaskId, setNewTaskInsertAfterTaskId] = useState('');

  const openDebugDrawer = (taskId: string, tab: DrawerTab = 'debug') => {
    setDebugTaskId(taskId);
    setActiveDrawerTab(tab);
    setDebugDrawerOpen(true);
    setDebugHint('');
  };

  const openRunDetailDrawer = (runId: string) => {
    if (!runId) {
      return;
    }
    setSelectedRunId(runId);
    setRunDrawerOpen(true);
  };

  const syncDebugDraftFromTask = (
    debugTask: OrchestrationTask | undefined,
    fallbackAgentId?: string,
  ) => {
    if (!debugTask) {
      return;
    }
    setDebugTitle(debugTask.title || '');
    setDebugDescription(debugTask.description || '');
    setDebugRuntimeTaskType(debugTask.runtimeTaskType || 'auto');
    setDebugSessionId(debugTask.sessionId || '');
    const taskAgentId =
      debugTask.assignment?.executorType === 'agent' && debugTask.assignment?.executorId
        ? debugTask.assignment.executorId
        : '';
    setDebugAgentId(taskAgentId || fallbackAgentId || '');
  };

  const resetForPlanSwitch = (extraReset?: () => void) => {
    setDebugDrawerOpen(false);
    setRunDrawerOpen(false);
    setSelectedRunId('');
    setActiveTab('settings');
    setDebugTaskId('');
    setDebugTitle('');
    setDebugDescription('');
    setDebugRuntimeTaskType('auto');
    setDebugSessionId('');
    setDebugAgentId('');
    setActiveDrawerTab('debug');
    setDebugHint('');
    setStreamHint('');
    setStreamTaskIds([]);
    setTaskHint('');
    extraReset?.();
  };

  useEffect(() => {
    if (!planId) {
      return;
    }
    resetForPlanSwitch();
  }, [planId]);

  return {
    promptDraft,
    setPromptDraft,
    modeDraft,
    setModeDraft,
    promptHint,
    setPromptHint,
    isReplanModalOpen,
    setIsReplanModalOpen,
    replanPlannerAgentId,
    setReplanPlannerAgentId,
    replanAutoGenerate,
    setReplanAutoGenerate,
    isReplanPending,
    setIsReplanPending,
    lastAsyncReplanError,
    setLastAsyncReplanError,
    debugDrawerOpen,
    setDebugDrawerOpen,
    debugTaskId,
    setDebugTaskId,
    debugTitle,
    setDebugTitle,
    debugDescription,
    setDebugDescription,
    debugRuntimeTaskType,
    setDebugRuntimeTaskType,
    debugHint,
    setDebugHint,
    debugSessionId,
    setDebugSessionId,
    debugAgentId,
    setDebugAgentId,
    activeDrawerTab,
    setActiveDrawerTab,
    activeTab,
    setActiveTab,
    runDrawerOpen,
    setRunDrawerOpen,
    selectedRunId,
    setSelectedRunId,
    streamHint,
    setStreamHint,
    streamConnected,
    setStreamConnected,
    streamTaskIds,
    setStreamTaskIds,
    taskHint,
    setTaskHint,
    isAddTaskModalOpen,
    setIsAddTaskModalOpen,
    newTaskTitle,
    setNewTaskTitle,
    newTaskDescription,
    setNewTaskDescription,
    newTaskPriority,
    setNewTaskPriority,
    newTaskInsertAfterTaskId,
    setNewTaskInsertAfterTaskId,
    openDebugDrawer,
    openRunDetailDrawer,
    syncDebugDraftFromTask,
    resetForPlanSwitch,
  };
};
