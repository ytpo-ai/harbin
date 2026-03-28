import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  ChevronDownIcon,
  DocumentDuplicateIcon,
  PencilSquareIcon,
  PlayIcon,
  PlusIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { OrchestrationPlan, OrchestrationRun } from '../../services/orchestrationService';
import { formatDateTime } from './constants';

interface PlanHeaderProps {
  planDetail: OrchestrationPlan;
  planId?: string;
  promptDraft: string;
  latestRunSummary: OrchestrationRun | null;
  isPlanEditable: boolean;
  isProductionPlan: boolean;
  runPlanLoading: boolean;
  replanLoading: boolean;
  replanPending: boolean;
  savePromptLoading: boolean;
  generateLoading: boolean;
  stopGenerationLoading: boolean;
  deleteLoading: boolean;
  generationCompleted: boolean;
  cancelRunLoading: boolean;
  publishLoading: boolean;
  unlockLoading: boolean;
  onBack: () => void;
  onRefresh: () => void;
  onGenerateNext: () => void;
  onStopGeneration: () => void;
  onDeletePlan: () => void;
  onSavePrompt: () => void;
  onOpenReplan: () => void;
  onRunPlan: () => void;
  runPlanDisabled?: boolean;
  runPlanDisabledReason?: string;
  onCancelRun: (runId: string) => void;
  onPublish: () => void;
  onUnlock: () => void;
  onCopyMarkdown: () => void;
}

const PlanHeader: React.FC<PlanHeaderProps> = ({
  planDetail,
  planId,
  promptDraft,
  latestRunSummary,
  isPlanEditable,
  isProductionPlan,
  runPlanLoading,
  replanLoading,
  replanPending,
  savePromptLoading,
  generateLoading,
  stopGenerationLoading,
  deleteLoading,
  generationCompleted,
  cancelRunLoading,
  publishLoading,
  unlockLoading,
  onBack,
  onRefresh,
  onGenerateNext,
  onStopGeneration,
  onDeletePlan,
  onSavePrompt,
  onOpenReplan,
  onRunPlan,
  runPlanDisabled,
  runPlanDisabledReason,
  onCancelRun,
  onPublish,
  onUnlock,
  onCopyMarkdown,
}) => {
  const [moreActionsOpen, setMoreActionsOpen] = useState(false);
  const moreActionsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!moreActionsRef.current) {
        return;
      }
      if (!moreActionsRef.current.contains(event.target as Node)) {
        setMoreActionsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  return (
    <div className="bg-white border-b border-slate-200 px-4 py-3">
      <div className="flex items-center justify-between max-w-7xl mx-auto">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
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
            onClick={onRefresh}
            className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          >
            <ArrowPathIcon className="h-4 w-4" /> 刷新
          </button>
          <button
            onClick={onSavePrompt}
            disabled={!planId || savePromptLoading || !isPlanEditable || !promptDraft.trim()}
            className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <PencilSquareIcon className="h-4 w-4" /> 保存
          </button>
          {!isProductionPlan && (
            <button
              onClick={onGenerateNext}
              disabled={!planId || generateLoading || runPlanLoading}
              className="inline-flex items-center gap-1 rounded-md border border-emerald-200 px-3 py-1.5 text-sm text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
            >
              <PlusIcon className="h-4 w-4" />
              {generateLoading ? '生成中...' : '生成下一步'}
            </button>
          )}
            <button
              onClick={onRunPlan}
              disabled={!planId || runPlanLoading || runPlanDisabled}
              title={runPlanDisabled ? runPlanDisabledReason : undefined}
              className="inline-flex items-center gap-1 rounded-md border border-cyan-200 px-3 py-1.5 text-sm text-cyan-700 hover:bg-cyan-50 disabled:opacity-50"
            >
            <PlayIcon className="h-4 w-4" /> 运行
          </button>
          {latestRunSummary?.status === 'running' && latestRunSummary?._id && (
            <button
              onClick={() => onCancelRun(latestRunSummary._id)}
              disabled={cancelRunLoading}
              className="inline-flex items-center gap-1 rounded-md border border-rose-200 px-3 py-1.5 text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-50"
            >
              {cancelRunLoading ? '停止中...' : '停止运行'}
            </button>
          )}
          {planDetail.status === 'production' && (
            <button
              onClick={onUnlock}
              disabled={!planId || unlockLoading || runPlanLoading}
              className="inline-flex items-center gap-1 rounded-md border border-amber-200 px-3 py-1.5 text-sm text-amber-700 hover:bg-amber-50 disabled:opacity-50"
            >
              {unlockLoading ? '解锁中...' : '解锁编辑'}
            </button>
          )}
          <div className="relative" ref={moreActionsRef}>
            <button
              onClick={() => setMoreActionsOpen((prev) => !prev)}
              className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
            >
              更多操作 <ChevronDownIcon className="h-4 w-4" />
            </button>
            {moreActionsOpen && (
              <div className="absolute right-0 z-20 mt-1 min-w-40 rounded-md border border-slate-200 bg-white p-1 shadow-lg">
                {!isProductionPlan && (
                  <button
                    onClick={() => {
                      setMoreActionsOpen(false);
                      onOpenReplan();
                    }}
                    disabled={!planId || replanLoading || replanPending || runPlanLoading || !isPlanEditable}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
                  >
                    <ArrowPathIcon className={`h-4 w-4 ${(replanLoading || replanPending) ? 'animate-spin' : ''}`} />
                    {(replanLoading || replanPending) ? '重新编排中...' : '重新编排'}
                  </button>
                )}
                <button
                  onClick={() => {
                    setMoreActionsOpen(false);
                    onDeletePlan();
                  }}
                  disabled={!planId || deleteLoading || replanLoading || replanPending || runPlanLoading}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                >
                  <TrashIcon className="h-4 w-4" />
                  {deleteLoading ? '删除中...' : '删除计划'}
                </button>
                {planDetail.status === 'planned' && (
                  <button
                    onClick={() => {
                      setMoreActionsOpen(false);
                      onPublish();
                    }}
                    disabled={!planId || publishLoading || runPlanLoading}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                  >
                    {publishLoading ? '发布中...' : '发布生产'}
                  </button>
                )}
                {planDetail.status === 'drafting' && (
                  <button
                    onClick={() => {
                      setMoreActionsOpen(false);
                      onStopGeneration();
                    }}
                    disabled={!planId || stopGenerationLoading}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                  >
                    {stopGenerationLoading ? '停止中...' : '停止执行'}
                  </button>
                )}
                <button
                  onClick={() => {
                    setMoreActionsOpen(false);
                    onCopyMarkdown();
                  }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-100"
                >
                  <DocumentDuplicateIcon className="h-4 w-4" /> 复制任务MD
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PlanHeader;
