import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from 'react-query';
import { useNavigate } from 'react-router-dom';
import {
  BeakerIcon,
  ArrowPathIcon,
  ChevronRightIcon,
  ClockIcon,
  EyeIcon,
  PencilSquareIcon,
  PlayIcon,
  PlusIcon,
  SparklesIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { agentService } from '../services/agentService';
import { employeeService } from '../services/employeeService';
import {
  orchestrationService,
  DebugRuntimeTaskTypeOverride,
  OrchestrationPlan,
  OrchestrationRun,
  OrchestrationRunTask,
  OrchestrationTask,
  PlanMode,
} from '../services/orchestrationService';

type DrawerTab = 'debug' | 'session';
type PlanDrawerTab = 'settings' | 'history';

type TaskEditableDraft = {
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  dependencyTaskIds: string[];
};

const STATUS_COLOR: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  drafting: 'bg-amber-100 text-amber-700',
  planned: 'bg-indigo-100 text-indigo-700',
  production: 'bg-emerald-100 text-emerald-700',
  pending: 'bg-gray-100 text-gray-700',
  assigned: 'bg-cyan-100 text-cyan-700',
  in_progress: 'bg-blue-100 text-blue-700',
  blocked: 'bg-orange-100 text-orange-700',
  waiting_human: 'bg-yellow-100 text-yellow-700',
  cancelled: 'bg-zinc-100 text-zinc-700',
};

const RUN_STATUS_COLOR: Record<string, string> = {
  running: 'bg-blue-100 text-blue-700',
  completed: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-rose-100 text-rose-700',
  cancelled: 'bg-zinc-100 text-zinc-700',
};

const RUN_STATUS_LABEL: Record<string, string> = {
  running: '执行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

const TRIGGER_TYPE_LABEL: Record<string, string> = {
  manual: '手动触发',
  schedule: '定时触发',
  autorun: '自动触发',
};

const PLAN_PROMPT_DRAFT_STORAGE_KEY = 'orchestration-plan-prompt-drafts';
const FULLY_EDITABLE_PLAN_STATUS = new Set([
  'draft',
  'drafting',
  'planned',
]);

const DEBUG_RUNTIME_TYPE_OPTIONS: Array<{ value: 'auto' | DebugRuntimeTaskTypeOverride; label: string }> = [
  { value: 'auto', label: '自动判定（不覆盖）' },
  { value: 'general', label: '通用（general）' },
  { value: 'development', label: '开发（development）' },
  { value: 'research', label: '研究（research）' },
  { value: 'review', label: '评审（review）' },
  { value: 'external_action', label: '外部动作（external_action）' },
];

const TASK_RUNTIME_TYPE_LABEL: Record<DebugRuntimeTaskTypeOverride, string> = {
  general: 'general',
  development: 'development',
  research: 'research',
  review: 'review',
  external_action: 'external_action',
};

const formatDateTime = (value?: string) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const formatDuration = (durationMs?: number) => {
  if (!durationMs || durationMs <= 0) {
    return '-';
  }
  const seconds = Math.floor(durationMs / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainSeconds = seconds % 60;
  if (minutes < 60) {
    return `${minutes}m ${remainSeconds}s`;
  }
  const hours = Math.floor(minutes / 60);
  const remainMinutes = minutes % 60;
  return `${hours}h ${remainMinutes}m`;
};

const getRunCompletionPercent = (run?: OrchestrationRun | null) => {
  if (!run?.stats?.totalTasks) {
    return 0;
  }
  return Math.min(100, Math.round((run.stats.completedTasks / run.stats.totalTasks) * 100));
};

const extractErrorMessage = (error: unknown, fallback: string) => {
  const message = (error as any)?.response?.data?.message;
  if (typeof message === 'string' && message.trim()) {
    return message;
  }
  if (Array.isArray(message) && typeof message[0] === 'string' && message[0].trim()) {
    return message[0];
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
};

const normalizeIdList = (values: string[]) => Array.from(new Set(values.filter(Boolean).map((item) => item.trim())));

const normalizeComparableIdList = (values: string[]) => normalizeIdList(values).sort();

const isSameIdList = (left: string[], right: string[]) => {
  const normalizedLeft = normalizeComparableIdList(left);
  const normalizedRight = normalizeComparableIdList(right);
  if (normalizedLeft.length !== normalizedRight.length) {
    return false;
  }
  return normalizedLeft.every((item, index) => item === normalizedRight[index]);
};

const getTaskEditableDraft = (task: OrchestrationTask): TaskEditableDraft => ({
  title: task.title || '',
  description: task.description || '',
  priority: task.priority || 'medium',
  dependencyTaskIds: normalizeIdList(task.dependencyTaskIds || []),
});

const isTaskEditable = (planStatus: string, taskStatus: string) => {
  void taskStatus;
  if (FULLY_EDITABLE_PLAN_STATUS.has(planStatus)) {
    return true;
  }
  return false;
};

const Orchestration: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isDetailDrawerOpen, setIsDetailDrawerOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [title, setTitle] = useState('');
  const [mode, setMode] = useState<PlanMode>('hybrid');
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
  const [runStatusFilter, setRunStatusFilter] = useState<'all' | 'running' | 'completed' | 'failed' | 'cancelled'>('all');
  const [runTriggerFilter, setRunTriggerFilter] = useState<'all' | 'manual' | 'schedule' | 'autorun'>('all');
  const [runDetailDrawerOpen, setRunDetailDrawerOpen] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [promptDrafts, setPromptDrafts] = useState<Record<string, string>>({});
  const [planHint, setPlanHint] = useState('');
  const [taskEdits, setTaskEdits] = useState<Record<string, TaskEditableDraft>>({});
  const [taskHint, setTaskHint] = useState('');
  const [planModeDraft, setPlanModeDraft] = useState<PlanMode>('hybrid');
  const [isAddTaskModalOpen, setIsAddTaskModalOpen] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDescription, setNewTaskDescription] = useState('');
  const [newTaskPriority, setNewTaskPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('medium');
  const [newTaskInsertAfterTaskId, setNewTaskInsertAfterTaskId] = useState('');
  const [dependencyModalTaskId, setDependencyModalTaskId] = useState('');
  const [dependencyModalDraftIds, setDependencyModalDraftIds] = useState<string[]>([]);

  const { data: plans = [], isLoading: plansLoading } = useQuery<OrchestrationPlan[]>(
    'orchestration-plans',
    () => orchestrationService.getPlans(),
    { refetchInterval: 3000 },
  );

  const { data: planDetail, isFetching: planDetailLoading } = useQuery(
    ['orchestration-plan', selectedPlanId],
    () => orchestrationService.getPlanById(selectedPlanId),
    {
      enabled: Boolean(selectedPlanId) && isDetailDrawerOpen,
      refetchInterval: (data) => {
        if (!selectedPlanId || !isDetailDrawerOpen) {
          return false;
        }
        const status = (data as any)?.status as string | undefined;
        if (!status) {
          return false;
        }
        if (status === 'drafting') {
          return 2500;
        }
        if (status === 'planned' || status === 'draft') {
          return false;
        }
        return false;
      },
    },
  );

  const {
    data: planRuns = [],
    isFetching: planRunsLoading,
    error: planRunsError,
  } = useQuery<OrchestrationRun[]>(
    ['orchestration-plan-runs', selectedPlanId],
    () => orchestrationService.getPlanRuns(selectedPlanId, 50),
    {
      enabled: Boolean(selectedPlanId) && isDetailDrawerOpen && activePlanDrawerTab === 'history',
      refetchInterval: (data) => {
        const hasRunning = (data as OrchestrationRun[] | undefined)?.some((item) => item.status === 'running');
        return hasRunning ? 3000 : false;
      },
    },
  );

  const {
    data: latestRun,
    isFetching: latestRunLoading,
  } = useQuery<OrchestrationRun | null>(
    ['orchestration-plan-latest-run', selectedPlanId],
    () => orchestrationService.getPlanLatestRun(selectedPlanId),
    {
      enabled: Boolean(selectedPlanId) && isDetailDrawerOpen && activePlanDrawerTab === 'history',
      refetchInterval: 5000,
    },
  );

  const {
    data: runDetail,
    isFetching: runDetailLoading,
    error: runDetailError,
  } = useQuery<OrchestrationRun>(
    ['orchestration-run-detail', selectedRunId],
    () => orchestrationService.getRunById(selectedRunId),
    {
      enabled: Boolean(selectedRunId) && runDetailDrawerOpen,
      refetchInterval: (data) => ((data as OrchestrationRun | undefined)?.status === 'running' ? 3000 : false),
    },
  );

  const {
    data: runTasks = [],
    isFetching: runTasksLoading,
    error: runTasksError,
  } = useQuery<OrchestrationRunTask[]>(
    ['orchestration-run-tasks', selectedRunId],
    () => orchestrationService.getRunTasks(selectedRunId),
    {
      enabled: Boolean(selectedRunId) && runDetailDrawerOpen,
      refetchInterval: runDetailDrawerOpen ? 3000 : false,
    },
  );

  const debugTask = useMemo(
    () => planDetail?.tasks?.find((task) => task._id === debugTaskId),
    [planDetail?.tasks, debugTaskId],
  );
  const planTasks = planDetail?.tasks ?? [];
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
  const isPlanEditable = useMemo(
    () => Boolean(planDetail?.status && FULLY_EDITABLE_PLAN_STATUS.has(planDetail.status)),
    [planDetail?.status],
  );

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
      .filter(Boolean) as Array<{
      taskId: string;
      title: string;
      description: string;
      priority: 'low' | 'medium' | 'high' | 'urgent';
      dependencyTaskIds: string[];
    }>;
  }, [planTasks, taskEdits]);

  const filteredPlanRuns = useMemo(() => {
    return planRuns.filter((run) => {
      const statusMatched = runStatusFilter === 'all' || run.status === runStatusFilter;
      const triggerMatched = runTriggerFilter === 'all' || run.triggerType === runTriggerFilter;
      return statusMatched && triggerMatched;
    });
  }, [planRuns, runStatusFilter, runTriggerFilter]);

  const latestRunSummary = latestRun ?? planDetail?.lastRun ?? null;

  const { data: debugSessionDetail, isFetching: debugSessionLoading } = useQuery(
    ['orchestration-debug-session', debugSessionId],
    () => orchestrationService.getSessionById(debugSessionId),
    {
      enabled: debugDrawerOpen && Boolean(debugSessionId),
      refetchInterval: debugDrawerOpen && debugSessionId ? 3000 : false,
    },
  );

  const { data: agents = [] } = useQuery('orchestration-agents', () => agentService.getAssignableAgents());
  const { data: employees = [] } = useQuery('orchestration-employees', () => employeeService.getEmployees());

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
    setTaskEdits({});
    setTaskHint('');
    setDependencyModalTaskId('');
    setDependencyModalDraftIds([]);
  }, [selectedPlanId]);

  useEffect(() => {
    setTaskEdits((previous) => {
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

  const createPlanMutation = useMutation(orchestrationService.createPlanFromPrompt, {
    onSuccess: async (created) => {
      setPrompt('');
      setTitle('');
      await queryClient.invalidateQueries('orchestration-plans');
      if (created?._id) {
        setSelectedPlanId(created._id);
        setIsDetailDrawerOpen(false);
        navigate(`/orchestration/plans/${created._id}`);
      }
      setIsCreateModalOpen(false);
    },
  });

  const runPlanMutation = useMutation(
    ({ planId, continueOnFailure }: { planId: string; continueOnFailure: boolean }) =>
      orchestrationService.runPlan(planId, continueOnFailure),
    {
      onSuccess: async (_, vars) => {
        await Promise.all([
          queryClient.invalidateQueries('orchestration-plans'),
          queryClient.invalidateQueries(['orchestration-plan', vars.planId]),
          queryClient.invalidateQueries(['orchestration-plan-runs', vars.planId]),
          queryClient.invalidateQueries(['orchestration-plan-latest-run', vars.planId]),
        ]);
      },
    },
  );

  const savePlanPromptMutation = useMutation(
    ({ planId, sourcePrompt, mode: nextMode }: { planId: string; sourcePrompt: string; mode: PlanMode }) =>
      orchestrationService.updatePlan(planId, { sourcePrompt, mode: nextMode }),
    {
      onSuccess: async (updated) => {
        setPlanHint('计划设置已保存');
        if (updated?._id) {
          setPromptDrafts((prev) => {
            const next = {
              ...prev,
              [updated._id]: updated.sourcePrompt || '',
            };
            window.localStorage.setItem(PLAN_PROMPT_DRAFT_STORAGE_KEY, JSON.stringify(next));
            return next;
          });
        }
        await Promise.all([
          queryClient.invalidateQueries('orchestration-plans'),
          queryClient.invalidateQueries(['orchestration-plan', selectedPlanId]),
        ]);
      },
      onError: () => {
        setPlanHint('保存计划设置失败，请稍后重试');
      },
    },
  );

  const replanPlanMutation = useMutation(
    ({ planId, prompt: nextPrompt }: { planId: string; prompt: string }) =>
      orchestrationService.replanPlan(planId, {
        prompt: nextPrompt,
        mode: planModeDraft,
        plannerAgentId: planDetail?.strategy?.plannerAgentId,
      }),
    {
      onSuccess: async () => {
        setPlanHint('重新编排请求已提交，正在后台处理');
        setDebugDrawerOpen(false);
        setDebugTaskId('');
        setDebugHint('');
        await Promise.all([
          queryClient.invalidateQueries('orchestration-plans'),
          queryClient.invalidateQueries(['orchestration-plan', selectedPlanId]),
        ]);
      },
      onError: (error) => {
        const message = error instanceof Error ? error.message : '重新编排失败，请稍后重试';
        setPlanHint(message);
      },
    },
  );

  const refreshPlanData = async () => {
    await Promise.all([
      queryClient.invalidateQueries('orchestration-plans'),
      queryClient.invalidateQueries(['orchestration-plan', selectedPlanId]),
      queryClient.invalidateQueries(['orchestration-plan-runs', selectedPlanId]),
      queryClient.invalidateQueries(['orchestration-plan-latest-run', selectedPlanId]),
      queryClient.invalidateQueries(['orchestration-run-detail']),
      queryClient.invalidateQueries(['orchestration-run-tasks']),
    ]);
  };

  const retryTaskMutation = useMutation((taskId: string) => orchestrationService.retryTask(taskId), {
    onSuccess: refreshPlanData,
  });

  const saveTaskDraftMutation = useMutation(
    ({
      taskId,
      title: nextTitle,
      description: nextDescription,
      runtimeTaskType,
    }: {
      taskId: string;
      title?: string;
      description?: string;
      runtimeTaskType?: DebugRuntimeTaskTypeOverride | 'auto';
    }) =>
      orchestrationService.updateTaskDraft(taskId, {
        title: nextTitle,
        description: nextDescription,
        runtimeTaskType,
      }),
    {
      onSuccess: async () => {
        setDebugHint('草稿已保存，可继续单步调试');
        await Promise.all([
          queryClient.invalidateQueries('orchestration-plans'),
          queryClient.invalidateQueries(['orchestration-plan', selectedPlanId]),
        ]);
      },
    },
  );

  const debugStepMutation = useMutation(
    ({
      taskId,
      title: nextTitle,
      description: nextDescription,
      runtimeTaskTypeOverride,
    }: {
      taskId: string;
      title?: string;
      description?: string;
      runtimeTaskTypeOverride?: DebugRuntimeTaskTypeOverride;
    }) =>
      orchestrationService.debugTaskStep(taskId, {
        title: nextTitle,
        description: nextDescription,
        resetResult: true,
        runtimeTaskTypeOverride,
      }),
    {
      onSuccess: async (result) => {
        if (result.task?.sessionId) {
          setDebugSessionId(result.task.sessionId);
        }
        setDebugHint(result.execution?.error ? `调试失败：${result.execution.error}` : '单步调试已完成，可继续编辑后重试');
        await Promise.all([
          queryClient.invalidateQueries('orchestration-plans'),
          queryClient.invalidateQueries(['orchestration-plan', selectedPlanId]),
          queryClient.invalidateQueries(['orchestration-debug-session', result.task?.sessionId]),
        ]);
      },
    },
  );

  const deletePlanMutation = useMutation((planId: string) => orchestrationService.deletePlan(planId), {
    onSuccess: async (_, deletedPlanId) => {
      await queryClient.invalidateQueries('orchestration-plans');
      const latestPlans = await orchestrationService.getPlans();
      if (!latestPlans.length) {
        setSelectedPlanId('');
        setIsDetailDrawerOpen(false);
        return;
      }
      const next = latestPlans.find((plan) => plan._id !== deletedPlanId) || latestPlans[0];
      setSelectedPlanId(next._id);
      queryClient.invalidateQueries(['orchestration-plan', next._id]);
    },
  });

  const handleDeletePlan = async (planId: string) => {
    if (!planId) {
      return;
    }

    const ok = window.confirm('确认删除该计划及其任务？此操作不可恢复。');
    if (!ok) {
      return;
    }

    try {
      await deletePlanMutation.mutateAsync(planId);
    } catch (error) {
      alert(extractErrorMessage(error, '删除失败，请稍后重试'));
    }
  };

  const reassignMutation = useMutation(
    ({
      taskId,
      executorType,
      executorId,
    }: {
      taskId: string;
      executorType: 'agent' | 'employee' | 'unassigned';
      executorId?: string;
    }) => orchestrationService.reassignTask(taskId, { executorType, executorId }),
    {
      onSuccess: refreshPlanData,
    },
  );

  const completeHumanTaskMutation = useMutation(
    ({ taskId, summary }: { taskId: string; summary?: string }) =>
      orchestrationService.completeHumanTask(taskId, { summary }),
    {
      onSuccess: refreshPlanData,
    },
  );

  const addTaskMutation = useMutation(
    ({
      planId,
      title,
      description,
      priority,
      insertAfterTaskId,
    }: {
      planId: string;
      title: string;
      description: string;
      priority: 'low' | 'medium' | 'high' | 'urgent';
      insertAfterTaskId?: string;
    }) =>
      orchestrationService.addTaskToPlan(planId, {
        title,
        description,
        priority,
        insertAfterTaskId,
      }),
    {
      onSuccess: async () => {
        setTaskHint('任务已添加');
        setIsAddTaskModalOpen(false);
        setNewTaskTitle('');
        setNewTaskDescription('');
        setNewTaskPriority('medium');
        setNewTaskInsertAfterTaskId('');
        await refreshPlanData();
      },
    },
  );

  const removeTaskMutation = useMutation((taskId: string) => orchestrationService.deleteTask(taskId), {
    onSuccess: async () => {
      setTaskHint('任务已删除');
      await refreshPlanData();
    },
  });

  const duplicateTaskMutation = useMutation(
    ({ planId, taskId }: { planId: string; taskId: string }) => orchestrationService.duplicateTask(planId, taskId),
    {
      onSuccess: async () => {
        setTaskHint('任务已复制');
        await refreshPlanData();
      },
    },
  );

  const reorderTaskMutation = useMutation(
    ({ planId, taskIds }: { planId: string; taskIds: string[] }) => orchestrationService.reorderTasks(planId, taskIds),
    {
      onSuccess: async () => {
        setTaskHint('任务顺序已更新');
        await refreshPlanData();
      },
    },
  );

  const batchUpdateTasksMutation = useMutation(
    ({ planId, updates }: { planId: string; updates: typeof dirtyTaskUpdates }) =>
      orchestrationService.batchUpdateTasks(planId, updates),
    {
      onSuccess: async () => {
        setTaskHint('任务修改已保存');
        setTaskEdits({});
        await refreshPlanData();
      },
    },
  );

  const copyPlanToForm = (plan: OrchestrationPlan) => {
    setTitle(plan.title || '');
    setPrompt(plan.sourcePrompt || '');
    setMode(plan.strategy?.mode || 'hybrid');
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
    if (!runId) {
      return;
    }
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

  const getEffectiveTaskDraft = (task: OrchestrationTask): TaskEditableDraft => {
    return taskEdits[task._id] || getTaskEditableDraft(task);
  };

  const updateTaskDraftField = (
    task: OrchestrationTask,
    patch: Partial<TaskEditableDraft>,
  ) => {
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

  const removeTaskEdit = (taskId: string) => {
    setTaskEdits((previous) => {
      const next = { ...previous };
      delete next[taskId];
      return next;
    });
  };

  const handleMoveTask = (taskId: string, direction: 'up' | 'down') => {
    if (!selectedPlanId || !planTasks.length || reorderTaskMutation.isLoading) {
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
    reorderTaskMutation.mutate({
      planId: selectedPlanId,
      taskIds: nextTaskIds,
    });
  };

  const handleSaveTaskEdits = () => {
    if (!selectedPlanId) {
      return;
    }
    if (!dirtyTaskUpdates.length) {
      setTaskHint('没有待保存的任务改动');
      return;
    }
    batchUpdateTasksMutation.mutate({
      planId: selectedPlanId,
      updates: dirtyTaskUpdates,
    });
  };

  const handleDebugRun = async () => {
    if (!debugTask) {
      return;
    }
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
        await reassignMutation.mutateAsync({
          taskId: debugTask._id,
          executorType: 'agent',
          executorId: targetAgentId,
        });
      }
      const nextTitle = debugTitle.trim();
      const nextDescription = debugDescription.trim();
      const originalTitle = String(debugTask.title || '').trim();
      const originalDescription = String(debugTask.description || '').trim();
      await debugStepMutation.mutateAsync({
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

      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <p className="text-sm font-semibold text-slate-900">Plan 列表</p>
          <p className="text-xs text-slate-500">共 {plans.length} 条</p>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-xs text-slate-600">
              <tr>
                <th className="px-4 py-3 text-left font-medium">计划</th>
                <th className="px-4 py-3 text-left font-medium">状态</th>
                <th className="px-4 py-3 text-left font-medium">模式</th>
                <th className="px-4 py-3 text-left font-medium">进度</th>
                <th className="px-4 py-3 text-left font-medium">更新时间</th>
                <th className="px-4 py-3 text-left font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {plansLoading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-sm text-slate-400">
                    加载中...
                  </td>
                </tr>
              ) : plans.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-400">
                    暂无计划，点击右上角“创建计划”开始。
                  </td>
                </tr>
              ) : (
                plans.map((plan) => (
                  <tr key={plan._id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3 align-top">
                      <p className="font-medium text-slate-900">{plan.title || '未命名计划'}</p>
                      <p className="mt-1 line-clamp-2 text-xs text-slate-500">{plan.sourcePrompt || '-'}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded px-1.5 py-0.5 text-xs ${STATUS_COLOR[plan.status] || STATUS_COLOR.pending}`}>
                        {plan.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{plan.strategy?.mode || '-'}</td>
                    <td className="px-4 py-3 text-slate-700">{plan.stats.completedTasks}/{plan.stats.totalTasks}</td>
                    <td className="px-4 py-3 text-slate-700">{formatDateTime(plan.updatedAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => window.open(`/orchestration/plans/${plan._id}`, '_blank')}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 text-slate-700 hover:bg-slate-100"
                          title="查看详情"
                          aria-label="查看详情"
                        >
                          <EyeIcon className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => {
                            void handleDeletePlan(plan._id);
                          }}
                          disabled={deletePlanMutation.isLoading}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-rose-200 text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                          title="删除计划"
                          aria-label="删除计划"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-2xl rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <p className="text-sm font-semibold text-slate-900">创建编排计划</p>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                aria-label="关闭创建弹窗"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="max-h-[70vh] space-y-3 overflow-y-auto px-4 py-4">
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="计划标题（可选）"
                className="w-full rounded-md border border-slate-300 px-2 py-2 text-sm"
              />
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="输入一句提示词，例如：发布一个 Agent API 网关版本"
                className="min-h-[120px] w-full rounded-md border border-slate-300 px-2 py-2 text-sm"
              />
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <select
                  value={mode}
                  onChange={(event) => setMode(event.target.value as PlanMode)}
                  className="rounded-md border border-slate-300 px-2 py-2 text-sm"
                >
                  <option value="sequential">串行</option>
                  <option value="parallel">并行</option>
                  <option value="hybrid">混合</option>
                </select>
                <select
                  value={plannerAgentId}
                  onChange={(event) => setPlannerAgentId(event.target.value)}
                  className="rounded-md border border-slate-300 px-2 py-2 text-sm"
                >
                  <option value="">默认 Planner</option>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </select>
              </div>
              <label className="inline-flex items-center gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={autoGenerate}
                  onChange={(event) => setAutoGenerate(event.target.checked)}
                />
                创建并生成任务
              </label>
              {createPlanMutation.isError && <p className="text-xs text-rose-600">创建失败，请稍后重试。</p>}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
              >
                取消
              </button>
              <button
                onClick={() =>
                  createPlanMutation.mutate({
                    prompt: prompt.trim(),
                    title: title.trim() || undefined,
                    plannerAgentId: plannerAgentId || undefined,
                    mode,
                    autoGenerate,
                  })
                }
                disabled={!prompt.trim() || createPlanMutation.isLoading}
                className="inline-flex items-center gap-1 rounded-md bg-primary-600 px-3 py-1.5 text-sm text-white disabled:bg-slate-300"
              >
                <SparklesIcon className="h-4 w-4" /> 生成计划
              </button>
            </div>
          </div>
        </div>
      )}

      {isDetailDrawerOpen && (
        <div className="fixed inset-0 z-40">
          <button
            className="absolute inset-0 bg-black/30"
            onClick={() => setIsDetailDrawerOpen(false)}
            aria-label="关闭详情抽屉"
          />
          <aside className="absolute right-0 top-0 h-full w-full max-w-5xl overflow-y-auto bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">{planDetail?.title || '计划详情'}</p>
                <p className="text-xs text-slate-500">mode: {planDetail?.strategy?.mode || '-'}</p>
              </div>
              <button
                onClick={() => setIsDetailDrawerOpen(false)}
                className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                aria-label="关闭抽屉"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3 p-4">
              {!selectedPlanId ? (
                <p className="text-sm text-slate-500">未选择计划。</p>
              ) : planDetailLoading && !planDetail ? (
                <p className="text-sm text-slate-500">加载中...</p>
              ) : !planDetail ? (
                <p className="text-sm text-slate-500">未获取到计划详情。</p>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => {
                        if (!selectedPlanId) return;
                        const nextPrompt = currentPromptDraft.trim();
                        if (!nextPrompt) {
                          setPlanHint('Prompt 不能为空');
                          return;
                        }
                        savePlanPromptMutation.mutate({
                          planId: selectedPlanId,
                          sourcePrompt: nextPrompt,
                          mode: planModeDraft,
                        });
                      }}
                      disabled={!selectedPlanId || savePlanPromptMutation.isLoading}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      <PencilSquareIcon className="h-3.5 w-3.5" /> 保存 Prompt
                    </button>
                    <button
                      onClick={() => {
                        if (!selectedPlanId) return;
                        const nextPrompt = currentPromptDraft.trim();
                        if (!nextPrompt) {
                          setPlanHint('Prompt 不能为空');
                          return;
                        }
                        const ok = window.confirm('确认覆盖当前计划任务并重新编排？旧任务执行轨迹将被替换。');
                        if (!ok) return;
                        replanPlanMutation.mutate({
                          planId: selectedPlanId,
                          prompt: nextPrompt,
                        });
                      }}
                      disabled={!selectedPlanId || replanPlanMutation.isLoading || runPlanMutation.isLoading}
                      className="inline-flex items-center gap-1 rounded-md border border-indigo-200 px-3 py-1.5 text-xs text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
                    >
                      <ArrowPathIcon className="h-3.5 w-3.5" /> 重新编排
                    </button>
                    <button
                      onClick={() => copyPlanToForm(planDetail)}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                    >
                      <PencilSquareIcon className="h-3.5 w-3.5" /> 复制到新建
                    </button>
                    <button
                      onClick={() =>
                        selectedPlanId && runPlanMutation.mutate({ planId: selectedPlanId, continueOnFailure: true })
                      }
                      disabled={!selectedPlanId || runPlanMutation.isLoading}
                      className="inline-flex items-center gap-1 rounded-md border border-cyan-200 px-3 py-1.5 text-xs text-cyan-700 hover:bg-cyan-50 disabled:opacity-50"
                    >
                      <PlayIcon className="h-3.5 w-3.5" /> 运行计划
                    </button>
                    <button
                      onClick={() => {
                        if (!selectedPlanId) return;
                        void handleDeletePlan(selectedPlanId);
                      }}
                      disabled={!selectedPlanId || deletePlanMutation.isLoading}
                      className="inline-flex items-center gap-1 rounded-md border border-rose-200 px-3 py-1.5 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                    >
                      <TrashIcon className="h-3.5 w-3.5" /> 删除计划
                    </button>
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-white p-2">
                    <div className="inline-flex items-center gap-2">
                      <button
                        onClick={() => setActivePlanDrawerTab('settings')}
                        className={`rounded-md px-3 py-1.5 text-xs ${activePlanDrawerTab === 'settings' ? 'bg-primary-100 text-primary-700' : 'text-slate-600 hover:bg-slate-100'}`}
                      >
                        任务设置
                      </button>
                      <button
                        onClick={() => setActivePlanDrawerTab('history')}
                        className={`rounded-md px-3 py-1.5 text-xs ${activePlanDrawerTab === 'history' ? 'bg-primary-100 text-primary-700' : 'text-slate-600 hover:bg-slate-100'}`}
                      >
                        执行历史
                      </button>
                    </div>
                  </div>

                  {activePlanDrawerTab === 'settings' ? (
                    <>
                  <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 text-xs text-slate-700">
                    <p>
                      <span className="font-medium">Planner Agent:</span> {planDetail.strategy?.plannerAgentId || '默认'}
                    </p>
                    <div className="mt-2">
                      <p className="mb-1 font-medium">计划模式</p>
                      <select
                        value={planModeDraft}
                        onChange={(event) => setPlanModeDraft(event.target.value as PlanMode)}
                        className="w-full rounded border border-slate-200 bg-white p-2 text-xs text-slate-700"
                      >
                        <option value="sequential">串行</option>
                        <option value="parallel">并行</option>
                        <option value="hybrid">混合</option>
                      </select>
                    </div>
                    <div className="mt-2">
                      <p className="mb-1 font-medium">Prompt（支持编辑与保持）</p>
                      <textarea
                        value={currentPromptDraft}
                        onChange={(event) => {
                          if (!planDetail?._id) return;
                          updatePromptDraft(planDetail._id, event.target.value);
                          if (planHint) {
                            setPlanHint('');
                          }
                        }}
                        className="min-h-[120px] w-full rounded border border-slate-200 bg-white p-2 text-xs text-slate-600"
                      />
                    </div>
                    {planHint && <p className="mt-2 text-xs text-indigo-700">{planHint}</p>}
                  </div>

                  <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3 text-xs text-slate-700 md:grid-cols-4">
                    <div>总任务: {planDetail.stats?.totalTasks ?? '-'}</div>
                    <div>已完成: {planDetail.stats?.completedTasks ?? '-'}</div>
                    <div>失败: {planDetail.stats?.failedTasks ?? '-'}</div>
                    <div>待人工: {planDetail.stats?.waitingHumanTasks ?? '-'}</div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-slate-700">任务列表</p>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setIsAddTaskModalOpen(true)}
                          disabled={!isPlanEditable || addTaskMutation.isLoading}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                          <PlusIcon className="h-3.5 w-3.5" /> 添加任务
                        </button>
                        <button
                          onClick={handleSaveTaskEdits}
                          disabled={!dirtyTaskUpdates.length || batchUpdateTasksMutation.isLoading}
                          className="inline-flex items-center gap-1 rounded-md border border-indigo-200 px-2 py-1 text-xs text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
                        >
                          <PencilSquareIcon className="h-3.5 w-3.5" />
                          {batchUpdateTasksMutation.isLoading ? '保存中...' : `批量保存(${dirtyTaskUpdates.length})`}
                        </button>
                      </div>
                    </div>
                    {taskHint ? <p className="text-xs text-indigo-700">{taskHint}</p> : null}

                    {planTasks.length === 0 ? (
                      <p className="text-sm text-slate-400">该计划暂无任务</p>
                    ) : (
                      planTasks.map((task) => {
                        const editable = isTaskEditable(planDetail.status, task.status);
                        const draft = getEffectiveTaskDraft(task);
                        const isDirty = dirtyTaskUpdates.some((item) => item.taskId === task._id);
                        return (
                          <div
                            key={task._id}
                            className={`space-y-2 rounded-lg border p-3 ${debugTaskId === task._id ? 'border-primary-300 bg-primary-50/40' : 'border-gray-200'}`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <p className="text-[11px] uppercase tracking-wide text-slate-400">任务 #{task.order + 1}</p>
                                <input
                                  value={draft.title}
                                  onChange={(event) => updateTaskDraftField(task, { title: event.target.value })}
                                  disabled={!editable}
                                  className={`mt-1 w-full rounded border px-2 py-1 text-sm font-medium text-slate-900 ${editable ? 'border-slate-300 bg-white' : 'border-slate-200 bg-slate-50 text-slate-600'}`}
                                />
                                {isDirty ? <p className="mt-1 text-[11px] text-indigo-600">有未保存改动</p> : null}
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span className={`text-xs px-1.5 py-0.5 rounded ${STATUS_COLOR[task.status] || STATUS_COLOR.pending}`}>
                                  {task.status}
                                </span>
                                <span className="text-xs px-1.5 py-0.5 rounded bg-cyan-50 text-cyan-700 border border-cyan-200">
                                  type: {task.runtimeTaskType ? TASK_RUNTIME_TYPE_LABEL[task.runtimeTaskType] : 'auto'}
                                </span>
                                <button
                                  onClick={() => handleMoveTask(task._id, 'up')}
                                  disabled={!editable || reorderTaskMutation.isLoading || task.order <= 0}
                                  className="hidden rounded border border-slate-300 px-1.5 py-0.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                                >
                                  ↑
                                </button>
                                <button
                                  onClick={() => handleMoveTask(task._id, 'down')}
                                  disabled={!editable || reorderTaskMutation.isLoading || task.order >= planTasks.length - 1}
                                  className="hidden rounded border border-slate-300 px-1.5 py-0.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                                >
                                  ↓
                                </button>
                                <button
                                  onClick={() => selectedPlanId && duplicateTaskMutation.mutate({ planId: selectedPlanId, taskId: task._id })}
                                  disabled={!editable || duplicateTaskMutation.isLoading || !selectedPlanId}
                                  className="hidden rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                                >
                                  复制
                                </button>
                                <button
                                  onClick={() => {
                                    const ok = window.confirm('确认删除该任务？依赖此任务的下游任务将自动解除依赖。');
                                    if (!ok) {
                                      return;
                                    }
                                    removeTaskMutation.mutate(task._id);
                                    removeTaskEdit(task._id);
                                  }}
                                  disabled={!editable || removeTaskMutation.isLoading}
                                  className="rounded border border-rose-200 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                                >
                                  删除
                                </button>
                                <button
                                  onClick={() => openDebugDrawer(task._id, 'debug')}
                                  className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-primary-200 text-primary-700 hover:bg-primary-50"
                                >
                                  <BeakerIcon className="h-3.5 w-3.5" /> 调试
                                </button>
                              </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-4 gap-2 items-center">
                              <select
                                value={draft.priority}
                                onChange={(event) =>
                                  updateTaskDraftField(task, {
                                    priority: event.target.value as 'low' | 'medium' | 'high' | 'urgent',
                                  })
                                }
                                disabled={!editable}
                                className="text-xs border border-gray-300 rounded px-2 py-1.5 disabled:bg-slate-50"
                              >
                                <option value="low">low</option>
                                <option value="medium">medium</option>
                                <option value="high">high</option>
                                <option value="urgent">urgent</option>
                              </select>

                              <select
                                value={task.assignment?.executorType || 'unassigned'}
                                onChange={(event) => {
                                  const executorType = event.target.value as 'agent' | 'employee' | 'unassigned';
                                  reassignMutation.mutate({ taskId: task._id, executorType });
                                }}
                                disabled={!editable}
                                className="text-xs border border-gray-300 rounded px-2 py-1.5 disabled:bg-slate-50"
                              >
                                <option value="agent">Agent</option>
                                <option value="employee">Employee</option>
                                <option value="unassigned">Unassigned</option>
                              </select>

                              {task.assignment?.executorType === 'agent' ? (
                                <select
                                  value={task.assignment.executorId || ''}
                                  onChange={(event) =>
                                    reassignMutation.mutate({
                                      taskId: task._id,
                                      executorType: 'agent',
                                      executorId: event.target.value,
                                    })
                                  }
                                  disabled={!editable}
                                  className="text-xs border border-gray-300 rounded px-2 py-1.5 disabled:bg-slate-50"
                                >
                                  <option value="">选择 Agent</option>
                                  {agents.map((agent) => (
                                    <option key={agent.id} value={agent.id}>
                                      {agent.name}
                                    </option>
                                  ))}
                                </select>
                              ) : task.assignment?.executorType === 'employee' ? (
                                <select
                                  value={task.assignment.executorId || ''}
                                  onChange={(event) =>
                                    reassignMutation.mutate({
                                      taskId: task._id,
                                      executorType: 'employee',
                                      executorId: event.target.value,
                                    })
                                  }
                                  disabled={!editable}
                                  className="text-xs border border-gray-300 rounded px-2 py-1.5 disabled:bg-slate-50"
                                >
                                  <option value="">选择员工</option>
                                  {employees.map((employee) => (
                                    <option key={employee.id} value={employee.id}>
                                      {employee.name || employee.id}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <div className="text-xs text-gray-400">未分配执行者</div>
                              )}

                              <div className="flex items-center gap-2 rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs">
                                <button
                                  onClick={() => openDependencyModal(task)}
                                  disabled={!editable}
                                  className="inline-flex shrink-0 items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                                >
                                  依赖
                                </button>
                                <p className="min-w-0 truncate text-[11px] text-slate-500">
                                  {draft.dependencyTaskIds.length
                                    ? `已选 ${draft.dependencyTaskIds.length} 项`
                                    : '无依赖'}
                                </p>
                              </div>
                            </div>

                            <div className="rounded border border-gray-200 bg-gray-50/70 p-2 space-y-2">
                              <p className="text-[11px] font-semibold text-gray-700">任务上下文</p>
                              <textarea
                                value={draft.description}
                                onChange={(event) => updateTaskDraftField(task, { description: event.target.value })}
                                disabled={!editable}
                                className={`min-h-[72px] w-full rounded border px-2 py-1.5 text-xs ${editable ? 'border-slate-300 bg-white text-slate-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}
                              />
                              <p className="text-xs text-gray-600">
                                <span className="font-medium text-gray-700">输出:</span> {task.result?.output || task.result?.summary || '-'}
                              </p>
                              <p className="text-xs text-gray-600">
                                <span className="font-medium text-gray-700">错误:</span> {task.result?.error || '-'}
                              </p>
                              <p className="text-xs text-gray-600 inline-flex items-center gap-1">
                                <span className="font-medium text-gray-700">Session:</span>
                                {task.sessionId ? (
                                  <button
                                    onClick={() => {
                                      openDebugDrawer(task._id, 'session');
                                      setDebugSessionId(task.sessionId || '');
                                    }}
                                    className="inline-flex items-center gap-1 text-primary-700 hover:underline"
                                  >
                                    {task.sessionId}
                                    <ChevronRightIcon className="h-3.5 w-3.5" />
                                  </button>
                                ) : (
                                  <span>-</span>
                                )}
                              </p>
                            </div>

                            <div className="text-right">
                              {task.status === 'waiting_human' && (
                                <button
                                  onClick={() => {
                                    const summary = window.prompt('请输入人工完成说明', '由人工完成') || undefined;
                                    completeHumanTaskMutation.mutate({ taskId: task._id, summary });
                                  }}
                                  className="text-xs px-2 py-1.5 rounded bg-emerald-600 text-white"
                                >
                                  人工完成
                                </button>
                              )}
                              {task.status === 'failed' && (
                                <button
                                  onClick={() => retryTaskMutation.mutate(task._id)}
                                  disabled={retryTaskMutation.isLoading}
                                  className="text-xs px-2 py-1.5 rounded bg-blue-600 text-white disabled:bg-gray-300"
                                >
                                  重试
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                    </>
                  ) : (
                    <div className="space-y-3">
                      <div className="rounded-lg border border-slate-200 bg-white p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold text-slate-900">最近一次执行</p>
                            <p className="mt-1 text-xs text-slate-500">展示最近一次 run 摘要，可展开查看任务级执行明细。</p>
                          </div>
                          {latestRunSummary?._id && (
                            <button
                              onClick={() => openRunDetailDrawer(latestRunSummary._id)}
                              className="inline-flex items-center gap-1 rounded border border-primary-200 px-2 py-1 text-xs text-primary-700 hover:bg-primary-50"
                            >
                              查看详情
                              <ChevronRightIcon className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>

                        {latestRunLoading ? (
                          <p className="mt-2 text-xs text-slate-400">加载最近执行中...</p>
                        ) : !latestRunSummary ? (
                          <p className="mt-2 text-xs text-slate-400">暂无执行记录。</p>
                        ) : (
                          <>
                            <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
                              <div className="rounded border border-slate-200 bg-slate-50 p-2">
                                <p className="text-[11px] text-slate-500">状态</p>
                                <span className={`mt-1 inline-flex rounded px-1.5 py-0.5 text-xs ${RUN_STATUS_COLOR[latestRunSummary.status] || 'bg-slate-100 text-slate-600'}`}>
                                  {RUN_STATUS_LABEL[latestRunSummary.status] || latestRunSummary.status}
                                </span>
                              </div>
                              <div className="rounded border border-slate-200 bg-slate-50 p-2">
                                <p className="text-[11px] text-slate-500">触发来源</p>
                                <p className="mt-1 text-xs text-slate-700">{TRIGGER_TYPE_LABEL[latestRunSummary.triggerType] || latestRunSummary.triggerType}</p>
                              </div>
                              <div className="rounded border border-slate-200 bg-slate-50 p-2">
                                <p className="text-[11px] text-slate-500">开始时间</p>
                                <p className="mt-1 text-xs text-slate-700">{formatDateTime(latestRunSummary.startedAt)}</p>
                              </div>
                              <div className="rounded border border-slate-200 bg-slate-50 p-2">
                                <p className="text-[11px] text-slate-500">耗时</p>
                                <p className="mt-1 text-xs text-slate-700">{formatDuration(latestRunSummary.durationMs)}</p>
                              </div>
                            </div>
                            <div className="mt-2">
                              <div className="mb-1 flex items-center justify-between text-[11px] text-slate-500">
                                <span>完成率</span>
                                <span>{latestRunSummary.stats?.completedTasks || 0}/{latestRunSummary.stats?.totalTasks || 0}</span>
                              </div>
                              <div className="h-2 rounded-full bg-slate-100">
                                <div
                                  className="h-2 rounded-full bg-cyan-500"
                                  style={{ width: `${getRunCompletionPercent(latestRunSummary)}%` }}
                                />
                              </div>
                              {latestRunSummary.error && <p className="mt-2 text-xs text-rose-600">错误：{latestRunSummary.error}</p>}
                            </div>
                          </>
                        )}
                      </div>

                      <div className="rounded-lg border border-slate-200 bg-white p-3">
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-semibold text-slate-900">执行历史</p>
                          <div className="flex items-center gap-2">
                            <select
                              value={runTriggerFilter}
                              onChange={(event) => setRunTriggerFilter(event.target.value as typeof runTriggerFilter)}
                              className="rounded border border-slate-300 px-2 py-1.5 text-xs"
                            >
                              <option value="all">全部触发来源</option>
                              <option value="manual">手动触发</option>
                              <option value="schedule">定时触发</option>
                              <option value="autorun">自动触发</option>
                            </select>
                            <select
                              value={runStatusFilter}
                              onChange={(event) => setRunStatusFilter(event.target.value as typeof runStatusFilter)}
                              className="rounded border border-slate-300 px-2 py-1.5 text-xs"
                            >
                              <option value="all">全部状态</option>
                              <option value="running">执行中</option>
                              <option value="completed">已完成</option>
                              <option value="failed">失败</option>
                              <option value="cancelled">已取消</option>
                            </select>
                          </div>
                        </div>

                        {planRunsLoading ? (
                          <p className="text-xs text-slate-400">加载历史中...</p>
                        ) : planRunsError ? (
                          <p className="text-xs text-rose-600">执行历史加载失败，请稍后重试。</p>
                        ) : filteredPlanRuns.length === 0 ? (
                          <p className="text-xs text-slate-400">当前筛选条件下暂无执行记录。</p>
                        ) : (
                          <div className="space-y-2">
                            {filteredPlanRuns.map((run) => (
                              <div key={run._id} className="rounded border border-slate-200 px-2.5 py-2">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="flex items-center gap-2">
                                    <span className={`inline-flex rounded px-1.5 py-0.5 text-xs ${RUN_STATUS_COLOR[run.status] || 'bg-slate-100 text-slate-600'}`}>
                                      {RUN_STATUS_LABEL[run.status] || run.status}
                                    </span>
                                    <p className="text-xs text-slate-700">{TRIGGER_TYPE_LABEL[run.triggerType] || run.triggerType}</p>
                                    <p className="text-[11px] text-slate-500">{run._id}</p>
                                  </div>
                                  <button
                                    onClick={() => openRunDetailDrawer(run._id)}
                                    className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                                  >
                                    详情
                                    <ChevronRightIcon className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                                  <span>开始：{formatDateTime(run.startedAt)}</span>
                                  <span>耗时：{formatDuration(run.durationMs)}</span>
                                  <span>完成：{run.stats?.completedTasks || 0}/{run.stats?.totalTasks || 0}</span>
                                </div>
                                <p className="mt-1 line-clamp-2 text-xs text-slate-600">{run.summary || '-'}</p>
                                {run.error && <p className="mt-1 text-xs text-rose-600">{run.error}</p>}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </aside>
        </div>
      )}

      {isAddTaskModalOpen && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <p className="text-sm font-semibold text-slate-900">添加任务</p>
              <button
                onClick={() => setIsAddTaskModalOpen(false)}
                className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                aria-label="关闭添加任务弹窗"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-3 px-4 py-4">
              <input
                value={newTaskTitle}
                onChange={(event) => setNewTaskTitle(event.target.value)}
                placeholder="任务标题"
                className="w-full rounded-md border border-slate-300 px-2 py-2 text-sm"
              />
              <textarea
                value={newTaskDescription}
                onChange={(event) => setNewTaskDescription(event.target.value)}
                placeholder="任务描述"
                className="min-h-[120px] w-full rounded-md border border-slate-300 px-2 py-2 text-sm"
              />
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <select
                  value={newTaskPriority}
                  onChange={(event) => setNewTaskPriority(event.target.value as 'low' | 'medium' | 'high' | 'urgent')}
                  className="rounded-md border border-slate-300 px-2 py-2 text-sm"
                >
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                  <option value="urgent">urgent</option>
                </select>
                <select
                  value={newTaskInsertAfterTaskId}
                  onChange={(event) => setNewTaskInsertAfterTaskId(event.target.value)}
                  className="rounded-md border border-slate-300 px-2 py-2 text-sm"
                >
                  <option value="">追加到末尾</option>
                  {planTasks.map((task) => (
                    <option key={task._id} value={task._id}>
                      在 #{task.order + 1} 后插入
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
              <button
                onClick={() => setIsAddTaskModalOpen(false)}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
              >
                取消
              </button>
              <button
                onClick={() => {
                  if (!selectedPlanId) return;
                  const title = newTaskTitle.trim();
                  const description = newTaskDescription.trim();
                  if (!title || !description) {
                    setTaskHint('任务标题和描述不能为空');
                    return;
                  }
                  addTaskMutation.mutate({
                    planId: selectedPlanId,
                    title,
                    description,
                    priority: newTaskPriority,
                    insertAfterTaskId: newTaskInsertAfterTaskId || undefined,
                  });
                }}
                disabled={addTaskMutation.isLoading}
                className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700 disabled:bg-slate-300"
              >
                <PlusIcon className="h-4 w-4" /> {addTaskMutation.isLoading ? '添加中...' : '确认添加'}
              </button>
            </div>
          </div>
        </div>
      )}

      {dependencyModalTask && (
        <div className="fixed inset-0 z-[96] flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-xl rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">设置任务依赖</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  #{dependencyModalTask.order + 1} {dependencyModalTask.title || '未命名任务'}
                </p>
              </div>
              <button
                onClick={closeDependencyModal}
                className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                aria-label="关闭依赖设置弹窗"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3 px-4 py-4">
              <div className="max-h-72 space-y-2 overflow-y-auto rounded-md border border-slate-200 p-3">
                {dependencyModalCandidates.length === 0 ? (
                  <p className="text-xs text-slate-500">暂无可依赖任务，请先新增其他任务。</p>
                ) : (
                  dependencyModalCandidates.map((candidate) => (
                    <label
                      key={candidate._id}
                      className="flex cursor-pointer items-start gap-2 rounded border border-slate-200 px-2 py-1.5 hover:bg-slate-50"
                    >
                      <input
                        type="checkbox"
                        checked={dependencyModalDraftIds.includes(candidate._id)}
                        onChange={() => toggleDependencyDraftId(candidate._id)}
                        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                      />
                      <span className="text-xs text-slate-700">#{candidate.order + 1} {candidate.title || '未命名任务'}</span>
                    </label>
                  ))
                )}
              </div>
              <p className="text-xs text-slate-500">已选择 {dependencyModalDraftIds.length} 项依赖</p>
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-slate-200 px-4 py-3">
              <button
                onClick={() => setDependencyModalDraftIds([])}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
              >
                清空依赖
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={closeDependencyModal}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                >
                  取消
                </button>
                <button
                  onClick={applyDependencyDraft}
                  className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700"
                >
                  确认
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {runDetailDrawerOpen && (
        <div className="fixed inset-0 z-[91]">
          <button
            className="absolute inset-0 bg-black/30"
            onClick={() => setRunDetailDrawerOpen(false)}
            aria-label="关闭 run 详情抽屉"
          />
          <aside className="absolute right-0 top-0 h-full w-full border-l border-slate-200 bg-white shadow-2xl sm:w-[92vw] lg:w-[56vw]">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">Run 执行详情</p>
                <p className="mt-0.5 text-xs text-slate-500">{selectedRunId || '-'}</p>
              </div>
              <button
                onClick={() => setRunDetailDrawerOpen(false)}
                className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="h-[calc(100%-61px)] space-y-4 overflow-y-auto p-4">
              {runDetailLoading && !runDetail ? (
                <p className="text-sm text-slate-400">加载 run 详情中...</p>
              ) : runDetailError ? (
                <p className="text-sm text-rose-600">获取 run 详情失败，请稍后重试。</p>
              ) : !runDetail ? (
                <p className="text-sm text-slate-400">未查询到 run 详情。</p>
              ) : (
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    <p className="text-xs text-slate-600">
                      状态：
                      <span className={`ml-1 inline-flex rounded px-1.5 py-0.5 text-xs ${RUN_STATUS_COLOR[runDetail.status] || 'bg-slate-100 text-slate-600'}`}>
                        {RUN_STATUS_LABEL[runDetail.status] || runDetail.status}
                      </span>
                    </p>
                    <p className="text-xs text-slate-600">触发来源：{TRIGGER_TYPE_LABEL[runDetail.triggerType] || runDetail.triggerType}</p>
                    <p className="text-xs text-slate-600">开始时间：{formatDateTime(runDetail.startedAt)}</p>
                    <p className="text-xs text-slate-600">完成时间：{formatDateTime(runDetail.completedAt)}</p>
                    <p className="text-xs text-slate-600">耗时：{formatDuration(runDetail.durationMs)}</p>
                    <p className="text-xs text-slate-600">统计：{runDetail.stats?.completedTasks || 0}/{runDetail.stats?.totalTasks || 0}（失败 {runDetail.stats?.failedTasks || 0}）</p>
                  </div>
                  <p className="mt-2 text-xs text-slate-600">摘要：{runDetail.summary || '-'}</p>
                  {runDetail.error && <p className="mt-1 text-xs text-rose-600">错误：{runDetail.error}</p>}
                </div>
              )}

              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <p className="mb-2 text-sm font-semibold text-slate-900">任务执行明细</p>
                {runTasksLoading && !runTasks.length ? (
                  <p className="text-xs text-slate-400">加载任务明细中...</p>
                ) : runTasksError ? (
                  <p className="text-xs text-rose-600">加载任务明细失败，请稍后重试。</p>
                ) : runTasks.length === 0 ? (
                  <p className="text-xs text-slate-400">该次执行暂无任务明细。</p>
                ) : (
                  <div className="space-y-2">
                    {runTasks.map((task) => (
                      <div key={task._id} className="rounded border border-slate-200 px-3 py-2">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-xs font-medium text-slate-800">#{task.order + 1} {task.title || '未命名任务'}</p>
                            <p className="mt-0.5 text-[11px] text-slate-500">执行者：{task.assignment?.executorType || 'unassigned'}{task.assignment?.executorId ? `:${task.assignment.executorId}` : ''}</p>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className={`inline-flex rounded px-1.5 py-0.5 text-xs ${STATUS_COLOR[task.status] || STATUS_COLOR.pending}`}>
                              {task.status}
                            </span>
                            <span className="inline-flex rounded border border-cyan-200 bg-cyan-50 px-1.5 py-0.5 text-xs text-cyan-700">
                              type: {task.runtimeTaskType ? TASK_RUNTIME_TYPE_LABEL[task.runtimeTaskType] : 'auto'}
                            </span>
                          </div>
                        </div>
                        <p className="mt-1 whitespace-pre-wrap text-xs text-slate-600">{task.result?.summary || task.result?.output || '-'}</p>
                        {task.result?.error && <p className="mt-1 text-xs text-rose-600">{task.result.error}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </aside>
        </div>
      )}

          {debugDrawerOpen && (
            <div className="fixed inset-0 z-[90]">
              <div className="absolute inset-0 bg-black/25" onClick={() => setDebugDrawerOpen(false)} />
              <aside className="absolute right-0 top-0 h-full w-full bg-white shadow-2xl sm:w-[92vw] lg:w-[56vw] border-l border-gray-200 flex flex-col">
                <div className="px-4 py-3 border-b border-gray-200 flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">单步调试抽屉</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {debugTask ? `Step #${debugTask.order + 1} · ${debugTask.status}` : '请选择任务后再调试'}
                    </p>
                  </div>
                  <button
                    onClick={() => setDebugDrawerOpen(false)}
                    className="p-1 rounded hover:bg-gray-100 text-gray-500"
                  >
                    <XMarkIcon className="h-5 w-5" />
                  </button>
                </div>

                <div className="px-4 py-2 border-b border-gray-200 inline-flex gap-2">
                  <button
                    onClick={() => setActiveDrawerTab('debug')}
                    className={`px-3 py-1.5 text-xs rounded ${activeDrawerTab === 'debug' ? 'bg-primary-100 text-primary-700' : 'text-gray-600 hover:bg-gray-100'}`}
                  >
                    调试
                  </button>
                  <button
                    onClick={() => setActiveDrawerTab('session')}
                    className={`px-3 py-1.5 text-xs rounded ${activeDrawerTab === 'session' ? 'bg-primary-100 text-primary-700' : 'text-gray-600 hover:bg-gray-100'}`}
                  >
                    Session
                  </button>
                </div>

                {!debugTask ? (
                  <div className="flex-1 p-4 text-sm text-gray-500">当前计划中未找到该任务，请重新选择。</div>
                ) : (
                  <>
                    {activeDrawerTab === 'debug' ? (
                      <>
                        <div className="p-4 border-b border-gray-200 space-y-3">
                          <div className="grid grid-cols-1 gap-2">
                            <label className="text-xs text-gray-600">执行 Agent</label>
                            <select
                              value={debugAgentId}
                              onChange={(event) => setDebugAgentId(event.target.value)}
                              className="w-full text-sm border border-gray-300 rounded px-2 py-1.5"
                            >
                              <option value="">请选择 Agent</option>
                              {agents.map((agent) => (
                                <option key={agent.id} value={agent.id}>
                                  {agent.name}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="grid grid-cols-1 gap-2">
                            <label className="text-xs text-gray-600">任务标题</label>
                            <input
                              value={debugTitle}
                              onChange={(event) => setDebugTitle(event.target.value)}
                              className="w-full text-sm border border-gray-300 rounded px-2 py-1.5"
                            />
                          </div>
                          <div className="grid grid-cols-1 gap-2">
                            <label className="text-xs text-gray-600">任务描述（可编辑后反复调试）</label>
                            <textarea
                              value={debugDescription}
                              onChange={(event) => setDebugDescription(event.target.value)}
                              className="w-full min-h-[120px] text-sm border border-gray-300 rounded px-2 py-1.5"
                            />
                          </div>
                          <div className="grid grid-cols-1 gap-2">
                            <label className="text-xs text-gray-600">任务类型（可保存）</label>
                            <select
                              value={debugRuntimeTaskType}
                              onChange={(event) => setDebugRuntimeTaskType(event.target.value as 'auto' | DebugRuntimeTaskTypeOverride)}
                              className="w-full text-sm border border-gray-300 rounded px-2 py-1.5"
                            >
                              {DEBUG_RUNTIME_TYPE_OPTIONS.map((item) => (
                                <option key={item.value} value={item.value}>{item.label}</option>
                              ))}
                            </select>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              onClick={() => {
                                const nextTitle = debugTitle.trim();
                                const nextDescription = debugDescription.trim();
                                const originalTitle = String(debugTask.title || '').trim();
                                const originalDescription = String(debugTask.description || '').trim();
                                saveTaskDraftMutation.mutate({
                                  taskId: debugTask._id,
                                  title: nextTitle && nextTitle !== originalTitle ? nextTitle : undefined,
                                  description: nextDescription && nextDescription !== originalDescription ? nextDescription : undefined,
                                  runtimeTaskType:
                                    debugRuntimeTaskType !== (debugTask.runtimeTaskType || 'auto')
                                      ? debugRuntimeTaskType
                                      : undefined,
                                });
                              }}
                              disabled={saveTaskDraftMutation.isLoading}
                              className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
                            >
                              <PencilSquareIcon className="h-4 w-4" /> 保存草稿
                            </button>
                            <button
                              onClick={handleDebugRun}
                              disabled={debugStepMutation.isLoading || reassignMutation.isLoading}
                              className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded bg-gray-900 text-white disabled:bg-gray-300"
                            >
                              <PlayIcon className="h-4 w-4" /> 执行当前 Step
                            </button>
                          </div>
                          {debugHint && <p className="text-xs text-primary-700">{debugHint}</p>}
                        </div>

                        <div className="flex-1 overflow-y-auto p-4 space-y-4">
                          <section className="space-y-2">
                            <p className="text-xs font-semibold text-gray-700">运行日志</p>
                            {!debugTask.runLogs?.length ? (
                              <p className="text-xs text-gray-400">暂无日志</p>
                            ) : (
                              <div className="space-y-1">
                                {debugTask.runLogs.slice(-10).reverse().map((log, index) => (
                                  <div key={`${log.timestamp}-${index}`} className="rounded border border-gray-200 px-2 py-1.5">
                                    <p className="text-[11px] text-gray-500 inline-flex items-center gap-1">
                                      <ClockIcon className="h-3 w-3" /> {formatDateTime(log.timestamp)} · {log.level}
                                    </p>
                                    <p className="text-xs text-gray-700 mt-0.5">{log.message}</p>
                                  </div>
                                ))}
                              </div>
                            )}
                          </section>
                        </div>
                      </>
                    ) : (
                      <div className="flex-1 overflow-y-auto p-4 space-y-4">
                        <section className="space-y-2">
                          <p className="text-xs font-semibold text-gray-700">Session 信息</p>
                          {!debugSessionId ? (
                            <p className="text-xs text-gray-400">该任务尚未产生 session</p>
                          ) : debugSessionLoading ? (
                            <p className="text-xs text-gray-400">加载 session 中...</p>
                          ) : !debugSessionDetail ? (
                            <p className="text-xs text-gray-400">未查询到 session 详情</p>
                          ) : (
                            <div className="rounded border border-gray-200 p-3 space-y-2">
                              <p className="text-xs text-gray-600">ID: {debugSessionDetail._id}</p>
                              <p className="text-xs text-gray-600">Owner: {debugSessionDetail.ownerType} / {debugSessionDetail.ownerId}</p>
                              <p className="text-xs text-gray-600">状态: {debugSessionDetail.status}</p>
                              <p className="text-xs text-gray-600">更新时间: {formatDateTime(debugSessionDetail.updatedAt)}</p>
                              <div className="border-t border-gray-200 pt-2 space-y-1">
                                <p className="text-xs font-medium text-gray-700">最近消息</p>
                                {(debugSessionDetail.messages || []).slice(-5).reverse().map((message, index) => (
                                  <div key={`${message.timestamp}-${index}`} className="bg-gray-50 rounded px-2 py-1.5">
                                    <p className="text-[11px] text-gray-500">
                                      {message.role} · {formatDateTime(message.timestamp)}
                                    </p>
                                    <p className="text-xs text-gray-700 whitespace-pre-wrap line-clamp-3">{message.content}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </section>
                      </div>
                    )}
                  </>
                )}
              </aside>
            </div>
          )}
      </div>
  );
};

export default Orchestration;
