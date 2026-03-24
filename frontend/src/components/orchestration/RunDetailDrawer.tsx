import React from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { OrchestrationRun, OrchestrationRunTask } from '../../services/orchestrationService';
import {
  RUN_STATUS_COLOR,
  RUN_STATUS_LABEL,
  STATUS_COLOR,
  TASK_RUNTIME_TYPE_LABEL,
  TRIGGER_TYPE_LABEL,
  formatDateTime,
  formatDuration,
  formatExecutor,
} from './constants';

interface RunDetailDrawerProps {
  open: boolean;
  selectedRunId: string;
  runDetail: OrchestrationRun | undefined;
  runDetailLoading: boolean;
  hasRunDetailError: boolean;
  runTasks: OrchestrationRunTask[];
  runTasksLoading: boolean;
  hasRunTasksError: boolean;
  isCancelling: boolean;
  onClose: () => void;
  onCancelRun: (runId: string) => void;
}

const RunDetailDrawer: React.FC<RunDetailDrawerProps> = ({
  open,
  selectedRunId,
  runDetail,
  runDetailLoading,
  hasRunDetailError,
  runTasks,
  runTasksLoading,
  hasRunTasksError,
  isCancelling,
  onClose,
  onCancelRun,
}) => {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[88]">
      <button
        className="absolute inset-0 bg-black/30"
        onClick={onClose}
        aria-label="关闭执行详情抽屉"
      />
      <aside className="absolute right-0 top-0 h-full w-full border-l border-slate-200 bg-white shadow-2xl sm:w-[92vw] lg:w-[56vw]">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">Run 执行详情</p>
            <p className="mt-0.5 text-xs text-slate-500">{selectedRunId || '-'}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="h-[calc(100%-61px)] space-y-4 overflow-y-auto p-4">
          {runDetailLoading && !runDetail ? (
            <p className="text-sm text-slate-400">加载 run 详情中...</p>
          ) : hasRunDetailError ? (
            <p className="text-sm text-rose-600">获取 run 详情失败，请稍后重试。</p>
          ) : !runDetail ? (
            <p className="text-sm text-slate-400">未查询到 run 详情。</p>
          ) : (
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <p className="text-xs text-slate-600">
                  状态：
                  <span className={`ml-1 inline-flex rounded px-1.5 py-0.5 text-xs ${RUN_STATUS_COLOR[runDetail.status] || 'bg-slate-100 text-slate-600'}`}>
                    {RUN_STATUS_LABEL[runDetail.status] || runDetail.status}
                  </span>
                </p>
                <p className="text-xs text-slate-600">触发来源：{TRIGGER_TYPE_LABEL[runDetail.triggerType] || runDetail.triggerType}</p>
                <p className="text-xs text-slate-600">开始时间：{formatDateTime(runDetail.startedAt)}</p>
                <p className="text-xs text-slate-600">完成时间：{formatDateTime(runDetail.completedAt)}</p>
                <p className="text-xs text-slate-600">耗时：{formatDuration(runDetail.durationMs)}</p>
                <p className="text-xs text-slate-600">
                  统计：{runDetail.stats?.completedTasks || 0}/{runDetail.stats?.totalTasks || 0}（失败 {runDetail.stats?.failedTasks || 0}）
                </p>
              </div>
              <p className="mt-2 text-xs text-slate-600">摘要：{runDetail.summary || '-'}</p>
              {runDetail.error && <p className="mt-1 text-xs text-rose-600">错误：{runDetail.error}</p>}
              {runDetail.status === 'running' && (
                <div className="mt-3">
                  <button
                    onClick={() => onCancelRun(runDetail._id)}
                    disabled={isCancelling}
                    className="inline-flex items-center gap-1 rounded border border-rose-200 px-2.5 py-1.5 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                  >
                    {isCancelling ? '取消中...' : '取消此次运行'}
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="mb-2 text-sm font-semibold text-slate-900">任务执行明细</p>
            {runTasksLoading && !runTasks.length ? (
              <p className="text-xs text-slate-400">加载任务明细中...</p>
            ) : hasRunTasksError ? (
              <p className="text-xs text-rose-600">加载任务明细失败，请稍后重试。</p>
            ) : runTasks.length === 0 ? (
              <p className="text-xs text-slate-400">该次执行暂无任务明细。</p>
            ) : (
              <div className="space-y-2">
                {runTasks.map((task) => (
                  <div key={task._id} className="rounded border border-slate-200 px-3 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-xs font-medium text-slate-800">#{task.order + 1} {task.title || '未命名任务'}</p>
                        <p className="mt-0.5 text-[11px] text-slate-500">执行者：{formatExecutor(task)}</p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className={`inline-flex rounded px-1.5 py-0.5 text-xs ${STATUS_COLOR[task.status] || STATUS_COLOR.pending}`}>
                          {task.status}
                        </span>
                        <span className="inline-flex rounded border border-cyan-200 bg-cyan-50 px-1.5 py-0.5 text-xs text-cyan-700">
                          type: {task.runtimeTaskType ? TASK_RUNTIME_TYPE_LABEL[task.runtimeTaskType] : 'auto'}
                        </span>
                      </div>
                    </div>
                    <p className="mt-1 text-xs text-slate-600 whitespace-pre-wrap">{task.result?.summary || task.result?.output || '-'}</p>
                    {task.result?.error && <p className="mt-1 text-xs text-rose-600">{task.result.error}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
};

export default RunDetailDrawer;
