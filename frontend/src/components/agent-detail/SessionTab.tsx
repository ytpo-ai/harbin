import React, { useEffect } from 'react';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import { useSessionState } from './hooks/useSessionState';
import { getSessionId } from './utils';
import { SessionDrawer } from './SessionDrawer';

interface SessionTabProps {
  agentId: string;
  agentName?: string;
  externalSessionId?: string;
  onExternalSessionHandled?: () => void;
}

export const SessionTab: React.FC<SessionTabProps> = ({ agentId, agentName, externalSessionId, onExternalSessionHandled }) => {
  const state = useSessionState(agentId);
  const { setSessionIdInput, setSelectedSessionId, setIsSessionDrawerOpen } = state;

  useEffect(() => {
    const sid = (externalSessionId || '').trim();
    if (!sid) return;
    setSessionIdInput(sid);
    setSelectedSessionId(sid);
    setIsSessionDrawerOpen(true);
    onExternalSessionHandled?.();
  }, [externalSessionId, onExternalSessionHandled, setIsSessionDrawerOpen, setSelectedSessionId, setSessionIdInput]);

  return (
    <>
      <div className="space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-bold tracking-tight text-slate-900">Session 查询</h2>
            <p className="mt-1 text-sm text-slate-500">查看该 Agent 的会话上下文、消息轨迹与运行关联信息</p>
          </div>
          <button
            onClick={() => {
              state.sessionListQuery.refetch();
              if (state.selectedSessionId) {
                state.sessionDetailQuery.refetch();
              }
            }}
            className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 transition-all hover:border-slate-300 hover:bg-slate-50"
          >
            <ArrowPathIcon
              className={`mr-2 h-4 w-4 ${state.sessionListQuery.isFetching || state.sessionDetailQuery.isFetching ? 'animate-spin' : ''}`}
            />
            刷新
          </button>
        </div>

        <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200/50">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <input
              value={state.sessionKeyword}
              onChange={(e) => {
                state.setSessionKeyword(e.target.value);
                state.setSessionPage(1);
              }}
              className="rounded-lg border border-slate-200 bg-slate-50/50 px-4 py-2.5 text-sm transition-all focus:border-primary-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-100"
              placeholder="关键词（标题/plan/task/meeting）"
            />
            <input
              value={state.sessionIdInput}
              onChange={(e) => state.setSessionIdInput(e.target.value)}
              className="rounded-lg border border-slate-200 bg-slate-50/50 px-4 py-2.5 text-sm transition-all focus:border-primary-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-100"
              placeholder="精确查询 Session ID"
            />
            <button
              onClick={() => {
                const sid = state.sessionIdInput.trim();
                if (!sid) return;
                state.setSelectedSessionId(sid);
                state.setIsSessionDrawerOpen(true);
              }}
              className="inline-flex items-center justify-center rounded-lg border border-primary-200/60 bg-primary-50/50 px-4 py-2.5 text-sm font-medium text-primary-700 transition-all hover:border-primary-300 hover:bg-primary-100/50"
            >
              按 Session ID 查询
            </button>
            <button
              onClick={state.clearSessionFilter}
              className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 transition-all hover:border-slate-300 hover:bg-slate-50"
            >
              清空筛选
            </button>
          </div>
          <div className="mt-4 text-sm text-slate-500">
            当前共 <span className="font-semibold text-slate-700">{state.sessionListQuery.data?.total || 0}</span> 条，页码{' '}
            <span className="font-semibold text-slate-700">{state.sessionListQuery.data?.page || 1}</span>/
            {Math.max(1, state.sessionListQuery.data?.totalPages || 1)}
          </div>
        </div>

        <div className="rounded-xl bg-white shadow-sm ring-1 ring-slate-200/50">
          <div className="border-b border-slate-100 px-5 py-4 text-sm font-semibold text-slate-800">会话列表</div>
          {state.sessionListQuery.isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary-200 border-t-primary-600" />
            </div>
          ) : state.sessionListQuery.error ? (
            <div className="flex flex-col items-center justify-center py-12 text-red-500">
              <div className="mb-2 text-4xl">⚠️</div>
              <p className="text-sm">Session 列表加载失败，请稍后重试</p>
            </div>
          ) : state.sessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <div className="mb-2 text-4xl">💬</div>
              <p className="text-sm">暂无 Session 数据</p>
            </div>
          ) : (
            <div className="max-h-[70vh] space-y-2 overflow-y-auto p-3">
              {state.sessions.map((session) => {
                const sid = getSessionId(session);
                const lastMessage = session.messages?.[session.messages.length - 1];
                const isSelected = sid && sid === state.selectedSessionId;
                return (
                  <button
                    key={sid || session._id || `${session.title}-${session.createdAt || 'na'}`}
                    onClick={() => {
                      state.setSelectedSessionId(sid);
                      state.setIsSessionDrawerOpen(true);
                    }}
                    className={`w-full rounded-xl border p-4 text-left transition-all duration-200 ${
                      isSelected
                        ? 'border-primary-300 bg-primary-50/50 shadow-sm'
                        : 'border-slate-200/60 bg-white hover:border-slate-300 hover:bg-slate-50/50 hover:shadow-sm'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="flex-1 truncate text-sm font-semibold text-slate-900">{session.title || sid}</p>
                      <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-600 ring-1 ring-slate-200/60">
                        {session.sessionType}
                      </span>
                    </div>
                    <p className="mt-1.5 truncate font-mono text-xs text-slate-400">{sid}</p>
                    <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-slate-500">{lastMessage?.content || '暂无消息内容'}</p>
                    <div className="mt-3 flex items-center justify-between text-[11px] text-slate-400">
                      <span
                        className={`font-medium ${
                          session.status === 'active'
                            ? 'text-emerald-600'
                            : String(session.status) === 'completed'
                              ? 'text-blue-600'
                              : 'text-slate-500'
                        }`}
                      >
                        {session.status}
                      </span>
                      <span>{session.lastActiveAt ? new Date(session.lastActiveAt).toLocaleString() : '-'}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {state.totalSessionPages > 1 && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-500">
              第 {state.sessionPage} / {state.totalSessionPages} 页
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => state.setSessionPage((prev) => Math.max(1, prev - 1))}
                disabled={state.sessionPage <= 1}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition-all hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                上一页
              </button>
              <button
                onClick={() => state.setSessionPage((prev) => Math.min(state.totalSessionPages, prev + 1))}
                disabled={state.sessionPage >= state.totalSessionPages}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition-all hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                下一页
              </button>
            </div>
          </div>
        )}
      </div>

      <SessionDrawer state={state} agentName={agentName} />
    </>
  );
};
