import React from 'react';
import { OrchestrationPlan, OrchestrationRun } from '../../services/orchestrationService';
import PlanStatusBadge from './PlanStatusBadge';
import { RUN_STATUS_COLOR, RUN_STATUS_LABEL, formatDateTime } from './constants';

interface PlanSummaryCardsProps {
  planDetail: OrchestrationPlan;
  latestRunSummary: OrchestrationRun | null;
}

const PlanSummaryCards: React.FC<PlanSummaryCardsProps> = ({ planDetail, latestRunSummary }) => {
  return (
    <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-white p-4 text-sm md:grid-cols-5">
      <div>
        <p className="text-xs text-slate-500">计划状态</p>
        <div className="mt-1">
          <PlanStatusBadge status={planDetail.status} />
        </div>
      </div>
      <div>
        <p className="text-xs text-slate-500">模板任务</p>
        <p className="mt-1 text-sm font-medium text-slate-800">{planDetail.stats?.totalTasks ?? '-'}</p>
      </div>
      <div>
        <p className="text-xs text-slate-500">增量进度</p>
        <p className="mt-1 text-sm font-medium text-slate-800">
          {planDetail.generationState
            ? `${planDetail.generationState.currentStep}/${planDetail.generationConfig?.maxTasks || '-'} 步`
            : '-'}
        </p>
      </div>
      <div>
        <p className="text-xs text-slate-500">最后执行状态</p>
        <span className={`mt-1 inline-flex rounded px-1.5 py-0.5 text-xs ${RUN_STATUS_COLOR[latestRunSummary?.status || ''] || 'bg-slate-100 text-slate-600'}`}>
          {latestRunSummary ? (RUN_STATUS_LABEL[latestRunSummary.status] || latestRunSummary.status) : '暂无执行'}
        </span>
      </div>
      <div>
        <p className="text-xs text-slate-500">最后执行时间</p>
        <p className="mt-1 text-sm font-medium text-slate-800">{formatDateTime(latestRunSummary?.startedAt)}</p>
      </div>
    </div>
  );
};

export default PlanSummaryCards;
