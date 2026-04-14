import React, { useEffect, useState } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { PlanDomainType, PlanMode, PlanRunMode } from '../../services/orchestrationService';

type AgentOption = {
  id: string;
  name: string;
};

export interface PlanSettingsFormValues {
  title: string;
  sourcePrompt: string;
  mode: PlanMode;
  runMode: PlanRunMode;
  domainType: PlanDomainType;
  plannerAgentId: string;
}

interface PlanSettingsModalProps {
  open: boolean;
  saving: boolean;
  agents: AgentOption[];
  initialValues: PlanSettingsFormValues;
  onClose: () => void;
  onSave: (values: PlanSettingsFormValues) => void;
}

const PlanSettingsModal: React.FC<PlanSettingsModalProps> = ({
  open,
  saving,
  agents,
  initialValues,
  onClose,
  onSave,
}) => {
  const [form, setForm] = useState<PlanSettingsFormValues>(initialValues);

  useEffect(() => {
    if (open) {
      setForm(initialValues);
    }
  }, [open, initialValues]);

  if (!open) return null;

  const update = <K extends keyof PlanSettingsFormValues>(key: K, value: PlanSettingsFormValues[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    if (!form.sourcePrompt.trim()) return;
    onSave(form);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-2xl rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <p className="text-sm font-semibold text-slate-900">编辑计划设置</p>
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
            aria-label="关闭"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[70vh] space-y-3 overflow-y-auto px-4 py-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">计划标题</label>
            <input
              value={form.title}
              onChange={(e) => update('title', e.target.value)}
              placeholder="计划标题（可选）"
              className="w-full rounded-md border border-slate-300 px-2 py-2 text-sm"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">Prompt</label>
            <textarea
              value={form.sourcePrompt}
              onChange={(e) => update('sourcePrompt', e.target.value)}
              placeholder="输入提示词"
              className="min-h-[120px] w-full rounded-md border border-slate-300 px-2 py-2 text-sm"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Planner Agent</label>
              <select
                value={form.plannerAgentId}
                onChange={(e) => update('plannerAgentId', e.target.value)}
                className="w-full rounded-md border border-slate-300 px-2 py-2 text-sm"
              >
                <option value="">默认 Planner</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">计划模式</label>
              <select
                value={form.mode}
                onChange={(e) => update('mode', e.target.value as PlanMode)}
                className="w-full rounded-md border border-slate-300 px-2 py-2 text-sm"
              >
                <option value="sequential">串行</option>
                <option value="parallel">并行</option>
                <option value="hybrid">混合</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">运行模式</label>
              <select
                value={form.runMode}
                onChange={(e) => update('runMode', e.target.value as PlanRunMode)}
                className="w-full rounded-md border border-slate-300 px-2 py-2 text-sm"
              >
                <option value="multi">多次执行（multi）</option>
                <option value="once">仅生成过程执行（once）</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">领域类型</label>
              <select
                value={form.domainType}
                onChange={(e) => update('domainType', e.target.value as PlanDomainType)}
                className="w-full rounded-md border border-slate-300 px-2 py-2 text-sm"
              >
                <option value="general">通用（general）</option>
                <option value="development">研发（development）</option>
                <option value="research">调研（research）</option>
              </select>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !form.sourcePrompt.trim()}
            className="inline-flex items-center gap-1 rounded-md bg-primary-600 px-3 py-1.5 text-sm text-white disabled:bg-slate-300"
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PlanSettingsModal;
