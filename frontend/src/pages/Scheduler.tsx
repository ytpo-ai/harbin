import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from 'react-query';
import {
  ArrowPathIcon,
  BoltIcon,
  ClockIcon,
  PlayIcon,
  PlusIcon,
  PowerIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { agentService } from '../services/agentService';
import {
  schedulerService,
  OrchestrationSchedule,
  ScheduleType,
} from '../services/schedulerService';

const formatDateTime = (value?: string) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const Scheduler: React.FC = () => {
  const queryClient = useQueryClient();
  const [selectedScheduleId, setSelectedScheduleId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [scheduleType, setScheduleType] = useState<ScheduleType>('interval');
  const [intervalHours, setIntervalHours] = useState('2');
  const [cronExpression, setCronExpression] = useState('0 */2 * * *');
  const [timezone, setTimezone] = useState('Asia/Shanghai');
  const [executorId, setExecutorId] = useState('');
  const [prompt, setPrompt] = useState('请检查关键状态并给出结构化结论。');

  const { data: agents = [] } = useQuery('scheduler-agents', () => agentService.getAgents());
  const { data: schedules = [], isLoading: schedulesLoading } = useQuery<OrchestrationSchedule[]>(
    'orchestration-schedules',
    () => schedulerService.getSchedules(),
    { refetchInterval: 5000 },
  );

  const { data: scheduleDetail, isFetching: detailLoading } = useQuery(
    ['orchestration-schedule', selectedScheduleId],
    () => schedulerService.getScheduleById(selectedScheduleId),
    {
      enabled: Boolean(selectedScheduleId),
      refetchInterval: selectedScheduleId ? 5000 : false,
    },
  );

  const { data: history = [] } = useQuery(
    ['orchestration-schedule-history', selectedScheduleId],
    () => schedulerService.getScheduleHistory(selectedScheduleId, 15),
    {
      enabled: Boolean(selectedScheduleId),
      refetchInterval: selectedScheduleId ? 5000 : false,
    },
  );

  useEffect(() => {
    if (!selectedScheduleId && schedules.length) {
      setSelectedScheduleId(schedules[0]._id);
    }
  }, [schedules, selectedScheduleId]);

  useEffect(() => {
    if (!executorId && agents.length) {
      setExecutorId(agents[0].id);
    }
  }, [agents, executorId]);

  const createMutation = useMutation(schedulerService.createSchedule, {
    onSuccess: async (created) => {
      await queryClient.invalidateQueries('orchestration-schedules');
      setSelectedScheduleId(created._id);
      setName('');
      setDescription('');
    },
  });

  const enableMutation = useMutation((scheduleId: string) => schedulerService.enableSchedule(scheduleId), {
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries('orchestration-schedules'),
        queryClient.invalidateQueries(['orchestration-schedule', selectedScheduleId]),
      ]);
    },
  });

  const disableMutation = useMutation((scheduleId: string) => schedulerService.disableSchedule(scheduleId), {
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries('orchestration-schedules'),
        queryClient.invalidateQueries(['orchestration-schedule', selectedScheduleId]),
      ]);
    },
  });

  const triggerMutation = useMutation((scheduleId: string) => schedulerService.triggerSchedule(scheduleId), {
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries('orchestration-schedules'),
        queryClient.invalidateQueries(['orchestration-schedule', selectedScheduleId]),
        queryClient.invalidateQueries(['orchestration-schedule-history', selectedScheduleId]),
      ]);
    },
  });

  const deleteMutation = useMutation((scheduleId: string) => schedulerService.deleteSchedule(scheduleId), {
    onSuccess: async () => {
      await queryClient.invalidateQueries('orchestration-schedules');
      const latest = await schedulerService.getSchedules();
      setSelectedScheduleId(latest[0]?._id || '');
    },
  });

  const scheduleSummary = useMemo(() => {
    if (!scheduleDetail) {
      return '-';
    }
    if (scheduleDetail.schedule.type === 'interval') {
      const hours = ((scheduleDetail.schedule.intervalMs || 0) / (60 * 60 * 1000)).toFixed(2);
      return `每 ${hours} 小时`;
    }
    return scheduleDetail.schedule.expression || '-';
  }, [scheduleDetail]);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-gradient-to-r from-white via-sky-50 to-cyan-50 px-4 py-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">定时服务管理</h1>
            <p className="mt-1 text-sm text-slate-600">为 Agent 创建可持续运行的计划任务，如每 2 小时自动巡检一次。</p>
          </div>
          <button
            onClick={() => queryClient.invalidateQueries('orchestration-schedules')}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            <ArrowPathIcon className="h-4 w-4" /> 刷新
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 min-h-[640px]">
        <aside className="lg:col-span-4 rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-200 p-4">
            <p className="text-sm font-semibold text-slate-900">新建定时计划</p>
            <div className="mt-3 space-y-2">
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="任务名称，例如：Agent状态巡检"
                className="w-full rounded-md border border-slate-300 px-2 py-2 text-sm"
              />
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="任务描述（可选）"
                className="min-h-[80px] w-full rounded-md border border-slate-300 px-2 py-2 text-sm"
              />
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={scheduleType}
                  onChange={(event) => setScheduleType(event.target.value as ScheduleType)}
                  className="rounded-md border border-slate-300 px-2 py-2 text-sm"
                >
                  <option value="interval">固定间隔</option>
                  <option value="cron">Cron</option>
                </select>
                <select
                  value={executorId}
                  onChange={(event) => setExecutorId(event.target.value)}
                  className="rounded-md border border-slate-300 px-2 py-2 text-sm"
                >
                  <option value="">选择 Agent</option>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </select>
              </div>

              {scheduleType === 'interval' ? (
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    min={1}
                    value={intervalHours}
                    onChange={(event) => setIntervalHours(event.target.value)}
                    className="rounded-md border border-slate-300 px-2 py-2 text-sm"
                  />
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-2 text-xs text-slate-600">单位：小时</div>
                </div>
              ) : (
                <input
                  value={cronExpression}
                  onChange={(event) => setCronExpression(event.target.value)}
                  className="w-full rounded-md border border-slate-300 px-2 py-2 text-sm"
                  placeholder="0 */2 * * *"
                />
              )}

              <input
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
                className="w-full rounded-md border border-slate-300 px-2 py-2 text-sm"
                placeholder="Asia/Shanghai"
              />

              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                className="min-h-[90px] w-full rounded-md border border-slate-300 px-2 py-2 text-sm"
                placeholder="触发后给 Agent 的执行指令"
              />

              <button
                onClick={() =>
                  createMutation.mutate({
                    name: name.trim(),
                    description: description.trim() || undefined,
                    schedule:
                      scheduleType === 'interval'
                        ? {
                            type: 'interval',
                            intervalMs: Math.max(Number(intervalHours || 0), 1) * 60 * 60 * 1000,
                            timezone,
                          }
                        : {
                            type: 'cron',
                            expression: cronExpression.trim(),
                            timezone,
                          },
                    target: {
                      executorType: 'agent',
                      executorId,
                    },
                    input: {
                      prompt: prompt.trim() || undefined,
                    },
                    enabled: true,
                  })
                }
                disabled={!name.trim() || !executorId || createMutation.isLoading}
                className="inline-flex w-full items-center justify-center gap-1 rounded-md bg-primary-600 px-3 py-2 text-sm text-white disabled:bg-slate-300"
              >
                <PlusIcon className="h-4 w-4" /> 创建计划
              </button>
            </div>
          </div>

          <div className="border-b border-slate-200 px-4 py-3">
            <p className="text-sm font-semibold text-slate-900">计划列表</p>
          </div>
          <div className="max-h-[360px] space-y-1 overflow-y-auto p-2">
            {schedulesLoading ? (
              <p className="px-2 py-3 text-sm text-slate-400">加载中...</p>
            ) : schedules.length === 0 ? (
              <p className="px-2 py-3 text-sm text-slate-400">暂无计划</p>
            ) : (
              schedules.map((item) => (
                <button
                  key={item._id}
                  onClick={() => setSelectedScheduleId(item._id)}
                  className={`w-full rounded-md border px-2 py-2 text-left ${
                    selectedScheduleId === item._id
                      ? 'border-primary-400 bg-primary-50'
                      : 'border-transparent hover:bg-slate-50'
                  }`}
                >
                  <p className="truncate text-sm font-medium text-slate-900">{item.name}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {item.enabled ? '已启用' : '已停用'} · {item.status}
                  </p>
                </button>
              ))
            )}
          </div>
        </aside>

        <section className="lg:col-span-8 rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 p-4">
            <div>
              <p className="text-sm font-semibold text-slate-900">{scheduleDetail?.name || '未选择计划'}</p>
              <p className="text-xs text-slate-500">{scheduleSummary}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => selectedScheduleId && triggerMutation.mutate(selectedScheduleId)}
                disabled={!selectedScheduleId || triggerMutation.isLoading}
                className="inline-flex items-center gap-1 rounded-md border border-cyan-200 px-3 py-1.5 text-xs text-cyan-700 hover:bg-cyan-50 disabled:opacity-50"
              >
                <PlayIcon className="h-3.5 w-3.5" /> 手动触发
              </button>
              {scheduleDetail?.enabled ? (
                <button
                  onClick={() => selectedScheduleId && disableMutation.mutate(selectedScheduleId)}
                  disabled={!selectedScheduleId || disableMutation.isLoading}
                  className="inline-flex items-center gap-1 rounded-md border border-amber-200 px-3 py-1.5 text-xs text-amber-700 hover:bg-amber-50"
                >
                  <PowerIcon className="h-3.5 w-3.5" /> 停用
                </button>
              ) : (
                <button
                  onClick={() => selectedScheduleId && enableMutation.mutate(selectedScheduleId)}
                  disabled={!selectedScheduleId || enableMutation.isLoading}
                  className="inline-flex items-center gap-1 rounded-md border border-emerald-200 px-3 py-1.5 text-xs text-emerald-700 hover:bg-emerald-50"
                >
                  <PowerIcon className="h-3.5 w-3.5" /> 启用
                </button>
              )}
              <button
                onClick={() => {
                  if (!selectedScheduleId) return;
                  if (!window.confirm('确认删除该定时计划？')) return;
                  deleteMutation.mutate(selectedScheduleId);
                }}
                disabled={!selectedScheduleId || deleteMutation.isLoading}
                className="inline-flex items-center gap-1 rounded-md border border-rose-200 px-3 py-1.5 text-xs text-rose-700 hover:bg-rose-50"
              >
                <TrashIcon className="h-3.5 w-3.5" /> 删除
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 border-b border-slate-200 bg-slate-50/70 p-4 md:grid-cols-4">
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <p className="text-[11px] text-slate-500">下次执行</p>
              <p className="mt-1 text-sm font-medium text-slate-800">{formatDateTime(scheduleDetail?.nextRunAt)}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <p className="text-[11px] text-slate-500">总执行</p>
              <p className="mt-1 text-sm font-medium text-slate-800">{scheduleDetail?.stats?.totalRuns ?? 0}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <p className="text-[11px] text-slate-500">成功</p>
              <p className="mt-1 text-sm font-medium text-emerald-700">{scheduleDetail?.stats?.successRuns ?? 0}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <p className="text-[11px] text-slate-500">失败/跳过</p>
              <p className="mt-1 text-sm font-medium text-rose-700">
                {(scheduleDetail?.stats?.failedRuns ?? 0) + (scheduleDetail?.stats?.skippedRuns ?? 0)}
              </p>
            </div>
          </div>

          <div className="p-4 space-y-3">
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="text-xs font-semibold text-slate-700">最近执行结果</p>
              <p className="mt-1 text-xs text-slate-600">开始时间：{formatDateTime(scheduleDetail?.lastRun?.startedAt)}</p>
              <p className="text-xs text-slate-600">完成时间：{formatDateTime(scheduleDetail?.lastRun?.completedAt)}</p>
              <p className="text-xs text-slate-600">状态：{scheduleDetail?.lastRun?.success ? '成功' : scheduleDetail?.lastRun?.error ? '失败' : '-'}</p>
              {scheduleDetail?.lastRun?.error && (
                <p className="mt-1 text-xs text-rose-600">错误：{scheduleDetail.lastRun.error}</p>
              )}
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold text-slate-700">执行历史</p>
              {detailLoading ? (
                <p className="text-xs text-slate-400">加载中...</p>
              ) : history.length === 0 ? (
                <p className="text-xs text-slate-400">暂无执行历史</p>
              ) : (
                <div className="space-y-2">
                  {history.map((item) => (
                    <div key={item._id} className="rounded-lg border border-slate-200 px-3 py-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-medium text-slate-700">{item.status}</p>
                        <p className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                          <ClockIcon className="h-3 w-3" /> {formatDateTime(item.createdAt)}
                        </p>
                      </div>
                      <p className="mt-1 text-xs text-slate-600 line-clamp-2">{item.result?.output || item.result?.summary || '-'}</p>
                      {item.result?.error && <p className="mt-1 text-xs text-rose-600">{item.result.error}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500">
        <p className="inline-flex items-center gap-1">
          <BoltIcon className="h-3.5 w-3.5" /> 建议：如果是固定节奏巡检优先使用间隔模式；复杂时间窗口使用 Cron。
        </p>
      </div>
    </div>
  );
};

export default Scheduler;
