import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from 'react-query';
import { memoService } from '../../../services/memoService';
import { AgentMemo } from '../../../types';
import {
  AGENT_DETAIL_QUERY_KEYS,
  DEFAULT_MEMO_PAGE_SIZE,
  emptyDraft,
  MemoDraft,
  standardMemoKinds,
} from '../constants';

export const useMemoState = (agentId: string) => {
  const queryClient = useQueryClient();
  const [memoCategory, setMemoCategory] = useState<'standard' | 'topic'>('standard');
  const [memoSearch, setMemoSearch] = useState('');
  const [memoPage, setMemoPage] = useState(1);
  const [selectedMemo, setSelectedMemo] = useState<AgentMemo | null>(null);
  const [editingMemo, setEditingMemo] = useState<AgentMemo | null>(null);
  const [memoEditorOpen, setMemoEditorOpen] = useState(false);
  const [memoDraft, setMemoDraft] = useState<MemoDraft>(emptyDraft);

  const memoQuery = useQuery(
    AGENT_DETAIL_QUERY_KEYS.memos(agentId, memoSearch, memoPage, memoCategory),
    () => {
      const effectiveMemoKind = memoCategory === 'topic' ? 'topic' : undefined;
      const effectiveMemoType = memoCategory === 'topic' ? 'knowledge' : 'standard';
      return memoService.getMemos({
        agentId,
        search: memoSearch.trim() || undefined,
        memoKind: effectiveMemoKind,
        memoType: effectiveMemoType as AgentMemo['memoType'],
        page: memoPage,
        pageSize: DEFAULT_MEMO_PAGE_SIZE,
      });
    },
    { enabled: !!agentId, keepPreviousData: true },
  );

  const createMemoMutation = useMutation(
    (payload: Parameters<typeof memoService.createMemo>[0]) => memoService.createMemo(payload),
    {
      onSuccess: () => {
        queryClient.invalidateQueries(AGENT_DETAIL_QUERY_KEYS.memosBase(agentId));
        setMemoEditorOpen(false);
        setEditingMemo(null);
      },
    },
  );

  const updateMemoMutation = useMutation(
    ({ memoId, payload }: { memoId: string; payload: Partial<AgentMemo> }) => memoService.updateMemo(memoId, payload),
    {
      onSuccess: () => {
        queryClient.invalidateQueries(AGENT_DETAIL_QUERY_KEYS.memosBase(agentId));
        setMemoEditorOpen(false);
        setEditingMemo(null);
      },
    },
  );

  const deleteMemoMutation = useMutation((memoId: string) => memoService.deleteMemo(memoId), {
    onSuccess: () => {
      queryClient.invalidateQueries(AGENT_DETAIL_QUERY_KEYS.memosBase(agentId));
    },
  });

  useEffect(() => {
    if (!memoEditorOpen) return;
    if (!editingMemo) {
      setMemoDraft({
        ...emptyDraft,
        memoKind: memoCategory === 'topic' ? 'topic' : 'identity',
        memoType: memoCategory === 'topic' ? 'knowledge' : 'standard',
      });
      return;
    }

    setMemoDraft({
      title: editingMemo.title || '',
      content: editingMemo.content || '',
      category: editingMemo.category || '',
      memoKind: editingMemo.memoKind || '',
      memoType: editingMemo.memoType || '',
      topic: editingMemo.topic || '',
      todoStatus: editingMemo.todoStatus || '',
      tags: (editingMemo.tags || []).join(', '),
    });
  }, [editingMemo, memoEditorOpen, memoCategory]);

  const memos = memoQuery.data?.items || [];
  const totalMemoPages = memoQuery.data?.totalPages || 1;

  const displayedMemos = useMemo(() => {
    if (memoCategory === 'topic') return memos;
    const order = new Map(standardMemoKinds.map((kind, index) => [kind, index]));
    return [...memos].sort((a, b) => {
      const aOrder = order.get((a.memoKind || 'custom') as NonNullable<AgentMemo['memoKind']>) ?? 99;
      const bOrder = order.get((b.memoKind || 'custom') as NonNullable<AgentMemo['memoKind']>) ?? 99;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime();
    });
  }, [memoCategory, memos]);

  const memoSummary = useMemo(() => {
    const byKind: Record<string, number> = {};
    displayedMemos.forEach((memo) => {
      const key = memo.memoKind || 'topic';
      byKind[key] = (byKind[key] || 0) + 1;
    });
    return byKind;
  }, [displayedMemos]);

  const handleSaveMemo = () => {
    if (!agentId) return;
    if (!memoDraft.title.trim() || !memoDraft.content.trim()) {
      window.alert('标题和内容不能为空');
      return;
    }

    const payload = {
      agentId,
      title: memoDraft.title.trim(),
      content: memoDraft.content.trim(),
      category: memoDraft.category.trim() || undefined,
      memoKind: (memoDraft.memoKind || undefined) as AgentMemo['memoKind'] | undefined,
      memoType: (memoDraft.memoType || undefined) as AgentMemo['memoType'] | undefined,
      topic: memoDraft.topic.trim() || undefined,
      todoStatus: (memoDraft.todoStatus || undefined) as AgentMemo['todoStatus'] | undefined,
      tags: memoDraft.tags
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    };

    if (editingMemo?.id) {
      updateMemoMutation.mutate({ memoId: editingMemo.id, payload });
      return;
    }
    createMemoMutation.mutate(payload);
  };

  return {
    memoCategory,
    setMemoCategory,
    memoSearch,
    setMemoSearch,
    memoPage,
    setMemoPage,
    selectedMemo,
    setSelectedMemo,
    editingMemo,
    setEditingMemo,
    memoEditorOpen,
    setMemoEditorOpen,
    memoDraft,
    setMemoDraft,
    memoQuery,
    createMemoMutation,
    updateMemoMutation,
    deleteMemoMutation,
    displayedMemos,
    memoSummary,
    totalMemoPages,
    handleSaveMemo,
  };
};

export type UseMemoStateResult = ReturnType<typeof useMemoState>;
