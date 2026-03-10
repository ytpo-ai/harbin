import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  ClipboardDocumentIcon,
  EyeIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import {
  agentService,
  AgentRuntimeSession,
  AgentRuntimeSessionMessage,
} from '../services/agentService';
import { memoService } from '../services/memoService';
import {
  agentActionLogService,
  AgentActionLogItem,
  AgentActionLogQuery,
} from '../services/agentActionLogService';
import { AgentMemo } from '../types';

const DEFAULT_MEMO_PAGE_SIZE = 30;
const DEFAULT_LOG_PAGE_SIZE = 20;
const DEFAULT_SESSION_PAGE_SIZE = 8;

type LogStatus = NonNullable<NonNullable<AgentActionLogItem['details']>['status']>;

const LOG_STATUS_META: Record<LogStatus | 'unknown', { label: string; badgeClass: string }> = {
  completed: { label: '成功', badgeClass: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  started: { label: '进行中', badgeClass: 'border-amber-200 bg-amber-50 text-amber-700' },
  running: { label: '运行中', badgeClass: 'border-sky-200 bg-sky-50 text-sky-700' },
  pending: { label: '待执行', badgeClass: 'border-slate-200 bg-slate-100 text-slate-700' },
  failed: { label: '失败', badgeClass: 'border-rose-200 bg-rose-50 text-rose-700' },
  paused: { label: '已暂停', badgeClass: 'border-orange-200 bg-orange-50 text-orange-700' },
  resumed: { label: '已恢复', badgeClass: 'border-cyan-200 bg-cyan-50 text-cyan-700' },
  cancelled: { label: '已取消', badgeClass: 'border-zinc-200 bg-zinc-100 text-zinc-700' },
  asked: { label: '待授权', badgeClass: 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700' },
  replied: { label: '已授权回复', badgeClass: 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700' },
  denied: { label: '已拒绝', badgeClass: 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700' },
  step_started: { label: '步骤开始', badgeClass: 'border-indigo-200 bg-indigo-50 text-indigo-700' },
  unknown: { label: '未知', badgeClass: 'border-gray-200 bg-gray-100 text-gray-700' },
};

const CONTEXT_TYPE_LABEL: Record<AgentActionLogItem['contextType'], string> = {
  chat: 'Chat',
  orchestration: 'Orchestration',
};

type MemoDraft = {
  title: string;
  content: string;
  category: string;
  memoKind: string;
  memoType: string;
  topic: string;
  todoStatus: string;
  tags: string;
};

const emptyDraft: MemoDraft = {
  title: '',
  content: '',
  category: '',
  memoKind: '',
  memoType: '',
  topic: '',
  todoStatus: '',
  tags: '',
};

const memoKindOptions: Array<NonNullable<AgentMemo['memoKind']>> = [
  'identity',
  'todo',
  'topic',
  'history',
  'draft',
  'custom',
  'evaluation',
  'achievement',
  'criticism',
];

const standardMemoKinds: Array<NonNullable<AgentMemo['memoKind']>> = [
  'identity',
  'todo',
  'history',
  'draft',
  'custom',
  'evaluation',
  'achievement',
  'criticism',
];

const memoTypeOptions: Array<NonNullable<AgentMemo['memoType']>> = ['knowledge', 'standard'];
const todoStatusOptions: Array<NonNullable<AgentMemo['todoStatus']>> = ['pending', 'in_progress', 'completed', 'cancelled'];

const AgentDetail: React.FC = () => {
  const navigate = useNavigate();
  const { agentId = '' } = useParams<{ agentId: string }>();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'memo' | 'log' | 'session'>('memo');
  const [memoCategory, setMemoCategory] = useState<'standard' | 'topic'>('standard');
  const [memoSearch, setMemoSearch] = useState('');
  const [memoPage, setMemoPage] = useState(1);
  const [selectedMemo, setSelectedMemo] = useState<AgentMemo | null>(null);
  const [editingMemo, setEditingMemo] = useState<AgentMemo | null>(null);
  const [memoEditorOpen, setMemoEditorOpen] = useState(false);
  const [memoDraft, setMemoDraft] = useState<MemoDraft>(emptyDraft);
  const [logFilters, setLogFilters] = useState<AgentActionLogQuery>({
    page: 1,
    pageSize: DEFAULT_LOG_PAGE_SIZE,
    status: '',
    contextType: '',
  });
  const [sessionKeyword, setSessionKeyword] = useState('');
  const [sessionIdInput, setSessionIdInput] = useState('');
  const [sessionPage, setSessionPage] = useState(1);
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [isSessionDrawerOpen, setIsSessionDrawerOpen] = useState(false);
  const [sessionCopyNotice, setSessionCopyNotice] = useState('');
  const [expandedLogIds, setExpandedLogIds] = useState<Record<string, boolean>>({});

  const { data: agent, isLoading: isAgentLoading } = useQuery(
    ['agent-detail', agentId],
    () => agentService.getAgent(agentId),
    { enabled: !!agentId },
  );

  const memoQuery = useQuery(
    ['agent-memos', agentId, memoSearch, memoPage, memoCategory],
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

  const logQuery = useQuery(
    ['agent-logs', agentId, logFilters],
    () => agentActionLogService.getAgentActionLogs({ ...logFilters, agentId }),
    { enabled: !!agentId, keepPreviousData: true },
  );

  const sessionListQuery = useQuery(
    ['agent-runtime-sessions', agentId, sessionKeyword, sessionPage],
    () =>
      agentService.getAgentRuntimeSessions({
        ownerType: 'agent',
        ownerId: agentId,
        keyword: sessionKeyword.trim() || undefined,
        page: sessionPage,
        pageSize: DEFAULT_SESSION_PAGE_SIZE,
      }),
    { enabled: !!agentId, keepPreviousData: true },
  );

  const sessionDetailQuery = useQuery(
    ['agent-runtime-session-detail', selectedSessionId],
    () => agentService.getAgentRuntimeSession(selectedSessionId),
    {
      enabled: !!selectedSessionId,
      retry: false,
    },
  );

  const createMemoMutation = useMutation(
    (payload: Parameters<typeof memoService.createMemo>[0]) => memoService.createMemo(payload),
    {
      onSuccess: () => {
        queryClient.invalidateQueries(['agent-memos', agentId]);
        setMemoEditorOpen(false);
        setEditingMemo(null);
      },
    },
  );

  const updateMemoMutation = useMutation(
    ({ memoId, payload }: { memoId: string; payload: Partial<AgentMemo> }) => memoService.updateMemo(memoId, payload),
    {
      onSuccess: () => {
        queryClient.invalidateQueries(['agent-memos', agentId]);
        setMemoEditorOpen(false);
        setEditingMemo(null);
      },
    },
  );

  const deleteMemoMutation = useMutation((memoId: string) => memoService.deleteMemo(memoId), {
    onSuccess: () => {
      queryClient.invalidateQueries(['agent-memos', agentId]);
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
  const logs = logQuery.data?.logs || [];
  const sessions = sessionListQuery.data?.sessions || [];
  const totalSessionPages = sessionListQuery.data?.totalPages || 1;

  useEffect(() => {
    if (selectedSessionId) return;
    if (sessions.length === 0) return;
    setSelectedSessionId(sessions[0].id);
  }, [sessions, selectedSessionId]);

  const updateLogFilter = (patch: Partial<AgentActionLogQuery>) => {
    setLogFilters((prev) => ({ ...prev, ...patch, page: 1 }));
  };

  const toggleLogExpanded = (logId: string) => {
    setExpandedLogIds((prev) => ({
      ...prev,
      [logId]: !prev[logId],
    }));
  };

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
      alert('标题和内容不能为空');
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

  const getLogStatusMeta = (item: AgentActionLogItem) => {
    const status = item.details?.status;
    if (!status) return LOG_STATUS_META.unknown;
    return LOG_STATUS_META[status] || LOG_STATUS_META.unknown;
  };

  const formatLogAction = (action: string): string => {
    const normalized = action.replace(/^runtime:/, '').replace(/[:_]+/g, ' ').trim();
    if (!normalized) return action;
    return normalized
      .split(' ')
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const getLogContextLabel = (contextType: AgentActionLogItem['contextType']): string => {
    return CONTEXT_TYPE_LABEL[contextType] || 'Unknown';
  };

  const getExtraDetailEntries = (item: AgentActionLogItem): Array<[string, string]> => {
    const details = item.details;
    if (!details) return [];
    const hiddenKeys = new Set([
      'status',
      'durationMs',
      'taskTitle',
      'taskId',
      'taskType',
      'runId',
      'sessionId',
      'agentSessionId',
      'meetingTitle',
      'error',
    ]);
    return Object.entries(details)
      .filter(([key, value]) => !hiddenKeys.has(key) && value !== undefined && value !== null && String(value).trim() !== '')
      .slice(0, 4)
      .map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)]);
  };

  const getLogSessionId = (item: AgentActionLogItem): string => {
    const raw = item.details?.agentSessionId || item.details?.sessionId;
    return typeof raw === 'string' ? raw : '';
  };

  const getSessionId = (session: AgentRuntimeSession): string => {
    const rawId = session.id || session._id;
    return typeof rawId === 'string' ? rawId : '';
  };

  const renderSessionRole = (message: AgentRuntimeSessionMessage) => {
    const roleMap: Record<AgentRuntimeSessionMessage['role'], string> = {
      system: '系统',
      user: '用户',
      assistant: 'Agent',
      tool: '工具',
    };
    const roleClassMap: Record<AgentRuntimeSessionMessage['role'], string> = {
      system: 'bg-gray-100 text-gray-700',
      user: 'bg-blue-100 text-blue-700',
      assistant: 'bg-green-100 text-green-700',
      tool: 'bg-amber-100 text-amber-700',
    };
    return (
      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${roleClassMap[message.role]}`}>
        {roleMap[message.role]}
      </span>
    );
  };

  const renderMessageStatus = (message: AgentRuntimeSessionMessage) => {
    const status = message.status || 'completed';
    if (status === 'completed') {
      return <span className="inline-flex rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-700">完成</span>;
    }
    if (status === 'streaming') {
      return <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">流式中</span>;
    }
    if (status === 'pending') {
      return <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">待处理</span>;
    }
    return <span className="inline-flex rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-700">异常</span>;
  };

  const copyText = async (text: string): Promise<boolean> => {
    if (!text) return false;
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  };

  const buildSessionClipboardText = (session: AgentRuntimeSession): string => {
    const lines: string[] = [
      `Session: ${session.id || '-'}`,
      `Title: ${session.title || '-'}`,
      `Status: ${session.status || '-'}`,
      `Type: ${session.sessionType || '-'}`,
      `Owner: ${session.ownerType || '-'} / ${session.ownerId || '-'}`,
      `Last Active: ${session.lastActiveAt ? new Date(session.lastActiveAt).toLocaleString() : '-'}`,
      `Created At: ${session.createdAt ? new Date(session.createdAt).toLocaleString() : '-'}`,
      '',
      'Context',
      `- Plan: ${session.planContext?.linkedPlanId || '-'}`,
      `- Task: ${session.planContext?.linkedTaskId || '-'}`,
      `- Meeting: ${session.meetingContext?.meetingId || '-'}`,
      `- Agenda: ${session.meetingContext?.agendaId || '-'}`,
      '',
      'Messages',
    ];

    if (!session.messages?.length) {
      lines.push('- (no messages)');
      return lines.join('\n');
    }

    session.messages.forEach((message, index) => {
      lines.push(
        `\n[${index + 1}] ${message.role} | ${message.status || 'completed'} | ${message.timestamp ? new Date(message.timestamp).toLocaleString() : '-'}`,
      );
      if (message.runId) lines.push(`run: ${message.runId}`);
      if (message.taskId) lines.push(`task: ${message.taskId}`);
      lines.push(message.content || '-');
    });

    return lines.join('\n');
  };

  const handleCopySessionContent = async () => {
    const session = sessionDetailQuery.data;
    if (!session) return;
    const copied = await copyText(buildSessionClipboardText(session));
    setSessionCopyNotice(copied ? '会话内容已复制到剪贴板' : '复制失败，请检查浏览器剪贴板权限');
    window.setTimeout(() => setSessionCopyNotice(''), 2000);
  };

  if (!agentId) {
    return (
      <div className="rounded-lg bg-white p-6 shadow">
        <p className="text-sm text-gray-600">未找到 Agent ID，请从 Agent 列表进入。</p>
        <button
          onClick={() => navigate('/agents')}
          className="mt-3 inline-flex items-center rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700"
        >
          <ArrowLeftIcon className="mr-2 h-4 w-4" />
          返回 Agent 列表
        </button>
      </div>
    );
  }

  if (isAgentLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-50 via-white to-blue-50/30 p-6 shadow-sm ring-1 ring-slate-200/50">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-blue-100/40 via-transparent to-transparent" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <button
              onClick={() => navigate('/agents')}
              className="mb-3 inline-flex items-center text-sm text-slate-500 hover:text-slate-700 transition-colors"
            >
              <ArrowLeftIcon className="mr-1.5 h-4 w-4" />
              返回 Agent 列表
            </button>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{agent?.name || 'Agent 详情'}</h1>
            <p className="mt-1.5 text-sm text-slate-500">{agent?.description || '查看 Agent 详细信息与运营数据'}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full bg-slate-100/80 px-3.5 py-1.5 text-xs font-medium text-slate-600 ring-1 ring-slate-200/60">
              {agent?.roleId || '-'}
            </span>
            <span className="rounded-full bg-slate-100/80 px-3.5 py-1.5 text-xs font-medium text-slate-600 ring-1 ring-slate-200/60">
              {agent?.model?.name || '-'}
            </span>
            <span className={`rounded-full px-3.5 py-1.5 text-xs font-medium ring-1 ${
              agent?.isActive 
                ? 'bg-emerald-50/80 text-emerald-700 ring-emerald-200/60' 
                : 'bg-slate-100/80 text-slate-500 ring-slate-200/60'
            }`}>
              {agent?.isActive ? '活跃' : '非活跃'}
            </span>
          </div>
        </div>
      </div>

      <div className="relative">
        <nav className="flex gap-1 border-b border-slate-200/60">
          {(['memo', 'log', 'session'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`relative px-4 py-3 text-sm font-medium transition-all duration-200 ${
                activeTab === tab
                  ? 'text-primary-600'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <span className="relative z-10">{tab === 'memo' ? '备忘录' : tab === 'log' ? '日志' : 'Session'}</span>
              {activeTab === tab && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary-500 to-primary-600 rounded-full" />
              )}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === 'memo' && (
        <div className="space-y-5">
          <div className="flex flex-col gap-4 rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200/50 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-3">
              <div className="inline-flex rounded-lg bg-slate-100/50 p-1 ring-1 ring-slate-200/30">
                <button
                  onClick={() => {
                    setMemoCategory('standard');
                    setMemoPage(1);
                  }}
                  className={`rounded-md px-4 py-1.5 text-sm font-medium transition-all duration-200 ${
                    memoCategory === 'standard' 
                      ? 'bg-white text-primary-600 shadow-sm' 
                      : 'text-slate-600 hover:text-slate-800'
                  }`}
                >
                  标准
                </button>
                <button
                  onClick={() => {
                    setMemoCategory('topic');
                    setMemoPage(1);
                  }}
                  className={`rounded-md px-4 py-1.5 text-sm font-medium transition-all duration-200 ${
                    memoCategory === 'topic' 
                      ? 'bg-white text-primary-600 shadow-sm' 
                      : 'text-slate-600 hover:text-slate-800'
                  }`}
                >
                  主题
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                <input
                  value={memoSearch}
                  onChange={(e) => {
                    setMemoSearch(e.target.value);
                    setMemoPage(1);
                  }}
                  className="w-full sm:w-64 rounded-lg border border-slate-200 bg-slate-50/50 px-4 py-2.5 text-sm transition-all focus:border-primary-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-100"
                  placeholder={memoCategory === 'topic' ? '搜索主题备忘录' : '搜索标准备忘录'}
                />
              </div>
            </div>
            <button
              onClick={() => {
                setEditingMemo(null);
                setMemoEditorOpen(true);
              }}
              className="inline-flex items-center rounded-lg bg-gradient-to-r from-primary-500 to-primary-600 px-4 py-2.5 text-sm font-medium text-white shadow-md shadow-primary-500/20 transition-all hover:shadow-lg hover:shadow-primary-500/30 hover:-translate-y-0.5"
            >
              <PlusIcon className="mr-1.5 h-4 w-4" />
              新建备忘录
            </button>
          </div>

          <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200/50">
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium text-slate-600">共 {memoQuery.data?.total || 0} 条</span>
              <div className="flex flex-wrap gap-2">
                {Object.entries(memoSummary).map(([key, count]) => (
                  <span key={key} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-200/60">
                    {key}: {count}
                  </span>
                ))}
              </div>
            </div>

            {memoQuery.isLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary-200 border-t-primary-600" />
              </div>
            ) : displayedMemos.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                <div className="mb-2 text-4xl">📝</div>
                <p className="text-sm">暂无备忘录</p>
              </div>
            ) : (
              <div className="space-y-3">
                {displayedMemos.map((memo, index) => (
                  <div 
                    key={memo.id} 
                    className="group relative overflow-hidden rounded-xl border border-slate-200/60 bg-white p-4 transition-all duration-200 hover:border-slate-300 hover:shadow-md hover:shadow-slate-200/50"
                    style={{ animationDelay: `${index * 30}ms` }}
                  >
                    <div className="absolute inset-0 bg-gradient-to-r from-primary-50/0 via-primary-50/30 to-primary-50/0 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                    <div className="relative flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                            memo.memoKind === 'identity' ? 'bg-blue-50 text-blue-600 ring-1 ring-blue-200/60' :
                            memo.memoKind === 'todo' ? 'bg-amber-50 text-amber-600 ring-1 ring-amber-200/60' :
                            memo.memoKind === 'achievement' ? 'bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200/60' :
                            memo.memoKind === 'criticism' ? 'bg-rose-50 text-rose-600 ring-1 ring-rose-200/60' :
                            memo.memoKind === 'topic' ? 'bg-purple-50 text-purple-600 ring-1 ring-purple-200/60' :
                            'bg-slate-50 text-slate-600 ring-1 ring-slate-200/60'
                          }`}>
                            {memo.memoKind || 'topic'}
                          </span>
                          <span className="text-xs text-slate-400">{memo.memoType || '-'}</span>
                        </div>
                        <p className="text-base font-semibold text-slate-900 truncate">{memo.title}</p>
                        <p className="mt-1.5 text-xs text-slate-500 line-clamp-2">{memo.content}</p>
                        <p className="mt-2 text-xs text-slate-400">
                          {memo.category || '-'} · {memo.updatedAt ? new Date(memo.updatedAt).toLocaleString() : ''}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1.5 sm:flex-col">
                        <button
                          onClick={() => setSelectedMemo(memo)}
                          className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-all hover:border-slate-300 hover:bg-slate-50"
                        >
                          <EyeIcon className="mr-1.5 h-3.5 w-3.5" />
                          查看
                        </button>
                        <button
                          onClick={() => {
                            setEditingMemo(memo);
                            setMemoEditorOpen(true);
                          }}
                          className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-all hover:border-slate-300 hover:bg-slate-50"
                        >
                          <PencilIcon className="mr-1.5 h-3.5 w-3.5" />
                          编辑
                        </button>
                        <button
                          onClick={() => {
                            if (window.confirm('确定要删除这条备忘录吗？')) {
                              deleteMemoMutation.mutate(memo.id);
                            }
                          }}
                          className="inline-flex items-center rounded-lg border border-red-200/60 bg-white px-3 py-1.5 text-xs font-medium text-red-500 transition-all hover:border-red-300 hover:bg-red-50/50"
                        >
                          <TrashIcon className="mr-1.5 h-3.5 w-3.5" />
                          删除
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {totalMemoPages > 1 && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-500">第 {memoPage} / {totalMemoPages} 页</span>
              <div className="flex gap-2">
                <button
                  onClick={() => setMemoPage((prev) => Math.max(1, prev - 1))}
                  disabled={memoPage <= 1}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition-all hover:border-slate-300 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  上一页
                </button>
                <button
                  onClick={() => setMemoPage((prev) => Math.min(totalMemoPages, prev + 1))}
                  disabled={memoPage >= totalMemoPages}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition-all hover:border-slate-300 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  下一页
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'log' && (
        <div className="space-y-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-lg font-bold text-slate-900 tracking-tight">Agent 日志</h2>
              <p className="mt-1 text-sm text-slate-500">查看该 Agent 在 Chat / Orchestration 场景中的行为日志</p>
            </div>
            <button
              onClick={() => logQuery.refetch()}
              className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 transition-all hover:border-slate-300 hover:bg-slate-50"
            >
              <ArrowPathIcon className={`mr-2 h-4 w-4 ${logQuery.isFetching ? 'animate-spin' : ''}`} />
              刷新
            </button>
          </div>

          <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200/50">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
              <input
                type="datetime-local"
                value={logFilters.from || ''}
                onChange={(e) => updateLogFilter({ from: e.target.value || undefined })}
                className="rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2.5 text-sm transition-all focus:border-primary-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-100"
                placeholder="开始时间"
              />
              <input
                type="datetime-local"
                value={logFilters.to || ''}
                onChange={(e) => updateLogFilter({ to: e.target.value || undefined })}
                className="rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2.5 text-sm transition-all focus:border-primary-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-100"
                placeholder="结束时间"
              />
              <input
                type="text"
                value={logFilters.action || ''}
                onChange={(e) => updateLogFilter({ action: e.target.value || undefined })}
                className="rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2.5 text-sm transition-all focus:border-primary-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-100"
                placeholder="动作关键词"
              />
              <select
                value={logFilters.contextType || ''}
                onChange={(e) => updateLogFilter({ contextType: e.target.value as AgentActionLogQuery['contextType'] })}
                className="rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2.5 text-sm transition-all focus:border-primary-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-100"
              >
                <option value="">全部上下文</option>
                <option value="chat">Chat</option>
                <option value="orchestration">Orchestration</option>
              </select>
              <select
                value={logFilters.status || ''}
                onChange={(e) => updateLogFilter({ status: e.target.value as AgentActionLogQuery['status'] })}
                className="rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2.5 text-sm transition-all focus:border-primary-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-100"
              >
                <option value="">全部状态</option>
                <option value="started">进行中</option>
                <option value="running">运行中</option>
                <option value="pending">待执行</option>
                <option value="completed">成功</option>
                <option value="failed">失败</option>
                <option value="paused">已暂停</option>
                <option value="resumed">已恢复</option>
                <option value="cancelled">已取消</option>
                <option value="asked">待授权</option>
                <option value="replied">已授权回复</option>
                <option value="denied">已拒绝</option>
                <option value="step_started">步骤开始</option>
              </select>
            </div>

            <div className="mt-4 text-sm text-slate-500">
              当前共 <span className="font-semibold text-slate-700">{logQuery.data?.total || 0}</span> 条，页码 <span className="font-semibold text-slate-700">{logQuery.data?.page || 1}</span>/{Math.max(1, logQuery.data?.totalPages || 1)}
            </div>
          </div>

          <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200/50">
            {logQuery.isLoading ? (
              <div className="space-y-3 p-4">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className="animate-pulse rounded-xl border border-slate-100 p-5">
                    <div className="mb-4 h-4 w-32 rounded-lg bg-slate-100" />
                    <div className="mb-3 h-6 w-1/2 rounded-lg bg-slate-200" />
                    <div className="h-4 w-3/4 rounded-lg bg-slate-100" />
                  </div>
                ))}
              </div>
            ) : logQuery.error ? (
              <div className="flex flex-col items-center justify-center p-12 text-red-500">
                <div className="mb-2 text-4xl">⚠️</div>
                <p className="text-sm">日志查询失败，请检查权限或筛选条件</p>
              </div>
            ) : logs.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-12 text-slate-400">
                <div className="mb-2 text-4xl">📋</div>
                <p className="text-sm">暂无日志数据</p>
              </div>
            ) : (
              <div className="space-y-3 p-4">
                {logs.map((item) => {
                  const statusMeta = getLogStatusMeta(item);
                  const sessionId = getLogSessionId(item);
                  const durationMs = item.details?.durationMs;
                  const extraEntries = getExtraDetailEntries(item);
                  const isOrchestration = item.contextType === 'orchestration';
                  const chatTitle = String(item.details?.meetingTitle || item.details?.taskTitle || '-');
                  const primaryTitle = isOrchestration ? String(item.details?.taskTitle || '-') : chatTitle;
                  const isExpanded = expandedLogIds[item.id] === true;
                  return (
                    <article
                      key={item.id}
                      className="group relative overflow-hidden rounded-xl border border-slate-200/60 bg-white p-5 transition-all duration-200 hover:border-slate-300 hover:shadow-md hover:shadow-slate-200/50"
                    >
                      <div className="absolute inset-0 bg-gradient-to-r from-primary-50/0 via-primary-50/20 to-primary-50/0 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                      <div className="relative flex flex-wrap items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3 mb-2">
                            <span className="text-xs font-medium text-slate-400">{new Date(item.timestamp).toLocaleString()}</span>
                            <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ${
                              statusMeta.label === '成功' ? 'bg-emerald-50 text-emerald-600 ring-emerald-200/60' :
                              statusMeta.label === '失败' ? 'bg-red-50 text-red-600 ring-red-200/60' :
                              statusMeta.label === '进行中' || statusMeta.label === '运行中' ? 'bg-amber-50 text-amber-600 ring-amber-200/60' :
                              statusMeta.label === '待授权' ? 'bg-fuchsia-50 text-fuchsia-600 ring-fuchsia-200/60' :
                              'bg-slate-50 text-slate-600 ring-slate-200/60'
                            }`}>
                              {statusMeta.label}
                            </span>
                            <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-medium text-slate-600 ring-1 ring-slate-200/60">
                              {getLogContextLabel(item.contextType)}
                            </span>
                            {typeof durationMs === 'number' && (
                              <span className="inline-flex rounded-full bg-slate-50 px-2.5 py-0.5 text-[10px] font-medium text-slate-500 ring-1 ring-slate-200/60">
                                {durationMs}ms
                              </span>
                            )}
                          </div>
                          <h3 className="text-base font-semibold text-slate-900">{formatLogAction(item.action)}</h3>
                          <p className="mt-1.5 text-sm text-slate-600 truncate">{primaryTitle}</p>
                          <p className="mt-1.5 break-all font-mono text-xs text-slate-400">{item.action}</p>
                        </div>
                      </div>

                      <div className="relative mt-4 flex items-center justify-between">
                        <p className="text-xs text-slate-400">{isOrchestration ? '任务标题' : '会议标题'} 已固定展示</p>
                        <button
                          onClick={() => toggleLogExpanded(item.id)}
                          className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-all hover:border-slate-300 hover:bg-slate-50"
                        >
                          {isExpanded ? '收起详情' : '展开详情'}
                        </button>
                      </div>

                      {isExpanded ? (
                        <div className="relative mt-4 space-y-3">
                          <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-100 bg-slate-50/50 p-4 md:grid-cols-2">
                            <div>
                              <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">{isOrchestration ? '任务' : '会议'}</p>
                              <p className="mt-1.5 text-sm font-medium text-slate-800">{primaryTitle}</p>
                              {isOrchestration ? (
                                <p className="mt-1.5 break-all text-xs text-slate-500">
                                  ID: <span className="font-mono">{item.details?.taskId || '-'}</span> 
                                  {item.details?.taskType ? <span className="ml-2">· 类型: {item.details.taskType}</span> : ''}
                                </p>
                              ) : null}
                            </div>
                            <div>
                              <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">上下文</p>
                              <p className="mt-1.5 break-all text-sm font-mono text-slate-600">{item.contextId || '-'}</p>
                              <p className="mt-1.5 break-all text-xs text-slate-500">Run: <span className="font-mono">{item.details?.runId || '-'}</span></p>
                            </div>
                          </div>

                          {item.details?.error ? (
                            <div className="rounded-xl border border-red-200/60 bg-red-50/50 px-4 py-3 text-sm text-red-600">
                              <span className="font-medium">错误信息：</span>{String(item.details.error)}
                            </div>
                          ) : null}

                          {extraEntries.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {extraEntries.map(([key, value]) => (
                                <span
                                  key={`${item.id}-${key}`}
                                  title={value}
                                  className="max-w-full truncate rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs text-slate-600"
                                >
                                  {key}: {value}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ) : null}

                      {sessionId ? (
                        <button
                          onClick={() => {
                            setActiveTab('session');
                            setSessionIdInput(sessionId);
                            setSelectedSessionId(sessionId);
                            setIsSessionDrawerOpen(true);
                          }}
                          className="relative mt-4 inline-flex items-center text-xs font-medium text-primary-600 transition-colors hover:text-primary-700"
                        >
                          <span className="mr-1">查看 Session:</span>
                          <span className="font-mono">{sessionId.slice(0, 12)}...</span>
                        </button>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            )}
          </div>

          {logQuery.data && logQuery.data.totalPages > 1 && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-500">第 {logFilters.page || 1} / {logQuery.data.totalPages} 页</span>
              <div className="flex gap-2">
                <button
                  onClick={() => setLogFilters((prev) => ({ ...prev, page: Math.max(1, (prev.page || 1) - 1) }))}
                  disabled={(logFilters.page || 1) <= 1}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition-all hover:border-slate-300 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  上一页
                </button>
                <button
                  onClick={() => setLogFilters((prev) => ({ ...prev, page: (prev.page || 1) + 1 }))}
                  disabled={!!logQuery.data && (logFilters.page || 1) >= (logQuery.data.totalPages || 1)}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition-all hover:border-slate-300 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  下一页
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'session' && (
        <div className="space-y-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-lg font-bold text-slate-900 tracking-tight">Session 查询</h2>
              <p className="mt-1 text-sm text-slate-500">查看该 Agent 的会话上下文、消息轨迹与运行关联信息</p>
            </div>
            <button
              onClick={() => {
                sessionListQuery.refetch();
                if (selectedSessionId) {
                  sessionDetailQuery.refetch();
                }
              }}
              className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 transition-all hover:border-slate-300 hover:bg-slate-50"
            >
              <ArrowPathIcon className={`mr-2 h-4 w-4 ${sessionListQuery.isFetching || sessionDetailQuery.isFetching ? 'animate-spin' : ''}`} />
              刷新
            </button>
          </div>

          <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200/50">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
              <input
                value={sessionKeyword}
                onChange={(e) => {
                  setSessionKeyword(e.target.value);
                  setSessionPage(1);
                }}
                className="rounded-lg border border-slate-200 bg-slate-50/50 px-4 py-2.5 text-sm transition-all focus:border-primary-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-100"
                placeholder="关键词（标题/plan/task/meeting）"
              />
              <input
                value={sessionIdInput}
                onChange={(e) => setSessionIdInput(e.target.value)}
                className="rounded-lg border border-slate-200 bg-slate-50/50 px-4 py-2.5 text-sm transition-all focus:border-primary-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-100"
                placeholder="精确查询 Session ID"
              />
              <button
                onClick={() => {
                  const sid = sessionIdInput.trim();
                  if (!sid) return;
                  setSelectedSessionId(sid);
                  setIsSessionDrawerOpen(true);
                }}
                className="inline-flex items-center justify-center rounded-lg border border-primary-200/60 bg-primary-50/50 px-4 py-2.5 text-sm font-medium text-primary-700 transition-all hover:border-primary-300 hover:bg-primary-100/50"
              >
                按 Session ID 查询
              </button>
              <button
                onClick={() => {
                  setSessionKeyword('');
                  setSessionIdInput('');
                  setSessionPage(1);
                  setSelectedSessionId('');
                  setIsSessionDrawerOpen(false);
                }}
                className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 transition-all hover:border-slate-300 hover:bg-slate-50"
              >
                清空筛选
              </button>
            </div>
            <div className="mt-4 text-sm text-slate-500">
              当前共 <span className="font-semibold text-slate-700">{sessionListQuery.data?.total || 0}</span> 条，页码 <span className="font-semibold text-slate-700">{sessionListQuery.data?.page || 1}</span>/{Math.max(1, sessionListQuery.data?.totalPages || 1)}
            </div>
          </div>

          <div className="rounded-xl bg-white shadow-sm ring-1 ring-slate-200/50">
            <div className="border-b border-slate-100 px-5 py-4 text-sm font-semibold text-slate-800">会话列表</div>
            {sessionListQuery.isLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary-200 border-t-primary-600" />
              </div>
            ) : sessionListQuery.error ? (
              <div className="flex flex-col items-center justify-center py-12 text-red-500">
                <div className="mb-2 text-4xl">⚠️</div>
                <p className="text-sm">Session 列表加载失败，请稍后重试</p>
              </div>
            ) : sessions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                <div className="mb-2 text-4xl">💬</div>
                <p className="text-sm">暂无 Session 数据</p>
              </div>
            ) : (
              <div className="max-h-[70vh] overflow-y-auto p-3 space-y-2">
                {sessions.map((session) => {
                  const sid = getSessionId(session);
                  const lastMessage = session.messages?.[session.messages.length - 1];
                  const isSelected = sid && sid === selectedSessionId;
                  return (
                    <button
                      key={sid || session._id || `${session.title}-${session.createdAt || 'na'}`}
                      onClick={() => {
                        setSelectedSessionId(sid);
                        setIsSessionDrawerOpen(true);
                      }}
                      className={`w-full rounded-xl border p-4 text-left transition-all duration-200 ${
                        isSelected
                          ? 'border-primary-300 bg-primary-50/50 shadow-sm'
                          : 'border-slate-200/60 bg-white hover:border-slate-300 hover:bg-slate-50/50 hover:shadow-sm'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <p className="flex-1 truncate text-sm font-semibold text-slate-900">{session.title || sid}</p>
                        <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-600 ring-1 ring-slate-200/60">{session.sessionType}</span>
                      </div>
                      <p className="mt-1.5 font-mono text-xs text-slate-400 truncate">{sid}</p>
                      <p className="mt-3 text-xs text-slate-500 line-clamp-2 leading-relaxed">
                        {lastMessage?.content || '暂无消息内容'}
                      </p>
                      <div className="mt-3 flex items-center justify-between text-[11px] text-slate-400">
                        <span className={`font-medium ${
                          session.status === 'active' ? 'text-emerald-600' :
                          String(session.status) === 'completed' ? 'text-blue-600' :
                          'text-slate-500'
                        }`}>{session.status}</span>
                        <span>{session.lastActiveAt ? new Date(session.lastActiveAt).toLocaleString() : '-'}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {totalSessionPages > 1 && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-500">第 {sessionPage} / {totalSessionPages} 页</span>
              <div className="flex gap-2">
                <button
                  onClick={() => setSessionPage((prev) => Math.max(1, prev - 1))}
                  disabled={sessionPage <= 1}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition-all hover:border-slate-300 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  上一页
                </button>
                <button
                  onClick={() => setSessionPage((prev) => Math.min(totalSessionPages, prev + 1))}
                  disabled={sessionPage >= totalSessionPages}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition-all hover:border-slate-300 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  下一页
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {isSessionDrawerOpen ? (
        <div className="fixed inset-0 z-40">
          <button
            className="absolute inset-0 bg-slate-900/20 backdrop-blur-sm"
            onClick={() => setIsSessionDrawerOpen(false)}
            aria-label="关闭 Session 详情抽屉"
          />
          <aside className="absolute right-0 top-0 h-full w-[96vw] max-w-3xl bg-white shadow-2xl ring-1 ring-slate-200/50">
            <div className="flex h-full flex-col">
              <div className="flex items-center justify-between border-b border-slate-200/60 px-6 py-5">
                <div>
                  <p className="text-lg font-semibold text-slate-900">Session 详情</p>
                  <p className="text-xs text-slate-500 mt-1">查看上下文与消息轨迹</p>
                </div>
                <button
                  onClick={() => setIsSessionDrawerOpen(false)}
                  className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
                  aria-label="关闭抽屉"
                >
                  <XMarkIcon className="h-5 w-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-5">
                {!selectedSessionId ? (
                  <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                    <div className="mb-2 text-4xl">💬</div>
                    <p className="text-sm">请从列表选择 Session，或输入 Session ID 查询</p>
                  </div>
                ) : sessionDetailQuery.isLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary-200 border-t-primary-600" />
                  </div>
                ) : sessionDetailQuery.error ? (
                  <div className="flex flex-col items-center justify-center py-12 text-red-500">
                    <div className="mb-2 text-4xl">⚠️</div>
                    <p className="text-sm">未找到该 Session，或你暂无访问权限</p>
                  </div>
                ) : (
                  <div className="space-y-5">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-slate-800">基础信息</p>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={handleCopySessionContent}
                          className="inline-flex items-center rounded-lg bg-primary-50 px-3 py-1.5 text-xs font-medium text-primary-600 transition-colors hover:bg-primary-100"
                        >
                          <ClipboardDocumentIcon className="mr-1.5 h-3.5 w-3.5" />
                          复制会话
                        </button>
                        {sessionDetailQuery.data?.id ? (
                          <button
                            onClick={() => copyText(sessionDetailQuery.data?.id || '')}
                            className="inline-flex items-center rounded-lg bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100"
                          >
                            <ClipboardDocumentIcon className="mr-1.5 h-3.5 w-3.5" />
                            复制 ID
                          </button>
                        ) : null}
                      </div>
                    </div>
                    {sessionCopyNotice ? <p className="text-xs text-emerald-600 font-medium">{sessionCopyNotice}</p> : null}

                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-xl border border-slate-200/60 bg-slate-50/50 px-4 py-3">
                        <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Session ID</p>
                        <p className="mt-1.5 font-mono text-xs text-slate-700 truncate">{sessionDetailQuery.data?.id}</p>
                      </div>
                      <div className="rounded-xl border border-slate-200/60 bg-slate-50/50 px-4 py-3">
                        <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">状态</p>
                        <p className="mt-1.5 text-sm font-medium text-slate-700">{sessionDetailQuery.data?.status}</p>
                      </div>
                      <div className="rounded-xl border border-slate-200/60 bg-slate-50/50 px-4 py-3">
                        <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">类型</p>
                        <p className="mt-1.5 text-sm font-medium text-slate-700">{sessionDetailQuery.data?.sessionType}</p>
                      </div>
                      <div className="rounded-xl border border-slate-200/60 bg-slate-50/50 px-4 py-3">
                        <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">最近活跃</p>
                        <p className="mt-1.5 text-sm text-slate-600">
                          {sessionDetailQuery.data?.lastActiveAt
                            ? new Date(sessionDetailQuery.data.lastActiveAt).toLocaleString()
                            : '-'}
                        </p>
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200/60 p-4">
                      <p className="text-sm font-semibold text-slate-800">上下文</p>
                      <div className="mt-3 grid grid-cols-2 gap-3 text-xs md:grid-cols-4">
                        <div className="rounded-lg bg-slate-50 p-2.5">
                          <p className="text-slate-400">Plan</p>
                          <p className="mt-1 font-mono text-slate-600 truncate">{sessionDetailQuery.data?.planContext?.linkedPlanId || '-'}</p>
                        </div>
                        <div className="rounded-lg bg-slate-50 p-2.5">
                          <p className="text-slate-400">Task</p>
                          <p className="mt-1 font-mono text-slate-600 truncate">{sessionDetailQuery.data?.planContext?.linkedTaskId || '-'}</p>
                        </div>
                        <div className="rounded-lg bg-slate-50 p-2.5">
                          <p className="text-slate-400">Meeting</p>
                          <p className="mt-1 font-mono text-slate-600 truncate">{sessionDetailQuery.data?.meetingContext?.meetingId || '-'}</p>
                        </div>
                        <div className="rounded-lg bg-slate-50 p-2.5">
                          <p className="text-slate-400">Agenda</p>
                          <p className="mt-1 font-mono text-slate-600 truncate">{sessionDetailQuery.data?.meetingContext?.agendaId || '-'}</p>
                        </div>
                      </div>
                    </div>

                    <div>
                      <p className="text-sm font-semibold text-slate-800 mb-3">消息轨迹 ({sessionDetailQuery.data?.messages?.length || 0})</p>
                      {!sessionDetailQuery.data?.messages?.length ? (
                        <div className="rounded-xl border-2 border-dashed border-slate-200 p-8 text-center">
                          <p className="text-sm text-slate-400">该 Session 暂无消息记录</p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {sessionDetailQuery.data.messages.map((message, index) => (
                            <div key={`${message.id || index}-${message.timestamp}`} className="rounded-xl border border-slate-200/60 bg-white p-4 transition-all hover:border-slate-300 hover:shadow-sm">
                              <div className="flex flex-wrap items-center gap-2 mb-3">
                                {renderSessionRole(message)}
                                {renderMessageStatus(message)}
                                <span className="text-xs text-slate-400 ml-auto">
                                  {message.timestamp ? new Date(message.timestamp).toLocaleString() : '-'}
                                </span>
                              </div>
                              <div className="text-xs text-slate-400 mb-3 space-x-3">
                                {message.runId ? <span className="font-mono">run: {message.runId}</span> : null}
                                {message.taskId ? <span className="font-mono">task: {message.taskId}</span> : null}
                              </div>
                              <pre className="whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-sm text-slate-700 leading-relaxed">
                                {message.content || '-'}
                              </pre>
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
      ) : null}

      {selectedMemo ? (
        <div className="fixed inset-0 z-50">
          <button className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" onClick={() => setSelectedMemo(null)} aria-label="关闭弹窗" />
          <div className="absolute left-1/2 top-1/2 w-[94vw] max-w-3xl -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200/50 overflow-hidden">
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
                  {selectedMemo.memoType || '-'} · {selectedMemo.category || '-'}
                </p>
              </div>
              <button onClick={() => setSelectedMemo(null)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <div className="max-h-[65vh] overflow-y-auto px-6 py-5">
              <pre className="whitespace-pre-wrap text-sm text-slate-700 leading-relaxed font-sans">{selectedMemo.content}</pre>
            </div>
          </div>
        </div>
      ) : null}

      {memoEditorOpen ? (
        <div className="fixed inset-0 z-50">
          <button className="absolute inset-0 bg-black/40" onClick={() => setMemoEditorOpen(false)} aria-label="关闭弹窗" />
          <div className="absolute left-1/2 top-1/2 w-[94vw] max-w-3xl -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
              <div>
                <p className="text-base font-semibold text-gray-900">{editingMemo ? '编辑备忘录' : '新建备忘录'}</p>
                <p className="text-xs text-gray-500">Agent: {agent?.name}</p>
              </div>
              <button onClick={() => setMemoEditorOpen(false)} className="text-sm text-gray-500">
                关闭
              </button>
            </div>
            <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label className="mb-1 block text-sm text-gray-600">标题</label>
                  <input
                    value={memoDraft.title}
                    onChange={(e) => setMemoDraft((prev) => ({ ...prev, title: e.target.value }))}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-gray-600">种类</label>
                  <select
                    value={memoDraft.memoKind}
                    onChange={(e) => setMemoDraft((prev) => ({ ...prev, memoKind: e.target.value }))}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  >
                    <option value="">不指定</option>
                    {memoKindOptions.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm text-gray-600">类型</label>
                  <select
                    value={memoDraft.memoType}
                    onChange={(e) => setMemoDraft((prev) => ({ ...prev, memoType: e.target.value }))}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  >
                    <option value="">不指定</option>
                    {memoTypeOptions.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm text-gray-600">类别</label>
                  <input
                    value={memoDraft.category}
                    onChange={(e) => setMemoDraft((prev) => ({ ...prev, category: e.target.value }))}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-gray-600">Topic</label>
                  <input
                    value={memoDraft.topic}
                    onChange={(e) => setMemoDraft((prev) => ({ ...prev, topic: e.target.value }))}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-gray-600">Todo 状态</label>
                  <select
                    value={memoDraft.todoStatus}
                    onChange={(e) => setMemoDraft((prev) => ({ ...prev, todoStatus: e.target.value }))}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  >
                    <option value="">不指定</option>
                    {todoStatusOptions.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm text-gray-600">标签 (逗号分隔)</label>
                  <input
                    value={memoDraft.tags}
                    onChange={(e) => setMemoDraft((prev) => ({ ...prev, tags: e.target.value }))}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="mb-1 block text-sm text-gray-600">内容</label>
                  <textarea
                    rows={8}
                    value={memoDraft.content}
                    onChange={(e) => setMemoDraft((prev) => ({ ...prev, content: e.target.value }))}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-5 py-4">
              <button
                onClick={() => setMemoEditorOpen(false)}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700"
              >
                取消
              </button>
              <button
                onClick={handleSaveMemo}
                disabled={createMemoMutation.isLoading || updateMemoMutation.isLoading}
                className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60"
              >
                {createMemoMutation.isLoading || updateMemoMutation.isLoading ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default AgentDetail;
