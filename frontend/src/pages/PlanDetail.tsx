import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from 'react-query';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  BeakerIcon,
  ChevronRightIcon,
  ClockIcon,
  PencilSquareIcon,
  PlayIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { agentService } from '../services/agentService';
import { employeeService } from '../services/employeeService';
import {
  orchestrationService,
  OrchestrationPlan,
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

const PlanDetail: React.FC = () => {
  const { id: planId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [promptDraft, setPromptDraft] = useState('');
  const [promptHint, setPromptHint] = useState('');
  const [debugDrawerOpen, setDebugDrawerOpen] = useState(false);
  const [debugTaskId, setDebugTaskId] = useState('');
  const [debugTitle, setDebugTitle] = useState('');
  const [debugDescription, setDebugDescription] = useState('');
  const [debugHint, setDebugHint] = useState('');
  const [debugSessionId, setDebugSessionId] = useState('');
  const [debugAgentId, setDebugAgentId] = useState('');
  const [activeDrawerTab, setActiveDrawerTab] = useState<DrawerTab>('debug');

  const { data: planDetail, isLoading: planLoading, error: planError } = useQuery<OrchestrationPlan>(
    ['orchestration-plan', planId],
    () => orchestrationService.getPlanById(planId!),
    {
      enabled: Boolean(planId),
      refetchInterval: (data) => {
        if (!planId) return false;
        const status = (data as any)?.status as string | undefined;
        if (!status) return false;
        if (ACTIVE_PLAN_STATUS.has(status)) return 3000;
        if (status && TERMINAL_PLAN_STATUS.has(status)) return false;
        return false;
      },
    },
  );

  const { data: agents = [] } = useQuery('plan-detail-agents', () => agentService.getAgents());
  const { data: employees = [] } = useQuery('plan-detail-employees', () => employeeService.getEmployees());

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

  useEffect(() => {
    if (planDetail?._id) {
      setPromptDraft(planDetail.sourcePrompt || '');
    }
  }, [planDetail?._id, planDetail?.sourcePrompt]);

  useEffect(() => {
    if (!debugTask) return;
    setDebugTitle(debugTask.title || '');
    setDebugDescription(debugTask.description || '');
    setDebugSessionId(debugTask.sessionId || '');
    const taskAgentId =
      debugTask.assignment?.executorType === 'agent' && debugTask.assignment?.executorId
        ? debugTask.assignment.executorId
        : '';
    setDebugAgentId(taskAgentId || agents[0]?.id || '');
  }, [debugTask, agents]);

  useEffect(() => {
    setDebugDrawerOpen(false);
    setDebugTaskId('');
    setDebugTitle('');
    setDebugDescription('');
    setDebugSessionId('');
    setDebugAgentId('');
    setActiveDrawerTab('debug');
    setDebugHint('');
  }, [planId]);

  const savePlanPromptMutation = useMutation(
    ({ planId, sourcePrompt }: { planId: string; sourcePrompt: string }) =>
      orchestrationService.updatePlan(planId, { sourcePrompt }),
    {
      onSuccess: async () => {
        setPromptHint('Prompt 已保存');
        await Promise.all([
          queryClient.invalidateQueries('orchestration-plans'),
          queryClient.invalidateQueries(['orchestration-plan', planId]),
        ]);
      },
      onError: () => {
        setPromptHint('保存失败，请稍后重试');
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
        ]);
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
        setPromptHint('重新编排已完成，任务结构已覆盖更新');
        setDebugDrawerOpen(false);
        setDebugTaskId('');
        setDebugHint('');
        await Promise.all([
          queryClient.invalidateQueries('orchestration-plans'),
          queryClient.invalidateQueries(['orchestration-plan', planId]),
        ]);
      },
      onError: (error) => {
        const message = error instanceof Error ? error.message : '重新编排失败，请稍后重试';
        setPromptHint(message);
      },
    },
  );

  const retryTaskMutation = useMutation((taskId: string) => orchestrationService.retryTask(taskId), {
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries('orchestration-plans'),
        queryClient.invalidateQueries(['orchestration-plan', planId]),
      ]);
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
          queryClient.invalidateQueries(['orchestration-plan', planId]),
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
          queryClient.invalidateQueries(['orchestration-plan', planId]),
        ]);
      },
    },
  );

  const saveTaskDraftMutation = useMutation(
    ({ taskId, title: nextTitle, description: nextDescription }: { taskId: string; title?: string; description?: string }) =>
      orchestrationService.updateTaskDraft(taskId, { title: nextTitle, description: nextDescription }),
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

  const openDebugDrawer = (taskId: string, tab: DrawerTab = 'debug') => {
    setDebugTaskId(taskId);
    setActiveDrawerTab(tab);
    setDebugDrawerOpen(true);
    setDebugHint('');
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
                savePlanPromptMutation.mutate({ planId, sourcePrompt: nextPrompt });
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
                const ok = window.confirm('确认覆盖当前计划任务并重新编排？旧任务执行轨迹将被替换。');
                if (!ok) return;
                replanPlanMutation.mutate({ planId, prompt: nextPrompt });
              }}
              disabled={!planId || replanPlanMutation.isLoading || runPlanMutation.isLoading}
              className="inline-flex items-center gap-1 rounded-md border border-indigo-200 px-3 py-1.5 text-sm text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
            >
              <ArrowPathIcon className="h-4 w-4" /> 重新编排
            </button>
            <button
              onClick={() => planId && runPlanMutation.mutate({ planId, continueOnFailure: true })}
              disabled={!planId || runPlanMutation.isLoading}
              className="inline-flex items-center gap-1 rounded-md border border-cyan-200 px-3 py-1.5 text-sm text-cyan-700 hover:bg-cyan-50 disabled:opacity-50"
            >
              <PlayIcon className="h-4 w-4" /> 运行
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-4 space-y-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium text-slate-700 mb-2">Prompt</p>
          <textarea
            value={promptDraft}
            onChange={(event) => setPromptDraft(event.target.value)}
            className="min-h-[100px] w-full rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600"
          />
          {promptHint && <p className="mt-2 text-xs text-indigo-700">{promptHint}</p>}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 rounded-lg border border-slate-200 bg-white p-4 text-sm">
          <div>
            <p className="text-xs text-slate-500">状态</p>
            <span className={`inline-flex mt-1 rounded px-1.5 py-0.5 text-xs ${STATUS_COLOR[planDetail.status] || STATUS_COLOR.pending}`}>
              {planDetail.status}
            </span>
          </div>
          <div>
            <p className="text-xs text-slate-500">总任务</p>
            <p className="mt-1 text-sm font-medium text-slate-800">{planDetail.stats?.totalTasks ?? '-'}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">已完成</p>
            <p className="mt-1 text-sm font-medium text-emerald-700">{planDetail.stats?.completedTasks ?? '-'}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">失败</p>
            <p className="mt-1 text-sm font-medium text-rose-700">{planDetail.stats?.failedTasks ?? '-'}</p>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-semibold text-slate-800">任务列表</p>
          {planTasks.length === 0 ? (
            <p className="text-sm text-slate-400 py-4">该计划暂无任务</p>
          ) : (
            planTasks.map((task) => (
              <div
                key={task._id}
                className={`rounded-lg border bg-white p-4 ${debugTaskId === task._id ? 'border-primary-300 bg-primary-50/40' : 'border-slate-200'}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-slate-900">#{task.order + 1} {task.title}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{task.description}</p>
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

                <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2 items-center">
                  <select
                    value={task.assignment?.executorType || 'unassigned'}
                    onChange={(event) => {
                      const executorType = event.target.value as 'agent' | 'employee' | 'unassigned';
                      reassignMutation.mutate({ taskId: task._id, executorType });
                    }}
                    className="text-xs border border-slate-300 rounded px-2 py-1.5"
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
                      className="text-xs border border-slate-300 rounded px-2 py-1.5"
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
                      className="text-xs border border-slate-300 rounded px-2 py-1.5"
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
                  <p className="text-xs text-slate-600">
                    <span className="font-medium text-slate-700">输入:</span> {task.description || '-'}
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
              </div>
            ))
          )}
        </div>
      </div>

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
    </div>
  );
};

export default PlanDetail;
