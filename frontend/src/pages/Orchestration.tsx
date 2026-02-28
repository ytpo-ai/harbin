import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from 'react-query';
import {
  ArrowPathIcon,
  PlayIcon,
  SparklesIcon,
  UserCircleIcon,
} from '@heroicons/react/24/outline';
import { agentService } from '../services/agentService';
import { employeeService } from '../services/employeeService';
import {
  AgentSession,
  orchestrationService,
  OrchestrationPlan,
  PlanMode,
} from '../services/orchestrationService';

type MainTab = 'plans' | 'sessions';

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

const Orchestration: React.FC = () => {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<MainTab>('plans');
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [prompt, setPrompt] = useState('');
  const [title, setTitle] = useState('');
  const [mode, setMode] = useState<PlanMode>('hybrid');
  const [autoRun, setAutoRun] = useState(true);
  const [plannerAgentId, setPlannerAgentId] = useState('');

  const [sessionOwnerType, setSessionOwnerType] = useState<'agent' | 'employee' | 'system'>('system');
  const [sessionOwnerId, setSessionOwnerId] = useState('orchestrator');
  const [sessionTitle, setSessionTitle] = useState('');
  const [sessionRole, setSessionRole] = useState<'user' | 'assistant' | 'system'>('user');
  const [sessionMessage, setSessionMessage] = useState('');

  const [sessionStatusFilter, setSessionStatusFilter] = useState<'active' | 'archived' | 'closed' | ''>('');
  const [sessionOwnerTypeFilter, setSessionOwnerTypeFilter] = useState<'agent' | 'employee' | 'system' | ''>('');

  const { data: plans = [], isLoading: plansLoading } = useQuery<OrchestrationPlan[]>(
    'orchestration-plans',
    () => orchestrationService.getPlans(),
    {
      refetchInterval: activeTab === 'plans' ? 3000 : false,
    },
  );

  const { data: planDetail, isFetching: planDetailLoading } = useQuery(
    ['orchestration-plan', selectedPlanId],
    () => orchestrationService.getPlanById(selectedPlanId),
    {
      enabled: Boolean(selectedPlanId),
      refetchInterval: (data) => {
        if (!selectedPlanId || activeTab !== 'plans') {
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

  const { data: agents = [] } = useQuery('orchestration-agents', () => agentService.getAgents());
  const { data: employees = [] } = useQuery('orchestration-employees', () => employeeService.getEmployees());

  const { data: sessions = [], isLoading: sessionsLoading } = useQuery<AgentSession[]>(
    ['orchestration-sessions', sessionStatusFilter, sessionOwnerTypeFilter],
    () =>
      orchestrationService.getSessions({
        status: sessionStatusFilter || undefined,
        ownerType: sessionOwnerTypeFilter || undefined,
      }),
  );

  const { data: sessionDetail, isFetching: sessionDetailLoading } = useQuery(
    ['orchestration-session-detail', selectedSessionId],
    () => orchestrationService.getSessionById(selectedSessionId),
    { enabled: Boolean(selectedSessionId) },
  );

  useEffect(() => {
    if (!selectedPlanId && plans.length > 0) {
      setSelectedPlanId(plans[0]._id);
    }
  }, [plans, selectedPlanId]);

  useEffect(() => {
    if (!selectedSessionId && sessions.length > 0) {
      setSelectedSessionId(sessions[0]._id);
    }
  }, [sessions, selectedSessionId]);

  useEffect(() => {
    if (sessionOwnerType === 'system') {
      setSessionOwnerId('orchestrator');
    }
  }, [sessionOwnerType]);

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
          queryClient.invalidateQueries('orchestration-sessions'),
        ]);
      },
    },
  );

  const retryTaskMutation = useMutation((taskId: string) => orchestrationService.retryTask(taskId), {
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries('orchestration-plans'),
        queryClient.invalidateQueries(['orchestration-plan', selectedPlanId]),
        queryClient.invalidateQueries('orchestration-sessions'),
      ]);
    },
  });

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

  const createSessionMutation = useMutation(
    () =>
      orchestrationService.createSession({
        ownerType: sessionOwnerType,
        ownerId: sessionOwnerId.trim(),
        title: sessionTitle.trim(),
        linkedPlanId: selectedPlanId || undefined,
      }),
    {
      onSuccess: async (created) => {
        setSessionTitle('');
        await queryClient.invalidateQueries('orchestration-sessions');
        if (created?._id) {
          setSelectedSessionId(created._id);
        }
      },
    },
  );

  const appendMessageMutation = useMutation(
    () =>
      orchestrationService.appendMessage(selectedSessionId, {
        role: sessionRole,
        content: sessionMessage.trim(),
      }),
    {
      onSuccess: async () => {
        setSessionMessage('');
        await Promise.all([
          queryClient.invalidateQueries('orchestration-sessions'),
          queryClient.invalidateQueries(['orchestration-session-detail', selectedSessionId]),
        ]);
      },
    },
  );

  const archiveSessionMutation = useMutation((sessionId: string) => orchestrationService.archiveSession(sessionId), {
    onSuccess: async (_, sid) => {
      await Promise.all([
        queryClient.invalidateQueries('orchestration-sessions'),
        queryClient.invalidateQueries(['orchestration-session-detail', sid]),
      ]);
    },
  });

  const resumeSessionMutation = useMutation((sessionId: string) => orchestrationService.resumeSession(sessionId), {
    onSuccess: async (_, sid) => {
      await Promise.all([
        queryClient.invalidateQueries('orchestration-sessions'),
        queryClient.invalidateQueries(['orchestration-session-detail', sid]),
      ]);
    },
  });

  const activeOwnerOptions = useMemo(() => {
    if (sessionOwnerType === 'agent') {
      return agents.map((agent) => ({ id: agent.id, label: `${agent.name} (${agent.type})` }));
    }
    if (sessionOwnerType === 'employee') {
      return employees.map((employee) => ({
        id: employee.id,
        label: `${employee.name || employee.id} (${employee.type})`,
      }));
    }
    return [{ id: 'orchestrator', label: 'System / Orchestrator' }];
  }, [agents, employees, sessionOwnerType]);

  const copyPlanToForm = (plan: OrchestrationPlan) => {
    setActiveTab('plans');
    setTitle(plan.title || '');
    setPrompt(plan.sourcePrompt || '');
    setMode(plan.strategy?.mode || 'hybrid');
    setPlannerAgentId(plan.strategy?.plannerAgentId || '');
    setAutoRun(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">任务编排中心</h1>
          <p className="text-sm text-gray-500">通过一句提示词拆解任务，并统一管理 Agent Session</p>
        </div>
        <button
          onClick={() => {
            queryClient.invalidateQueries('orchestration-plans');
            queryClient.invalidateQueries('orchestration-sessions');
          }}
          className="inline-flex items-center gap-1 px-3 py-2 text-sm rounded-md border border-gray-200 hover:bg-gray-50"
        >
          <ArrowPathIcon className="h-4 w-4" /> 刷新
        </button>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-2 inline-flex">
        <button
          onClick={() => setActiveTab('plans')}
          className={`px-3 py-1.5 text-sm rounded-md ${activeTab === 'plans' ? 'bg-primary-100 text-primary-700' : 'text-gray-600 hover:bg-gray-100'}`}
        >
          计划编排
        </button>
        <button
          onClick={() => setActiveTab('sessions')}
          className={`px-3 py-1.5 text-sm rounded-md ${activeTab === 'sessions' ? 'bg-primary-100 text-primary-700' : 'text-gray-600 hover:bg-gray-100'}`}
        >
          Session 管理
        </button>
      </div>

      {activeTab === 'plans' ? (
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
                  <div key={task._id} className="border border-gray-200 rounded-lg p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium text-gray-900">#{task.order + 1} {task.title}</p>
                        <p className="text-xs text-gray-600 mt-0.5">{task.description}</p>
                      </div>
                      <span className={`text-xs px-1.5 py-0.5 rounded ${STATUS_COLOR[task.status] || STATUS_COLOR.pending}`}>
                        {task.status}
                      </span>
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

                    {task.result?.error && <p className="text-xs text-rose-600">错误: {task.result.error}</p>}
                    {task.result?.output && (
                      <p className="text-xs text-gray-600 line-clamp-2">输出: {task.result.output}</p>
                    )}
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 min-h-[620px]">
          <aside className="lg:col-span-4 bg-white border border-gray-200 rounded-lg flex flex-col">
            <div className="p-3 border-b border-gray-200">
              <p className="text-sm font-semibold text-gray-900">新建 Session</p>
              <div className="mt-2 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={sessionOwnerType}
                    onChange={(event) => setSessionOwnerType(event.target.value as 'agent' | 'employee' | 'system')}
                    className="text-sm border border-gray-300 rounded px-2 py-1.5"
                  >
                    <option value="system">System</option>
                    <option value="agent">Agent</option>
                    <option value="employee">Employee</option>
                  </select>
                  <select
                    value={sessionOwnerId}
                    onChange={(event) => setSessionOwnerId(event.target.value)}
                    className="text-sm border border-gray-300 rounded px-2 py-1.5"
                  >
                    <option value="">选择 owner</option>
                    {activeOwnerOptions.map((owner) => (
                      <option key={owner.id} value={owner.id}>
                        {owner.label}
                      </option>
                    ))}
                  </select>
                </div>
                <input
                  value={sessionTitle}
                  onChange={(event) => setSessionTitle(event.target.value)}
                  placeholder="session title"
                  className="w-full text-sm border border-gray-300 rounded px-2 py-1.5"
                />
                <button
                  onClick={() => createSessionMutation.mutate()}
                  disabled={!sessionOwnerId.trim() || !sessionTitle.trim() || createSessionMutation.isLoading}
                  className="w-full text-sm bg-primary-600 text-white rounded px-2 py-2 disabled:bg-gray-300"
                >
                  创建 Session
                </button>
              </div>
            </div>

            <div className="p-3 border-b border-gray-200 grid grid-cols-2 gap-2">
              <select
                value={sessionStatusFilter}
                onChange={(event) => setSessionStatusFilter(event.target.value as 'active' | 'archived' | 'closed' | '')}
                className="text-xs border border-gray-300 rounded px-2 py-1.5"
              >
                <option value="">全部状态</option>
                <option value="active">active</option>
                <option value="archived">archived</option>
                <option value="closed">closed</option>
              </select>
              <select
                value={sessionOwnerTypeFilter}
                onChange={(event) =>
                  setSessionOwnerTypeFilter(event.target.value as 'agent' | 'employee' | 'system' | '')
                }
                className="text-xs border border-gray-300 rounded px-2 py-1.5"
              >
                <option value="">全部 owner</option>
                <option value="system">system</option>
                <option value="agent">agent</option>
                <option value="employee">employee</option>
              </select>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {sessionsLoading ? (
                <p className="text-sm text-gray-400 px-2 py-3">加载中...</p>
              ) : sessions.length === 0 ? (
                <p className="text-sm text-gray-400 px-2 py-3">暂无 session</p>
              ) : (
                sessions.map((session) => (
                  <button
                    key={session._id}
                    onClick={() => setSelectedSessionId(session._id)}
                    className={`w-full text-left px-2 py-2 rounded border ${
                      selectedSessionId === session._id
                        ? 'border-primary-500 bg-primary-50'
                        : 'border-transparent hover:bg-gray-50'
                    }`}
                  >
                    <p className="text-sm font-medium text-gray-900 truncate">{session.title}</p>
                    <div className="mt-1 flex items-center justify-between">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${STATUS_COLOR[session.status] || STATUS_COLOR.pending}`}>
                        {session.status}
                      </span>
                      <span className="text-xs text-gray-500 inline-flex items-center gap-1">
                        <UserCircleIcon className="h-3 w-3" /> {session.ownerType}
                      </span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </aside>

          <section className="lg:col-span-8 bg-white border border-gray-200 rounded-lg flex flex-col">
            <div className="p-3 border-b border-gray-200 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-gray-900">{sessionDetail?.title || '未选择 Session'}</p>
                <p className="text-xs text-gray-500">owner: {sessionDetail?.ownerType || '-'} / {sessionDetail?.ownerId || '-'}</p>
              </div>
              <div className="flex items-center gap-2">
                {sessionDetail?.status === 'active' ? (
                  <button
                    onClick={() => selectedSessionId && archiveSessionMutation.mutate(selectedSessionId)}
                    className="px-3 py-1.5 text-xs rounded border border-gray-200 hover:bg-gray-50"
                  >
                    归档
                  </button>
                ) : (
                  <button
                    onClick={() => selectedSessionId && resumeSessionMutation.mutate(selectedSessionId)}
                    className="px-3 py-1.5 text-xs rounded border border-gray-200 hover:bg-gray-50"
                  >
                    恢复
                  </button>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {sessionDetailLoading ? (
                <p className="text-sm text-gray-400">加载中...</p>
              ) : !sessionDetail?.messages?.length ? (
                <p className="text-sm text-gray-400">暂无消息</p>
              ) : (
                sessionDetail.messages.map((message, index) => (
                  <div
                    key={`${message.timestamp}-${index}`}
                    className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[86%] rounded-lg px-3 py-2 ${
                        message.role === 'user' ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-900'
                      }`}
                    >
                      <p className="text-xs opacity-80">{message.role}</p>
                      <pre className="text-sm whitespace-pre-wrap font-sans">{message.content}</pre>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="p-3 border-t border-gray-200">
              <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
                <select
                  value={sessionRole}
                  onChange={(event) => setSessionRole(event.target.value as 'user' | 'assistant' | 'system')}
                  className="md:col-span-1 text-sm border border-gray-300 rounded px-2 py-1.5"
                >
                  <option value="user">user</option>
                  <option value="assistant">assistant</option>
                  <option value="system">system</option>
                </select>
                <input
                  value={sessionMessage}
                  onChange={(event) => setSessionMessage(event.target.value)}
                  placeholder="输入消息"
                  className="md:col-span-3 text-sm border border-gray-300 rounded px-2 py-1.5"
                />
                <button
                  onClick={() => appendMessageMutation.mutate()}
                  disabled={!selectedSessionId || !sessionMessage.trim() || appendMessageMutation.isLoading}
                  className="md:col-span-1 text-sm rounded bg-gray-900 text-white px-3 py-1.5 disabled:bg-gray-300"
                >
                  追加
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
};

export default Orchestration;
