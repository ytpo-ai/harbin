import React from 'react';
import { PlusIcon, SparklesIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { PlanDomainType, PlanMode, PlanRunMode } from '../../../services/orchestrationService';

type AgentOption = {
  id: string;
  name: string;
};

type Props = {
  open: boolean;
  title: string;
  prompt: string;
  mode: PlanMode;
  runMode: PlanRunMode;
  domainType: PlanDomainType;
  autoGenerate: boolean;
  plannerAgentId: string;
  agents: AgentOption[];
  createLoading: boolean;
  createError: boolean;
  onClose: () => void;
  onTitleChange: (value: string) => void;
  onPromptChange: (value: string) => void;
  onModeChange: (value: PlanMode) => void;
  onRunModeChange: (value: PlanRunMode) => void;
  onDomainTypeChange: (value: PlanDomainType) => void;
  onAutoGenerateChange: (value: boolean) => void;
  onPlannerAgentIdChange: (value: string) => void;
  onSubmit: () => void;
};

const CreatePlanModal: React.FC<Props> = ({
  open,
  title,
  prompt,
  mode,
  runMode,
  domainType,
  autoGenerate,
  plannerAgentId,
  agents,
  createLoading,
  createError,
  onClose,
  onTitleChange,
  onPromptChange,
  onModeChange,
  onRunModeChange,
  onDomainTypeChange,
  onAutoGenerateChange,
  onPlannerAgentIdChange,
  onSubmit,
}) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-2xl rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <p className="text-sm font-semibold text-slate-900">创建编排计划</p>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="关闭创建弹窗"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[70vh] space-y-3 overflow-y-auto px-4 py-4">
          <input
            value={title}
            onChange={(event) => onTitleChange(event.target.value)}
            placeholder="计划标题（可选）"
            className="w-full rounded-md border border-slate-300 px-2 py-2 text-sm"
          />
          <textarea
            value={prompt}
            onChange={(event) => onPromptChange(event.target.value)}
            placeholder="输入一句提示词，例如：发布一个 Agent API 网关版本"
            className="min-h-[120px] w-full rounded-md border border-slate-300 px-2 py-2 text-sm"
          />
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <select
              value={mode}
              onChange={(event) => onModeChange(event.target.value as PlanMode)}
              className="rounded-md border border-slate-300 px-2 py-2 text-sm"
            >
              <option value="sequential">串行</option>
              <option value="parallel">并行</option>
              <option value="hybrid">混合</option>
            </select>
            <select
              value={plannerAgentId}
              onChange={(event) => onPlannerAgentIdChange(event.target.value)}
              className="rounded-md border border-slate-300 px-2 py-2 text-sm"
            >
              <option value="">默认 Planner</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
            <select
              value={domainType}
              onChange={(event) => onDomainTypeChange(event.target.value as PlanDomainType)}
              className="rounded-md border border-slate-300 px-2 py-2 text-sm"
            >
              <option value="general">通用（general）</option>
              <option value="development">研发（development）</option>
              <option value="research">调研（research）</option>
            </select>
            <select
              value={runMode}
              onChange={(event) => onRunModeChange(event.target.value as PlanRunMode)}
              className="rounded-md border border-slate-300 px-2 py-2 text-sm"
            >
              <option value="multi">多次执行（multi）</option>
              <option value="once">仅生成过程执行（once）</option>
            </select>
          </div>
          <label className="inline-flex items-center gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={autoGenerate}
              onChange={(event) => onAutoGenerateChange(event.target.checked)}
            />
            创建并生成任务
          </label>
          {createError && <p className="text-xs text-rose-600">创建失败，请稍后重试。</p>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
          <button
            onClick={onClose}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          >
            取消
          </button>
          <button
            onClick={onSubmit}
            disabled={!prompt.trim() || createLoading}
            className="inline-flex items-center gap-1 rounded-md bg-primary-600 px-3 py-1.5 text-sm text-white disabled:bg-slate-300"
          >
            {createLoading ? <PlusIcon className="h-4 w-4" /> : <SparklesIcon className="h-4 w-4" />} 生成计划
          </button>
        </div>
      </div>
    </div>
  );
};

export default CreatePlanModal;
