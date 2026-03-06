import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from 'react-query';
import {
  BeakerIcon,
  ArrowPathIcon,
  ChevronRightIcon,
  ClockIcon,
  PencilSquareIcon,
  PlayIcon,
  SparklesIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { agentService } from '../services/agentService';
import { employeeService } from '../services/employeeService';
import {
  orchestrationService,
  OrchestrationPlan,
  PlanMode,
} from '../services/orchestrationService';

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

const formatDateTime = (value?: string) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const Orchestration: React.FC = () => {
  const queryClient = useQueryClient();
  const [selectedPlanId, setSelectedPlanId] = useState('');
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

  const { data: plans = [], isLoading: plansLoading } = useQuery<OrchestrationPlan[]>(
    'orchestration-plans',
    () => orchestrationService.getPlans(),
    { refetchInterval: 3000 },
  );

  const { data: planDetail, isFetching: planDetailLoading } = useQuery(
    ['orchestration-plan', selectedPlanId],
    () => orchestrationService.getPlanById(selectedPlanId),
    {
      enabled: Boolean(selectedPlanId),
      refetchInterval: (data) => {
        if (!selectedPlanId) {
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
  }, [selectedPlanId]);

  const createPlanMutation = useMutation(orchestrationService.createPlanFromPrompt, {
    onSuccess: async (created) => {
      setPrompt('');
      setTitle('');
      await queryClient.invalidateQueries('orchestration-plans');
      if (created?._id) {
        setSelectedPlanId(created._id);
      }
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
        return;
      }
      const next = latestPlans.find((plan) => plan._id !== deletedPlanId) || latestPlans[0];
      setSelectedPlanId(next._id);
      queryClient.invalidateQueries(['orchestration-plan', selectedPlanId]);
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
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const openDebugDrawer = (taskId: string, tab: DrawerTab = 'debug') => {
    setDebugTaskId(taskId);
    setActiveDrawerTab(tab);
    setDebugDrawerOpen(true);
    setDebugHint('');
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">计划编排中心</h1>
          <p className="text-sm text-gray-500">通过一句提示词拆解任务，并统一管理 Agent Session</p>
        </div>
        <button
          onClick={() => {
            queryClient.invalidateQueries('orchestration-plans');
          }}
          className="inline-flex items-center gap-1 px-3 py-2 text-sm rounded-md border border-gray-200 hover:bg-gray-50"
        >
          <ArrowPathIcon className="h-4 w-4" /> 刷新
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 min-h-[620px]">
          <aside className="lg:col-span-4 bg-white border border-gray-200 rounded-lg flex flex-col">
            <div className="p-3 border-b border-gray-200">
              <p className="text-sm font-semibold text-gray-900">新建编排计划</p>
              <div className="mt-2 space-y-2">
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="计划标题（可选）"
                  className="w-full text-sm border border-gray-300 rounded px-2 py-1.5"
                />
                <textarea
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder="输入一句提示词，例如：发布一个 Agent API 网关版本"
                  className="w-full min-h-[110px] text-sm border border-gray-300 rounded px-2 py-1.5"
                />
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={mode}
                    onChange={(event) => setMode(event.target.value as PlanMode)}
                    className="text-sm border border-gray-300 rounded px-2 py-1.5"
                  >
                    <option value="sequential">串行</option>
                    <option value="parallel">并行</option>
                    <option value="hybrid">混合</option>
                  </select>
                  <select
                    value={plannerAgentId}
                    onChange={(event) => setPlannerAgentId(event.target.value)}
                    className="text-sm border border-gray-300 rounded px-2 py-1.5"
                  >
                    <option value="">默认 Planner</option>
                    {agents.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name}
                      </option>
                    ))}
                  </select>
                </div>
                <label className="text-xs text-gray-600 inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={autoRun}
                    onChange={(event) => setAutoRun(event.target.checked)}
                  />
                  创建后自动执行
                </label>
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
                  className="w-full inline-flex items-center justify-center gap-1 text-sm bg-primary-600 text-white rounded px-2 py-2 disabled:bg-gray-300"
                >
                  <SparklesIcon className="h-4 w-4" /> 生成计划
                </button>
              </div>
            </div>

            <div className="p-3 border-b border-gray-200 flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-900">计划列表</p>
              <span className="text-xs text-gray-500">{plans.length}</span>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {plansLoading ? (
                <p className="text-sm text-gray-400 px-2 py-3">加载中...</p>
              ) : plans.length === 0 ? (
                <p className="text-sm text-gray-400 px-2 py-3">暂无计划</p>
              ) : (
                plans.map((plan) => (
                  <button
                    key={plan._id}
                    onClick={() => setSelectedPlanId(plan._id)}
                    className={`w-full text-left px-2 py-2 rounded border ${
                      selectedPlanId === plan._id
                        ? 'border-primary-500 bg-primary-50'
                        : 'border-transparent hover:bg-gray-50'
                    }`}
                  >
                    <p className="text-sm font-medium text-gray-900 truncate">{plan.title}</p>
                    <div className="mt-1 flex items-center justify-between">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${STATUS_COLOR[plan.status] || STATUS_COLOR.pending}`}>
                        {plan.status}
                      </span>
                      <span className="text-xs text-gray-500">{plan.stats.completedTasks}/{plan.stats.totalTasks}</span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </aside>

          <section className="lg:col-span-8 bg-white border border-gray-200 rounded-lg flex flex-col">
            <div className="p-3 border-b border-gray-200 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-gray-900">{planDetail?.title || '未选择计划'}</p>
                <p className="text-xs text-gray-500">mode: {planDetail?.strategy?.mode || '-'}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => planDetail && copyPlanToForm(planDetail)}
                  disabled={!planDetail}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-50"
                >
                  复制计划
                </button>
                <button
                  onClick={() => {
                    if (!selectedPlanId) return;
                    const ok = window.confirm('确认删除该计划及其任务？此操作不可恢复。');
                    if (!ok) return;
                    deletePlanMutation.mutate(selectedPlanId);
                  }}
                  disabled={!selectedPlanId || deletePlanMutation.isLoading}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded border border-rose-200 text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                >
                  删除计划
                </button>
                <button
                  onClick={() =>
                    selectedPlanId && runPlanMutation.mutate({ planId: selectedPlanId, continueOnFailure: true })
                  }
                  disabled={!selectedPlanId || runPlanMutation.isLoading}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs bg-gray-900 text-white rounded disabled:bg-gray-300"
                >
                  <PlayIcon className="h-4 w-4" /> 运行计划
                </button>
              </div>
            </div>

            <div className="p-3 border-b border-gray-200 bg-gray-50/60 space-y-2">
              <p className="text-xs text-gray-700">
                <span className="font-medium">Planner Agent:</span> {planDetail?.strategy?.plannerAgentId || '默认'}
              </p>
              <div>
                <p className="text-xs font-medium text-gray-700 mb-1">原始 Prompt</p>
                <pre className="text-xs whitespace-pre-wrap text-gray-600 bg-white border border-gray-200 rounded p-2">
                  {planDetail?.sourcePrompt || '-'}
                </pre>
              </div>
            </div>

            <div className="p-3 border-b border-gray-200 text-xs text-gray-600">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div>总任务: {planDetail?.stats?.totalTasks ?? '-'}</div>
                <div>已完成: {planDetail?.stats?.completedTasks ?? '-'}</div>
                <div>失败: {planDetail?.stats?.failedTasks ?? '-'}</div>
                <div>待人工: {planDetail?.stats?.waitingHumanTasks ?? '-'}</div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {planDetailLoading ? (
                <p className="text-sm text-gray-400">加载计划详情...</p>
              ) : !planDetail?.tasks?.length ? (
                <p className="text-sm text-gray-400">该计划暂无任务</p>
              ) : (
                planDetail.tasks.map((task) => (
                  <div
                    key={task._id}
                    className={`border rounded-lg p-3 space-y-2 ${debugTaskId === task._id ? 'border-primary-300 bg-primary-50/40' : 'border-gray-200'}`}
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
          </section>

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
      </div>
  );
};

export default Orchestration;
