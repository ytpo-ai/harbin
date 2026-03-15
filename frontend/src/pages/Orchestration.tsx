import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from 'react-query';
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
  OrchestrationPlan,
  PlanMode,
} from '../services/orchestrationService';
import { schedulerService } from '../services/schedulerService';

type DrawerTab = 'debug' | 'session';

const STATUS_COLOR: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
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

const TERMINAL_PLAN_STATUS = new Set(['completed', 'failed']);
const ACTIVE_PLAN_STATUS = new Set(['running', 'paused']);
const PLAN_PROMPT_DRAFT_STORAGE_KEY = 'orchestration-plan-prompt-drafts';

const formatDateTime = (value?: string) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const Orchestration: React.FC = () => {
  const queryClient = useQueryClient();
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isDetailDrawerOpen, setIsDetailDrawerOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [title, setTitle] = useState('');
  const [mode, setMode] = useState<PlanMode>('hybrid');
  const [autoRun, setAutoRun] = useState(true);
  const [plannerAgentId, setPlannerAgentId] = useState('');

  const [debugDrawerOpen, setDebugDrawerOpen] = useState(false);
  const [debugTaskId, setDebugTaskId] = useState('');
  const [debugTitle, setDebugTitle] = useState('');
  const [debugDescription, setDebugDescription] = useState('');
  const [debugHint, setDebugHint] = useState('');
  const [debugSessionId, setDebugSessionId] = useState('');
  const [debugAgentId, setDebugAgentId] = useState('');
  const [activeDrawerTab, setActiveDrawerTab] = useState<DrawerTab>('debug');
  const [promptDrafts, setPromptDrafts] = useState<Record<string, string>>({});
  const [planHint, setPlanHint] = useState('');

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
        if (ACTIVE_PLAN_STATUS.has(status)) {
          return 3000;
        }
        if (status && TERMINAL_PLAN_STATUS.has(status)) {
          return false;
        }
        return false;
      },
    },
  );

  const debugTask = useMemo(
    () => planDetail?.tasks?.find((task) => task._id === debugTaskId),
    [planDetail?.tasks, debugTaskId],
  );
  const planTasks = planDetail?.tasks ?? [];

  const { data: debugSessionDetail, isFetching: debugSessionLoading } = useQuery(
    ['orchestration-debug-session', debugSessionId],
    () => orchestrationService.getSessionById(debugSessionId),
    {
      enabled: debugDrawerOpen && Boolean(debugSessionId),
      refetchInterval: debugDrawerOpen && debugSessionId ? 3000 : false,
    },
  );

  const { data: agents = [] } = useQuery('orchestration-agents', () => agentService.getAgents());
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
    setDebugSessionId(debugTask.sessionId || '');
    const taskAgentId =
      debugTask.assignment?.executorType === 'agent' && debugTask.assignment?.executorId
        ? debugTask.assignment.executorId
        : '';
    setDebugAgentId(taskAgentId || agents[0]?.id || '');
  }, [agents, debugTask]);

  useEffect(() => {
    setDebugDrawerOpen(false);
    setDebugTaskId('');
    setDebugTitle('');
    setDebugDescription('');
    setDebugSessionId('');
    setDebugAgentId('');
    setActiveDrawerTab('debug');
    setDebugHint('');
    setPlanHint('');
  }, [selectedPlanId]);

  useEffect(() => {
    if (!planDetail?._id) {
      return;
    }
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
        setIsDetailDrawerOpen(true);
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
        ]);
      },
    },
  );

  const savePlanPromptMutation = useMutation(
    ({ planId, sourcePrompt }: { planId: string; sourcePrompt: string }) =>
      orchestrationService.updatePlan(planId, { sourcePrompt }),
    {
      onSuccess: async (updated) => {
        setPlanHint('Prompt 已保存');
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
        setPlanHint('保存失败，请稍后重试');
      },
    },
  );

  const replanPlanMutation = useMutation(
    ({ planId, prompt: nextPrompt }: { planId: string; prompt: string }) =>
      orchestrationService.replanPlan(planId, {
        prompt: nextPrompt,
        mode: planDetail?.strategy?.mode,
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

  const retryTaskMutation = useMutation((taskId: string) => orchestrationService.retryTask(taskId), {
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries('orchestration-plans'),
        queryClient.invalidateQueries(['orchestration-plan', selectedPlanId]),
      ]);
    },
  });

  const saveTaskDraftMutation = useMutation(
    ({ taskId, title: nextTitle, description: nextDescription }: { taskId: string; title?: string; description?: string }) =>
      orchestrationService.updateTaskDraft(taskId, { title: nextTitle, description: nextDescription }),
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
    }: {
      taskId: string;
      title?: string;
      description?: string;
    }) =>
      orchestrationService.debugTaskStep(taskId, {
        title: nextTitle,
        description: nextDescription,
        resetResult: true,
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
      onSuccess: async () => {
        await Promise.all([
          queryClient.invalidateQueries('orchestration-plans'),
          queryClient.invalidateQueries(['orchestration-plan', selectedPlanId]),
        ]);
      },
    },
  );

  const completeHumanTaskMutation = useMutation(
    ({ taskId, summary }: { taskId: string; summary?: string }) =>
      orchestrationService.completeHumanTask(taskId, { summary }),
    {
      onSuccess: async () => {
        await Promise.all([
          queryClient.invalidateQueries('orchestration-plans'),
          queryClient.invalidateQueries(['orchestration-plan', selectedPlanId]),
        ]);
      },
    },
  );

  const copyPlanToForm = (plan: OrchestrationPlan) => {
    setTitle(plan.title || '');
    setPrompt(plan.sourcePrompt || '');
    setMode(plan.strategy?.mode || 'hybrid');
    setPlannerAgentId(plan.strategy?.plannerAgentId || '');
    setAutoRun(false);
    setIsCreateModalOpen(true);
  };

  const openDebugDrawer = (taskId: string, tab: DrawerTab = 'debug') => {
    setDebugTaskId(taskId);
    setActiveDrawerTab(tab);
    setDebugDrawerOpen(true);
    setDebugHint('');
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
      await debugStepMutation.mutateAsync({
        taskId: debugTask._id,
        title: debugTitle.trim() || undefined,
        description: debugDescription.trim() || undefined,
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
                      <button
                        onClick={() => window.open(`/orchestration/plans/${plan._id}`, '_blank')}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 text-slate-700 hover:bg-slate-100"
                        title="查看详情"
                        aria-label="查看详情"
                      >
                        <EyeIcon className="h-4 w-4" />
                      </button>
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
                  checked={autoRun}
                  onChange={(event) => setAutoRun(event.target.checked)}
                />
                创建后自动执行
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
                    autoRun,
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
                      onClick={async () => {
                        if (!selectedPlanId) return;
                        try {
                          const linkedSchedules = await schedulerService.findSchedulesByPlanId(selectedPlanId);
                          if (linkedSchedules.length > 0) {
                            alert(`该计划已绑定 ${linkedSchedules.length} 个定时服务，无法删除。请先在定时服务管理中删除关联的定时服务。`);
                            return;
                          }
                        } catch (error) {
                          console.error('检查关联定时服务失败:', error);
                        }
                        const ok = window.confirm('确认删除该计划及其任务？此操作不可恢复。');
                        if (!ok) return;
                        deletePlanMutation.mutate(selectedPlanId);
                      }}
                      disabled={!selectedPlanId || deletePlanMutation.isLoading}
                      className="inline-flex items-center gap-1 rounded-md border border-rose-200 px-3 py-1.5 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                    >
                      <TrashIcon className="h-3.5 w-3.5" /> 删除计划
                    </button>
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 text-xs text-slate-700">
                    <p>
                      <span className="font-medium">Planner Agent:</span> {planDetail.strategy?.plannerAgentId || '默认'}
                    </p>
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
                    {planTasks.length === 0 ? (
                      <p className="text-sm text-slate-400">该计划暂无任务</p>
                    ) : (
                      planTasks.map((task) => (
                        <div
                          key={task._id}
                          className={`space-y-2 rounded-lg border p-3 ${debugTaskId === task._id ? 'border-primary-300 bg-primary-50/40' : 'border-gray-200'}`}
                        >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium text-gray-900">#{task.order + 1} {task.title}</p>
                        <p className="text-xs text-gray-600 mt-0.5">{task.description}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs px-1.5 py-0.5 rounded ${STATUS_COLOR[task.status] || STATUS_COLOR.pending}`}>
                          {task.status}
                        </span>
                        <button
                          onClick={() => openDebugDrawer(task._id, 'debug')}
                          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-primary-200 text-primary-700 hover:bg-primary-50"
                        >
                          <BeakerIcon className="h-3.5 w-3.5" /> 调试
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-center">
                      <select
                        value={task.assignment?.executorType || 'unassigned'}
                        onChange={(event) => {
                          const executorType = event.target.value as 'agent' | 'employee' | 'unassigned';
                          reassignMutation.mutate({ taskId: task._id, executorType });
                        }}
                        className="text-xs border border-gray-300 rounded px-2 py-1.5"
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
                          className="text-xs border border-gray-300 rounded px-2 py-1.5"
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
                          className="text-xs border border-gray-300 rounded px-2 py-1.5"
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

                    <div className="rounded border border-gray-200 bg-gray-50/70 p-2 space-y-2">
                      <p className="text-[11px] font-semibold text-gray-700">任务上下文</p>
                      <p className="text-xs text-gray-600">
                        <span className="font-medium text-gray-700">输入:</span> {task.description || '-'}
                      </p>
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

                    {task.result?.error && <p className="text-xs text-rose-600">错误: {task.result.error}</p>}
                    {task.result?.output && (
                      <p className="text-xs text-gray-600 line-clamp-2">输出: {task.result.output}</p>
                    )}
                        </div>
                      ))
                    )}
                  </div>
                </>
              )}
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
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              onClick={() =>
                                saveTaskDraftMutation.mutate({
                                  taskId: debugTask._id,
                                  title: debugTitle.trim() || undefined,
                                  description: debugDescription.trim() || undefined,
                                })
                              }
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
