import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from 'react-query';
import { BeakerIcon, EyeIcon, PaperAirplaneIcon, XMarkIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import { agentService } from '../services/agentService';
import { memoService } from '../services/memoService';
import { AgentMemo } from '../types';

const memoTypeOptions: Array<AgentMemo['memoType']> = ['knowledge', 'standard'];
const memoKindOptions: Array<NonNullable<AgentMemo['memoKind']>> = [
  'identity',
  'todo',
  'topic',
  'evaluation',
  'achievement',
  'criticism',
];

type TestMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
};

const Memos: React.FC = () => {
  const queryClient = useQueryClient();
  const [agentId, setAgentId] = useState('');
  const [memoType, setMemoType] = useState<string>('');
  const [memoKind, setMemoKind] = useState<string>('');
  const [search, setSearch] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [testAgentId, setTestAgentId] = useState('');
  const [testPrompt, setTestPrompt] = useState('请总结你对当前系统功能状态的理解，并说明下一步重点。');
  const [testMessages, setTestMessages] = useState<TestMessage[]>([]);
  const [selectedMemo, setSelectedMemo] = useState<AgentMemo | null>(null);

  const { data: agents = [] } = useQuery('agents', agentService.getAgents);

  const { data: memoPaged, isLoading } = useQuery(
    ['memos', agentId, memoType, memoKind, search],
    () =>
      memoService.getMemos({
        agentId: agentId || undefined,
        memoType: (memoType || undefined) as AgentMemo['memoType'] | undefined,
        memoKind: (memoKind || undefined) as AgentMemo['memoKind'] | undefined,
        search: search.trim() || undefined,
        page: 1,
        pageSize: 80,
      }),
    { keepPreviousData: true },
  );

  const monitorMemosQuery = useQuery(
    ['memo-monitor-docs', testAgentId],
    () => memoService.getMemos({ agentId: testAgentId || undefined, page: 1, pageSize: 20 }),
    {
      enabled: drawerOpen && !!testAgentId,
      refetchInterval: drawerOpen ? 3000 : false,
    },
  );

  const aggregationStatusQuery = useQuery(
    ['memo-aggregation-status', testAgentId],
    () => memoService.getAggregationStatus(testAgentId || undefined),
    {
      enabled: drawerOpen,
      refetchInterval: drawerOpen ? 3000 : false,
    },
  );

  const executeMutation = useMutation(
    ({ id, prompt }: { id: string; prompt: string }) =>
      agentService.executeTask(id, {
        id: `memo-test-${Date.now()}`,
        title: `备忘录测试对话 ${new Date().toLocaleTimeString()}`,
        description: prompt,
        type: 'chat',
        priority: 'medium',
        status: 'in_progress',
        assignedAgents: [id],
        teamId: 'memo-test-team',
        messages: [{ role: 'user', content: prompt, timestamp: new Date().toISOString() }],
      }),
    {
      onSuccess: (result) => {
        setTestMessages((prev) => [
          ...prev,
          {
            id: `${Date.now()}-assistant`,
            role: 'assistant',
            content: result.response,
            createdAt: new Date().toISOString(),
          },
        ]);
        queryClient.invalidateQueries('memos');
        queryClient.invalidateQueries('memo-monitor-docs');
      },
    },
  );

  const flushMutation = useMutation((id?: string) => memoService.flushEvents(id), {
    onSuccess: () => {
      queryClient.invalidateQueries('memos');
      queryClient.invalidateQueries('memo-monitor-docs');
      queryClient.invalidateQueries('memo-aggregation-status');
    },
  });

  const aggregateIdentityMutation = useMutation((agentId: string) => memoService.aggregateIdentity(agentId), {
    onSuccess: () => {
      queryClient.invalidateQueries('memos');
      queryClient.invalidateQueries('memo-monitor-docs');
    },
  });

  const aggregateEvaluationMutation = useMutation((agentId: string) => memoService.aggregateEvaluation(agentId), {
    onSuccess: () => {
      queryClient.invalidateQueries('memos');
      queryClient.invalidateQueries('memo-monitor-docs');
    },
  });

  const memos = memoPaged?.items || [];
  const groupedMemos = useMemo(() => {
    return {
      identity: memos.filter((item) => item.memoKind === 'identity'),
      todo: memos.filter((item) => item.memoKind === 'todo'),
      topic: memos.filter((item) => item.memoKind === 'topic' || !item.memoKind),
      achievement: memos.filter((item) => item.memoKind === 'achievement'),
      criticism: memos.filter((item) => item.memoKind === 'criticism'),
    };
  }, [memos]);

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-50 via-white to-blue-50/30 p-6 shadow-sm ring-1 ring-slate-200/50">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-blue-100/40 via-transparent to-transparent" />
        <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">备忘录管理</h1>
            <p className="mt-1.5 text-sm text-slate-500">只读查询 Agent 长期记忆文档（identity / todo / achievement / criticism / topic）</p>
          </div>
          <button
            onClick={() => {
              setDrawerOpen(true);
              if (!testAgentId && agents.length > 0) setTestAgentId(agents[0].id);
            }}
            className="inline-flex items-center rounded-xl bg-gradient-to-r from-primary-500 to-primary-600 px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-primary-500/20 transition-all hover:shadow-xl hover:shadow-primary-500/30 hover:-translate-y-0.5"
          >
            <BeakerIcon className="mr-2 h-4 w-4" />
            备忘录测试
          </button>
        </div>
      </div>

      <section className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200/50">
        <div className="mb-5 flex flex-wrap gap-3">
          <select 
            value={agentId} 
            onChange={(e) => setAgentId(e.target.value)} 
            className="rounded-lg border border-slate-200 bg-slate-50/50 px-4 py-2.5 text-sm transition-all focus:border-primary-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-100 min-w-[140px]"
          >
            <option value="">全部 Agent</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 min-w-[200px] rounded-lg border border-slate-200 bg-slate-50/50 px-4 py-2.5 text-sm transition-all focus:border-primary-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-100"
            placeholder="搜索标题/内容/tags/topic"
          />
          <select 
            value={memoType} 
            onChange={(e) => setMemoType(e.target.value)} 
            className="rounded-lg border border-slate-200 bg-slate-50/50 px-4 py-2.5 text-sm transition-all focus:border-primary-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-100"
          >
            <option value="">全部类型</option>
            {memoTypeOptions.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <select 
            value={memoKind} 
            onChange={(e) => setMemoKind(e.target.value)} 
            className="rounded-lg border border-slate-200 bg-slate-50/50 px-4 py-2.5 text-sm transition-all focus:border-primary-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-100"
          >
            <option value="">全部文档种类</option>
            {memoKindOptions.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary-200 border-t-primary-600" />
          </div>
        ) : (
          <div className="space-y-8">
            {(['identity', 'todo', 'achievement', 'criticism', 'topic'] as const).map((section) => (
              <div key={section}>
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <h2 className={`text-sm font-bold uppercase tracking-widest ${
                      section === 'identity' ? 'text-blue-600' :
                      section === 'todo' ? 'text-amber-600' :
                      section === 'achievement' ? 'text-emerald-600' :
                      section === 'criticism' ? 'text-rose-600' :
                      'text-purple-600'
                    }`}>
                      {section}
                    </h2>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      section === 'identity' ? 'bg-blue-50 text-blue-600' :
                      section === 'todo' ? 'bg-amber-50 text-amber-600' :
                      section === 'achievement' ? 'bg-emerald-50 text-emerald-600' :
                      section === 'criticism' ? 'bg-rose-50 text-rose-600' :
                      'bg-purple-50 text-purple-600'
                    }`}>
                      {groupedMemos[section].length}
                    </span>
                  </div>
                  {section === 'identity' && agentId && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => aggregateIdentityMutation.mutate(agentId)}
                        disabled={aggregateIdentityMutation.isLoading}
                        className="inline-flex items-center rounded-lg border border-blue-200/60 bg-blue-50/50 px-3 py-1.5 text-xs font-medium text-blue-600 transition-all hover:border-blue-300 hover:bg-blue-100/50 disabled:opacity-60"
                        title="重新聚合 Identity 简历"
                      >
                        <ArrowPathIcon className={`mr-1.5 h-3 w-3 ${aggregateIdentityMutation.isLoading ? 'animate-spin' : ''}`} />
                        {aggregateIdentityMutation.isLoading ? '聚合中...' : '刷新 Identity'}
                      </button>
                      <button
                        onClick={() => aggregateEvaluationMutation.mutate(agentId)}
                        disabled={aggregateEvaluationMutation.isLoading}
                        className="inline-flex items-center rounded-lg border border-green-200/60 bg-green-50/50 px-3 py-1.5 text-xs font-medium text-green-600 transition-all hover:border-green-300 hover:bg-green-100/50 disabled:opacity-60"
                        title="重新聚合 Evaluation 评估"
                      >
                        <ArrowPathIcon className={`mr-1.5 h-3 w-3 ${aggregateEvaluationMutation.isLoading ? 'animate-spin' : ''}`} />
                        {aggregateEvaluationMutation.isLoading ? '聚合中...' : '刷新 Evaluation'}
                      </button>
                    </div>
                  )}
                </div>
                <div className="space-y-3">
                  {groupedMemos[section].map((memo) => (
                    <div 
                      key={memo.id} 
                      className="group relative overflow-hidden rounded-xl border border-slate-200/60 bg-white p-4 transition-all duration-200 hover:border-slate-300 hover:shadow-md hover:shadow-slate-200/50"
                    >
                      <div className="absolute inset-0 bg-gradient-to-r from-primary-50/0 via-primary-50/20 to-primary-50/0 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                      <div className="relative flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-slate-900 truncate">{memo.title}</p>
                          <p className="mt-1.5 text-xs text-slate-500 line-clamp-2">
                            <span className={`inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-medium mr-1.5 ${
                              memo.memoKind === 'identity' ? 'bg-blue-50 text-blue-600' :
                              memo.memoKind === 'todo' ? 'bg-amber-50 text-amber-600' :
                              memo.memoKind === 'achievement' ? 'bg-emerald-50 text-emerald-600' :
                              memo.memoKind === 'criticism' ? 'bg-rose-50 text-rose-600' :
                              memo.memoKind === 'topic' ? 'bg-purple-50 text-purple-600' :
                              'bg-slate-100 text-slate-600'
                            }`}>
                              {memo.memoKind || 'topic'}
                            </span>
                            {memo.memoType} · {memo.category} · topic={memo.topic || 'n/a'} · 
                            updated={memo.updatedAt ? new Date(memo.updatedAt).toLocaleString() : 'n/a'}
                          </p>
                        </div>
                        <button
                          onClick={() => setSelectedMemo(memo)}
                          className="shrink-0 inline-flex items-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-all hover:border-slate-300 hover:bg-slate-50"
                        >
                          <EyeIcon className="mr-1.5 h-3.5 w-3.5" />
                          查看
                        </button>
                      </div>
                    </div>
                  ))}
                  {groupedMemos[section].length === 0 && (
                    <div className="flex flex-col items-center justify-center py-8 text-slate-400">
                      <div className="mb-2 text-3xl">📝</div>
                      <p className="text-sm">暂无文档</p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {drawerOpen ? (
        <div className="fixed inset-0 z-50">
          <button className="absolute inset-0 bg-slate-900/20 backdrop-blur-sm" onClick={() => setDrawerOpen(false)} aria-label="关闭抽屉" />
          <aside className="absolute right-0 top-0 h-full w-full bg-white shadow-2xl ring-1 ring-slate-200/50 sm:w-[90vw] lg:w-[62vw]">
            <div className="flex h-full flex-col">
              <div className="flex items-center justify-between border-b border-slate-200/60 px-6 py-5">
                <div>
                  <p className="text-lg font-semibold text-slate-900">备忘录测试模块</p>
                  <p className="text-xs text-slate-500 mt-1">选择 Agent 对话并持续监测其备忘录更新</p>
                </div>
                <button onClick={() => setDrawerOpen(false)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors">
                  <XMarkIcon className="h-5 w-5" />
                </button>
              </div>

              <div className="grid flex-1 grid-cols-1 gap-0 overflow-hidden lg:grid-cols-2">
                <div className="flex h-full flex-col border-r border-slate-200/60 p-4">
                  <div className="mb-4 flex items-center gap-2">
                    <select
                      value={testAgentId}
                      onChange={(e) => setTestAgentId(e.target.value)}
                      className="flex-1 rounded-lg border border-slate-200 bg-slate-50/50 px-4 py-2.5 text-sm transition-all focus:border-primary-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-100"
                    >
                      <option value="">选择 Agent</option>
                      {agents.map((agent) => (
                        <option key={agent.id} value={agent.id}>
                          {agent.name}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => flushMutation.mutate(testAgentId || undefined)}
                      disabled={flushMutation.isLoading}
                      className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-xs font-medium text-slate-600 transition-all hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
                    >
                      {flushMutation.isLoading ? '聚合中...' : '立即聚合'}
                    </button>
                  </div>

                  <div className="mb-4 rounded-xl border border-slate-200/60 bg-slate-50/50 p-4">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">聚合状态</p>
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div className="rounded-lg bg-white p-2.5">
                        <p className="text-slate-400">Redis</p>
                        <p className={`mt-1 font-semibold ${aggregationStatusQuery.data?.redisReady ? 'text-emerald-600' : 'text-slate-500'}`}>
                          {aggregationStatusQuery.data?.redisReady ? 'ready' : 'not-ready'}
                        </p>
                      </div>
                      <div className="rounded-lg bg-white p-2.5">
                        <p className="text-slate-400">Queue Keys</p>
                        <p className="mt-1 font-semibold text-slate-700">{aggregationStatusQuery.data?.queueKeys ?? 0}</p>
                      </div>
                      <div className="rounded-lg bg-white p-2.5">
                        <p className="text-slate-400">Queued Events</p>
                        <p className="mt-1 font-semibold text-slate-700">{aggregationStatusQuery.data?.queuedEvents ?? 0}</p>
                      </div>
                      <div className="rounded-lg bg-white p-2.5">
                        <p className="text-slate-400">Memo Docs</p>
                        <p className="mt-1 font-semibold text-slate-700">{aggregationStatusQuery.data?.memoDocuments ?? 0}</p>
                      </div>
                    </div>
                    <p className="mt-3 text-xs text-slate-400">
                      Latest Update: <span className="text-slate-600">{aggregationStatusQuery.data?.latestMemoUpdatedAt ? new Date(aggregationStatusQuery.data.latestMemoUpdatedAt).toLocaleString() : 'n/a'}</span>
                    </p>
                  </div>

                  <div className="flex-1 space-y-3 overflow-y-auto rounded-xl border border-slate-200/60 bg-slate-50/30 p-4">
                    {testMessages.map((message) => (
                      <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div
                          className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
                            message.role === 'user' 
                              ? 'bg-gradient-to-r from-primary-500 to-primary-600 text-white shadow-lg shadow-primary-500/25' 
                              : 'bg-white border border-slate-200/60 text-slate-800 shadow-sm'
                          }`}
                        >
                          {message.content}
                        </div>
                      </div>
                    ))}
                    {!testMessages.length && (
                      <div className="flex flex-col items-center justify-center py-8 text-slate-400">
                        <div className="mb-2 text-3xl">💬</div>
                        <p className="text-sm">先发起一条测试对话</p>
                      </div>
                    )}
                  </div>

                  <div className="mt-4 flex items-end gap-3">
                    <textarea
                      rows={3}
                      value={testPrompt}
                      onChange={(e) => setTestPrompt(e.target.value)}
                      className="flex-1 rounded-xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-sm transition-all focus:border-primary-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-100 resize-none"
                      placeholder="输入测试问题，观察 Agent 是否生成备忘录"
                    />
                    <button
                      onClick={() => {
                        if (!testAgentId || !testPrompt.trim()) return;
                        const content = testPrompt.trim();
                        setTestMessages((prev) => [
                          ...prev,
                          {
                            id: `${Date.now()}-user`,
                            role: 'user',
                            content,
                            createdAt: new Date().toISOString(),
                          },
                        ]);
                        executeMutation.mutate({ id: testAgentId, prompt: content });
                        setTestPrompt('');
                      }}
                      disabled={executeMutation.isLoading || !testAgentId || !testPrompt.trim()}
                      className="shrink-0 inline-flex items-center rounded-xl bg-gradient-to-r from-primary-500 to-primary-600 px-5 py-3 text-sm font-medium text-white shadow-lg shadow-primary-500/20 transition-all hover:shadow-xl hover:shadow-primary-500/30 hover:-translate-y-0.5 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:translate-y-0"
                    >
                      <PaperAirplaneIcon className="mr-1.5 h-4 w-4" />
                      {executeMutation.isLoading ? '发送中...' : '发送'}
                    </button>
                  </div>
                </div>

                <div className="h-full overflow-y-auto p-4">
                  <div className="mb-4 flex items-center justify-between">
                    <p className="text-sm font-semibold text-slate-800">实时备忘录监测</p>
                    <span className="rounded-full bg-primary-50 px-2.5 py-1 text-[10px] font-medium text-primary-600">每 3 秒刷新</span>
                  </div>
                  <div className="space-y-3">
                    {(monitorMemosQuery.data?.items || []).map((memo) => (
                      <div key={memo.id} className="rounded-xl border border-slate-200/60 bg-white p-4 transition-all hover:border-slate-300 hover:shadow-sm">
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                            memo.memoKind === 'identity' ? 'bg-blue-50 text-blue-600' :
                            memo.memoKind === 'todo' ? 'bg-amber-50 text-amber-600' :
                            memo.memoKind === 'achievement' ? 'bg-emerald-50 text-emerald-600' :
                            memo.memoKind === 'criticism' ? 'bg-rose-50 text-rose-600' :
                            memo.memoKind === 'topic' ? 'bg-purple-50 text-purple-600' :
                            'bg-slate-50 text-slate-600'
                          }`}>
                            {memo.memoKind || 'topic'}
                          </span>
                          <span className="text-xs text-slate-400">{memo.memoType}</span>
                        </div>
                        <p className="text-sm font-semibold text-slate-900 mb-1">{memo.title}</p>
                        <p className="text-xs text-slate-500 mb-2">topic={memo.topic || 'n/a'} · {memo.updatedAt ? new Date(memo.updatedAt).toLocaleString() : 'n/a'}</p>
                        <pre className="mt-2 whitespace-pre-wrap text-xs text-slate-600 leading-relaxed bg-slate-50/50 p-2.5 rounded-lg">{memo.content}</pre>
                      </div>
                    ))}
                    {!monitorMemosQuery.data?.items?.length && (
                      <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                        <div className="mb-2 text-4xl">📝</div>
                        <p className="text-sm">暂无可监测备忘录</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </aside>
        </div>
      ) : null}

      {selectedMemo ? (
        <div className="fixed inset-0 z-50">
          <button className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" onClick={() => setSelectedMemo(null)} aria-label="关闭弹窗" />
          <div className="absolute left-1/2 top-1/2 w-[94vw] max-w-4xl -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200/50 overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200/60 px-6 py-5 bg-slate-50/30">
              <div>
                <p className="text-lg font-semibold text-slate-900">{selectedMemo.title}</p>
                <p className="text-xs text-slate-500 mt-1.5">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider mr-2 ${
                    selectedMemo.memoKind === 'identity' ? 'bg-blue-50 text-blue-600' :
                    selectedMemo.memoKind === 'todo' ? 'bg-amber-50 text-amber-600' :
                    selectedMemo.memoKind === 'achievement' ? 'bg-emerald-50 text-emerald-600' :
                    selectedMemo.memoKind === 'criticism' ? 'bg-rose-50 text-rose-600' :
                    selectedMemo.memoKind === 'topic' ? 'bg-purple-50 text-purple-600' :
                    'bg-slate-100 text-slate-600'
                  }`}>
                    {selectedMemo.memoKind || 'topic'}
                  </span>
                  {selectedMemo.memoType} · {selectedMemo.category} · topic={selectedMemo.topic || 'n/a'}
                </p>
              </div>
              <button onClick={() => setSelectedMemo(null)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <div className="max-h-[68vh] overflow-y-auto px-6 py-5">
              <pre className="whitespace-pre-wrap text-sm text-slate-700 leading-relaxed font-sans">{selectedMemo.content}</pre>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default Memos;
