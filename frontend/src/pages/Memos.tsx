import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from 'react-query';
import { BeakerIcon, EyeIcon, PaperAirplaneIcon, XMarkIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import { agentService } from '../services/agentService';
import { memoService } from '../services/memoService';
import { AgentMemo } from '../types';

const memoTypeOptions: Array<AgentMemo['memoType']> = ['knowledge', 'standard'];
const memoKindOptions: Array<NonNullable<AgentMemo['memoKind']>> = ['identity', 'todo', 'topic', 'evaluation'];

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
        type: 'discussion',
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
    };
  }, [memos]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">备忘录管理</h1>
          <p className="mt-1 text-sm text-gray-500">只读查询 Agent 长期记忆文档（identity / todo / topic）</p>
        </div>
        <button
          onClick={() => {
            setDrawerOpen(true);
            if (!testAgentId && agents.length > 0) setTestAgentId(agents[0].id);
          }}
          className="inline-flex items-center rounded-md bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700"
        >
          <BeakerIcon className="mr-2 h-4 w-4" />
          备忘录测试
        </button>
      </div>

      <section className="rounded-lg bg-white p-5 shadow">
        <div className="mb-3 flex flex-wrap gap-2">
          <select value={agentId} onChange={(e) => setAgentId(e.target.value)} className="rounded-md border border-gray-300 px-3 py-2 text-sm">
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
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            placeholder="搜索标题/内容/tags/topic"
          />
          <select value={memoType} onChange={(e) => setMemoType(e.target.value)} className="rounded-md border border-gray-300 px-3 py-2 text-sm">
            <option value="">全部类型</option>
            {memoTypeOptions.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <select value={memoKind} onChange={(e) => setMemoKind(e.target.value)} className="rounded-md border border-gray-300 px-3 py-2 text-sm">
            <option value="">全部文档种类</option>
            {memoKindOptions.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>

        {isLoading ? (
          <div className="py-6 text-sm text-gray-500">加载备忘录中...</div>
        ) : (
          <div className="space-y-5">
            {(['identity', 'todo', 'topic'] as const).map((section) => (
              <div key={section}>
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">{section}</h2>
                  {section === 'identity' && agentId && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => aggregateIdentityMutation.mutate(agentId)}
                        disabled={aggregateIdentityMutation.isLoading}
                        className="inline-flex items-center rounded-md border border-blue-300 px-2 py-1 text-xs text-blue-700 hover:bg-blue-50 disabled:opacity-60"
                        title="重新聚合 Identity 简历"
                      >
                        <ArrowPathIcon className={`mr-1 h-3 w-3 ${aggregateIdentityMutation.isLoading ? 'animate-spin' : ''}`} />
                        {aggregateIdentityMutation.isLoading ? '聚合中...' : '刷新 Identity'}
                      </button>
                      <button
                        onClick={() => aggregateEvaluationMutation.mutate(agentId)}
                        disabled={aggregateEvaluationMutation.isLoading}
                        className="inline-flex items-center rounded-md border border-green-300 px-2 py-1 text-xs text-green-700 hover:bg-green-50 disabled:opacity-60"
                        title="重新聚合 Evaluation 评估"
                      >
                        <ArrowPathIcon className={`mr-1 h-3 w-3 ${aggregateEvaluationMutation.isLoading ? 'animate-spin' : ''}`} />
                        {aggregateEvaluationMutation.isLoading ? '聚合中...' : '刷新 Evaluation'}
                      </button>
                    </div>
                  )}
                </div>
                <div className="space-y-3">
                  {groupedMemos[section].map((memo) => (
                    <div key={memo.id} className="rounded-md border border-gray-200 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-gray-900">{memo.title}</p>
                          <p className="mt-1 text-xs text-gray-500">
                            {memo.memoKind || 'topic'} · {memo.memoType} · {memo.category} · topic={memo.topic || 'n/a'} · updated=
                            {memo.updatedAt ? new Date(memo.updatedAt).toLocaleString() : 'n/a'}
                          </p>
                        </div>
                        <button
                          onClick={() => setSelectedMemo(memo)}
                          className="inline-flex items-center rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                        >
                          <EyeIcon className="mr-1 h-4 w-4" />
                          查看
                        </button>
                      </div>
                    </div>
                  ))}
                  {groupedMemos[section].length === 0 && <div className="text-sm text-gray-400">暂无文档</div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {drawerOpen ? (
        <div className="fixed inset-0 z-50">
          <button className="absolute inset-0 bg-black/40" onClick={() => setDrawerOpen(false)} aria-label="关闭抽屉" />
          <aside className="absolute right-0 top-0 h-full w-full bg-white shadow-2xl sm:w-[90vw] lg:w-[62vw]">
            <div className="flex h-full flex-col">
              <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
                <div>
                  <p className="text-base font-semibold text-gray-900">备忘录测试模块</p>
                  <p className="text-xs text-gray-500">选择 Agent 对话并持续监测其备忘录更新</p>
                </div>
                <button onClick={() => setDrawerOpen(false)}>
                  <XMarkIcon className="h-5 w-5 text-gray-500" />
                </button>
              </div>

              <div className="grid flex-1 grid-cols-1 gap-0 overflow-hidden lg:grid-cols-2">
                <div className="flex h-full flex-col border-r border-gray-200 p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <select
                      value={testAgentId}
                      onChange={(e) => setTestAgentId(e.target.value)}
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
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
                      className="rounded-md border border-gray-300 px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                    >
                      {flushMutation.isLoading ? '聚合中...' : '立即聚合'}
                    </button>
                  </div>

                  <div className="mb-3 rounded-md border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
                    <p>Redis: {aggregationStatusQuery.data?.redisReady ? 'ready' : 'not-ready'}</p>
                    <p>Queue Keys: {aggregationStatusQuery.data?.queueKeys ?? 0}</p>
                    <p>Queued Events: {aggregationStatusQuery.data?.queuedEvents ?? 0}</p>
                    <p>Memo Docs: {aggregationStatusQuery.data?.memoDocuments ?? 0}</p>
                    <p>
                      Latest Update: {aggregationStatusQuery.data?.latestMemoUpdatedAt ? new Date(aggregationStatusQuery.data.latestMemoUpdatedAt).toLocaleString() : 'n/a'}
                    </p>
                  </div>

                  <div className="flex-1 space-y-2 overflow-y-auto rounded-md border border-gray-200 p-3">
                    {testMessages.map((message) => (
                      <div key={message.id} className={message.role === 'user' ? 'text-right' : 'text-left'}>
                        <div
                          className={`inline-block max-w-[90%] rounded px-3 py-2 text-sm ${
                            message.role === 'user' ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-900'
                          }`}
                        >
                          {message.content}
                        </div>
                      </div>
                    ))}
                    {!testMessages.length && <p className="text-sm text-gray-400">先发起一条测试对话。</p>}
                  </div>

                  <div className="mt-3 flex items-end gap-2">
                    <textarea
                      rows={3}
                      value={testPrompt}
                      onChange={(e) => setTestPrompt(e.target.value)}
                      className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
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
                      className="inline-flex items-center rounded-md bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60"
                    >
                      <PaperAirplaneIcon className="mr-1 h-4 w-4" />
                      {executeMutation.isLoading ? '发送中...' : '发送'}
                    </button>
                  </div>
                </div>

                <div className="h-full overflow-y-auto p-4">
                  <p className="mb-2 text-sm font-semibold text-gray-900">实时备忘录监测</p>
                  <p className="mb-3 text-xs text-gray-500">每 3 秒自动刷新一次</p>
                  <div className="space-y-3">
                    {(monitorMemosQuery.data?.items || []).map((memo) => (
                      <div key={memo.id} className="rounded-md border border-gray-200 p-3">
                        <p className="text-sm font-medium text-gray-900">{memo.title}</p>
                        <p className="mt-1 text-xs text-gray-500">
                          {memo.memoKind || 'topic'} · {memo.memoType} · topic={memo.topic || 'n/a'} ·
                          {memo.updatedAt ? new Date(memo.updatedAt).toLocaleString() : 'n/a'}
                        </p>
                        <pre className="mt-2 whitespace-pre-wrap text-xs text-gray-700">{memo.content}</pre>
                      </div>
                    ))}
                    {!monitorMemosQuery.data?.items?.length && <p className="text-sm text-gray-400">暂无可监测备忘录。</p>}
                  </div>
                </div>
              </div>
            </div>
          </aside>
        </div>
      ) : null}

      {selectedMemo ? (
        <div className="fixed inset-0 z-50">
          <button className="absolute inset-0 bg-black/40" onClick={() => setSelectedMemo(null)} aria-label="关闭弹窗" />
          <div className="absolute left-1/2 top-1/2 w-[94vw] max-w-4xl -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
              <div>
                <p className="text-base font-semibold text-gray-900">{selectedMemo.title}</p>
                <p className="text-xs text-gray-500">
                  {selectedMemo.memoKind || 'topic'} · {selectedMemo.memoType} · {selectedMemo.category} · topic={selectedMemo.topic || 'n/a'}
                </p>
              </div>
              <button onClick={() => setSelectedMemo(null)}>
                <XMarkIcon className="h-5 w-5 text-gray-500" />
              </button>
            </div>
            <div className="max-h-[68vh] overflow-y-auto px-5 py-4">
              <pre className="whitespace-pre-wrap text-sm text-gray-700">{selectedMemo.content}</pre>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default Memos;
