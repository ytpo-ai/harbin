import React from 'react';
import {
  ArrowPathIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClipboardDocumentIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { AgentRuntimeSessionMessage, AgentRuntimeSessionPart } from '../../services/agentService';
import { UseSessionStateResult } from './hooks/useSessionState';
import {
  getSessionMessageKey,
  getSessionMessageRawText,
  getSessionMessageText,
  getSessionPartText,
  getSessionPartType,
  getSystemMessageTag,
  shouldClampPartContent,
} from './utils';

interface SessionDrawerProps {
  state: UseSessionStateResult;
  agentName?: string;
}

const RoleBadge: React.FC<{ message: AgentRuntimeSessionMessage }> = ({ message }) => {
  const roleMap: Record<AgentRuntimeSessionMessage['role'], string> = {
    system: '系统',
    user: '用户',
    assistant: 'Agent',
    tool: '工具',
  };
  const roleClassMap: Record<AgentRuntimeSessionMessage['role'], string> = {
    system: 'bg-gray-100 text-gray-700',
    user: 'bg-blue-200 text-blue-800 ring-1 ring-blue-300/80',
    assistant: 'bg-green-100 text-green-700',
    tool: 'bg-amber-100 text-amber-700',
  };
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${roleClassMap[message.role]}`}>{roleMap[message.role]}</span>;
};

const MessageStatusBadge: React.FC<{ message: AgentRuntimeSessionMessage }> = ({ message }) => {
  const status = message.status || 'completed';
  if (status === 'completed') return <span className="inline-flex rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-700">完成</span>;
  if (status === 'streaming') return <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">流式中</span>;
  if (status === 'pending') return <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">待处理</span>;
  return <span className="inline-flex rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-700">异常</span>;
};

const FinishStatusBadge: React.FC<{ message: AgentRuntimeSessionMessage }> = ({ message }) => {
  if (!message.finish) return null;
  const labelMap: Record<string, string> = {
    stop: 'stop',
    'tool-calls': 'tool-calls',
    error: 'error',
    cancelled: 'cancelled',
    paused: 'paused',
    'max-rounds': 'max-rounds',
  };
  return <span className="inline-flex rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700">{labelMap[message.finish] || message.finish}</span>;
};

const TokenUsageBadge: React.FC<{ message: AgentRuntimeSessionMessage }> = ({ message }) => {
  if (!message.tokens) return null;
  return <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">tokens: {message.tokens.total ?? 0}</span>;
};

const CostBadge: React.FC<{ message: AgentRuntimeSessionMessage }> = ({ message }) => {
  if (typeof message.cost !== 'number' || Number.isNaN(message.cost)) return null;
  return <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">cost: {message.cost.toFixed(6)}</span>;
};

const getSessionMessageParts = (parts: AgentRuntimeSessionPart[] | undefined, message: AgentRuntimeSessionMessage): AgentRuntimeSessionPart[] => {
  if (!parts?.length || !message.id) return [];
  return parts.filter((part) => part.messageId === message.id);
};

export const SessionDrawer: React.FC<SessionDrawerProps> = ({ state, agentName }) => {
  if (!state.isSessionDrawerOpen) return null;

  const sessionDetail = state.sessionDetailQuery.data;
  const displaySessionId = (sessionDetail?.id || state.selectedSessionId || '').trim();
  const displaySessionIdTail = displaySessionId.length > 18 ? `...${displaySessionId.slice(-18)}` : displaySessionId;
  const contextItems = [
    { label: 'Plan', value: sessionDetail?.planContext?.linkedPlanId },
    { label: 'Task', value: sessionDetail?.planContext?.linkedTaskId },
    { label: 'Meeting', value: sessionDetail?.meetingContext?.meetingId },
    { label: 'Agenda', value: sessionDetail?.meetingContext?.agendaId },
  ].filter((item) => !!item.value?.trim());

  return (
    <div className="fixed inset-0 z-40">
      <button
        className="absolute inset-0 bg-slate-900/20 backdrop-blur-sm"
        onClick={() => state.setIsSessionDrawerOpen(false)}
        aria-label="关闭 Session 详情抽屉"
      />
      <aside className="absolute right-0 top-0 h-full w-[96vw] max-w-3xl bg-white shadow-2xl ring-1 ring-slate-200/50">
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-slate-200/60 px-6 py-5">
            <div className="min-w-0 flex-1 pr-4">
              <p className="text-lg font-semibold text-slate-900">Session 详情</p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1">
                  <span className="text-slate-400">Session ID</span>
                  <span className="max-w-[180px] truncate font-mono text-slate-700" title={displaySessionId || '-'}>
                    {displaySessionIdTail || '-'}
                  </span>
                  {displaySessionId ? (
                    <button
                      onClick={() => state.copyText(displaySessionId)}
                      className="rounded p-0.5 text-slate-400 transition-colors hover:bg-slate-200/70 hover:text-slate-600"
                      title="复制 Session ID"
                      aria-label="复制 Session ID"
                    >
                      <ClipboardDocumentIcon className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </span>
                <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1">
                  <span className="mr-1 text-slate-400">Agent</span>
                  <span className="max-w-[180px] truncate text-slate-700" title={agentName || '-'}>
                    {agentName || '-'}
                  </span>
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {sessionDetail ? (
                <button
                  onClick={state.handleCopySessionContent}
                  className="inline-flex items-center rounded-lg bg-primary-50 px-3 py-1.5 text-xs font-medium text-primary-600 transition-colors hover:bg-primary-100"
                >
                  <ClipboardDocumentIcon className="mr-1.5 h-3.5 w-3.5" />
                  复制会话
                </button>
              ) : null}
              <button
                onClick={() => {
                  state.sessionDetailQuery.refetch();
                  state.sessionListQuery.refetch();
                }}
                className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                aria-label="刷新 Session 内容"
                title="刷新 Session 内容"
              >
                <ArrowPathIcon className={`h-5 w-5 ${state.sessionDetailQuery.isFetching ? 'animate-spin' : ''}`} />
              </button>
              <button
                onClick={() => state.setIsSessionDrawerOpen(false)}
                className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                aria-label="关闭抽屉"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-5">
            {!state.selectedSessionId ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                <div className="mb-2 text-4xl">💬</div>
                <p className="text-sm">请从列表选择 Session，或输入 Session ID 查询</p>
              </div>
            ) : state.sessionDetailQuery.isLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary-200 border-t-primary-600" />
              </div>
            ) : state.sessionDetailQuery.error ? (
              <div className="flex flex-col items-center justify-center py-12 text-red-500">
                <div className="mb-2 text-4xl">⚠️</div>
                <p className="text-sm">未找到该 Session，或你暂无访问权限</p>
              </div>
            ) : (
              <div className="space-y-5">
                <p className="text-sm font-semibold text-slate-800">基础信息</p>
                {state.sessionCopyNotice ? <p className="text-xs font-medium text-emerald-600">{state.sessionCopyNotice}</p> : null}

                <div className="space-y-3">
                  <div className="rounded-xl border border-slate-200/60 bg-slate-50/50 px-4 py-3">
                    <p className="text-xs font-medium uppercase tracking-wider text-slate-400">Session ID</p>
                    <p className="mt-1.5 truncate font-mono text-xs text-slate-700">{sessionDetail?.id}</p>
                  </div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    <div className="rounded-xl border border-slate-200/60 bg-slate-50/50 px-4 py-3">
                      <p className="text-xs font-medium uppercase tracking-wider text-slate-400">状态</p>
                      <p className="mt-1.5 text-sm font-medium text-slate-700">{sessionDetail?.status}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200/60 bg-slate-50/50 px-4 py-3">
                      <p className="text-xs font-medium uppercase tracking-wider text-slate-400">类型</p>
                      <p className="mt-1.5 text-sm font-medium text-slate-700">{sessionDetail?.sessionType}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200/60 bg-slate-50/50 px-4 py-3">
                      <p className="text-xs font-medium uppercase tracking-wider text-slate-400">最近活跃</p>
                      <p className="mt-1.5 text-sm text-slate-600">{sessionDetail?.lastActiveAt ? new Date(sessionDetail.lastActiveAt).toLocaleString() : '-'}</p>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200/60 p-4">
                  <p className="text-sm font-semibold text-slate-800">上下文</p>
                  {contextItems.length ? (
                    <div className="mt-3 grid grid-cols-1 gap-3 text-xs md:grid-cols-2">
                      {contextItems.map((item) => (
                        <div key={item.label} className="rounded-lg bg-slate-50 p-2.5">
                          <p className="text-slate-400">{item.label}</p>
                          <div className="mt-1 flex items-center gap-2">
                            <p className="min-w-0 flex-1 truncate font-mono text-slate-600" title={item.value}>
                              {item.value}
                            </p>
                            <button
                              onClick={() => state.copyText(item.value || '')}
                              className="rounded p-0.5 text-slate-400 transition-colors hover:bg-slate-200/70 hover:text-slate-600"
                              title={`复制 ${item.label}`}
                              aria-label={`复制 ${item.label}`}
                            >
                              <ClipboardDocumentIcon className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-slate-400">暂无上下文信息</p>
                  )}
                </div>

                <div>
                  <p className="mb-3 text-sm font-semibold text-slate-800">消息轨迹 ({state.sessionDetailQuery.data?.messages?.length || 0})</p>
                  {!state.sessionDetailQuery.data?.messages?.length ? (
                    <div className="rounded-xl border-2 border-dashed border-slate-200 p-8 text-center">
                      <p className="text-sm text-slate-400">该 Session 暂无消息记录</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {state.groupedSessionMessages.map((group) => (
                        <div key={group.key} className="rounded-xl border border-slate-200/60 bg-slate-50/40 p-3">
                          <div className="mb-2 text-xs font-medium text-slate-500">消息组（{group.messages.length} 条）</div>
                          <div className="space-y-3">
                            {group.messages.map((message, index) => {
                              const messageKey = getSessionMessageKey(message, index);
                              const messageText = getSessionMessageText(message);
                              const messageRawText = getSessionMessageRawText(message);
                              const messageParts = getSessionMessageParts(state.sessionDetailQuery.data?.parts, message);
                              const hasParts = messageParts.length > 0;
                              const isSystemMessage = message.role === 'system';
                              const systemMessageTag = getSystemMessageTag(message);
                              const isMessageExpanded = state.expandedSessionMessageIds[messageKey] ?? !isSystemMessage;
                              const isRawInfoExpanded = !!state.expandedSessionRawInfoIds[messageKey];
                              const isPartsExpanded = !!state.expandedSessionPartsIds[messageKey];

                              return (
                                <div key={messageKey} className="rounded-xl border border-slate-200/60 bg-white p-4 transition-all hover:border-slate-300 hover:shadow-sm">
                                  <button
                                    onClick={() =>
                                      state.setExpandedSessionMessageIds((prev) => ({
                                        ...prev,
                                        [messageKey]: !isMessageExpanded,
                                      }))
                                    }
                                    className="mb-3 flex w-full flex-wrap items-center gap-2 text-left"
                                  >
                                    <RoleBadge message={message} />
                                    {isSystemMessage && systemMessageTag ? (
                                      <span className="inline-flex rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700 ring-1 ring-violet-200/70">
                                        {systemMessageTag}
                                      </span>
                                    ) : null}
                                    <MessageStatusBadge message={message} />
                                    <FinishStatusBadge message={message} />
                                    <TokenUsageBadge message={message} />
                                    <CostBadge message={message} />
                                    {typeof message.stepIndex === 'number' ? (
                                      <span className="inline-flex rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">step: {message.stepIndex}</span>
                                    ) : null}
                                    <span className="ml-auto inline-flex items-center gap-1 text-xs text-slate-400">
                                      {message.timestamp ? new Date(message.timestamp).toLocaleString() : '-'}
                                      {isMessageExpanded ? <ChevronDownIcon className="h-3.5 w-3.5" /> : <ChevronRightIcon className="h-3.5 w-3.5" />}
                                    </span>
                                  </button>

                                  {isMessageExpanded ? (
                                    <div>
                                      <div className="whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-sm leading-relaxed text-slate-700">{messageText}</div>
                                      <div className="mb-3 mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                                        <button
                                          onClick={() =>
                                            state.setExpandedSessionRawInfoIds((prev) => ({
                                              ...prev,
                                              [messageKey]: !prev[messageKey],
                                            }))
                                          }
                                          className="rounded-md border border-slate-200 px-2 py-0.5 text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-700"
                                        >
                                          {isRawInfoExpanded ? '收起原始信息' : '查看原始信息'}
                                        </button>
                                        {!isSystemMessage ? (
                                          <button
                                            onClick={() =>
                                              state.setExpandedSessionPartsIds((prev) => ({
                                                ...prev,
                                                [messageKey]: !prev[messageKey],
                                              }))
                                            }
                                            className="rounded-md border border-slate-200 px-2 py-0.5 text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-700"
                                          >
                                            {`Parts: ${messageParts.length} ${isPartsExpanded ? '收起 parts' : '查看 parts'}`}
                                          </button>
                                        ) : null}
                                      </div>
                                    </div>
                                  ) : null}

                                  {isMessageExpanded && isRawInfoExpanded ? (
                                    <div className="mt-3 space-y-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                                      <div className="flex items-center justify-between">
                                        <span className="text-xs font-medium text-slate-500">消息原始信息</span>
                                        <button
                                          onClick={() => {
                                            state.copyText(messageRawText).then((copied) => {
                                              state.setSessionCopyNotice(copied ? '消息原始信息已复制到剪贴板' : '复制失败，请检查浏览器剪贴板权限');
                                              window.setTimeout(() => state.setSessionCopyNotice(''), 2000);
                                            });
                                          }}
                                          className="inline-flex items-center rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50"
                                        >
                                          <ClipboardDocumentIcon className="mr-1 h-3.5 w-3.5" />
                                          复制原始信息
                                        </button>
                                      </div>
                                      <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md border border-slate-200 bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-100">
                                        {messageRawText}
                                      </pre>
                                    </div>
                                  ) : null}

                                  {isMessageExpanded && !isSystemMessage && hasParts && isPartsExpanded ? (
                                    <div className="mt-3 space-y-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                                      {messageParts.map((part, partIndex) => {
                                        const partText = getSessionPartText(part);
                                        const partKey = `${messageKey}-part-${partIndex}`;
                                        const isPartExpanded = !!state.expandedSessionPartContentIds[partKey];
                                        const shouldClampPart = shouldClampPartContent(partText);
                                        return (
                                          <div key={partKey} className="rounded-md border border-slate-200 bg-white p-2.5">
                                            <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
                                              <span>Part #{partIndex + 1}</span>
                                              <span className="rounded bg-slate-100 px-2 py-0.5">{getSessionPartType(part)}</span>
                                            </div>
                                            <pre
                                              className="whitespace-pre-wrap break-words text-xs leading-relaxed text-slate-700"
                                              style={
                                                shouldClampPart && !isPartExpanded
                                                  ? {
                                                      display: '-webkit-box',
                                                      WebkitLineClamp: 5,
                                                      WebkitBoxOrient: 'vertical',
                                                      overflow: 'hidden',
                                                    }
                                                  : undefined
                                              }
                                            >
                                              {partText || '-'}
                                            </pre>
                                            {shouldClampPart ? (
                                              <button
                                                onClick={() =>
                                                  state.setExpandedSessionPartContentIds((prev) => ({
                                                    ...prev,
                                                    [partKey]: !prev[partKey],
                                                  }))
                                                }
                                                className="mt-1 text-[11px] font-medium text-primary-600 hover:text-primary-700"
                                              >
                                                {isPartExpanded ? '收起 part' : '展开 part'}
                                              </button>
                                            ) : null}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
};
