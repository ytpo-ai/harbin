import React from 'react';
import { ChevronRightIcon } from '@heroicons/react/24/outline';
import { OrchestrationRun } from '../../../../services/orchestrationService';
import { RUN_STATUS_COLOR, RUN_STATUS_LABEL, RunStatusFilter, RunTriggerFilter, TRIGGER_TYPE_LABEL } from '../../constants';
import { formatDateTime, formatDuration, getRunCompletionPercent } from '../../utils';

type Props = {
  latestRunSummary: OrchestrationRun | null;
  latestRunLoading: boolean;
  runTriggerFilter: RunTriggerFilter;
  runStatusFilter: RunStatusFilter;
  planRunsLoading: boolean;
  planRunsError: unknown;
  filteredPlanRuns: OrchestrationRun[];
  onOpenRunDetail: (runId: string) => void;
  onRunTriggerFilterChange: (value: RunTriggerFilter) => void;
  onRunStatusFilterChange: (value: RunStatusFilter) => void;
};

const HistoryTab: React.FC<Props> = ({
  latestRunSummary,
  latestRunLoading,
  runTriggerFilter,
  runStatusFilter,
  planRunsLoading,
  planRunsError,
  filteredPlanRuns,
  onOpenRunDetail,
  onRunTriggerFilterChange,
  onRunStatusFilterChange,
}) => {
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-slate-900">最近一次执行</p>
            <p className="mt-1 text-xs text-slate-500">展示最近一次 run 摘要，可展开查看任务级执行明细。</p>
          </div>
          {latestRunSummary?._id && (
            <button
              onClick={() => onOpenRunDetail(latestRunSummary._id)}
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
              onChange={(event) => onRunTriggerFilterChange(event.target.value as RunTriggerFilter)}
              className="rounded border border-slate-300 px-2 py-1.5 text-xs"
            >
              <option value="all">全部触发来源</option>
              <option value="manual">手动触发</option>
              <option value="schedule">定时触发</option>
              <option value="autorun">自动触发</option>
            </select>
            <select
              value={runStatusFilter}
              onChange={(event) => onRunStatusFilterChange(event.target.value as RunStatusFilter)}
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
                    onClick={() => onOpenRunDetail(run._id)}
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
  );
};

export default HistoryTab;
