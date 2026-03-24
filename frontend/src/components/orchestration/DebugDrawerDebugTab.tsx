import React from 'react';
import { ClockIcon, PencilSquareIcon, PlayIcon } from '@heroicons/react/24/outline';
import { DebugRuntimeTaskTypeOverride, OrchestrationTask } from '../../services/orchestrationService';
import { DEBUG_RUNTIME_TYPE_OPTIONS, formatDateTime } from './constants';

interface DebugDrawerDebugTabProps {
  task: OrchestrationTask;
  editable: boolean;
  debugAgentId: string;
  debugTitle: string;
  debugDescription: string;
  debugRuntimeTaskType: 'auto' | DebugRuntimeTaskTypeOverride;
  debugHint: string;
  agents: Array<{ id: string; name: string }>;
  debugSaving: boolean;
  debugRunning: boolean;
  reassignRunning: boolean;
  onChangeAgentId: (value: string) => void;
  onChangeTitle: (value: string) => void;
  onChangeDescription: (value: string) => void;
  onChangeRuntimeType: (value: 'auto' | DebugRuntimeTaskTypeOverride) => void;
  onSaveDraft: () => void;
  onRunDebug: () => void;
}

const DebugDrawerDebugTab: React.FC<DebugDrawerDebugTabProps> = ({
  task,
  editable,
  debugAgentId,
  debugTitle,
  debugDescription,
  debugRuntimeTaskType,
  debugHint,
  agents,
  debugSaving,
  debugRunning,
  reassignRunning,
  onChangeAgentId,
  onChangeTitle,
  onChangeDescription,
  onChangeRuntimeType,
  onSaveDraft,
  onRunDebug,
}) => (
  <>
    <div className="p-4 border-b border-slate-200 space-y-3">
      {!editable && (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          production 状态下禁止调试与草稿变更，如需修改请先解锁计划。
        </div>
      )}
      <div className="grid grid-cols-1 gap-2">
        <label className="text-xs text-slate-600">执行 Agent</label>
        <select
          value={debugAgentId}
          onChange={(event) => onChangeAgentId(event.target.value)}
          disabled={!editable}
          className="w-full text-sm border border-slate-300 rounded px-2 py-1.5 disabled:bg-slate-50"
        >
          <option value="">请选择 Agent</option>
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-1 gap-2">
        <label className="text-xs text-slate-600">任务标题</label>
        <input
          value={debugTitle}
          onChange={(event) => onChangeTitle(event.target.value)}
          disabled={!editable}
          className="w-full text-sm border border-slate-300 rounded px-2 py-1.5 disabled:bg-slate-50"
        />
      </div>
      <div className="grid grid-cols-1 gap-2">
        <label className="text-xs text-slate-600">任务描述（可编辑后反复调试）</label>
        <textarea
          value={debugDescription}
          onChange={(event) => onChangeDescription(event.target.value)}
          disabled={!editable}
          className="w-full min-h-[120px] text-sm border border-slate-300 rounded px-2 py-1.5 disabled:bg-slate-50"
        />
      </div>
      <div className="grid grid-cols-1 gap-2">
        <label className="text-xs text-slate-600">任务类型（可保存）</label>
        <select
          value={debugRuntimeTaskType}
          onChange={(event) => onChangeRuntimeType(event.target.value as 'auto' | DebugRuntimeTaskTypeOverride)}
          disabled={!editable}
          className="w-full text-sm border border-slate-300 rounded px-2 py-1.5 disabled:bg-slate-50"
        >
          {DEBUG_RUNTIME_TYPE_OPTIONS.map((item) => (
            <option key={item.value} value={item.value}>{item.label}</option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={onSaveDraft}
          disabled={!editable || debugSaving}
          className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded border border-slate-300 hover:bg-slate-50 disabled:opacity-50"
        >
          <PencilSquareIcon className="h-4 w-4" /> 保存草稿
        </button>
        <button
          onClick={onRunDebug}
          disabled={!editable || debugRunning || reassignRunning}
          className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded bg-slate-900 text-white disabled:bg-slate-300"
        >
          <PlayIcon className="h-4 w-4" /> 执行当前 Step
        </button>
      </div>
      {debugHint && <p className="text-xs text-primary-700">{debugHint}</p>}
    </div>

    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      <section className="space-y-2">
        <p className="text-xs font-semibold text-slate-700">运行日志</p>
        {!task.runLogs?.length ? (
          <p className="text-xs text-slate-400">暂无日志</p>
        ) : (
          <div className="space-y-1">
            {task.runLogs.slice(-10).reverse().map((log, index) => (
              <div key={`${log.timestamp}-${index}`} className="rounded border border-slate-200 px-2 py-1.5">
                <p className="text-[11px] text-slate-500 inline-flex items-center gap-1">
                  <ClockIcon className="h-3 w-3" /> {formatDateTime(log.timestamp)} · {log.level}
                </p>
                <p className="text-xs text-slate-700 mt-0.5">{log.message}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  </>
);

export default DebugDrawerDebugTab;
