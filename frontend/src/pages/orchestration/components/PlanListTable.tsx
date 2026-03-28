import React from 'react';
import { DocumentDuplicateIcon, EyeIcon, TrashIcon } from '@heroicons/react/24/outline';
import { OrchestrationPlan } from '../../../services/orchestrationService';
import { STATUS_COLOR } from '../constants';
import { formatDateTime } from '../utils';

type Props = {
  plans: OrchestrationPlan[];
  plansLoading: boolean;
  deleteLoading: boolean;
  onCopyPlan: (plan: OrchestrationPlan) => void;
  onDeletePlan: (planId: string) => void;
};

const PlanListTable: React.FC<Props> = ({
  plans,
  plansLoading,
  deleteLoading,
  onCopyPlan,
  onDeletePlan,
}) => {
  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <p className="text-sm font-semibold text-slate-900">Plan 列表</p>
        <p className="text-xs text-slate-500">共 {plans.length} 条</p>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-xs text-slate-600">
            <tr>
              <th className="px-4 py-3 text-left font-medium">计划</th>
              <th className="px-4 py-3 text-left font-medium">状态</th>
              <th className="px-4 py-3 text-left font-medium">模式</th>
              <th className="px-4 py-3 text-left font-medium">进度</th>
              <th className="px-4 py-3 text-left font-medium">更新时间</th>
              <th className="px-4 py-3 text-left font-medium">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {plansLoading ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-sm text-slate-400">
                  加载中...
                </td>
              </tr>
            ) : plans.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-400">
                  暂无计划，点击右上角“创建计划”开始。
                </td>
              </tr>
            ) : (
              plans.map((plan) => (
                <tr key={plan._id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3 align-top">
                    <p className="font-medium text-slate-900">{plan.title || '未命名计划'}</p>
                    <p className="mt-1 line-clamp-2 text-xs text-slate-500">{plan.sourcePrompt || '-'}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded px-1.5 py-0.5 text-xs ${STATUS_COLOR[plan.status] || STATUS_COLOR.pending}`}>
                      {plan.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{plan.strategy?.mode || '-'}</td>
                  <td className="px-4 py-3 text-slate-700">{plan.stats.completedTasks}/{plan.stats.totalTasks}</td>
                  <td className="px-4 py-3 text-slate-700">{formatDateTime(plan.updatedAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => window.open(`/orchestration/plans/${plan._id}`, '_blank')}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 text-slate-700 hover:bg-slate-100"
                        title="查看详情"
                        aria-label="查看详情"
                      >
                        <EyeIcon className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => onCopyPlan(plan)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-sky-200 text-sky-700 hover:bg-sky-50"
                        title="复制并新建"
                        aria-label="复制并新建"
                      >
                        <DocumentDuplicateIcon className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => onDeletePlan(plan._id)}
                        disabled={deleteLoading}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-rose-200 text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                        title="删除计划"
                        aria-label="删除计划"
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
  );
};

export default PlanListTable;
