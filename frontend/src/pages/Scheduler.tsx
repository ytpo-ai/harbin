import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from 'react-query';
import {
  ArrowPathIcon,
  BoltIcon,
  ClockIcon,
  EyeIcon,
  PlayIcon,
  PencilSquareIcon,
  PlusIcon,
  PowerIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { agentService } from '../services/agentService';
import {
  schedulerService,
  CreateSchedulePayload,
  OrchestrationSchedule,
  ScheduleRunHistory,
  ScheduleType,
} from '../services/schedulerService';

type IntervalUnit = 'minute' | 'hour';

const formatDateTime = (value?: string) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const formatScheduleRule = (schedule?: OrchestrationSchedule['schedule']) => {
  if (!schedule) return '-';
  if (schedule.type === 'interval') {
    const intervalMs = schedule.intervalMs || 0;
    const hourMs = 60 * 60 * 1000;
    const minuteMs = 60 * 1000;

    if (intervalMs > 0 && intervalMs % hourMs === 0) {
      return `每 ${intervalMs / hourMs} 小时`;
    }
    if (intervalMs > 0 && intervalMs % minuteMs === 0) {
      return `每 ${intervalMs / minuteMs} 分钟`;
    }

    return `每 ${intervalMs} 毫秒`;
  }

  return schedule.expression || '-';
};

const toIntervalMs = (value: string, unit: IntervalUnit) => {
  const amount = Math.max(Number(value || 0), 1);
  if (unit === 'minute') {
    return amount * 60 * 1000;
  }

  return amount * 60 * 60 * 1000;
};

const parseIntervalForForm = (intervalMs?: number): { value: string; unit: IntervalUnit } => {
  const safeInterval = Math.max(intervalMs || 0, 60 * 1000);
  const hourMs = 60 * 60 * 1000;
  const minuteMs = 60 * 1000;

  if (safeInterval % hourMs === 0) {
    return { value: String(safeInterval / hourMs), unit: 'hour' };
  }

  return { value: String(Math.max(Math.round(safeInterval / minuteMs), 1)), unit: 'minute' };
};

const Scheduler: React.FC = () => {
  const queryClient = useQueryClient();
  const [selectedScheduleId, setSelectedScheduleId] = useState('');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDetailDrawerOpen, setIsDetailDrawerOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [scheduleType, setScheduleType] = useState<ScheduleType>('interval');
  const [intervalValue, setIntervalValue] = useState('2');
  const [intervalUnit, setIntervalUnit] = useState<IntervalUnit>('hour');
  const [cronExpression, setCronExpression] = useState('0 */2 * * *');
  const [timezone, setTimezone] = useState('Asia/Shanghai');
  const [executorId, setExecutorId] = useState('');
  const [prompt, setPrompt] = useState('请检查关键状态并给出结构化结论。');
  const [editingScheduleId, setEditingScheduleId] = useState('');
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editScheduleType, setEditScheduleType] = useState<ScheduleType>('interval');
  const [editIntervalValue, setEditIntervalValue] = useState('2');
  const [editIntervalUnit, setEditIntervalUnit] = useState<IntervalUnit>('hour');
  const [editCronExpression, setEditCronExpression] = useState('0 */2 * * *');
  const [editTimezone, setEditTimezone] = useState('Asia/Shanghai');
  const [editExecutorId, setEditExecutorId] = useState('');
  const [editPrompt, setEditPrompt] = useState('');

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
      enabled: Boolean(selectedScheduleId) && isDetailDrawerOpen,
      refetchInterval: selectedScheduleId && isDetailDrawerOpen ? 5000 : false,
    },
  );

  useEffect(() => {
    if (!executorId && agents.length) {
      setExecutorId(agents[0].id);
    }
  }, [agents, executorId]);

  const resetCreateForm = () => {
    setName('');
    setDescription('');
    setScheduleType('interval');
    setIntervalValue('2');
    setIntervalUnit('hour');
    setCronExpression('0 */2 * * *');
    setTimezone('Asia/Shanghai');
    setPrompt('请检查关键状态并给出结构化结论。');
  };

  const createMutation = useMutation(schedulerService.createSchedule, {
    onSuccess: async (created) => {
      await queryClient.invalidateQueries('orchestration-schedules');
      setSelectedScheduleId(created._id);
      setIsDetailDrawerOpen(true);
      setIsCreateModalOpen(false);
      resetCreateForm();
    },
  });

  const enableMutation = useMutation((scheduleId: string) => schedulerService.enableSchedule(scheduleId), {
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries('orchestration-schedules'),
        queryClient.invalidateQueries(['orchestration-schedule']),
      ]);
    },
  });

  const disableMutation = useMutation((scheduleId: string) => schedulerService.disableSchedule(scheduleId), {
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries('orchestration-schedules'),
        queryClient.invalidateQueries(['orchestration-schedule']),
      ]);
    },
  });

  const triggerMutation = useMutation((scheduleId: string) => schedulerService.triggerSchedule(scheduleId), {
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries('orchestration-schedules'),
        queryClient.invalidateQueries(['orchestration-schedule']),
        queryClient.invalidateQueries(['orchestration-schedule-history']),
      ]);
    },
  });

  const deleteMutation = useMutation((scheduleId: string) => schedulerService.deleteSchedule(scheduleId), {
    onSuccess: async (_, scheduleId) => {
      await queryClient.invalidateQueries('orchestration-schedules');
      if (scheduleId === editingScheduleId) {
        setIsEditModalOpen(false);
        setEditingScheduleId('');
      }
      if (scheduleId === selectedScheduleId) {
        setSelectedScheduleId('');
        setIsDetailDrawerOpen(false);
      }
    },
  });

  const updateMutation = useMutation(
    ({ scheduleId, payload }: { scheduleId: string; payload: Partial<CreateSchedulePayload> }) =>
      schedulerService.updateSchedule(scheduleId, payload),
    {
      onSuccess: async (updated) => {
        await Promise.all([
          queryClient.invalidateQueries('orchestration-schedules'),
          queryClient.invalidateQueries(['orchestration-schedule', updated._id]),
        ]);
        setSelectedScheduleId(updated._id);
        setIsDetailDrawerOpen(true);
        setIsEditModalOpen(false);
        setEditingScheduleId('');
      },
    },
  );

  const selectedSchedule = useMemo(
    () => schedules.find((item) => item._id === selectedScheduleId),
    [schedules, selectedScheduleId],
  );

  const historyLimit = scheduleDetail?.planId || selectedSchedule?.planId ? 1 : 15;

  const { data: history = [], isFetching: historyLoading } = useQuery<ScheduleRunHistory[]>(
    ['orchestration-schedule-history', selectedScheduleId, historyLimit],
    () => schedulerService.getScheduleHistory(selectedScheduleId, historyLimit),
    {
      enabled: Boolean(selectedScheduleId) && isDetailDrawerOpen,
      refetchInterval: selectedScheduleId && isDetailDrawerOpen ? 5000 : false,
    },
  );

  const editingSchedule = useMemo(() => {
    if (!editingScheduleId) return undefined;
    if (scheduleDetail && scheduleDetail._id === editingScheduleId) {
      return scheduleDetail;
    }

    return schedules.find((item) => item._id === editingScheduleId);
  }, [editingScheduleId, scheduleDetail, schedules]);

  const selectedScheduleName = scheduleDetail?.name || selectedSchedule?.name || '定时计划详情';
  const scheduleSummary = formatScheduleRule(scheduleDetail?.schedule || selectedSchedule?.schedule);

  const submitCreate = () => {
    createMutation.mutate({
      name: name.trim(),
      description: description.trim() || undefined,
      schedule:
        scheduleType === 'interval'
          ? {
              type: 'interval',
              intervalMs: toIntervalMs(intervalValue, intervalUnit),
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
    });
  };

  const openScheduleDetail = (scheduleId: string) => {
    setSelectedScheduleId(scheduleId);
    setIsDetailDrawerOpen(true);
  };

  const openEditModal = (scheduleId: string) => {
    const schedule =
      scheduleDetail && scheduleDetail._id === scheduleId
        ? scheduleDetail
        : schedules.find((item) => item._id === scheduleId);

    if (!schedule) return;

    setEditingScheduleId(scheduleId);
    setEditName(schedule.name || '');
    setEditDescription(schedule.description || '');
    setEditScheduleType(schedule.schedule?.type || 'interval');
    const parsedInterval = parseIntervalForForm(schedule.schedule?.intervalMs);
    setEditIntervalValue(parsedInterval.value);
    setEditIntervalUnit(parsedInterval.unit);
    setEditCronExpression(schedule.schedule?.expression || '0 */2 * * *');
    setEditTimezone(schedule.schedule?.timezone || 'Asia/Shanghai');
    setEditExecutorId(schedule.target?.executorId || '');
    setEditPrompt(schedule.input?.prompt || '');
    setIsEditModalOpen(true);
  };

  const deleteSchedule = (scheduleId: string) => {
    if (!window.confirm('确认删除该定时计划？')) return;
    deleteMutation.mutate(scheduleId);
  };

  const submitEdit = () => {
    if (!editingScheduleId) return;

    updateMutation.mutate({
      scheduleId: editingScheduleId,
      payload: {
        name: editName.trim(),
        description: editDescription.trim() || undefined,
        schedule:
          editScheduleType === 'interval'
            ? {
                type: 'interval',
                intervalMs: toIntervalMs(editIntervalValue, editIntervalUnit),
                timezone: editTimezone,
              }
            : {
                type: 'cron',
                expression: editCronExpression.trim(),
                timezone: editTimezone,
              },
        target: {
          executorType: 'agent',
          executorId: editExecutorId,
        },
        input: {
          prompt: editPrompt.trim() || undefined,
        },
        enabled: editingSchedule?.enabled,
      },
    });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-gradient-to-r from-white via-sky-50 to-cyan-50 px-4 py-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">定时服务管理</h1>
            <p className="mt-1 text-sm text-slate-600">为 Agent 创建可持续运行的计划任务，如每 2 小时自动巡检一次。</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => queryClient.invalidateQueries('orchestration-schedules')}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              <ArrowPathIcon className="h-4 w-4" /> 刷新
            </button>
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="inline-flex items-center gap-1 rounded-md bg-primary-600 px-3 py-2 text-sm text-white hover:bg-primary-700"
            >
              <PlusIcon className="h-4 w-4" /> 新建计划
            </button>
          </div>
        </div>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <p className="text-sm font-semibold text-slate-900">定时计划列表</p>
          <p className="text-xs text-slate-500">共 {schedules.length} 条</p>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-xs text-slate-600">
              <tr>
                <th className="px-4 py-3 text-left font-medium">计划</th>
                <th className="px-4 py-3 text-left font-medium">规则</th>
                <th className="px-4 py-3 text-left font-medium">状态</th>
                <th className="px-4 py-3 text-left font-medium">下次执行</th>
                <th className="px-4 py-3 text-left font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {schedulesLoading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-sm text-slate-400">
                    加载中...
                  </td>
                </tr>
              ) : schedules.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-400">
                    暂无计划，点击右上角“新建计划”开始创建。
                  </td>
                </tr>
              ) : (
                schedules.map((item) => (
                  <tr key={item._id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3 align-top">
                      <p className="font-medium text-slate-900">{item.name}</p>
                      <p className="mt-1 line-clamp-2 text-xs text-slate-500">{item.description || '-'}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{formatScheduleRule(item.schedule)}</td>
                    <td className="px-4 py-3">
                      <p className="text-slate-700">{item.enabled ? '已启用' : '已停用'}</p>
                      <p className="mt-1 text-xs text-slate-500">{item.status}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{formatDateTime(item.nextRunAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          onClick={() => openScheduleDetail(item._id)}
                          title="查看详情"
                          aria-label="查看详情"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 text-slate-700 hover:bg-slate-100"
                        >
                          <EyeIcon className="h-4 w-4" />
                        </button>
                        {item.planId && (
                          <button
                            onClick={() => window.open(`/orchestration/plans/${item.planId}`, '_blank')}
                            title="查看关联计划"
                            aria-label="查看关联计划"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-cyan-200 text-cyan-700 hover:bg-cyan-50"
                          >
                            <PlayIcon className="h-4 w-4" />
                          </button>
                        )}
                        <button
                          onClick={() => openEditModal(item._id)}
                          title="编辑"
                          aria-label="编辑"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-amber-200 text-amber-700 hover:bg-amber-50"
                        >
                          <PencilSquareIcon className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => deleteSchedule(item._id)}
                          disabled={deleteMutation.isLoading}
                          title="删除"
                          aria-label="删除"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-rose-200 text-rose-700 hover:bg-rose-50 disabled:opacity-50"
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

      <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500">
        <p className="inline-flex items-center gap-1">
          <BoltIcon className="h-3.5 w-3.5" /> 建议：如果是固定节奏巡检优先使用间隔模式；复杂时间窗口使用 Cron。
        </p>
      </div>

      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-2xl rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <p className="text-sm font-semibold text-slate-900">新建定时计划</p>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                aria-label="关闭新建弹窗"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="max-h-[70vh] space-y-3 overflow-y-auto px-4 py-4">
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

              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
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
                    value={intervalValue}
                    onChange={(event) => setIntervalValue(event.target.value)}
                    className="rounded-md border border-slate-300 px-2 py-2 text-sm"
                  />
                  <select
                    value={intervalUnit}
                    onChange={(event) => setIntervalUnit(event.target.value as IntervalUnit)}
                    className="rounded-md border border-slate-300 px-2 py-2 text-sm"
                  >
                    <option value="minute">分钟</option>
                    <option value="hour">小时</option>
                  </select>
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
                className="min-h-[100px] w-full rounded-md border border-slate-300 px-2 py-2 text-sm"
                placeholder="触发后给 Agent 的执行指令"
              />

              {createMutation.isError && (
                <p className="text-xs text-rose-600">创建失败，请检查输入后重试。</p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
              >
                取消
              </button>
              <button
                onClick={submitCreate}
                disabled={!name.trim() || !executorId || createMutation.isLoading}
                className="inline-flex items-center gap-1 rounded-md bg-primary-600 px-3 py-1.5 text-sm text-white disabled:bg-slate-300"
              >
                <PlusIcon className="h-4 w-4" /> 创建计划
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
          <aside className="absolute right-0 top-0 h-full w-full max-w-2xl overflow-y-auto bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">{selectedScheduleName}</p>
                <p className="text-xs text-slate-500">{scheduleSummary}</p>
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
              {!selectedScheduleId ? (
                <p className="text-sm text-slate-500">未选择计划。</p>
              ) : detailLoading && !scheduleDetail ? (
                <p className="text-sm text-slate-500">加载中...</p>
              ) : !scheduleDetail ? (
                <p className="text-sm text-slate-500">未获取到计划详情。</p>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => selectedScheduleId && openEditModal(selectedScheduleId)}
                      disabled={!selectedScheduleId}
                      className="inline-flex items-center gap-1 rounded-md border border-amber-200 px-3 py-1.5 text-xs text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                    >
                      <PencilSquareIcon className="h-3.5 w-3.5" /> 编辑
                    </button>
                    <button
                      onClick={() => selectedScheduleId && triggerMutation.mutate(selectedScheduleId)}
                      disabled={!selectedScheduleId || triggerMutation.isLoading}
                      className="inline-flex items-center gap-1 rounded-md border border-cyan-200 px-3 py-1.5 text-xs text-cyan-700 hover:bg-cyan-50 disabled:opacity-50"
                    >
                      <PlayIcon className="h-3.5 w-3.5" /> 手动触发
                    </button>

                    {scheduleDetail.enabled ? (
                      <button
                        onClick={() => selectedScheduleId && disableMutation.mutate(selectedScheduleId)}
                        disabled={!selectedScheduleId || disableMutation.isLoading}
                        className="inline-flex items-center gap-1 rounded-md border border-amber-200 px-3 py-1.5 text-xs text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                      >
                        <PowerIcon className="h-3.5 w-3.5" /> 停用
                      </button>
                    ) : (
                      <button
                        onClick={() => selectedScheduleId && enableMutation.mutate(selectedScheduleId)}
                        disabled={!selectedScheduleId || enableMutation.isLoading}
                        className="inline-flex items-center gap-1 rounded-md border border-emerald-200 px-3 py-1.5 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                      >
                        <PowerIcon className="h-3.5 w-3.5" /> 启用
                      </button>
                    )}

                    <button
                      onClick={() => selectedScheduleId && deleteSchedule(selectedScheduleId)}
                      disabled={!selectedScheduleId || deleteMutation.isLoading}
                      className="inline-flex items-center gap-1 rounded-md border border-rose-200 px-3 py-1.5 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                    >
                      <TrashIcon className="h-3.5 w-3.5" /> 删除
                    </button>
                  </div>

                  <div className="grid grid-cols-1 gap-3 bg-slate-50/70 md:grid-cols-4 md:rounded-lg md:border md:border-slate-200 md:p-3">
                    <div className="rounded-lg border border-slate-200 bg-white p-3">
                      <p className="text-[11px] text-slate-500">下次执行</p>
                      <p className="mt-1 text-sm font-medium text-slate-800">{formatDateTime(scheduleDetail.nextRunAt)}</p>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-white p-3">
                      <p className="text-[11px] text-slate-500">总执行</p>
                      <p className="mt-1 text-sm font-medium text-slate-800">{scheduleDetail.stats?.totalRuns ?? 0}</p>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-white p-3">
                      <p className="text-[11px] text-slate-500">成功</p>
                      <p className="mt-1 text-sm font-medium text-emerald-700">{scheduleDetail.stats?.successRuns ?? 0}</p>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-white p-3">
                      <p className="text-[11px] text-slate-500">失败/跳过</p>
                      <p className="mt-1 text-sm font-medium text-rose-700">
                        {(scheduleDetail.stats?.failedRuns ?? 0) + (scheduleDetail.stats?.skippedRuns ?? 0)}
                      </p>
                    </div>
                  </div>

                  <div className="rounded-lg border border-slate-200 p-3">
                    <p className="text-xs font-semibold text-slate-700">计划配置</p>
                    <p className="mt-1 text-xs text-slate-600">执行对象：{scheduleDetail.target?.executorName || scheduleDetail.target?.executorId || '-'}</p>
                    <p className="text-xs text-slate-600">时区：{scheduleDetail.schedule?.timezone || '-'}</p>
                    <p className="text-xs text-slate-600">更新时间：{formatDateTime(scheduleDetail.updatedAt)}</p>
                  </div>

                  <div className="rounded-lg border border-slate-200 p-3">
                    <p className="text-xs font-semibold text-slate-700">最近执行结果</p>
                    <p className="mt-1 text-xs text-slate-600">开始时间：{formatDateTime(scheduleDetail.lastRun?.startedAt)}</p>
                    <p className="text-xs text-slate-600">完成时间：{formatDateTime(scheduleDetail.lastRun?.completedAt)}</p>
                    <p className="text-xs text-slate-600">
                      状态：
                      {scheduleDetail.lastRun?.success ? '成功' : scheduleDetail.lastRun?.error ? '失败' : '-'}
                    </p>
                    {scheduleDetail.lastRun?.error && (
                      <p className="mt-1 text-xs text-rose-600">错误：{scheduleDetail.lastRun.error}</p>
                    )}
                  </div>

                  <div>
                    <p className="mb-2 text-xs font-semibold text-slate-700">执行历史</p>
                    {historyLoading ? (
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
                            <p className="mt-1 line-clamp-2 text-xs text-slate-600">
                              {item.summary || '-'}
                            </p>
                            {item.error && (
                              <p className="mt-1 text-xs text-rose-600">{item.error}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </aside>
        </div>
      )}

      {isEditModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-2xl rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <p className="text-sm font-semibold text-slate-900">编辑定时计划</p>
              <button
                onClick={() => {
                  setIsEditModalOpen(false);
                  setEditingScheduleId('');
                }}
                className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                aria-label="关闭编辑弹窗"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="max-h-[70vh] space-y-3 overflow-y-auto px-4 py-4">
              <input
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
                placeholder="任务名称，例如：Agent状态巡检"
                className="w-full rounded-md border border-slate-300 px-2 py-2 text-sm"
              />

              <textarea
                value={editDescription}
                onChange={(event) => setEditDescription(event.target.value)}
                placeholder="任务描述（可选）"
                className="min-h-[80px] w-full rounded-md border border-slate-300 px-2 py-2 text-sm"
              />

              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <select
                  value={editScheduleType}
                  onChange={(event) => setEditScheduleType(event.target.value as ScheduleType)}
                  className="rounded-md border border-slate-300 px-2 py-2 text-sm"
                >
                  <option value="interval">固定间隔</option>
                  <option value="cron">Cron</option>
                </select>
                <select
                  value={editExecutorId}
                  onChange={(event) => setEditExecutorId(event.target.value)}
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

              {editScheduleType === 'interval' ? (
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    min={1}
                    value={editIntervalValue}
                    onChange={(event) => setEditIntervalValue(event.target.value)}
                    className="rounded-md border border-slate-300 px-2 py-2 text-sm"
                  />
                  <select
                    value={editIntervalUnit}
                    onChange={(event) => setEditIntervalUnit(event.target.value as IntervalUnit)}
                    className="rounded-md border border-slate-300 px-2 py-2 text-sm"
                  >
                    <option value="minute">分钟</option>
                    <option value="hour">小时</option>
                  </select>
                </div>
              ) : (
                <input
                  value={editCronExpression}
                  onChange={(event) => setEditCronExpression(event.target.value)}
                  className="w-full rounded-md border border-slate-300 px-2 py-2 text-sm"
                  placeholder="0 */2 * * *"
                />
              )}

              <input
                value={editTimezone}
                onChange={(event) => setEditTimezone(event.target.value)}
                className="w-full rounded-md border border-slate-300 px-2 py-2 text-sm"
                placeholder="Asia/Shanghai"
              />

              <textarea
                value={editPrompt}
                onChange={(event) => setEditPrompt(event.target.value)}
                className="min-h-[100px] w-full rounded-md border border-slate-300 px-2 py-2 text-sm"
                placeholder="触发后给 Agent 的执行指令"
              />

              {updateMutation.isError && <p className="text-xs text-rose-600">修改失败，请稍后重试。</p>}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
              <button
                onClick={() => {
                  setIsEditModalOpen(false);
                  setEditingScheduleId('');
                }}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
              >
                取消
              </button>
              <button
                onClick={submitEdit}
                disabled={!editName.trim() || !editExecutorId || updateMutation.isLoading}
                className="inline-flex items-center gap-1 rounded-md bg-primary-600 px-3 py-1.5 text-sm text-white disabled:bg-slate-300"
              >
                <PencilSquareIcon className="h-4 w-4" /> 保存修改
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Scheduler;
