import React from 'react';
import { PlanMode } from '../../services/orchestrationService';

interface PlanPromptEditorProps {
  modeDraft: PlanMode;
  promptDraft: string;
  promptHint: string;
  plannerAgentId?: string;
  plannerAgentName?: string;
  setModeDraft: (value: PlanMode) => void;
  setPromptDraft: (value: string) => void;
}

const PlanPromptEditor: React.FC<PlanPromptEditorProps> = ({
  modeDraft,
  promptDraft,
  promptHint,
  plannerAgentId,
  plannerAgentName,
  setModeDraft,
  setPromptDraft,
}) => {
  const plannerDisplay = plannerAgentId
    ? plannerAgentName && plannerAgentName !== plannerAgentId
      ? `${plannerAgentName} (${plannerAgentId})`
      : plannerAgentId
    : '默认';

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="mb-1 text-xs font-medium text-slate-700">当前 Planner</p>
      <p className="mb-3 text-xs text-slate-600">{plannerDisplay}</p>
      <p className="mb-2 text-xs font-medium text-slate-700">计划模式</p>
      <select
        value={modeDraft}
        onChange={(event) => setModeDraft(event.target.value as PlanMode)}
        className="mb-3 w-full rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700"
      >
        <option value="sequential">串行</option>
        <option value="parallel">并行</option>
        <option value="hybrid">混合</option>
      </select>
      <p className="mb-2 text-xs font-medium text-slate-700">Prompt</p>
      <textarea
        value={promptDraft}
        onChange={(event) => setPromptDraft(event.target.value)}
        className="min-h-[100px] w-full rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600"
      />
      {promptHint && <p className="mt-2 text-xs text-indigo-700">{promptHint}</p>}
    </div>
  );
};

export default PlanPromptEditor;
