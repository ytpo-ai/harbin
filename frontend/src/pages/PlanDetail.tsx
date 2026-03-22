import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from 'react-query';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  BeakerIcon,
  ChevronRightIcon,
  ClockIcon,
  DocumentDuplicateIcon,
  PencilSquareIcon,
  PlayIcon,
  PlusIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { agentService } from '../services/agentService';
import { employeeService } from '../services/employeeService';
import {
  DebugRuntimeTaskTypeOverride,
  orchestrationService,
  OrchestrationRun,
  OrchestrationRunTask,
  OrchestrationTask,
  OrchestrationPlan,
  PlanMode,
} from '../services/orchestrationService';

type DrawerTab = 'debug' | 'session';
type PlanDetailTab = 'settings' | 'history';

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
  running: 'bg-blue-100 text-blue-700',
  paused: 'bg-amber-100 text-amber-700',
  completed: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-rose-100 text-rose-700',
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

const STREAMING_PLAN_STATUS = new Set(['drafting']);
const FULLY_EDITABLE_PLAN_STATUS = new Set(['draft', 'planned']);

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

const formatExecutor = (task: OrchestrationTask) => {
  const executorType = task.assignment?.executorType || 'unassigned';
  const executorId = task.assignment?.executorId;
  if (executorType === 'unassigned') return 'unassigned';
  return executorId ? `${executorType}:${executorId}` : executorType;
};

const buildPlanTasksMarkdown = (plan: OrchestrationPlan) => {
  const tasks = plan.tasks || [];
  const taskTitleById = new Map(tasks.map((task) => [task._id, `#${task.order + 1} ${task.title || '未命名任务'}`]));
  const lines: string[] = [];

  lines.push(`# 计划任务清单：${plan.title || '未命名计划'}`);
  lines.push('');
  lines.push(`- 计划 ID: ${plan._id}`);
  lines.push(`- 计划状态: ${plan.status}`);
  lines.push(`- 编排模式: ${plan.strategy?.mode || '-'}`);
  lines.push(`- Planner: ${plan.strategy?.plannerAgentId || '默认'}`);
  lines.push(`- 更新时间: ${formatDateTime(plan.updatedAt)}`);
  lines.push('');
  lines.push('## Prompt');
  lines.push('');
  lines.push(plan.sourcePrompt || '-');
  lines.push('');
  lines.push('## 任务列表');
  lines.push('');

  if (!tasks.length) {
    lines.push('_暂无任务_');
    return lines.join('\n');
  }

  for (const task of tasks) {
    const dependencies = (task.dependencyTaskIds || [])
      .map((dependencyId) => taskTitleById.get(dependencyId) || dependencyId)
      .join(', ');
    lines.push(`### ${task.order + 1}. ${task.title || '未命名任务'}`);
    lines.push(`- 状态: ${task.status}`);
    lines.push(`- 优先级: ${task.priority}`);
    lines.push(`- 执行者: ${formatExecutor(task)}`);
    lines.push(`- 依赖: ${dependencies || '无'}`);
    lines.push(`- 描述: ${task.description || '-'}`);
    lines.push(`- 输出: ${task.result?.output || task.result?.summary || '-'}`);
    lines.push(`- 错误: ${task.result?.error || '-'}`);
    lines.push('');
  }

  return lines.join('\n');
};

const PlanDetail: React.FC = () => {
  const { id: planId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [promptDraft, setPromptDraft] = useState('');
  const [modeDraft, setModeDraft] = useState<PlanMode>('hybrid');
  const [promptHint, setPromptHint] = useState('');
  const [isReplanModalOpen, setIsReplanModalOpen] = useState(false);
  const [replanPlannerAgentId, setReplanPlannerAgentId] = useState('');
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
  const [runStatusFilter, setRunStatusFilter] = useState<'all' | 'running' | 'completed' | 'failed' | 'cancelled'>('all');
  const [runTriggerFilter, setRunTriggerFilter] = useState<'all' | 'manual' | 'schedule' | 'autorun'>('all');
  const [runDrawerOpen, setRunDrawerOpen] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [streamHint, setStreamHint] = useState('');
  const [streamConnected, setStreamConnected] = useState(false);
  const [streamTaskIds, setStreamTaskIds] = useState<string[]>([]);
  const [taskEdits, setTaskEdits] = useState<Record<string, TaskEditableDraft>>({});
  const [taskHint, setTaskHint] = useState('');
  const [isAddTaskModalOpen, setIsAddTaskModalOpen] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDescription, setNewTaskDescription] = useState('');
  const [newTaskPriority, setNewTaskPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('medium');
  const [newTaskInsertAfterTaskId, setNewTaskInsertAfterTaskId] = useState('');
  const [dependencyModalTaskId, setDependencyModalTaskId] = useState('');
  const [dependencyModalDraftIds, setDependencyModalDraftIds] = useState<string[]>([]);

  const { data: planDetail, isLoading: planLoading, error: planError } = useQuery<OrchestrationPlan>(
    ['orchestration-plan', planId],
    () => orchestrationService.getPlanById(planId!),
    {
      enabled: Boolean(planId),
      refetchInterval: (data) => {
        if (!planId) return false;
        if (isReplanPending) return 2000;
        const status = (data as any)?.status as string | undefined;
        if (!status) return false;
        if (STREAMING_PLAN_STATUS.has(status)) return 2500;
        if (status === 'planned' || status === 'draft') return false;
        return false;
      },
    },
  );

  const {
    data: planRuns = [],
    isFetching: planRunsLoading,
    error: planRunsError,
  } = useQuery<OrchestrationRun[]>(
    ['orchestration-plan-runs', planId],
    () => orchestrationService.getPlanRuns(planId!, 50),
    {
      enabled: Boolean(planId) && activeTab === 'history',
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
    ['orchestration-plan-latest-run', planId],
    () => orchestrationService.getPlanLatestRun(planId!),
    {
      enabled: Boolean(planId) && activeTab === 'history',
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
      enabled: Boolean(selectedRunId) && runDrawerOpen,
      refetchInterval: (data) => {
        const status = (data as OrchestrationRun | undefined)?.status;
        return status === 'running' ? 3000 : false;
      },
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
      enabled: Boolean(selectedRunId) && runDrawerOpen,
      refetchInterval: runDrawerOpen ? 3000 : false,
    },
  );

  useEffect(() => {
    if (!planId) {
      return;
    }

    let disposed = false;
    const unsubscribe = orchestrationService.subscribePlanEvents(planId, {
      onEvent: (event) => {
        if (disposed || !event?.type) {
          return;
        }
        setStreamConnected(true);
        if (event.type === 'plan.task.generated') {
          const generatedTaskId = String((event.data?.task?._id || '')).trim();
          if (generatedTaskId) {
            setStreamTaskIds((prev) => (prev.includes(generatedTaskId) ? prev : [...prev, generatedTaskId]));
          }
          setStreamHint(`正在生成任务 (${event.data?.index || 0}/${event.data?.total || '-'})`);
          if (isReplanPending) {
            setPromptHint(`重新编排任务生成中 (${event.data?.index || 0}/${event.data?.total || '-'})`);
          }
          void queryClient.invalidateQueries(['orchestration-plan', planId]);
          return;
        }
        if (event.type === 'plan.completed') {
          setStreamHint('任务生成完成');
          if (isReplanPending) {
            setIsReplanPending(false);
            setPromptHint('重新编排已完成，任务结构已覆盖更新');
          }
          void Promise.all([
            queryClient.invalidateQueries('orchestration-plans'),
            queryClient.invalidateQueries(['orchestration-plan', planId]),
          ]);
          return;
        }
        if (event.type === 'plan.failed') {
          setStreamHint(`任务生成失败: ${event.data?.error || 'unknown error'}`);
          if (isReplanPending) {
            setIsReplanPending(false);
            setPromptHint(`重新编排失败：${event.data?.error || 'unknown error'}`);
          }
          void queryClient.invalidateQueries(['orchestration-plan', planId]);
          return;
        }
        if (event.type === 'plan.status.changed' && event.data?.status === 'drafting') {
          setStreamHint('任务生成中...');
          if (isReplanPending) {
            setPromptHint('重新编排中：已清空旧任务，正在流式生成新任务...');
          }
        }
      },
      onError: () => {
        if (disposed) {
          return;
        }
        setStreamConnected(false);
      },
    });

    return () => {
      disposed = true;
      setStreamConnected(false);
      unsubscribe();
    };
  }, [isReplanPending, planId, queryClient]);

  const { data: agents = [] } = useQuery('plan-detail-agents', () => agentService.getAssignableAgents());
  const { data: employees = [] } = useQuery('plan-detail-employees', () => employeeService.getEmployees());

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

  useEffect(() => {
    if (planDetail?._id) {
      setPromptDraft(planDetail.sourcePrompt || '');
      setModeDraft(planDetail.strategy?.mode || 'hybrid');
    }
  }, [planDetail?._id, planDetail?.sourcePrompt, planDetail?.strategy?.mode]);

  useEffect(() => {
    if (!debugTask) return;
    setDebugTitle(debugTask.title || '');
    setDebugDescription(debugTask.description || '');
    setDebugRuntimeTaskType(debugTask.runtimeTaskType || 'auto');
    setDebugSessionId(debugTask.sessionId || '');
    const taskAgentId =
      debugTask.assignment?.executorType === 'agent' && debugTask.assignment?.executorId
        ? debugTask.assignment.executorId
        : '';
    setDebugAgentId(taskAgentId || agents[0]?.id || '');
  }, [debugTask, agents]);

  useEffect(() => {
    setDebugDrawerOpen(false);
    setRunDrawerOpen(false);
    setSelectedRunId('');
    setActiveTab('settings');
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
    setStreamHint('');
    setStreamTaskIds([]);
    setTaskEdits({});
    setTaskHint('');
    setDependencyModalTaskId('');
    setDependencyModalDraftIds([]);
  }, [planId]);

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

  const refreshPlanData = async () => {
    await Promise.all([
      queryClient.invalidateQueries('orchestration-plans'),
      queryClient.invalidateQueries(['orchestration-plan', planId]),
      queryClient.invalidateQueries(['orchestration-plan-runs', planId]),
      queryClient.invalidateQueries(['orchestration-plan-latest-run', planId]),
      queryClient.invalidateQueries(['orchestration-run-detail']),
      queryClient.invalidateQueries(['orchestration-run-tasks']),
    ]);
  };

  const savePlanPromptMutation = useMutation(
    ({ planId, sourcePrompt, mode: nextMode }: { planId: string; sourcePrompt: string; mode: PlanMode }) =>
      orchestrationService.updatePlan(planId, { sourcePrompt, mode: nextMode }),
    {
      onSuccess: async () => {
        setPromptHint('计划设置已保存');
        await Promise.all([
          queryClient.invalidateQueries('orchestration-plans'),
          queryClient.invalidateQueries(['orchestration-plan', planId]),
        ]);
      },
      onError: () => {
        setPromptHint('保存计划设置失败，请稍后重试');
      },
    },
  );

  const runPlanMutation = useMutation(
    ({ planId, continueOnFailure }: { planId: string; continueOnFailure: boolean }) =>
      orchestrationService.runPlan(planId, continueOnFailure),
    {
      onSuccess: async () => {
        await Promise.all([
          queryClient.invalidateQueries('orchestration-plans'),
          queryClient.invalidateQueries(['orchestration-plan', planId]),
          queryClient.invalidateQueries(['orchestration-plan-runs', planId]),
          queryClient.invalidateQueries(['orchestration-plan-latest-run', planId]),
        ]);
      },
    },
  );

  const replanPlanMutation = useMutation(
    ({
      planId,
      prompt: nextPrompt,
      plannerAgentId,
    }: {
      planId: string;
      prompt: string;
      plannerAgentId?: string;
    }) =>
      orchestrationService.replanPlan(planId, {
        prompt: nextPrompt,
        mode: modeDraft,
        plannerAgentId,
      }),
    {
      onMutate: () => {
        setIsReplanModalOpen(false);
        setPromptHint('正在重新编排：正在清空旧任务...');
        setIsReplanPending(true);
        setLastAsyncReplanError(String(planDetail?.metadata?.asyncReplanError || ''));
        setStreamTaskIds([]);
        setStreamHint('重新编排已启动，等待新任务流式返回...');
        queryClient.setQueryData(['orchestration-plan', planId], (prev: any) => {
          if (!prev) {
            return prev;
          }
          return {
            ...prev,
            status: 'drafting',
            taskIds: [],
            tasks: [],
            stats: {
              ...(prev.stats || {}),
              totalTasks: 0,
              completedTasks: 0,
              failedTasks: 0,
              waitingHumanTasks: 0,
            },
          };
        });
        void queryClient.invalidateQueries(['orchestration-plan', planId]);
      },
      onSuccess: async () => {
        setPromptHint('重新编排任务已提交，正在后台处理中...');
        setDebugDrawerOpen(false);
        setDebugTaskId('');
        setDebugHint('');
        await queryClient.invalidateQueries(['orchestration-plan', planId]);
      },
      onError: (error) => {
        setIsReplanPending(false);
        const message = error instanceof Error ? error.message : '重新编排失败，请稍后重试';
        setPromptHint(message);
      },
    },
  );

  useEffect(() => {
    if (!isReplanPending || !planDetail) return;

    const currentAsyncError = String(planDetail.metadata?.asyncReplanError || '');
    if (currentAsyncError && currentAsyncError !== lastAsyncReplanError) {
      setIsReplanPending(false);
      setPromptHint(`重新编排失败：${currentAsyncError}`);
      return;
    }

    if (planDetail.status === 'planned') {
      setIsReplanPending(false);
      setPromptHint('重新编排已完成，任务结构已覆盖更新');
      Promise.all([
        queryClient.invalidateQueries('orchestration-plans'),
        queryClient.invalidateQueries(['orchestration-plan', planId]),
      ]);
      return;
    }

    if (planDetail.status === 'drafting' && (planDetail.stats?.totalTasks || 0) === 0) {
      setPromptHint('重新编排中：旧任务已删除，等待新任务生成...');
    }
  }, [
    isReplanPending,
    lastAsyncReplanError,
    planDetail,
    planId,
    queryClient,
  ]);

  const retryTaskMutation = useMutation((taskId: string) => orchestrationService.retryTask(taskId), {
    onSuccess: refreshPlanData,
  });

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
      planId: targetPlanId,
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
      orchestrationService.addTaskToPlan(targetPlanId, {
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
    ({ targetPlanId, taskId }: { targetPlanId: string; taskId: string }) =>
      orchestrationService.duplicateTask(targetPlanId, taskId),
    {
      onSuccess: async () => {
        setTaskHint('任务已复制');
        await refreshPlanData();
      },
    },
  );

  const reorderTaskMutation = useMutation(
    ({ targetPlanId, taskIds }: { targetPlanId: string; taskIds: string[] }) =>
      orchestrationService.reorderTasks(targetPlanId, taskIds),
    {
      onSuccess: async () => {
        setTaskHint('任务顺序已更新');
        await refreshPlanData();
      },
    },
  );

  const batchUpdateTasksMutation = useMutation(
    ({ targetPlanId, updates }: { targetPlanId: string; updates: typeof dirtyTaskUpdates }) =>
      orchestrationService.batchUpdateTasks(targetPlanId, updates),
    {
      onSuccess: async () => {
        setTaskHint('任务修改已保存');
        setTaskEdits({});
        await refreshPlanData();
      },
    },
  );

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
          queryClient.invalidateQueries(['orchestration-plan', planId]),
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
          queryClient.invalidateQueries(['orchestration-plan', planId]),
          queryClient.invalidateQueries(['orchestration-debug-session', result.task?.sessionId]),
        ]);
      },
    },
  );

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

  const handleCopyPlanTasksMarkdown = async () => {
    if (!planDetail) return;
    const markdown = buildPlanTasksMarkdown(planDetail);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(markdown);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = markdown;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setPromptHint('已复制到剪贴板');
    } catch {
      setPromptHint('复制失败，请稍后重试');
    }
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
    if (!planId || !planTasks.length || reorderTaskMutation.isLoading) {
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
      targetPlanId: planId,
      taskIds: nextTaskIds,
    });
  };

  const handleSaveTaskEdits = () => {
    if (!planId) {
      return;
    }
    if (!dirtyTaskUpdates.length) {
      setTaskHint('没有待保存的任务改动');
      return;
    }
    batchUpdateTasksMutation.mutate({
      targetPlanId: planId,
      updates: dirtyTaskUpdates,
    });
  };

  if (planLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-slate-500">加载中...</p>
      </div>
    );
  }

  if (planError || !planDetail) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <p className="text-rose-600">获取计划详情失败</p>
        <button
          onClick={() => navigate('/orchestration')}
          className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
        >
          <ArrowLeftIcon className="h-4 w-4" /> 返回计划列表
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-4 py-3">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/orchestration')}
              className="p-1.5 rounded-md hover:bg-slate-100 text-slate-600"
            >
              <ArrowLeftIcon className="h-5 w-5" />
            </button>
            <div>
              <h1 className="text-lg font-semibold text-slate-900">{planDetail.title || '未命名计划'}</h1>
              <p className="text-xs text-slate-500">mode: {planDetail.strategy?.mode || '-'} · 创建于 {formatDateTime(planDetail.createdAt)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => queryClient.invalidateQueries(['orchestration-plan', planId])}
              className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
            >
              <ArrowPathIcon className="h-4 w-4" /> 刷新
            </button>
            <button
              onClick={() => {
                if (!planId) return;
                const nextPrompt = promptDraft.trim();
                if (!nextPrompt) {
                  setPromptHint('Prompt 不能为空');
                  return;
                }
                savePlanPromptMutation.mutate({ planId, sourcePrompt: nextPrompt, mode: modeDraft });
              }}
              disabled={!planId || savePlanPromptMutation.isLoading}
              className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <PencilSquareIcon className="h-4 w-4" /> 保存
            </button>
            <button
              onClick={() => {
                if (!planId) return;
                const nextPrompt = promptDraft.trim();
                if (!nextPrompt) {
                  setPromptHint('Prompt 不能为空');
                  return;
                }
                setReplanPlannerAgentId(planDetail?.strategy?.plannerAgentId || '');
                setIsReplanModalOpen(true);
              }}
              disabled={!planId || replanPlanMutation.isLoading || isReplanPending || runPlanMutation.isLoading}
              className="inline-flex items-center gap-1 rounded-md border border-indigo-200 px-3 py-1.5 text-sm text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
            >
              <ArrowPathIcon className={`h-4 w-4 ${(replanPlanMutation.isLoading || isReplanPending) ? 'animate-spin' : ''}`} />
              {(replanPlanMutation.isLoading || isReplanPending) ? '重新编排中...' : '重新编排'}
            </button>
            <button
              onClick={() => planId && runPlanMutation.mutate({ planId, continueOnFailure: true })}
              disabled={!planId || runPlanMutation.isLoading}
              className="inline-flex items-center gap-1 rounded-md border border-cyan-200 px-3 py-1.5 text-sm text-cyan-700 hover:bg-cyan-50 disabled:opacity-50"
            >
              <PlayIcon className="h-4 w-4" /> 运行
            </button>
            <button
              onClick={handleCopyPlanTasksMarkdown}
              disabled={!planDetail}
              className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <DocumentDuplicateIcon className="h-4 w-4" /> 复制任务MD
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-4 space-y-4">
        <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-white p-4 text-sm md:grid-cols-4">
          <div>
            <p className="text-xs text-slate-500">计划状态</p>
            <span className={`mt-1 inline-flex rounded px-1.5 py-0.5 text-xs ${STATUS_COLOR[planDetail.status] || STATUS_COLOR.pending}`}>
              {planDetail.status}
            </span>
          </div>
          <div>
            <p className="text-xs text-slate-500">模板任务</p>
            <p className="mt-1 text-sm font-medium text-slate-800">{planDetail.stats?.totalTasks ?? '-'}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">最后执行状态</p>
            <span className={`mt-1 inline-flex rounded px-1.5 py-0.5 text-xs ${RUN_STATUS_COLOR[latestRunSummary?.status || ''] || 'bg-slate-100 text-slate-600'}`}>
              {latestRunSummary ? (RUN_STATUS_LABEL[latestRunSummary.status] || latestRunSummary.status) : '暂无执行'}
            </span>
          </div>
          <div>
            <p className="text-xs text-slate-500">最后执行时间</p>
            <p className="mt-1 text-sm font-medium text-slate-800">{formatDateTime(latestRunSummary?.startedAt)}</p>
          </div>
        </div>

        {planDetail.status === 'drafting' && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <p className="font-medium">任务生成中</p>
            <p className="mt-1 text-xs text-amber-700">
              {streamHint || '系统正在异步编排任务，任务会逐条显示在下方列表。'} {' · '}
              {streamConnected ? '实时连接已建立' : '实时连接重连中，已启用轮询兜底'}
            </p>
          </div>
        )}

        <div className="rounded-lg border border-slate-200 bg-white p-2">
          <div className="inline-flex items-center gap-2">
            <button
              onClick={() => setActiveTab('settings')}
              className={`rounded-md px-3 py-1.5 text-xs ${activeTab === 'settings' ? 'bg-primary-100 text-primary-700' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              任务设置
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`rounded-md px-3 py-1.5 text-xs ${activeTab === 'history' ? 'bg-primary-100 text-primary-700' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              执行历史
            </button>
          </div>
        </div>

        {activeTab === 'settings' ? (
          <>
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="mb-2 text-xs font-medium text-slate-700">计划模式</p>
              <select
                value={modeDraft}
                onChange={(event) => setModeDraft(event.target.value as PlanMode)}
                className="mb-3 w-full rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700"
              >
                <option value="sequential">串行</option>
                <option value="parallel">并行</option>
                <option value="hybrid">混合</option>
              </select>
              <p className="mb-2 text-xs font-medium text-slate-700">Prompt</p>
              <textarea
                value={promptDraft}
                onChange={(event) => setPromptDraft(event.target.value)}
                className="min-h-[100px] w-full rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600"
              />
              {promptHint && <p className="mt-2 text-xs text-indigo-700">{promptHint}</p>}
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-800">任务列表</p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setIsAddTaskModalOpen(true)}
                    disabled={!isPlanEditable || addTaskMutation.isLoading}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    <PlusIcon className="h-3.5 w-3.5" /> 添加任务
                  </button>
                  <button
                    onClick={handleSaveTaskEdits}
                    disabled={!dirtyTaskUpdates.length || batchUpdateTasksMutation.isLoading}
                    className="inline-flex items-center gap-1 rounded-md border border-indigo-200 px-2.5 py-1.5 text-xs text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
                  >
                    <PencilSquareIcon className="h-3.5 w-3.5" />
                    {batchUpdateTasksMutation.isLoading ? '保存中...' : `批量保存(${dirtyTaskUpdates.length})`}
                  </button>
                </div>
              </div>
              {taskHint ? <p className="text-xs text-indigo-700">{taskHint}</p> : null}
              {planTasks.length === 0 ? (
                <p className="py-4 text-sm text-slate-400">该计划暂无任务</p>
              ) : (
                planTasks.map((task) => (
                  <div
                    key={task._id}
                    className={`rounded-lg border bg-white p-4 ${debugTaskId === task._id ? 'border-primary-300 bg-primary-50/40' : 'border-slate-200'} ${streamTaskIds.includes(task._id) ? 'ring-1 ring-amber-300' : ''}`}
                  >
                    {(() => {
                      const editable = isTaskEditable(planDetail.status, task.status);
                      const draft = getEffectiveTaskDraft(task);
                      const isDirty = dirtyTaskUpdates.some((item) => item.taskId === task._id);
                      return (
                        <>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-slate-400">任务 #{task.order + 1}</p>
                    <input
                      value={draft.title}
                      onChange={(event) => updateTaskDraftField(task, { title: event.target.value })}
                      disabled={!editable}
                      className={`mt-1 w-full rounded border px-2 py-1 text-sm font-medium text-slate-900 ${editable ? 'border-slate-300 bg-white' : 'border-slate-200 bg-slate-50 text-slate-600'}`}
                    />
                    {isDirty ? <p className="mt-1 text-[11px] text-indigo-600">有未保存改动</p> : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-1.5 py-0.5 rounded ${STATUS_COLOR[task.status] || STATUS_COLOR.pending}`}>
                      {task.status}
                    </span>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-cyan-50 text-cyan-700 border border-cyan-200">
                      type: {task.runtimeTaskType ? TASK_RUNTIME_TYPE_LABEL[task.runtimeTaskType] : 'auto'}
                    </span>
                    <button
                      onClick={() => handleMoveTask(task._id, 'up')}
                      disabled={!editable || reorderTaskMutation.isLoading || task.order <= 0}
                      className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => handleMoveTask(task._id, 'down')}
                      disabled={!editable || reorderTaskMutation.isLoading || task.order >= planTasks.length - 1}
                      className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      ↓
                    </button>
                    <button
                      onClick={() => planId && duplicateTaskMutation.mutate({ targetPlanId: planId, taskId: task._id })}
                      disabled={!editable || duplicateTaskMutation.isLoading || !planId}
                      className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      <DocumentDuplicateIcon className="h-3.5 w-3.5" /> 复制
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
                      className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-rose-200 text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                    >
                      <TrashIcon className="h-3.5 w-3.5" /> 删除
                    </button>
                    <button
                      onClick={() => openDebugDrawer(task._id, 'debug')}
                      className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-primary-200 text-primary-700 hover:bg-primary-50"
                    >
                      <BeakerIcon className="h-3.5 w-3.5" /> 调试
                    </button>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-1 md:grid-cols-4 gap-2 items-center">
                  <select
                    value={draft.priority}
                    onChange={(event) =>
                      updateTaskDraftField(task, {
                        priority: event.target.value as 'low' | 'medium' | 'high' | 'urgent',
                      })
                    }
                    disabled={!editable}
                    className="text-xs border border-slate-300 rounded px-2 py-1.5 disabled:bg-slate-50"
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
                    className="text-xs border border-slate-300 rounded px-2 py-1.5 disabled:bg-slate-50"
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
                        className="text-xs border border-slate-300 rounded px-2 py-1.5 disabled:bg-slate-50"
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
                        className="text-xs border border-slate-300 rounded px-2 py-1.5 disabled:bg-slate-50"
                      >
                      <option value="">选择员工</option>
                      {employees.map((employee) => (
                        <option key={employee.id} value={employee.id}>
                          {employee.name || employee.id}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="text-xs text-slate-400">未分配执行者</div>
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
                        className="text-xs px-2 py-1.5 rounded bg-blue-600 text-white disabled:bg-slate-300"
                      >
                        重试
                      </button>
                    )}
                  </div>
                </div>

                <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-2 space-y-2">
                  <p className="text-[11px] font-semibold text-slate-700">任务上下文</p>
                  <textarea
                    value={draft.description}
                    onChange={(event) => updateTaskDraftField(task, { description: event.target.value })}
                    disabled={!editable}
                    className={`min-h-[72px] w-full rounded border px-2 py-1.5 text-xs ${editable ? 'border-slate-300 bg-white text-slate-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}
                  />
                  <p className="text-xs text-slate-600">
                    <span className="font-medium text-slate-700">依赖:</span> {draft.dependencyTaskIds.length ? draft.dependencyTaskIds.join(', ') : '-'}
                  </p>
                  <p className="text-xs text-slate-600">
                    <span className="font-medium text-slate-700">输出:</span> {task.result?.output || task.result?.summary || '-'}
                  </p>
                  <p className="text-xs text-slate-600">
                    <span className="font-medium text-slate-700">错误:</span> {task.result?.error || '-'}
                  </p>
                  <p className="text-xs text-slate-600 inline-flex items-center gap-1">
                    <span className="font-medium text-slate-700">Session:</span>
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
                        </>
                      );
                    })()}
                  </div>
                ))
              )}
            </div>
          </>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">最近一次执行</p>
                  <p className="mt-1 text-xs text-slate-500">默认展示最后一次 run 摘要，可进入详情查看任务执行明细。</p>
                </div>
                {latestRunSummary?._id && (
                  <button
                    onClick={() => openRunDetailDrawer(latestRunSummary._id)}
                    className="inline-flex items-center gap-1 rounded-md border border-primary-200 px-2.5 py-1.5 text-xs text-primary-700 hover:bg-primary-50"
                  >
                    查看详情
                    <ChevronRightIcon className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              {latestRunLoading ? (
                <p className="mt-3 text-xs text-slate-400">加载最近执行中...</p>
              ) : !latestRunSummary ? (
                <p className="mt-3 text-xs text-slate-400">暂无执行记录，可先点击顶部“运行”触发一次计划。</p>
              ) : (
                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-4">
                  <div className="rounded border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[11px] text-slate-500">状态</p>
                    <span className={`mt-1 inline-flex rounded px-1.5 py-0.5 text-xs ${RUN_STATUS_COLOR[latestRunSummary.status] || 'bg-slate-100 text-slate-600'}`}>
                      {RUN_STATUS_LABEL[latestRunSummary.status] || latestRunSummary.status}
                    </span>
                  </div>
                  <div className="rounded border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[11px] text-slate-500">触发来源</p>
                    <p className="mt-1 text-xs font-medium text-slate-800">{TRIGGER_TYPE_LABEL[latestRunSummary.triggerType] || latestRunSummary.triggerType}</p>
                  </div>
                  <div className="rounded border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[11px] text-slate-500">开始时间</p>
                    <p className="mt-1 text-xs font-medium text-slate-800">{formatDateTime(latestRunSummary.startedAt)}</p>
                  </div>
                  <div className="rounded border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[11px] text-slate-500">耗时</p>
                    <p className="mt-1 text-xs font-medium text-slate-800">{formatDuration(latestRunSummary.durationMs)}</p>
                  </div>
                </div>
              )}
              {latestRunSummary && (
                <div className="mt-3">
                  <div className="mb-1 flex items-center justify-between text-[11px] text-slate-500">
                    <span>完成率</span>
                    <span>
                      {latestRunSummary.stats?.completedTasks || 0}/{latestRunSummary.stats?.totalTasks || 0}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100">
                    <div
                      className="h-2 rounded-full bg-cyan-500"
                      style={{ width: `${getRunCompletionPercent(latestRunSummary)}%` }}
                    />
                  </div>
                  {latestRunSummary.error && (
                    <p className="mt-2 text-xs text-rose-600">错误：{latestRunSummary.error}</p>
                  )}
                </div>
              )}
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
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
                    <div key={run._id} className="rounded-lg border border-slate-200 px-3 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className={`inline-flex rounded px-1.5 py-0.5 text-xs ${RUN_STATUS_COLOR[run.status] || 'bg-slate-100 text-slate-600'}`}>
                            {RUN_STATUS_LABEL[run.status] || run.status}
                          </span>
                          <p className="text-xs font-medium text-slate-700">{TRIGGER_TYPE_LABEL[run.triggerType] || run.triggerType}</p>
                          <p className="text-[11px] text-slate-500">{run._id}</p>
                        </div>
                        <button
                          onClick={() => openRunDetailDrawer(run._id)}
                          className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                        >
                          查看详情
                          <ChevronRightIcon className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                        <span>开始：{formatDateTime(run.startedAt)}</span>
                        <span>耗时：{formatDuration(run.durationMs)}</span>
                        <span>
                          完成：{run.stats?.completedTasks || 0}/{run.stats?.totalTasks || 0}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-600 line-clamp-2">{run.summary || '-'}</p>
                      {run.error && <p className="mt-1 text-xs text-rose-600">{run.error}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {isAddTaskModalOpen && (
        <div className="fixed inset-0 z-[92] flex items-center justify-center bg-slate-900/40 p-4">
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
                  onChange={(event) =>
                    setNewTaskPriority(event.target.value as 'low' | 'medium' | 'high' | 'urgent')
                  }
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
                  if (!planId) {
                    return;
                  }
                  const title = newTaskTitle.trim();
                  const description = newTaskDescription.trim();
                  if (!title || !description) {
                    setTaskHint('任务标题和描述不能为空');
                    return;
                  }
                  addTaskMutation.mutate({
                    planId,
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
        <div className="fixed inset-0 z-[93] flex items-center justify-center bg-slate-900/40 p-4">
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

      {runDrawerOpen && (
        <div className="fixed inset-0 z-[88]">
          <button
            className="absolute inset-0 bg-black/30"
            onClick={() => setRunDrawerOpen(false)}
            aria-label="关闭执行详情抽屉"
          />
          <aside className="absolute right-0 top-0 h-full w-full border-l border-slate-200 bg-white shadow-2xl sm:w-[92vw] lg:w-[56vw]">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">Run 执行详情</p>
                <p className="mt-0.5 text-xs text-slate-500">{selectedRunId || '-'}</p>
              </div>
              <button
                onClick={() => setRunDrawerOpen(false)}
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
                    <p className="text-xs text-slate-600">
                      统计：{runDetail.stats?.completedTasks || 0}/{runDetail.stats?.totalTasks || 0}（失败 {runDetail.stats?.failedTasks || 0}）
                    </p>
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
                            <p className="mt-0.5 text-[11px] text-slate-500">执行者：{formatExecutor(task)}</p>
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
                        <p className="mt-1 text-xs text-slate-600 whitespace-pre-wrap">{task.result?.summary || task.result?.output || '-'}</p>
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
          <aside className="absolute right-0 top-0 h-full w-full bg-white shadow-2xl sm:w-[92vw] lg:w-[56vw] border-l border-slate-200 flex flex-col">
            <div className="px-4 py-3 border-b border-slate-200 flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-slate-900">单步调试</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {debugTask ? `Step #${debugTask.order + 1} · ${debugTask.status}` : '请选择任务后再调试'}
                </p>
              </div>
              <button
                onClick={() => setDebugDrawerOpen(false)}
                className="p-1 rounded hover:bg-slate-100 text-slate-500"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="px-4 py-2 border-b border-slate-200 inline-flex gap-2">
              <button
                onClick={() => setActiveDrawerTab('debug')}
                className={`px-3 py-1.5 text-xs rounded ${activeDrawerTab === 'debug' ? 'bg-primary-100 text-primary-700' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                调试
              </button>
              <button
                onClick={() => setActiveDrawerTab('session')}
                className={`px-3 py-1.5 text-xs rounded ${activeDrawerTab === 'session' ? 'bg-primary-100 text-primary-700' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                Session
              </button>
            </div>

            {!debugTask ? (
              <div className="flex-1 p-4 text-sm text-slate-500">当前计划中未找到该任务，请重新选择。</div>
            ) : (
              <>
                {activeDrawerTab === 'debug' ? (
                  <>
                    <div className="p-4 border-b border-slate-200 space-y-3">
                      <div className="grid grid-cols-1 gap-2">
                        <label className="text-xs text-slate-600">执行 Agent</label>
                        <select
                          value={debugAgentId}
                          onChange={(event) => setDebugAgentId(event.target.value)}
                          className="w-full text-sm border border-slate-300 rounded px-2 py-1.5"
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
                        <label className="text-xs text-slate-600">任务标题</label>
                        <input
                          value={debugTitle}
                          onChange={(event) => setDebugTitle(event.target.value)}
                          className="w-full text-sm border border-slate-300 rounded px-2 py-1.5"
                        />
                      </div>
                      <div className="grid grid-cols-1 gap-2">
                        <label className="text-xs text-slate-600">任务描述（可编辑后反复调试）</label>
                        <textarea
                          value={debugDescription}
                          onChange={(event) => setDebugDescription(event.target.value)}
                          className="w-full min-h-[120px] text-sm border border-slate-300 rounded px-2 py-1.5"
                        />
                      </div>
                      <div className="grid grid-cols-1 gap-2">
                        <label className="text-xs text-slate-600">任务类型（可保存）</label>
                        <select
                          value={debugRuntimeTaskType}
                          onChange={(event) => setDebugRuntimeTaskType(event.target.value as 'auto' | DebugRuntimeTaskTypeOverride)}
                          className="w-full text-sm border border-slate-300 rounded px-2 py-1.5"
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
                          className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded border border-slate-300 hover:bg-slate-50 disabled:opacity-50"
                        >
                          <PencilSquareIcon className="h-4 w-4" /> 保存草稿
                        </button>
                        <button
                          onClick={handleDebugRun}
                          disabled={debugStepMutation.isLoading || reassignMutation.isLoading}
                          className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded bg-slate-900 text-white disabled:bg-slate-300"
                        >
                          <PlayIcon className="h-4 w-4" /> 执行当前 Step
                        </button>
                      </div>
                      {debugHint && <p className="text-xs text-primary-700">{debugHint}</p>}
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-4">
                      <section className="space-y-2">
                        <p className="text-xs font-semibold text-slate-700">运行日志</p>
                        {!debugTask.runLogs?.length ? (
                          <p className="text-xs text-slate-400">暂无日志</p>
                        ) : (
                          <div className="space-y-1">
                            {debugTask.runLogs.slice(-10).reverse().map((log, index) => (
                              <div key={`${log.timestamp}-${index}`} className="rounded border border-slate-200 px-2 py-1.5">
                                <p className="text-[11px] text-slate-500 inline-flex items-center gap-1">
                                  <ClockIcon className="h-3 w-3" /> {formatDateTime(log.timestamp)} · {log.level}
                                </p>
                                <p className="text-xs text-slate-700 mt-0.5">{log.message}</p>
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
                      <p className="text-xs font-semibold text-slate-700">Session 信息</p>
                      {!debugSessionId ? (
                        <p className="text-xs text-slate-400">该任务尚未产生 session</p>
                      ) : debugSessionLoading ? (
                        <p className="text-xs text-slate-400">加载 session 中...</p>
                      ) : !debugSessionDetail ? (
                        <p className="text-xs text-slate-400">未查询到 session 详情</p>
                      ) : (
                        <div className="rounded border border-slate-200 p-3 space-y-2">
                          <p className="text-xs text-slate-600">ID: {debugSessionDetail._id}</p>
                          <p className="text-xs text-slate-600">Owner: {debugSessionDetail.ownerType} / {debugSessionDetail.ownerId}</p>
                          <p className="text-xs text-slate-600">状态: {debugSessionDetail.status}</p>
                          <p className="text-xs text-slate-600">更新时间: {formatDateTime(debugSessionDetail.updatedAt)}</p>
                          <div className="border-t border-slate-200 pt-2 space-y-1">
                            <p className="text-xs font-medium text-slate-700">最近消息</p>
                            {(debugSessionDetail.messages || []).slice(-5).reverse().map((message, index) => (
                              <div key={`${message.timestamp}-${index}`} className="bg-slate-50 rounded px-2 py-1.5">
                                <p className="text-[11px] text-slate-500">
                                  {message.role} · {formatDateTime(message.timestamp)}
                                </p>
                                <p className="text-xs text-slate-700 whitespace-pre-wrap line-clamp-3">{message.content}</p>
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

      {isReplanModalOpen && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <p className="text-sm font-semibold text-slate-900">选择 Planner 后重新编排</p>
              <button
                onClick={() => {
                  if (replanPlanMutation.isLoading) return;
                  setIsReplanModalOpen(false);
                }}
                disabled={replanPlanMutation.isLoading}
                className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
                aria-label="关闭重新编排弹窗"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3 px-4 py-4">
              <p className="text-xs text-slate-600">确认后将覆盖当前任务结构，并按所选 Planner 重新编排。</p>
              <select
                value={replanPlannerAgentId}
                onChange={(event) => setReplanPlannerAgentId(event.target.value)}
                disabled={replanPlanMutation.isLoading}
                className="w-full rounded-md border border-slate-300 px-2 py-2 text-sm disabled:opacity-50"
              >
                <option value="">默认 Planner</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
              <button
                onClick={() => setIsReplanModalOpen(false)}
                disabled={replanPlanMutation.isLoading}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={() => {
                  if (!planId) return;
                  const nextPrompt = promptDraft.trim() || planDetail?.sourcePrompt?.trim() || '';
                  if (!nextPrompt) {
                    setPromptHint('Prompt 不能为空');
                    return;
                  }
                  replanPlanMutation.mutate({
                    planId,
                    prompt: nextPrompt,
                    plannerAgentId: replanPlannerAgentId || undefined,
                  });
                }}
                disabled={!planId || replanPlanMutation.isLoading || isReplanPending}
                className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700 disabled:bg-slate-300"
              >
                <ArrowPathIcon className={`h-4 w-4 ${replanPlanMutation.isLoading ? 'animate-spin' : ''}`} />
                {replanPlanMutation.isLoading ? '重新编排中...' : '确定并重排'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PlanDetail;
