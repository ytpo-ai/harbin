import React from 'react';
import { AgentSession } from '../../services/orchestrationService';
import { formatDateTime } from './constants';

interface DebugDrawerSessionTabProps {
  debugSessionId: string;
  debugSessionDetail: AgentSession | undefined;
  debugSessionLoading: boolean;
}

const DebugDrawerSessionTab: React.FC<DebugDrawerSessionTabProps> = ({
  debugSessionId,
  debugSessionDetail,
  debugSessionLoading,
}) => (
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
);

export default DebugDrawerSessionTab;
