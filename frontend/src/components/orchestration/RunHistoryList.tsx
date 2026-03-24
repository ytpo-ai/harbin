import React from 'react';
import { ChevronRightIcon } from '@heroicons/react/24/outline';
import { OrchestrationRun } from '../../services/orchestrationService';
import {
  RUN_STATUS_COLOR,
  RUN_STATUS_LABEL,
  TRIGGER_TYPE_LABEL,
  formatDateTime,
  formatDuration,
} from './constants';

interface RunHistoryListProps {
  runs: OrchestrationRun[];
  loading: boolean;
  hasError: boolean;
  runTriggerFilter: 'all' | 'manual' | 'schedule' | 'autorun';
  runStatusFilter: 'all' | 'running' | 'completed' | 'failed' | 'cancelled';
  isCancelling: boolean;
  onChangeTriggerFilter: (value: 'all' | 'manual' | 'schedule' | 'autorun') => void;
  onChangeStatusFilter: (value: 'all' | 'running' | 'completed' | 'failed' | 'cancelled') => void;
  onOpenRunDetail: (runId: string) => void;
  onCancelRun: (runId: string) => void;
}

const RunHistoryList: React.FC<RunHistoryListProps> = ({
  runs,
  loading,
  hasError,
  runTriggerFilter,
  runStatusFilter,
  isCancelling,
  onChangeTriggerFilter,
  onChangeStatusFilter,
  onOpenRunDetail,
  onCancelRun,
}) => {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-900">执行历史</p>
        <div className="flex items-center gap-2">
          <select
            value={runTriggerFilter}
            onChange={(event) => onChangeTriggerFilter(event.target.value as RunHistoryListProps['runTriggerFilter'])}
            className="rounded border border-slate-300 px-2 py-1.5 text-xs"
          >
            <option value="all">全部触发来源</option>
            <option value="manual">手动触发</option>
            <option value="schedule">定时触发</option>
            <option value="autorun">自动触发</option>
          </select>
          <select
            value={runStatusFilter}
            onChange={(event) => onChangeStatusFilter(event.target.value as RunHistoryListProps['runStatusFilter'])}
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

      {loading ? (
        <p className="text-xs text-slate-400">加载历史中...</p>
      ) : hasError ? (
        <p className="text-xs text-rose-600">执行历史加载失败，请稍后重试。</p>
      ) : runs.length === 0 ? (
        <p className="text-xs text-slate-400">当前筛选条件下暂无执行记录。</p>
      ) : (
        <div className="space-y-2">
          {runs.map((run) => (
            <div key={run._id} className="rounded-lg border border-slate-200 px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className={`inline-flex rounded px-1.5 py-0.5 text-xs ${RUN_STATUS_COLOR[run.status] || 'bg-slate-100 text-slate-600'}`}>
                    {RUN_STATUS_LABEL[run.status] || run.status}
                  </span>
                  <p className="text-xs font-medium text-slate-700">{TRIGGER_TYPE_LABEL[run.triggerType] || run.triggerType}</p>
                  <p className="text-[11px] text-slate-500">{run._id}</p>
                </div>
                <div className="flex items-center gap-2">
                  {run.status === 'running' && (
                    <button
                      onClick={() => onCancelRun(run._id)}
                      disabled={isCancelling}
                      className="inline-flex items-center gap-1 rounded border border-rose-200 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                    >
                      取消
                    </button>
                  )}
                  <button
                    onClick={() => onOpenRunDetail(run._id)}
                    className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                  >
                    查看详情
                    <ChevronRightIcon className="h-3.5 w-3.5" />
                  </button>
                </div>
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
  );
};

export default RunHistoryList;
