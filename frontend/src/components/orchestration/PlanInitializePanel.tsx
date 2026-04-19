import React from 'react';
import { ChevronDownIcon } from '@heroicons/react/24/outline';
import { ChevronRightIcon } from '@heroicons/react/24/outline';

type PlanMetadata = Record<string, any> | undefined;

const TASK_TYPE_LABEL: Record<string, string> = {
  general: '通用',
  research: '调研',
  'development.plan': '研发规划',
  'development.exec': '研发执行',
  'development.review': '研发评审',
};

interface PlanInitializePanelProps {
  metadata?: PlanMetadata;
  defaultCollapsed?: boolean;
}

const PlanInitializePanel: React.FC<PlanInitializePanelProps> = ({ metadata, defaultCollapsed = false }) => {
  const [collapsed, setCollapsed] = React.useState(defaultCollapsed);
  const taskContext = metadata?.taskContext && typeof metadata.taskContext === 'object' && !Array.isArray(metadata.taskContext)
    ? metadata.taskContext as Record<string, unknown>
    : {};
  const outline = Array.isArray(metadata?.outline)
    ? metadata?.outline as Array<Record<string, unknown>>
    : [];

  const requirementId = String(taskContext.requirementId || '').trim();
  const requirementTitle = String(taskContext.requirementTitle || '').trim();
  const requirementDescription = String(taskContext.requirementDescription || '').trim();

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setCollapsed((prev) => !prev)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          {collapsed ? (
            <ChevronRightIcon className="h-4 w-4 shrink-0 text-slate-400" />
          ) : (
            <ChevronDownIcon className="h-4 w-4 shrink-0 text-slate-400" />
          )}
          <span className="text-xs font-semibold tracking-wide text-slate-500 shrink-0">#0</span>
          <p className="text-sm font-semibold text-slate-800">计划初始化</p>
        </div>
        <span className="text-xs text-slate-500 shrink-0">outline {outline.length} 步</span>
      </button>

      {collapsed ? null : !requirementId && outline.length === 0 ? (
        <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">尚未产出初始化信息，等待 Initialize 阶段完成。</p>
      ) : (
        <div className="border-t border-slate-100 px-4 py-3">
          <div className="grid gap-2 text-xs text-slate-700 md:grid-cols-2">
            <div className="rounded-md bg-slate-50 px-2.5 py-2">
              <p className="text-slate-500">需求 ID</p>
              <p className="mt-0.5 font-medium text-slate-800 break-all">{requirementId || '-'}</p>
            </div>
            <div className="rounded-md bg-slate-50 px-2.5 py-2">
              <p className="text-slate-500">需求标题</p>
              <p className="mt-0.5 font-medium text-slate-800">{requirementTitle || '-'}</p>
            </div>
          </div>

          {requirementDescription ? (
            <div className="mt-2 rounded-md bg-slate-50 px-2.5 py-2">
              <p className="text-xs text-slate-500">需求描述</p>
              <p className="mt-0.5 whitespace-pre-wrap text-xs text-slate-700">{requirementDescription}</p>
            </div>
          ) : null}

          {outline.length > 0 ? (
            <div className="mt-3 space-y-1.5">
              <p className="text-xs font-medium text-slate-700">初始化大纲</p>
              {outline
                .slice()
                .sort((a, b) => Number(a.step || 0) - Number(b.step || 0))
                .map((step) => {
                  const stepNo = Number(step.step || 0) || 0;
                  const title = String(step.title || '').trim() || `步骤 ${stepNo || '-'}`;
                  const taskType = String(step.taskType || '').trim();
                  const taskTypeLabel = TASK_TYPE_LABEL[taskType] || taskType || '未标注';
                  const recommendedAgent = step.recommendedAgent && typeof step.recommendedAgent === 'object'
                    ? step.recommendedAgent as Record<string, unknown>
                    : null;
                  const recommendedAgentName = String(recommendedAgent?.agentName || recommendedAgent?.agentId || '').trim();

                  return (
                    <div key={`${stepNo}-${title}`} className="rounded-md border border-slate-200 px-2.5 py-2 text-xs">
                      <p className="font-medium text-slate-800">S{stepNo || '-'} · {title}</p>
                      <p className="mt-0.5 text-slate-600">类型：{taskTypeLabel}{recommendedAgentName ? ` · 推荐执行：${recommendedAgentName}` : ''}</p>
                    </div>
                  );
                })}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
};

export default PlanInitializePanel;
