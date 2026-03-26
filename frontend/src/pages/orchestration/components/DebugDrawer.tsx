import React from 'react';
import { ClockIcon, PencilSquareIcon, PlayIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { AgentSession, DebugRuntimeTaskTypeOverride, OrchestrationTask } from '../../../services/orchestrationService';
import { DEBUG_RUNTIME_TYPE_OPTIONS, DrawerTab } from '../constants';
import { formatDateTime } from '../utils';

type AgentOption = {
  id: string;
  name: string;
};

type Props = {
  open: boolean;
  activeDrawerTab: DrawerTab;
  debugTask?: OrchestrationTask;
  debugTitle: string;
  debugDescription: string;
  debugRuntimeTaskType: 'auto' | DebugRuntimeTaskTypeOverride;
  debugAgentId: string;
  debugHint: string;
  debugSessionId: string;
  debugSessionLoading: boolean;
  debugSessionDetail?: AgentSession;
  agents: AgentOption[];
  saveTaskDraftLoading: boolean;
  debugStepLoading: boolean;
  reassignLoading: boolean;
  onClose: () => void;
  onSwitchTab: (tab: DrawerTab) => void;
  onDebugTitleChange: (value: string) => void;
  onDebugDescriptionChange: (value: string) => void;
  onDebugRuntimeTaskTypeChange: (value: 'auto' | DebugRuntimeTaskTypeOverride) => void;
  onDebugAgentIdChange: (value: string) => void;
  onSaveTaskDraft: () => void;
  onDebugRun: () => void;
};

const DebugDrawer: React.FC<Props> = ({
  open,
  activeDrawerTab,
  debugTask,
  debugTitle,
  debugDescription,
  debugRuntimeTaskType,
  debugAgentId,
  debugHint,
  debugSessionId,
  debugSessionLoading,
  debugSessionDetail,
  agents,
  saveTaskDraftLoading,
  debugStepLoading,
  reassignLoading,
  onClose,
  onSwitchTab,
  onDebugTitleChange,
  onDebugDescriptionChange,
  onDebugRuntimeTaskTypeChange,
  onDebugAgentIdChange,
  onSaveTaskDraft,
  onDebugRun,
}) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90]">
      <div className="absolute inset-0 bg-black/25" onClick={onClose} />
      <aside className="absolute right-0 top-0 flex h-full w-full flex-col border-l border-gray-200 bg-white shadow-2xl sm:w-[92vw] lg:w-[56vw]">
        <div className="flex items-start justify-between gap-2 border-b border-gray-200 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-gray-900">单步调试抽屉</p>
            <p className="mt-0.5 text-xs text-gray-500">
              {debugTask ? `Step #${debugTask.order + 1} · ${debugTask.status}` : '请选择任务后再调试'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-gray-500 hover:bg-gray-100"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="inline-flex gap-2 border-b border-gray-200 px-4 py-2">
          <button
            onClick={() => onSwitchTab('debug')}
            className={`rounded px-3 py-1.5 text-xs ${activeDrawerTab === 'debug' ? 'bg-primary-100 text-primary-700' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            调试
          </button>
          <button
            onClick={() => onSwitchTab('session')}
            className={`rounded px-3 py-1.5 text-xs ${activeDrawerTab === 'session' ? 'bg-primary-100 text-primary-700' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            Session
          </button>
        </div>

        {!debugTask ? (
          <div className="flex-1 p-4 text-sm text-gray-500">当前计划中未找到该任务，请重新选择。</div>
        ) : activeDrawerTab === 'debug' ? (
          <>
            <div className="space-y-3 border-b border-gray-200 p-4">
              <div className="grid grid-cols-1 gap-2">
                <label className="text-xs text-gray-600">执行 Agent</label>
                <select
                  value={debugAgentId}
                  onChange={(event) => onDebugAgentIdChange(event.target.value)}
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
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
                <label className="text-xs text-gray-600">任务标题</label>
                <input
                  value={debugTitle}
                  onChange={(event) => onDebugTitleChange(event.target.value)}
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                />
              </div>
              <div className="grid grid-cols-1 gap-2">
                <label className="text-xs text-gray-600">任务描述（可编辑后反复调试）</label>
                <textarea
                  value={debugDescription}
                  onChange={(event) => onDebugDescriptionChange(event.target.value)}
                  className="min-h-[120px] w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                />
              </div>
              <div className="grid grid-cols-1 gap-2">
                <label className="text-xs text-gray-600">任务类型（可保存）</label>
                <select
                  value={debugRuntimeTaskType}
                  onChange={(event) => onDebugRuntimeTaskTypeChange(event.target.value as 'auto' | DebugRuntimeTaskTypeOverride)}
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                >
                  {DEBUG_RUNTIME_TYPE_OPTIONS.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={onSaveTaskDraft}
                  disabled={saveTaskDraftLoading}
                  className="inline-flex items-center gap-1 rounded border border-gray-300 px-3 py-1.5 text-xs hover:bg-gray-50 disabled:opacity-50"
                >
                  <PencilSquareIcon className="h-4 w-4" /> 保存草稿
                </button>
                <button
                  onClick={onDebugRun}
                  disabled={debugStepLoading || reassignLoading}
                  className="inline-flex items-center gap-1 rounded bg-gray-900 px-3 py-1.5 text-xs text-white disabled:bg-gray-300"
                >
                  <PlayIcon className="h-4 w-4" /> 执行当前 Step
                </button>
              </div>
              {debugHint && <p className="text-xs text-primary-700">{debugHint}</p>}
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto p-4">
              <section className="space-y-2">
                <p className="text-xs font-semibold text-gray-700">运行日志</p>
                {!debugTask.runLogs?.length ? (
                  <p className="text-xs text-gray-400">暂无日志</p>
                ) : (
                  <div className="space-y-1">
                    {debugTask.runLogs.slice(-10).reverse().map((log, index) => (
                      <div key={`${log.timestamp}-${index}`} className="rounded border border-gray-200 px-2 py-1.5">
                        <p className="inline-flex items-center gap-1 text-[11px] text-gray-500">
                          <ClockIcon className="h-3 w-3" /> {formatDateTime(log.timestamp)} · {log.level}
                        </p>
                        <p className="mt-0.5 text-xs text-gray-700">{log.message}</p>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </>
        ) : (
          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            <section className="space-y-2">
              <p className="text-xs font-semibold text-gray-700">Session 信息</p>
              {!debugSessionId ? (
                <p className="text-xs text-gray-400">该任务尚未产生 session</p>
              ) : debugSessionLoading ? (
                <p className="text-xs text-gray-400">加载 session 中...</p>
              ) : !debugSessionDetail ? (
                <p className="text-xs text-gray-400">未查询到 session 详情</p>
              ) : (
                <div className="space-y-2 rounded border border-gray-200 p-3">
                  <p className="text-xs text-gray-600">ID: {debugSessionDetail._id}</p>
                  <p className="text-xs text-gray-600">Owner: {debugSessionDetail.ownerType} / {debugSessionDetail.ownerId}</p>
                  <p className="text-xs text-gray-600">状态: {debugSessionDetail.status}</p>
                  <p className="text-xs text-gray-600">更新时间: {formatDateTime(debugSessionDetail.updatedAt)}</p>
                  <div className="space-y-1 border-t border-gray-200 pt-2">
                    <p className="text-xs font-medium text-gray-700">最近消息</p>
                    {(debugSessionDetail.messages || []).slice(-5).reverse().map((message, index) => (
                      <div key={`${message.timestamp}-${index}`} className="rounded bg-gray-50 px-2 py-1.5">
                        <p className="text-[11px] text-gray-500">
                          {message.role} · {formatDateTime(message.timestamp)}
                        </p>
                        <p className="line-clamp-3 whitespace-pre-wrap text-xs text-gray-700">{message.content}</p>
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
