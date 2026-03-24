import React from 'react';
import { ClockIcon, PencilSquareIcon, PlayIcon, XMarkIcon } from '@heroicons/react/24/outline';
import {
  AgentSession,
  DebugRuntimeTaskTypeOverride,
  OrchestrationTask,
} from '../../services/orchestrationService';
import {
  DEBUG_RUNTIME_TYPE_OPTIONS,
  DrawerTab,
  formatDateTime,
} from './constants';

interface DebugDrawerProps {
  open: boolean;
  task: OrchestrationTask | null;
  activeDrawerTab: DrawerTab;
  debugAgentId: string;
  debugTitle: string;
  debugDescription: string;
  debugRuntimeTaskType: 'auto' | DebugRuntimeTaskTypeOverride;
  debugHint: string;
  debugSessionId: string;
  debugSessionDetail: AgentSession | undefined;
  debugSessionLoading: boolean;
  agents: Array<{ id: string; name: string }>;
  debugSaving: boolean;
  debugRunning: boolean;
  reassignRunning: boolean;
  onClose: () => void;
  onTabChange: (tab: DrawerTab) => void;
  onChangeAgentId: (value: string) => void;
  onChangeTitle: (value: string) => void;
  onChangeDescription: (value: string) => void;
  onChangeRuntimeType: (value: 'auto' | DebugRuntimeTaskTypeOverride) => void;
  onSaveDraft: () => void;
  onRunDebug: () => void;
}

const DebugDrawer: React.FC<DebugDrawerProps> = ({
  open,
  task,
  activeDrawerTab,
  debugAgentId,
  debugTitle,
  debugDescription,
  debugRuntimeTaskType,
  debugHint,
  debugSessionId,
  debugSessionDetail,
  debugSessionLoading,
  agents,
  debugSaving,
  debugRunning,
  reassignRunning,
  onClose,
  onTabChange,
  onChangeAgentId,
  onChangeTitle,
  onChangeDescription,
  onChangeRuntimeType,
  onSaveDraft,
  onRunDebug,
}) => {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[90]">
      <div className="absolute inset-0 bg-black/25" onClick={onClose} />
      <aside className="absolute right-0 top-0 h-full w-full bg-white shadow-2xl sm:w-[92vw] lg:w-[56vw] border-l border-slate-200 flex flex-col">
        <div className="px-4 py-3 border-b border-slate-200 flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-slate-900">单步调试</p>
            <p className="text-xs text-slate-500 mt-0.5">
              {task ? `Step #${task.order + 1} · ${task.status}` : '请选择任务后再调试'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-slate-100 text-slate-500"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="px-4 py-2 border-b border-slate-200 inline-flex gap-2">
          <button
            onClick={() => onTabChange('debug')}
            className={`px-3 py-1.5 text-xs rounded ${activeDrawerTab === 'debug' ? 'bg-primary-100 text-primary-700' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            调试
          </button>
          <button
            onClick={() => onTabChange('session')}
            className={`px-3 py-1.5 text-xs rounded ${activeDrawerTab === 'session' ? 'bg-primary-100 text-primary-700' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            Session
          </button>
        </div>

        {!task ? (
          <div className="flex-1 p-4 text-sm text-slate-500">当前计划中未找到该任务，请重新选择。</div>
        ) : activeDrawerTab === 'debug' ? (
          <>
            <div className="p-4 border-b border-slate-200 space-y-3">
              <div className="grid grid-cols-1 gap-2">
                <label className="text-xs text-slate-600">执行 Agent</label>
                <select
                  value={debugAgentId}
                  onChange={(event) => onChangeAgentId(event.target.value)}
                  className="w-full text-sm border border-slate-300 rounded px-2 py-1.5"
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
                  className="w-full text-sm border border-slate-300 rounded px-2 py-1.5"
                />
              </div>
              <div className="grid grid-cols-1 gap-2">
                <label className="text-xs text-slate-600">任务描述（可编辑后反复调试）</label>
                <textarea
                  value={debugDescription}
                  onChange={(event) => onChangeDescription(event.target.value)}
                  className="w-full min-h-[120px] text-sm border border-slate-300 rounded px-2 py-1.5"
                />
              </div>
              <div className="grid grid-cols-1 gap-2">
                <label className="text-xs text-slate-600">任务类型（可保存）</label>
                <select
                  value={debugRuntimeTaskType}
                  onChange={(event) => onChangeRuntimeType(event.target.value as 'auto' | DebugRuntimeTaskTypeOverride)}
                  className="w-full text-sm border border-slate-300 rounded px-2 py-1.5"
                >
                  {DEBUG_RUNTIME_TYPE_OPTIONS.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={onSaveDraft}
                  disabled={debugSaving}
                  className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded border border-slate-300 hover:bg-slate-50 disabled:opacity-50"
                >
                  <PencilSquareIcon className="h-4 w-4" /> 保存草稿
                </button>
                <button
                  onClick={onRunDebug}
                  disabled={debugRunning || reassignRunning}
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
        ) : (
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <section className="space-y-2">
              <p className="text-xs font-semibold text-slate-700">Session 信息</p>
              {!debugSessionId ? (
                <p className="text-xs text-slate-400">该任务尚未产生 session</p>
              ) : debugSessionLoading ? (
                <p className="text-xs text-slate-400">加载 session 中...</p>
              ) : !debugSessionDetail ? (
                <p className="text-xs text-slate-400">未查询到 session 详情</p>
              ) : (
                <div className="rounded border border-slate-200 p-3 space-y-2">
                  <p className="text-xs text-slate-600">ID: {debugSessionDetail._id}</p>
                  <p className="text-xs text-slate-600">Owner: {debugSessionDetail.ownerType} / {debugSessionDetail.ownerId}</p>
                  <p className="text-xs text-slate-600">状态: {debugSessionDetail.status}</p>
                  <p className="text-xs text-slate-600">更新时间: {formatDateTime(debugSessionDetail.updatedAt)}</p>
                  <div className="border-t border-slate-200 pt-2 space-y-1">
                    <p className="text-xs font-medium text-slate-700">最近消息</p>
                    {(debugSessionDetail.messages || []).slice(-5).reverse().map((message, index) => (
                      <div key={`${message.timestamp}-${index}`} className="bg-slate-50 rounded px-2 py-1.5">
                        <p className="text-[11px] text-slate-500">
                          {message.role} · {formatDateTime(message.timestamp)}
                        </p>
                        <p className="text-xs text-slate-700 whitespace-pre-wrap line-clamp-3">{message.content}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          </div>
        )}
      </aside>
    </div>
  );
};

export default DebugDrawer;
