import React from 'react';
import { PencilSquareIcon } from '@heroicons/react/24/outline';
import { PlanMode } from '../../services/orchestrationService';

const MODE_LABEL: Record<string, string> = {
  sequential: '串行',
  parallel: '并行',
  hybrid: '混合',
};

const RUN_MODE_LABEL: Record<string, string> = {
  multi: '多次执行',
  once: '仅生成执行',
};

const DOMAIN_TYPE_LABEL: Record<string, string> = {
  general: '通用',
  development: '研发',
  research: '调研',
};

interface PlanPromptEditorProps {
  modeDraft: PlanMode;
  promptDraft: string;
  promptHint: string;
  plannerAgentId?: string;
  plannerAgentName?: string;
  runMode?: string;
  domainType?: string;
  isPlanEditable: boolean;
  onOpenSettings: () => void;
}

const PlanPromptEditor: React.FC<PlanPromptEditorProps> = ({
  modeDraft,
  promptDraft,
  promptHint,
  plannerAgentId,
  plannerAgentName,
  runMode,
  domainType,
  isPlanEditable,
  onOpenSettings,
}) => {
  const plannerDisplay = plannerAgentId
    ? plannerAgentName && plannerAgentName !== plannerAgentId
      ? plannerAgentName
      : plannerAgentId
    : '默认';

  const promptPreview = promptDraft.length > 120
    ? `${promptDraft.slice(0, 120)}...`
    : promptDraft || '-';

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-slate-800">计划设置</p>
        {isPlanEditable && (
          <button
            onClick={onOpenSettings}
            className="inline-flex items-center gap-1 rounded-md border border-indigo-200 px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50"
          >
            <PencilSquareIcon className="h-3.5 w-3.5" /> 编辑
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs md:grid-cols-4">
        <div>
          <span className="text-slate-500">Planner</span>
          <p className="font-medium text-slate-700 truncate" title={plannerAgentId || '默认'}>{plannerDisplay}</p>
        </div>
        <div>
          <span className="text-slate-500">模式</span>
          <p className="font-medium text-slate-700">{MODE_LABEL[modeDraft] || modeDraft}</p>
        </div>
        <div>
          <span className="text-slate-500">运行模式</span>
          <p className="font-medium text-slate-700">{RUN_MODE_LABEL[runMode || ''] || runMode || '-'}</p>
        </div>
        <div>
          <span className="text-slate-500">领域类型</span>
          <p className="font-medium text-slate-700">{DOMAIN_TYPE_LABEL[domainType || ''] || domainType || '-'}</p>
        </div>
      </div>
      <div className="mt-2">
        <span className="text-xs text-slate-500">Prompt</span>
        <p className="text-xs text-slate-600 line-clamp-2">{promptPreview}</p>
      </div>
      {promptHint && <p className="mt-1.5 text-xs text-indigo-700">{promptHint}</p>}
    </div>
  );
};

export default PlanPromptEditor;
