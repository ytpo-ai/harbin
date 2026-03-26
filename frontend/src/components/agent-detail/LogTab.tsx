import React from 'react';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import { AgentActionLogQuery } from '../../services/agentActionLogService';
import { CONTEXT_TYPE_LABEL, LOG_STATUS_META, LogStatus } from './constants';
import { useLogState } from './hooks/useLogState';
import { formatSyncState, getActionDescription, getActionSemantic, getTaskStatusMeta } from './utils';

interface LogTabProps {
  agentId: string;
  onViewSession: (sessionId: string) => void;
}

export const LogTab: React.FC<LogTabProps> = ({ agentId, onViewSession }) => {
  const state = useLogState(agentId);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-slate-900">Agent 日志</h2>
          <p className="mt-1 text-sm text-slate-500">按任务维度查看执行轨迹，点击展开查看详细 Action</p>
        </div>
        <button
          onClick={() => state.logQuery.refetch()}
          className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 transition-all hover:border-slate-300 hover:bg-slate-50"
        >
          <ArrowPathIcon className={`mr-2 h-4 w-4 ${state.logQuery.isFetching ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200/50">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <input
            type="datetime-local"
            value={state.logFilters.from || ''}
            onChange={(e) => state.updateLogFilter({ from: e.target.value || undefined })}
            className="rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2.5 text-sm transition-all focus:border-primary-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-100"
            placeholder="开始时间"
          />
          <input
            type="datetime-local"
            value={state.logFilters.to || ''}
            onChange={(e) => state.updateLogFilter({ to: e.target.value || undefined })}
            className="rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2.5 text-sm transition-all focus:border-primary-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-100"
            placeholder="结束时间"
          />
          <select
            value={state.logFilters.contextType || ''}
            onChange={(e) => state.updateLogFilter({ contextType: e.target.value as AgentActionLogQuery['contextType'] })}
            className="rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2.5 text-sm transition-all focus:border-primary-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-100"
          >
            <option value="">全部上下文</option>
            <option value="chat">Chat</option>
            <option value="orchestration">Orchestration</option>
          </select>
          <select
            value={state.logFilters.status || ''}
            onChange={(e) => state.updateLogFilter({ status: e.target.value as AgentActionLogQuery['status'] })}
            className="rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2.5 text-sm transition-all focus:border-primary-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-100"
          >
            <option value="">全部状态</option>
            <option value="completed">成功</option>
            <option value="failed">失败</option>
            <option value="running">运行中</option>
            <option value="paused">已暂停</option>
            <option value="asked">待授权</option>
            <option value="cancelled">已取消</option>
          </select>
        </div>
        <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
          <span>
            共 <span className="font-semibold text-slate-700">{state.logQuery.data?.total || 0}</span> 条日志，聚合为{' '}
            <span className="font-semibold text-slate-700">{state.taskGroups.length}</span> 个任务
          </span>
          <span>
            页码 <span className="font-semibold text-slate-700">{state.logQuery.data?.page || 1}</span>/
            {Math.max(1, state.logQuery.data?.totalPages || 1)}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-400">最新运行</p>
          <p className="mt-2 text-sm font-semibold text-slate-900">
            {state.runtimeRunQuery.data?.status
              ? LOG_STATUS_META[state.runtimeRunQuery.data.status as LogStatus]?.label || state.runtimeRunQuery.data.status
              : '-'}
          </p>
          <p className="mt-1 text-xs text-slate-500">步骤 {state.runtimeRunQuery.data?.currentStep ?? '-'}</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-400">同步状态</p>
          <p className="mt-2 text-sm font-semibold text-slate-900">{formatSyncState(state.runtimeRunQuery.data)}</p>
          <p className="mt-1 text-xs text-slate-500">
            {state.runtimeRunQuery.data?.sync?.lastSyncAt
              ? `最近同步: ${new Date(state.runtimeRunQuery.data.sync.lastSyncAt).toLocaleString()}`
              : '暂无同步记录'}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-400">授权处理</p>
          <p className="mt-2 text-sm font-semibold text-slate-900">
            {state.approvalRunCandidates.length > 0 ? `${state.approvalRunCandidates.length} 条待处理` : '无待处理'}
          </p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => state.handleApprovalDecision(true)}
              disabled={!state.approvalTargetRunId || state.handlingApprovalRunId === state.approvalTargetRunId}
              className="rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-40"
            >
              同意
            </button>
            <button
              onClick={() => state.handleApprovalDecision(false)}
              disabled={!state.approvalTargetRunId || state.handlingApprovalRunId === state.approvalTargetRunId}
              className="rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-700 transition-colors hover:bg-rose-100 disabled:opacity-40"
            >
              拒绝
            </button>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200/50">
        {state.logQuery.isLoading ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="animate-pulse rounded-xl border border-slate-100 p-5">
                <div className="mb-4 h-4 w-32 rounded-lg bg-slate-100" />
                <div className="mb-3 h-6 w-1/2 rounded-lg bg-slate-200" />
                <div className="h-4 w-3/4 rounded-lg bg-slate-100" />
              </div>
            ))}
          </div>
        ) : state.logQuery.error ? (
          <div className="flex flex-col items-center justify-center p-12 text-red-500">
            <p className="text-sm font-medium">日志查询失败，请检查权限或筛选条件</p>
          </div>
        ) : state.taskGroups.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-slate-400">
            <p className="text-sm">暂无日志数据</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {state.taskGroups.map((group) => {
              const isExpanded = state.expandedTaskKeys[group.groupKey] === true;
              const viewMode = state.taskViewModes[group.groupKey] || 'readable';
              const isRawMode = viewMode === 'raw';
              const statusMeta = getTaskStatusMeta(group.finalStatus);
              const durationStr =
                group.totalDurationMs >= 1000 ? `${(group.totalDurationMs / 1000).toFixed(1)}s` : `${group.totalDurationMs}ms`;

              return (
                <div key={group.groupKey}>
                  <button
                    onClick={() => state.toggleTaskExpanded(group.groupKey)}
                    className="w-full px-5 py-4 text-left transition-colors hover:bg-slate-50/50"
                  >
                    <div className="flex items-start gap-4">
                      <div className="mt-0.5 flex-shrink-0">
                        <span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold ring-1 ${statusMeta.badgeClass}`}>
                          {group.finalStatus === 'completed'
                            ? 'v'
                            : group.finalStatus === 'failed'
                              ? '!'
                              : group.finalStatus === 'running' || group.finalStatus === 'started'
                                ? '>'
                                : group.finalStatus === 'paused'
                                  ? '||'
                                  : group.finalStatus === 'asked'
                                    ? '?'
                                    : '.'}
                        </span>
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate text-sm font-semibold text-slate-900">{group.title || '未命名任务'}</h3>
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${statusMeta.badgeClass}`}>
                            {statusMeta.label}
                          </span>
                          <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500 ring-1 ring-slate-200/60">
                            {CONTEXT_TYPE_LABEL[group.contextType]}
                          </span>
                        </div>
                        <div className="mt-1.5 flex items-center gap-3 text-xs text-slate-400">
                          <span>{new Date(group.startTime).toLocaleString()}</span>
                          <span>{durationStr}</span>
                          <span>{group.actionCount} 个事件</span>
                        </div>
                        <p className="mt-1.5 truncate text-xs text-slate-500">{group.lastActionSummary}</p>
                      </div>

                      <div className="mt-1 flex flex-shrink-0 items-center gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            state.toggleTaskViewMode(group.groupKey);
                          }}
                          className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50"
                        >
                          {isRawMode ? '切换可读' : '切换原始'}
                        </button>
                        <span className={`inline-block text-slate-400 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}>
                          {'>'}
                        </span>
                      </div>
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="border-t border-slate-100 bg-slate-50/30 px-5 py-4">
                      {isRawMode ? (
                        <div className="space-y-3">
                          <p className="text-xs font-medium text-slate-500">原始任务数据（JSON）</p>
                          <pre className="max-h-[420px] overflow-auto rounded-lg border border-slate-200 bg-slate-900 p-4 text-[11px] leading-relaxed text-slate-100">
                            {JSON.stringify(
                              {
                                groupKey: group.groupKey,
                                title: group.title,
                                contextType: group.contextType,
                                finalStatus: group.finalStatus,
                                startTime: group.startTime,
                                endTime: group.endTime,
                                actionCount: group.actionCount,
                                totalDurationMs: group.totalDurationMs,
                                actions: group.actions,
                              },
                              null,
                              2,
                            )}
                          </pre>
                        </div>
                      ) : (
                        <div className="relative ml-4 space-y-0 border-l-2 border-slate-200 pl-6">
                          {group.actions.map((item, idx) => {
                            const semantic = getActionSemantic(item.action);
                            const desc = getActionDescription(item);
                            const isLast = idx === group.actions.length - 1;
                            const sessionId = item.details?.agentSessionId || item.details?.sessionId;
                            const hasError = !!item.details?.error;

                            return (
                              <div key={item.id} className="relative pb-4 last:pb-0">
                                <div className="absolute -left-[31px] top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-white ring-2 ring-slate-200">
                                  <span className={`text-[10px] leading-none ${semantic.color.split(' ')[0]}`}>{semantic.icon}</span>
                                </div>

                                <div className={`rounded-lg border bg-white px-4 py-3 transition-all ${hasError ? 'border-red-200/60' : 'border-slate-200/60'}`}>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ring-1 ${semantic.color}`}>{semantic.label}</span>
                                    <span className="text-[11px] text-slate-400">{new Date(item.timestamp).toLocaleTimeString()}</span>
                                    {typeof item.details?.durationMs === 'number' && item.details.durationMs > 0 && (
                                      <span className="text-[11px] text-slate-400">
                                        {item.details.durationMs >= 1000
                                          ? `${(item.details.durationMs / 1000).toFixed(1)}s`
                                          : `${item.details.durationMs}ms`}
                                      </span>
                                    )}
                                  </div>

                                  {desc && <p className="mt-1.5 text-xs text-slate-600">{desc}</p>}

                                  {hasError && (
                                    <div className="mt-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-600">
                                      {String(item.details?.error).slice(0, 200)}
                                    </div>
                                  )}

                                  {isLast && typeof sessionId === 'string' && sessionId && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onViewSession(sessionId);
                                      }}
                                      className="mt-2 inline-flex items-center text-[11px] font-medium text-primary-600 transition-colors hover:text-primary-700"
                                    >
                                      查看 Session -&gt;
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {state.logQuery.data && state.logQuery.data.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-500">
            第 {state.logFilters.page || 1} / {state.logQuery.data.totalPages} 页
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => state.setLogFilters((prev) => ({ ...prev, page: Math.max(1, (prev.page || 1) - 1) }))}
              disabled={(state.logFilters.page || 1) <= 1}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition-all hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              上一页
            </button>
            <button
              onClick={() => state.setLogFilters((prev) => ({ ...prev, page: (prev.page || 1) + 1 }))}
              disabled={!!state.logQuery.data && (state.logFilters.page || 1) >= (state.logQuery.data.totalPages || 1)}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition-all hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              下一页
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
