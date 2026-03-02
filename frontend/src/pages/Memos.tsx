import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from 'react-query';
import { PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { agentService } from '../services/agentService';
import { memoService } from '../services/memoService';
import { AgentMemo } from '../types';

const memoTypeOptions: Array<AgentMemo['memoType']> = ['knowledge', 'behavior', 'todo'];
const memoKindOptions: Array<NonNullable<AgentMemo['memoKind']>> = ['identity', 'todo', 'topic'];
const todoStatusOptions: Array<NonNullable<AgentMemo['todoStatus']>> = ['pending', 'in_progress', 'completed', 'cancelled'];

const Memos: React.FC = () => {
  const queryClient = useQueryClient();
  const [agentId, setAgentId] = useState('');
  const [memoType, setMemoType] = useState<string>('');
  const [memoKind, setMemoKind] = useState<string>('');
  const [search, setSearch] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState('general');
  const [todoStatus, setTodoStatus] = useState<NonNullable<AgentMemo['todoStatus']>>('pending');

  const { data: agents = [] } = useQuery('agents', agentService.getAgents);

  const { data: memoPaged, isLoading } = useQuery(
    ['memos', agentId, memoType, memoKind, search],
    () => memoService.getMemos({
      agentId: agentId || undefined,
      memoType: (memoType || undefined) as AgentMemo['memoType'] | undefined,
      memoKind: (memoKind || undefined) as AgentMemo['memoKind'] | undefined,
      search: search.trim() || undefined,
      page: 1,
      pageSize: 50,
    }),
    { keepPreviousData: true },
  );

  const memos = memoPaged?.items || [];
  const groupedTodo = useMemo(
    () => todoStatusOptions.map((status) => ({ status, items: memos.filter((memo) => memo.memoType === 'todo' && memo.todoStatus === status) })),
    [memos],
  );

  const createMutation = useMutation(memoService.createMemo, {
    onSuccess: () => {
      queryClient.invalidateQueries('memos');
      setTitle('');
      setContent('');
    },
  });

  const deleteMutation = useMutation(memoService.deleteMemo, {
    onSuccess: () => queryClient.invalidateQueries('memos'),
  });

  const updateMutation = useMutation(
    ({ id, payload }: { id: string; payload: Partial<AgentMemo> }) => memoService.updateMemo(id, payload),
    { onSuccess: () => queryClient.invalidateQueries('memos') },
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">备忘录管理</h1>
          <p className="mt-1 text-sm text-gray-500">管理 Agent 长期记忆（知识、行为、TODO）</p>
        </div>
      </div>

      <section className="rounded-lg bg-white p-5 shadow">
        <h2 className="text-lg font-medium text-gray-900">新增备忘录</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <select value={agentId} onChange={(e) => setAgentId(e.target.value)} className="rounded-md border border-gray-300 px-3 py-2 text-sm">
            <option value="">选择 Agent（必选）</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>{agent.name}</option>
            ))}
          </select>
          <input value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-md border border-gray-300 px-3 py-2 text-sm" placeholder="分类，例如: engineering" />
          <select value={memoType} onChange={(e) => setMemoType(e.target.value)} className="rounded-md border border-gray-300 px-3 py-2 text-sm">
              <option value="">选择类型</option>
              {memoTypeOptions.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          <select value={memoKind} onChange={(e) => setMemoKind(e.target.value)} className="rounded-md border border-gray-300 px-3 py-2 text-sm">
            <option value="">选择文档种类</option>
            {memoKindOptions.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
          {(memoType || '') === 'todo' && (
            <select value={todoStatus} onChange={(e) => setTodoStatus(e.target.value as NonNullable<AgentMemo['todoStatus']>)} className="rounded-md border border-gray-300 px-3 py-2 text-sm">
              {todoStatusOptions.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          )}
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="rounded-md border border-gray-300 px-3 py-2 text-sm md:col-span-2" placeholder="标题" />
          <textarea value={content} onChange={(e) => setContent(e.target.value)} className="rounded-md border border-gray-300 px-3 py-2 text-sm md:col-span-2" rows={4} placeholder="备忘录内容（支持 Markdown）" />
        </div>
        <button
          onClick={() => {
            if (!agentId || !title.trim() || !content.trim() || !memoType) {
              alert('请填写 Agent、类型、标题、内容');
              return;
            }
            createMutation.mutate({
              agentId,
              memoType: memoType as AgentMemo['memoType'],
              memoKind: (memoKind || undefined) as AgentMemo['memoKind'] | undefined,
              title: title.trim(),
              content: content.trim(),
              category: category.trim() || 'general',
              todoStatus: memoType === 'todo' ? todoStatus : undefined,
            });
          }}
          disabled={createMutation.isLoading}
          className="mt-3 inline-flex items-center rounded-md bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60"
        >
          <PlusIcon className="mr-2 h-4 w-4" />
          {createMutation.isLoading ? '创建中...' : '创建备忘录'}
        </button>
      </section>

      <section className="rounded-lg bg-white p-5 shadow">
        <div className="mb-3 flex flex-wrap gap-2">
          <input value={search} onChange={(e) => setSearch(e.target.value)} className="rounded-md border border-gray-300 px-3 py-2 text-sm" placeholder="搜索标题/内容/tags" />
          <select value={memoType} onChange={(e) => setMemoType(e.target.value)} className="rounded-md border border-gray-300 px-3 py-2 text-sm">
            <option value="">全部类型</option>
            {memoTypeOptions.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
          <select value={memoKind} onChange={(e) => setMemoKind(e.target.value)} className="rounded-md border border-gray-300 px-3 py-2 text-sm">
            <option value="">全部文档种类</option>
            {memoKindOptions.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </div>

        {isLoading ? (
          <div className="py-6 text-sm text-gray-500">加载备忘录中...</div>
        ) : (
          <div className="space-y-3">
            {memos.map((memo) => (
              <div key={memo.id} className="rounded-md border border-gray-200 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-gray-900">{memo.title}</p>
                    <p className="mt-1 text-xs text-gray-500">{memo.memoKind || 'topic'} · {memo.memoType} · {memo.category} · {memo.topic || 'n/a'} · {memo.todoStatus || 'n/a'}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {memo.memoType === 'todo' && (
                      <select
                        value={memo.todoStatus || 'pending'}
                        onChange={(e) => updateMutation.mutate({ id: memo.id, payload: { todoStatus: e.target.value as AgentMemo['todoStatus'] } })}
                        className="rounded-md border border-gray-300 px-2 py-1 text-xs"
                      >
                        {todoStatusOptions.map((item) => (
                          <option key={item} value={item}>{item}</option>
                        ))}
                      </select>
                    )}
                    <button
                      onClick={() => {
                        if (window.confirm(`确认删除备忘录: ${memo.title} ?`)) {
                          deleteMutation.mutate(memo.id);
                        }
                      }}
                      className="rounded-md border border-red-200 bg-red-50 p-2 text-red-600 hover:bg-red-100"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <pre className="mt-2 whitespace-pre-wrap text-sm text-gray-700">{memo.content}</pre>
              </div>
            ))}
            {!memos.length && <div className="py-6 text-sm text-gray-500">暂无备忘录记录。</div>}
          </div>
        )}
      </section>

      <section className="rounded-lg bg-white p-5 shadow">
        <h2 className="mb-3 text-lg font-medium text-gray-900">TODO 视图</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          {groupedTodo.map((column) => (
            <div key={column.status} className="rounded-md border border-gray-200 p-3">
              <p className="text-sm font-medium text-gray-900">{column.status}</p>
              <div className="mt-2 space-y-2">
                {column.items.map((item) => (
                  <div key={item.id} className="rounded border border-gray-100 bg-gray-50 p-2 text-xs text-gray-700">
                    <p className="font-medium">{item.title}</p>
                    <p className="mt-1 line-clamp-3">{item.content}</p>
                  </div>
                ))}
                {!column.items.length && <p className="text-xs text-gray-400">无</p>}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};

export default Memos;
