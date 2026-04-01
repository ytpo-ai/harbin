import React from 'react';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import { RUN_DETAIL_TABS, RUN_STATUS_META, SCORE_RULE_LABEL, getScoreBadgeClass } from './constants';
import { useLogState } from './hooks/useLogState';
import { DecisionTracebackDrawer } from './DecisionTracebackDrawer';

const MESSAGE_ROLE_META: Record<string, { label: string; icon: string; textColor: string; ringColor: string; badgeColor: string }> = {
  system: { label: '系统', icon: 'S', textColor: 'text-slate-500', ringColor: 'ring-slate-300', badgeColor: 'text-slate-600 bg-slate-50 ring-slate-200/60' },
  user: { label: '用户', icon: 'U', textColor: 'text-blue-600', ringColor: 'ring-blue-300', badgeColor: 'text-blue-600 bg-blue-50 ring-blue-200/60' },
  assistant: { label: 'Agent', icon: 'A', textColor: 'text-emerald-600', ringColor: 'ring-emerald-300', badgeColor: 'text-emerald-600 bg-emerald-50 ring-emerald-200/60' },
  tool: { label: '工具', icon: 'T', textColor: 'text-amber-600', ringColor: 'ring-amber-300', badgeColor: 'text-amber-600 bg-amber-50 ring-amber-200/60' },
};

interface LogTabProps {
  agentId: string;
  onViewSession: (sessionId: string) => void;
}

export const LogTab: React.FC<LogTabProps> = ({ agentId, onViewSession }) => {
  const state = useLogState(agentId);
  const [expandedScoreDetails, setExpandedScoreDetails] = React.useState<Record<string, boolean>>({});
  const [tracebackRunId, setTracebackRunId] = React.useState('');

  const tracebackTarget = state.runItems.find((item) => item.run.id === tracebackRunId);
  const tracebackScore = tracebackRunId ? state.runScores[tracebackRunId]?.data || null : null;
  const tracebackMessages = tracebackRunId ? state.runMessages[tracebackRunId]?.data || [] : [];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-slate-900">Agent 日志</h2>
          <p className="mt-1 text-sm text-slate-500">按 Run 查看执行流程、原始信息与扣分记录</p>
        </div>
        <button
          onClick={() => state.logQuery.refetch()}
          className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 transition-all hover:border-slate-300 hover:bg-slate-50"
        >
          <ArrowPathIcon className={`mr-2 h-4 w-4 ${state.logQuery.isFetching ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200/50">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          <input
            type="datetime-local"
            value={state.logFilters.from || ''}
            onChange={(e) => state.updateLogFilter({ from: e.target.value || undefined })}
            className="rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2.5 text-sm transition-all focus:border-primary-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-100"
            placeholder="开始时间"
          />
          <input
            type="datetime-local"
            value={state.logFilters.to || ''}
            onChange={(e) => state.updateLogFilter({ to: e.target.value || undefined })}
            className="rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2.5 text-sm transition-all focus:border-primary-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-100"
            placeholder="结束时间"
          />
          <select
            value={state.logFilters.status || ''}
            onChange={(e) => state.updateLogFilter({ status: e.target.value || undefined })}
            className="rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2.5 text-sm transition-all focus:border-primary-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-100"
          >
            <option value="">全部状态</option>
            <option value="pending">待执行</option>
            <option value="running">运行中</option>
            <option value="completed">成功</option>
            <option value="failed">失败</option>
            <option value="paused">已暂停</option>
            <option value="cancelled">已取消</option>
          </select>
        </div>
        <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
          <span>
            共 <span className="font-semibold text-slate-700">{state.logQuery.data?.total || 0}</span> 条运行记录
          </span>
          <span>
            页码 <span className="font-semibold text-slate-700">{state.logQuery.data?.page || 1}</span>/
            {Math.max(1, state.logQuery.data?.totalPages || 1)}
          </span>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200/50">
        {state.logQuery.isLoading ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="animate-pulse rounded-xl border border-slate-100 p-5">
                <div className="mb-4 h-4 w-32 rounded-lg bg-slate-100" />
                <div className="mb-3 h-6 w-1/2 rounded-lg bg-slate-200" />
                <div className="h-4 w-3/4 rounded-lg bg-slate-100" />
              </div>
            ))}
          </div>
        ) : state.logQuery.error ? (
          <div className="flex flex-col items-center justify-center p-12 text-red-500">
            <p className="text-sm font-medium">运行记录查询失败，请检查权限或筛选条件</p>
          </div>
        ) : state.runItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-slate-400">
            <p className="text-sm">暂无运行记录</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {state.runItems.map(({ run, totalDurationMs }) => {
              const isExpanded = state.expandedRunKeys[run.id] === true;
              const activeTab = state.detailTabs[run.id] || 'flow';
              const statusMeta = RUN_STATUS_META[run.status] || RUN_STATUS_META.running;
              const scoreState = state.runScores[run.id];
              const scoreData = scoreState?.data;
              const hasListScore = typeof run.score === 'number';
              const scoreValue = hasListScore ? run.score : scoreData?.score;
              const hasScore = typeof scoreValue === 'number';
              const scoreBadgeClass = hasScore ? getScoreBadgeClass(scoreValue!) : 'border-slate-200 bg-slate-100 text-slate-600';
              const scoreBadgeText = hasScore ? `${Math.round(scoreValue!)}分` : '无评分';
              const scoreDetailExpanded = expandedScoreDetails[run.id] === true;
              const durationStr =
                run.status === 'running' || run.status === 'pending'
                  ? '进行中'
                  : totalDurationMs >= 1000
                    ? `${(totalDurationMs / 1000).toFixed(1)}s`
                    : `${totalDurationMs}ms`;
              const runMessages = state.runMessages[run.id];

              return (
                <div key={run.id}>
                  <button
                    onClick={() => state.toggleTaskExpanded(run.id)}
                    className="w-full px-5 py-4 text-left transition-colors hover:bg-slate-50/50"
                  >
                    <div className="flex items-center gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <h3 className="truncate text-sm font-semibold text-slate-900">{run.taskTitle || '未命名任务'}</h3>
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${statusMeta.badgeClass}`}>
                            {statusMeta.label}
                          </span>
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${scoreBadgeClass}`}>
                            {scoreBadgeText}
                          </span>
                          <span className="text-slate-500">耗时: {durationStr}</span>
                          <span className="truncate text-slate-500">Agent: {run.agentName || '-'}</span>
                        </div>
                      </div>

                      <div className="mt-1 flex flex-shrink-0 items-center">
                        <span className={`inline-block text-slate-400 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}>
                          {'>'}
                        </span>
                      </div>
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="border-t border-slate-100 bg-slate-50/30 px-5 py-4">
                      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap gap-2">
                        {RUN_DETAIL_TABS.map((tab) => {
                          const selected = activeTab === tab.key;
                          return (
                            <button
                              key={tab.key}
                              onClick={(e) => {
                                e.stopPropagation();
                                state.setDetailTab(run.id, tab.key);
                              }}
                              className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                                selected
                                  ? 'border-primary-200 bg-primary-50 text-primary-700'
                                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                              }`}
                            >
                              {tab.label}
                            </button>
                          );
                        })}
                        </div>

                        {(run.status === 'completed' || run.status === 'failed') && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setTracebackRunId(run.id);
                            }}
                            className="inline-flex items-center text-xs font-medium text-primary-600 transition-colors hover:text-primary-700"
                          >
                            决策回溯 -&gt;
                          </button>
                        )}
                      </div>

                      {activeTab === 'raw' && (
                        <div className="space-y-3">
                          <p className="text-xs font-medium text-slate-500">原始运行数据（JSON）</p>
                          <pre className="max-h-[420px] overflow-auto rounded-lg border border-slate-200 bg-slate-900 p-4 text-[11px] leading-relaxed text-slate-100">
                            {JSON.stringify(run, null, 2)}
                          </pre>
                        </div>
                      )}

                      {activeTab === 'flow' && (
                        <div className="space-y-3">
                          {runMessages?.loading ? (
                            <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">执行流程加载中...</div>
                          ) : runMessages?.error ? (
                            <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">执行流程加载失败：{runMessages.error}</div>
                          ) : runMessages?.data?.length ? (
                            <div className="relative ml-4 space-y-0 border-l-2 border-slate-200 pl-6">
                              {runMessages.data.map((message) => {
                                const roleMeta = MESSAGE_ROLE_META[message.role] || MESSAGE_ROLE_META.user;
                                const hasToolParts = message.parts.some((p) => p.type === 'tool_call' || p.type === 'tool_result');
                                const hasError = message.parts.some((p) => !!p.error);
                                const contentPreview =
                                  typeof message.content === 'string' && message.content.length > 300
                                    ? message.content.slice(0, 300) + '...'
                                    : message.content;

                                return (
                                  <div key={message.id} className="relative pb-4 last:pb-0">
                                    <div className={`absolute -left-[31px] top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-white ring-2 ${roleMeta.ringColor}`}>
                                      <span className={`text-[10px] font-bold leading-none ${roleMeta.textColor}`}>{roleMeta.icon}</span>
                                    </div>

                                    <div className={`rounded-lg border bg-white px-4 py-3 transition-all ${hasError ? 'border-red-200/60' : 'border-slate-200/60'}`}>
                                      <div className="flex flex-wrap items-center gap-2">
                                        <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ring-1 ${roleMeta.badgeColor}`}>
                                          {roleMeta.label}
                                        </span>
                                        <span className="text-[11px] text-slate-400">{new Date(message.timestamp).toLocaleTimeString()}</span>
                                        {hasToolParts && (
                                          <span className="inline-flex rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 ring-1 ring-amber-200/60">
                                            工具调用
                                          </span>
                                        )}
                                      </div>

                                      {contentPreview && (
                                        <p className="mt-2 whitespace-pre-wrap break-words text-xs text-slate-600 leading-relaxed">{contentPreview}</p>
                                      )}

                                      {message.parts.length > 0 && (
                                        <div className="mt-2 space-y-1.5">
                                          {message.parts.map((part) => {
                                            const partIcon =
                                              part.type === 'tool_call' ? '#' : part.type === 'tool_result' ? '+' : part.type === 'reasoning' ? '~' : '.';
                                            const partColor = part.error
                                              ? 'border-red-200/60 bg-red-50/50'
                                              : part.type === 'tool_call' || part.type === 'tool_result'
                                                ? 'border-amber-200/60 bg-amber-50/30'
                                                : 'border-slate-200/60 bg-slate-50/30';

                                            return (
                                              <div key={part.id} className={`rounded-md border px-3 py-1.5 text-[11px] ${partColor}`}>
                                                <span className="font-semibold text-slate-500">[{partIcon}]</span>{' '}
                                                <span className="font-medium text-slate-600">{part.type}</span>
                                                {part.toolId && <span className="text-slate-500"> · {part.toolId}</span>}
                                                {part.status && part.status !== 'completed' && (
                                                  <span className="ml-1 text-slate-400">({part.status})</span>
                                                )}
                                                {part.error && <span className="ml-1 text-red-600"> · {part.error}</span>}
                                              </div>
                                            );
                                          })}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">暂无执行流程数据</div>
                          )}

                          {run.sessionId && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onViewSession(run.sessionId as string);
                              }}
                              className="mt-2 inline-flex items-center text-[11px] font-medium text-primary-600 transition-colors hover:text-primary-700"
                            >
                              查看 Session -&gt;
                            </button>
                          )}
                        </div>
                      )}

                      {activeTab === 'score' && (
                        <div className="space-y-4">
                          {scoreState?.loading ? (
                            <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">评分加载中...</div>
                          ) : scoreState?.error ? (
                            <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">评分加载失败：{scoreState.error}</div>
                          ) : !scoreData ? (
                            <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">该 Run 暂无评分记录</div>
                          ) : (
                            <>
                              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                                <div className="rounded-lg border border-slate-200 bg-white p-3">
                                  <p className="text-[11px] text-slate-500">总评分</p>
                                  <p className="mt-1 text-lg font-semibold text-slate-900">{Math.round(scoreData.score)}/100</p>
                                </div>
                                <div className="rounded-lg border border-slate-200 bg-white p-3">
                                  <p className="text-[11px] text-slate-500">执行轮次</p>
                                  <p className="mt-1 text-lg font-semibold text-slate-900">{scoreData.stats.totalRounds}</p>
                                </div>
                                <div className="rounded-lg border border-slate-200 bg-white p-3">
                                  <p className="text-[11px] text-slate-500">工具调用</p>
                                  <p className="mt-1 text-lg font-semibold text-slate-900">{scoreData.stats.totalToolCalls}</p>
                                </div>
                                <div className="rounded-lg border border-slate-200 bg-white p-3">
                                  <p className="text-[11px] text-slate-500">工具成功率</p>
                                  <p className="mt-1 text-lg font-semibold text-slate-900">
                                    {scoreData.stats.totalToolCalls > 0
                                      ? `${Math.round((scoreData.stats.successfulToolCalls / scoreData.stats.totalToolCalls) * 100)}%`
                                      : '-'}
                                  </p>
                                </div>
                              </div>

                              <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                                <div className="border-b border-slate-100 px-4 py-2 text-xs font-medium text-slate-500">扣分规则汇总</div>
                                <table className="w-full text-left text-xs">
                                  <thead className="bg-slate-50 text-slate-500">
                                    <tr>
                                      <th className="px-4 py-2 font-medium">规则</th>
                                      <th className="px-4 py-2 font-medium">说明</th>
                                      <th className="px-4 py-2 font-medium">触发次数</th>
                                      <th className="px-4 py-2 font-medium">总扣分</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {Object.entries(scoreData.deductionsByRule)
                                      .filter(([, value]) => value.count > 0)
                                      .map(([ruleId, value]) => (
                                        <tr key={ruleId} className="border-t border-slate-100 text-slate-700">
                                          <td className="px-4 py-2 font-medium">{ruleId}</td>
                                          <td className="px-4 py-2">{SCORE_RULE_LABEL[ruleId] || '未定义规则'}</td>
                                          <td className="px-4 py-2">{value.count}</td>
                                          <td className="px-4 py-2">{value.totalPoints}</td>
                                        </tr>
                                      ))}
                                  </tbody>
                                </table>
                              </div>

                              <div className="rounded-lg border border-slate-200 bg-white">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setExpandedScoreDetails((prev) => ({
                                      ...prev,
                                      [run.id]: !prev[run.id],
                                    }));
                                  }}
                                  className="w-full px-4 py-2 text-left text-xs font-medium text-slate-600 hover:bg-slate-50"
                                >
                                  {scoreDetailExpanded ? '收起完整扣分明细' : '查看完整扣分明细'}
                                </button>
                                {scoreDetailExpanded && (
                                  <div className="space-y-2 border-t border-slate-100 px-4 py-3">
                                    {[...scoreData.deductions]
                                      .sort((a, b) => a.round - b.round || new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
                                      .map((deduction, index) => (
                                        <div key={`${deduction.ruleId}-${deduction.round}-${index}`} className="rounded-md border border-slate-200 px-3 py-2 text-xs text-slate-700">
                                          <span className="font-semibold">[{deduction.ruleId}]</span> {deduction.points}分  第{deduction.round}轮
                                          {deduction.toolId ? `  工具: ${deduction.toolId}` : ''}
                                          {deduction.detail ? `  ${deduction.detail}` : ''}
                                        </div>
                                      ))}
                                  </div>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {state.logQuery.data && state.logQuery.data.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-500">
            第 {state.logFilters.page || 1} / {state.logQuery.data.totalPages} 页
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => state.setLogFilters((prev) => ({ ...prev, page: Math.max(1, (prev.page || 1) - 1) }))}
              disabled={(state.logFilters.page || 1) <= 1}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition-all hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              上一页
            </button>
            <button
              onClick={() => state.setLogFilters((prev) => ({ ...prev, page: (prev.page || 1) + 1 }))}
              disabled={!!state.logQuery.data && (state.logFilters.page || 1) >= (state.logQuery.data.totalPages || 1)}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition-all hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              下一页
            </button>
          </div>
        </div>
      )}

      {tracebackTarget && (
        <DecisionTracebackDrawer
          open={!!tracebackTarget}
          run={tracebackTarget.run}
          totalDurationMs={tracebackTarget.totalDurationMs}
          scoreData={tracebackScore}
          messages={tracebackMessages}
          onClose={() => setTracebackRunId('')}
        />
      )}
    </div>
  );
};
