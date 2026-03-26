import React, { useEffect, useState } from 'react';
import { ArrowPathIcon, PlusIcon } from '@heroicons/react/24/outline';
import { useQueryClient } from 'react-query';
import { useNavigate } from 'react-router-dom';
import {
  DebugRuntimeTaskTypeOverride,
  OrchestrationPlan,
  PlanDomainType,
  PlanMode,
  PlanRunMode,
} from '../../services/orchestrationService';
import AddTaskModal from './components/AddTaskModal';
import CreatePlanModal from './components/CreatePlanModal';
import DebugDrawer from './components/DebugDrawer';
import DependencyModal from './components/DependencyModal';
import PlanDetailDrawer from './components/PlanDetailDrawer';
import PlanListTable from './components/PlanListTable';
import RunDetailDrawer from './components/RunDetailDrawer';
import {
  DrawerTab,
  PLAN_PROMPT_DRAFT_STORAGE_KEY,
  PlanDrawerTab,
  RunStatusFilter,
  RunTriggerFilter,
  TaskPriority,
} from './constants';
import { useOrchestrationMutations } from './hooks/useOrchestrationMutations';
import { useOrchestrationQueries } from './hooks/useOrchestrationQueries';
import { useTaskEditing } from './hooks/useTaskEditing';
import { extractErrorMessage } from './utils';

const Orchestration: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isDetailDrawerOpen, setIsDetailDrawerOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [title, setTitle] = useState('');
  const [mode, setMode] = useState<PlanMode>('hybrid');
  const [runMode, setRunMode] = useState<PlanRunMode>('multi');
  const [domainType, setDomainType] = useState<PlanDomainType>('general');
  const [autoGenerate, setAutoGenerate] = useState(false);
  const [plannerAgentId, setPlannerAgentId] = useState('');

  const [debugDrawerOpen, setDebugDrawerOpen] = useState(false);
  const [debugTaskId, setDebugTaskId] = useState('');
  const [debugTitle, setDebugTitle] = useState('');
  const [debugDescription, setDebugDescription] = useState('');
  const [debugRuntimeTaskType, setDebugRuntimeTaskType] = useState<'auto' | DebugRuntimeTaskTypeOverride>('auto');
  const [debugHint, setDebugHint] = useState('');
  const [debugSessionId, setDebugSessionId] = useState('');
  const [debugAgentId, setDebugAgentId] = useState('');
  const [activeDrawerTab, setActiveDrawerTab] = useState<DrawerTab>('debug');

  const [activePlanDrawerTab, setActivePlanDrawerTab] = useState<PlanDrawerTab>('settings');
  const [runStatusFilter, setRunStatusFilter] = useState<RunStatusFilter>('all');
  const [runTriggerFilter, setRunTriggerFilter] = useState<RunTriggerFilter>('all');
  const [runDetailDrawerOpen, setRunDetailDrawerOpen] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState('');

  const [promptDrafts, setPromptDrafts] = useState<Record<string, string>>({});
  const [planHint, setPlanHint] = useState('');
  const [taskHint, setTaskHint] = useState('');
  const [planModeDraft, setPlanModeDraft] = useState<PlanMode>('hybrid');
  const [isAddTaskModalOpen, setIsAddTaskModalOpen] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDescription, setNewTaskDescription] = useState('');
  const [newTaskPriority, setNewTaskPriority] = useState<TaskPriority>('medium');
  const [newTaskInsertAfterTaskId, setNewTaskInsertAfterTaskId] = useState('');

  const {
    plans,
    plansLoading,
    planDetail,
    planDetailLoading,
    planRunsLoading,
    planRunsError,
    latestRunLoading,
    runDetail,
    runDetailLoading,
    runDetailError,
    runTasks,
    runTasksLoading,
    runTasksError,
    debugTask,
    planTasks,
    isPlanEditable,
    filteredPlanRuns,
    latestRunSummary,
    debugSessionDetail,
    debugSessionLoading,
    agents,
    employees,
  } = useOrchestrationQueries({
    selectedPlanId,
    selectedRunId,
    debugSessionId,
    debugTaskId,
    debugDrawerOpen,
    runDetailDrawerOpen,
    isDetailDrawerOpen,
    activePlanDrawerTab,
    runStatusFilter,
    runTriggerFilter,
  });

  const mutations = useOrchestrationMutations({
    navigate,
    selectedPlanId,
    planModeDraft,
    planDomainType: (planDetail?.domainType || 'general') as PlanDomainType,
    planRunMode: (planDetail?.strategy?.runMode || 'multi') as PlanRunMode,
    plannerAgentId: planDetail?.strategy?.plannerAgentId,
    setPrompt,
    setTitle,
    setDomainType,
    setRunMode,
    setSelectedPlanId,
    setIsDetailDrawerOpen,
    setIsCreateModalOpen,
    setPlanHint,
    setDebugDrawerOpen,
    setDebugTaskId,
    setDebugHint,
    setDebugSessionId,
    setPromptDrafts,
    setTaskHint,
    setIsAddTaskModalOpen,
    setNewTaskTitle,
    setNewTaskDescription,
    setNewTaskPriority,
    setNewTaskInsertAfterTaskId,
  });

  const taskEditing = useTaskEditing({
    selectedPlanId,
    planTasks,
    setTaskHint,
    reorderTask: mutations.reorderTaskMutation.mutate,
    reorderTaskLoading: mutations.reorderTaskMutation.isLoading,
    batchUpdateTasks: mutations.batchUpdateTasksMutation.mutateAsync,
    batchUpdateTasksLoading: mutations.batchUpdateTasksMutation.isLoading,
  });

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PLAN_PROMPT_DRAFT_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, string>;
      if (parsed && typeof parsed === 'object') {
        setPromptDrafts(parsed);
      }
    } catch {
      // ignore invalid local storage payload
    }
  }, []);

  useEffect(() => {
    if (!selectedPlanId && plans.length > 0) {
      setSelectedPlanId(plans[0]._id);
    }
  }, [plans, selectedPlanId]);

  useEffect(() => {
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
    setDebugAgentId(taskAgentId || agents[0]?.id || '');
  }, [agents, debugTask]);

  useEffect(() => {
    setDebugDrawerOpen(false);
    setRunDetailDrawerOpen(false);
    setSelectedRunId('');
    setActivePlanDrawerTab('settings');
    setRunStatusFilter('all');
    setRunTriggerFilter('all');
    setDebugTaskId('');
    setDebugTitle('');
    setDebugDescription('');
    setDebugRuntimeTaskType('auto');
    setDebugSessionId('');
    setDebugAgentId('');
    setActiveDrawerTab('debug');
    setDebugHint('');
    setPlanHint('');
    setPlanModeDraft('hybrid');
    taskEditing.setTaskEdits({});
    setTaskHint('');
    taskEditing.setDependencyModalTaskId('');
    taskEditing.setDependencyModalDraftIds([]);
  }, [selectedPlanId]);

  useEffect(() => {
    taskEditing.setTaskEdits((previous) => {
      const taskIdSet = new Set(planTasks.map((task) => task._id));
      const nextEntries = Object.entries(previous).filter(([taskId]) => taskIdSet.has(taskId));
      if (nextEntries.length === Object.keys(previous).length) {
        return previous;
      }
      return Object.fromEntries(nextEntries);
    });
  }, [planTasks]);

  useEffect(() => {
    if (!planDetail?._id) {
      return;
    }
    setPlanModeDraft(planDetail.strategy?.mode || 'hybrid');
    setPromptDrafts((prev) => {
      if (Object.prototype.hasOwnProperty.call(prev, planDetail._id)) {
        return prev;
      }
      const next = {
        ...prev,
        [planDetail._id]: planDetail.sourcePrompt || '',
      };
      window.localStorage.setItem(PLAN_PROMPT_DRAFT_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, [planDetail?._id, planDetail?.sourcePrompt]);

  const handleDeletePlan = async (planId: string) => {
    if (!planId) return;
    const ok = window.confirm('确认删除该计划及其任务？此操作不可恢复。');
    if (!ok) return;
    try {
      await mutations.deletePlanMutation.mutateAsync(planId);
    } catch (error) {
      alert(extractErrorMessage(error, '删除失败，请稍后重试'));
    }
  };

  const copyPlanToForm = (plan: OrchestrationPlan) => {
    setTitle(plan.title || '');
    setPrompt(plan.sourcePrompt || '');
    setMode(plan.strategy?.mode || 'hybrid');
    setRunMode((plan.strategy?.runMode || 'multi') as PlanRunMode);
    setPlannerAgentId(plan.strategy?.plannerAgentId || '');
    setAutoGenerate(false);
    setIsCreateModalOpen(true);
  };

  const openDebugDrawer = (taskId: string, tab: DrawerTab = 'debug') => {
    setDebugTaskId(taskId);
    setActiveDrawerTab(tab);
    setDebugDrawerOpen(true);
    setDebugHint('');
  };

  const openRunDetailDrawer = (runId: string) => {
    if (!runId) return;
    setSelectedRunId(runId);
    setRunDetailDrawerOpen(true);
  };

  const updatePromptDraft = (planId: string, value: string) => {
    setPromptDrafts((prev) => {
      const next = {
        ...prev,
        [planId]: value,
      };
      window.localStorage.setItem(PLAN_PROMPT_DRAFT_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const handleDebugRun = async () => {
    if (!debugTask) return;
    const targetAgentId = debugAgentId.trim();
    if (!targetAgentId) {
      setDebugHint('请先选择 Agent 再执行调试');
      return;
    }
    try {
      if (
        debugTask.assignment?.executorType !== 'agent'
        || debugTask.assignment?.executorId !== targetAgentId
      ) {
        await mutations.reassignMutation.mutateAsync({
          taskId: debugTask._id,
          executorType: 'agent',
          executorId: targetAgentId,
        });
      }

      const nextTitle = debugTitle.trim();
      const nextDescription = debugDescription.trim();
      const originalTitle = String(debugTask.title || '').trim();
      const originalDescription = String(debugTask.description || '').trim();
      await mutations.debugStepMutation.mutateAsync({
        taskId: debugTask._id,
        title: nextTitle && nextTitle !== originalTitle ? nextTitle : undefined,
        description: nextDescription && nextDescription !== originalDescription ? nextDescription : undefined,
        runtimeTaskTypeOverride: debugRuntimeTaskType === 'auto' ? undefined : debugRuntimeTaskType,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '调试执行失败，请稍后重试';
      setDebugHint(message);
    }
  };

  const currentPromptDraft = planDetail?._id
    ? (promptDrafts[planDetail._id] ?? planDetail.sourcePrompt ?? '')
    : '';

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-gradient-to-r from-white via-sky-50 to-cyan-50 px-4 py-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">计划编排中心</h1>
            <p className="mt-1 text-sm text-slate-600">默认展示 Plan 列表，支持弹窗创建与抽屉查看详情。</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => queryClient.invalidateQueries('orchestration-plans')}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              <ArrowPathIcon className="h-4 w-4" /> 刷新
            </button>
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="inline-flex items-center gap-1 rounded-md bg-primary-600 px-3 py-2 text-sm text-white hover:bg-primary-700"
            >
              <PlusIcon className="h-4 w-4" /> 创建计划
            </button>
          </div>
        </div>
      </div>

      <PlanListTable
        plans={plans}
        plansLoading={plansLoading}
        deleteLoading={mutations.deletePlanMutation.isLoading}
        onDeletePlan={(planId) => {
          void handleDeletePlan(planId);
        }}
      />

      <CreatePlanModal
        open={isCreateModalOpen}
        title={title}
        prompt={prompt}
        mode={mode}
        runMode={runMode}
        domainType={domainType}
        autoGenerate={autoGenerate}
        plannerAgentId={plannerAgentId}
        agents={agents}
        createLoading={mutations.createPlanMutation.isLoading}
        createError={mutations.createPlanMutation.isError}
        onClose={() => setIsCreateModalOpen(false)}
        onTitleChange={setTitle}
        onPromptChange={setPrompt}
        onModeChange={setMode}
        onRunModeChange={setRunMode}
        onDomainTypeChange={setDomainType}
        onAutoGenerateChange={setAutoGenerate}
        onPlannerAgentIdChange={setPlannerAgentId}
        onSubmit={() => {
          mutations.createPlanMutation.mutate({
            prompt: prompt.trim(),
            title: title.trim() || undefined,
            domainType,
            plannerAgentId: plannerAgentId || undefined,
            mode,
            runMode,
            autoGenerate,
          });
        }}
      />

      <PlanDetailDrawer
        open={isDetailDrawerOpen}
        selectedPlanId={selectedPlanId}
        planDetail={planDetail}
        planDetailLoading={planDetailLoading}
        activePlanDrawerTab={activePlanDrawerTab}
        currentPromptDraft={currentPromptDraft}
        planHint={planHint}
        taskHint={taskHint}
        planModeDraft={planModeDraft}
        planTasks={planTasks}
        isPlanEditable={isPlanEditable}
        debugTaskId={debugTaskId}
        dirtyTaskUpdates={taskEditing.dirtyTaskUpdates}
        latestRunSummary={latestRunSummary}
        latestRunLoading={latestRunLoading}
        runTriggerFilter={runTriggerFilter}
        runStatusFilter={runStatusFilter}
        planRunsLoading={planRunsLoading}
        planRunsError={planRunsError}
        filteredPlanRuns={filteredPlanRuns}
        agents={agents}
        employees={employees}
        savePlanPromptLoading={mutations.savePlanPromptMutation.isLoading}
        replanPlanLoading={mutations.replanPlanMutation.isLoading}
        runPlanLoading={mutations.runPlanMutation.isLoading}
        addTaskLoading={mutations.addTaskMutation.isLoading}
        batchUpdateTasksLoading={mutations.batchUpdateTasksMutation.isLoading}
        reorderTaskLoading={mutations.reorderTaskMutation.isLoading}
        duplicateTaskLoading={mutations.duplicateTaskMutation.isLoading}
        removeTaskLoading={mutations.removeTaskMutation.isLoading}
        retryTaskLoading={mutations.retryTaskMutation.isLoading}
        onClose={() => setIsDetailDrawerOpen(false)}
        onTabChange={setActivePlanDrawerTab}
        onPromptDraftChange={(value) => {
          if (!planDetail?._id) return;
          updatePromptDraft(planDetail._id, value);
          if (planHint) setPlanHint('');
        }}
        onPlanModeDraftChange={setPlanModeDraft}
        onSavePrompt={() => {
          if (!selectedPlanId) return;
          const nextPrompt = currentPromptDraft.trim();
          if (!nextPrompt) {
            setPlanHint('Prompt 不能为空');
            return;
          }
          mutations.savePlanPromptMutation.mutate({
            planId: selectedPlanId,
            sourcePrompt: nextPrompt,
            mode: planModeDraft,
          });
        }}
        onReplan={() => {
          if (!selectedPlanId) return;
          const nextPrompt = currentPromptDraft.trim();
          if (!nextPrompt) {
            setPlanHint('Prompt 不能为空');
            return;
          }
          const ok = window.confirm('确认覆盖当前计划任务并重新编排？旧任务执行轨迹将被替换。');
          if (!ok) return;
          mutations.replanPlanMutation.mutate({ planId: selectedPlanId, prompt: nextPrompt });
        }}
        onCopyToCreate={() => {
          if (planDetail) copyPlanToForm(planDetail);
        }}
        onRunPlan={() => {
          if (selectedPlanId) {
            mutations.runPlanMutation.mutate({ planId: selectedPlanId, continueOnFailure: true });
          }
        }}
        onDeletePlan={() => {
          if (selectedPlanId) {
            void handleDeletePlan(selectedPlanId);
          }
        }}
        onOpenAddTaskModal={() => setIsAddTaskModalOpen(true)}
        onSaveTaskEdits={() => {
          void taskEditing.handleSaveTaskEdits();
        }}
        getEffectiveTaskDraft={taskEditing.getEffectiveTaskDraft}
        onUpdateTaskDraftField={taskEditing.updateTaskDraftField}
        onMoveTask={taskEditing.handleMoveTask}
        onDuplicateTask={(taskId) => {
          if (selectedPlanId) {
            mutations.duplicateTaskMutation.mutate({ planId: selectedPlanId, taskId });
          }
        }}
        onRemoveTask={(task) => {
          const ok = window.confirm('确认删除该任务？依赖此任务的下游任务将自动解除依赖。');
          if (!ok) return;
          mutations.removeTaskMutation.mutate(task._id);
          taskEditing.removeTaskEdit(task._id);
        }}
        onOpenDebugDrawer={openDebugDrawer}
        onOpenDependencyModal={taskEditing.openDependencyModal}
        onReassignTask={mutations.reassignMutation.mutate}
        onCompleteHumanTask={(taskId) => {
          const summary = window.prompt('请输入人工完成说明', '由人工完成') || undefined;
          mutations.completeHumanTaskMutation.mutate({ taskId, summary });
        }}
        onRetryTask={(taskId) => mutations.retryTaskMutation.mutate(taskId)}
        onOpenSessionTab={(taskId, sessionId) => {
          openDebugDrawer(taskId, 'session');
          setDebugSessionId(sessionId || '');
        }}
        onOpenRunDetail={openRunDetailDrawer}
        onRunTriggerFilterChange={setRunTriggerFilter}
        onRunStatusFilterChange={setRunStatusFilter}
      />

      <AddTaskModal
        open={isAddTaskModalOpen}
        planTasks={planTasks}
        newTaskTitle={newTaskTitle}
        newTaskDescription={newTaskDescription}
        newTaskPriority={newTaskPriority}
        newTaskInsertAfterTaskId={newTaskInsertAfterTaskId}
        addTaskLoading={mutations.addTaskMutation.isLoading}
        onClose={() => setIsAddTaskModalOpen(false)}
        onTitleChange={setNewTaskTitle}
        onDescriptionChange={setNewTaskDescription}
        onPriorityChange={setNewTaskPriority}
        onInsertAfterTaskIdChange={setNewTaskInsertAfterTaskId}
        onConfirm={() => {
          if (!selectedPlanId) return;
          const finalTitle = newTaskTitle.trim();
          const description = newTaskDescription.trim();
          if (!finalTitle || !description) {
            setTaskHint('任务标题和描述不能为空');
            return;
          }
          mutations.addTaskMutation.mutate({
            planId: selectedPlanId,
            title: finalTitle,
            description,
            priority: newTaskPriority,
            insertAfterTaskId: newTaskInsertAfterTaskId || undefined,
          });
        }}
      />

      <DependencyModal
        dependencyModalTask={taskEditing.dependencyModalTask}
        dependencyModalCandidates={taskEditing.dependencyModalCandidates}
        dependencyModalDraftIds={taskEditing.dependencyModalDraftIds}
        onClose={taskEditing.closeDependencyModal}
        onClear={() => taskEditing.setDependencyModalDraftIds([])}
        onToggle={taskEditing.toggleDependencyDraftId}
        onApply={taskEditing.applyDependencyDraft}
      />

      <RunDetailDrawer
        open={runDetailDrawerOpen}
        selectedRunId={selectedRunId}
        runDetail={runDetail}
        runDetailLoading={runDetailLoading}
        runDetailError={runDetailError}
        runTasks={runTasks}
        runTasksLoading={runTasksLoading}
        runTasksError={runTasksError}
        onClose={() => setRunDetailDrawerOpen(false)}
      />

      <DebugDrawer
        open={debugDrawerOpen}
        activeDrawerTab={activeDrawerTab}
        debugTask={debugTask}
        debugTitle={debugTitle}
        debugDescription={debugDescription}
        debugRuntimeTaskType={debugRuntimeTaskType}
        debugAgentId={debugAgentId}
        debugHint={debugHint}
        debugSessionId={debugSessionId}
        debugSessionLoading={debugSessionLoading}
        debugSessionDetail={debugSessionDetail}
        agents={agents}
        saveTaskDraftLoading={mutations.saveTaskDraftMutation.isLoading}
        debugStepLoading={mutations.debugStepMutation.isLoading}
        reassignLoading={mutations.reassignMutation.isLoading}
        onClose={() => setDebugDrawerOpen(false)}
        onSwitchTab={setActiveDrawerTab}
        onDebugTitleChange={setDebugTitle}
        onDebugDescriptionChange={setDebugDescription}
        onDebugRuntimeTaskTypeChange={setDebugRuntimeTaskType}
        onDebugAgentIdChange={setDebugAgentId}
        onSaveTaskDraft={() => {
          if (!debugTask) return;
          const nextTitle = debugTitle.trim();
          const nextDescription = debugDescription.trim();
          const originalTitle = String(debugTask.title || '').trim();
          const originalDescription = String(debugTask.description || '').trim();
          mutations.saveTaskDraftMutation.mutate({
            taskId: debugTask._id,
            title: nextTitle && nextTitle !== originalTitle ? nextTitle : undefined,
            description: nextDescription && nextDescription !== originalDescription ? nextDescription : undefined,
            runtimeTaskType:
              debugRuntimeTaskType !== (debugTask.runtimeTaskType || 'auto')
                ? debugRuntimeTaskType
                : undefined,
          });
        }}
        onDebugRun={() => {
          void handleDebugRun();
        }}
      />
    </div>
  );
};

export default Orchestration;
