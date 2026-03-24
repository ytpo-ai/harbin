import React from 'react';
import { ChevronRightIcon } from '@heroicons/react/24/outline';
import { OrchestrationRun } from '../../services/orchestrationService';
import {
  RUN_STATUS_COLOR,
  RUN_STATUS_LABEL,
  TRIGGER_TYPE_LABEL,
  formatDateTime,
  formatDuration,
  getRunCompletionPercent,
} from './constants';

interface LatestRunCardProps {
  latestRunSummary: OrchestrationRun | null;
  loading: boolean;
  onOpenRunDetail: (runId: string) => void;
}

const LatestRunCard: React.FC<LatestRunCardProps> = ({ latestRunSummary, loading, onOpenRunDetail }) => {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">最近一次执行</p>
          <p className="mt-1 text-xs text-slate-500">默认展示最后一次 run 摘要，可进入详情查看任务执行明细。</p>
        </div>
        {latestRunSummary?._id && (
          <button
            onClick={() => onOpenRunDetail(latestRunSummary._id)}
            className="inline-flex items-center gap-1 rounded-md border border-primary-200 px-2.5 py-1.5 text-xs text-primary-700 hover:bg-primary-50"
          >
            查看详情
            <ChevronRightIcon className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {loading ? (
        <p className="mt-3 text-xs text-slate-400">加载最近执行中...</p>
      ) : !latestRunSummary ? (
        <p className="mt-3 text-xs text-slate-400">暂无执行记录，可先点击顶部“运行”触发一次计划。</p>
      ) : (
        <>
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
        </>
      )}
    </div>
  );
};

export default LatestRunCard;
