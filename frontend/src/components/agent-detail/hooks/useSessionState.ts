import { useEffect, useMemo, useState } from 'react';
import { useQuery } from 'react-query';
import { AGENT_DETAIL_QUERY_KEYS, DEFAULT_SESSION_PAGE_SIZE } from '../constants';
import { agentService, AgentRuntimeSession, AgentRuntimeSessionMessage } from '../../../services/agentService';

export const useSessionState = (agentId: string) => {
  const [sessionKeyword, setSessionKeyword] = useState('');
  const [sessionIdInput, setSessionIdInput] = useState('');
  const [sessionPage, setSessionPage] = useState(1);
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [isSessionDrawerOpen, setIsSessionDrawerOpen] = useState(false);
  const [sessionCopyNotice, setSessionCopyNotice] = useState('');
  const [expandedSessionMessageIds, setExpandedSessionMessageIds] = useState<Record<string, boolean>>({});
  const [expandedSessionRawInfoIds, setExpandedSessionRawInfoIds] = useState<Record<string, boolean>>({});
  const [expandedSessionPartsIds, setExpandedSessionPartsIds] = useState<Record<string, boolean>>({});
  const [expandedSessionPartContentIds, setExpandedSessionPartContentIds] = useState<Record<string, boolean>>({});

  const sessionListQuery = useQuery(
    AGENT_DETAIL_QUERY_KEYS.sessions(agentId, sessionKeyword, sessionPage),
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
    AGENT_DETAIL_QUERY_KEYS.sessionDetail(selectedSessionId),
    () => agentService.getAgentRuntimeSession(selectedSessionId),
    {
      enabled: !!selectedSessionId,
      retry: false,
    },
  );

  const sessions = sessionListQuery.data?.sessions || [];
  const totalSessionPages = sessionListQuery.data?.totalPages || 1;

  useEffect(() => {
    if (selectedSessionId) return;
    if (sessions.length === 0) return;
    setSelectedSessionId(sessions[0].id);
  }, [sessions, selectedSessionId]);

  const groupedSessionMessages = useMemo(() => {
    const rows = sessionDetailQuery.data?.messages || [];
    const groups = new Map<string, AgentRuntimeSessionMessage[]>();

    const toTimestamp = (message: AgentRuntimeSessionMessage): number => {
      if (!message.timestamp) return Number.NaN;
      const parsed = new Date(message.timestamp).getTime();
      return Number.isNaN(parsed) ? Number.NaN : parsed;
    };

    const compareMessageOrder = (a: AgentRuntimeSessionMessage, b: AgentRuntimeSessionMessage): number => {
      const at = toTimestamp(a);
      const bt = toTimestamp(b);
      if (Number.isFinite(at) && Number.isFinite(bt) && at !== bt) return at - bt;
      if (Number.isFinite(at) && !Number.isFinite(bt)) return -1;
      if (!Number.isFinite(at) && Number.isFinite(bt)) return 1;

      const sequenceDelta = (a.sequence ?? 0) - (b.sequence ?? 0);
      if (sequenceDelta !== 0) return sequenceDelta;
      return (a.stepIndex ?? 0) - (b.stepIndex ?? 0);
    };

    rows.forEach((message) => {
      const key = message.parentMessageId || message.id || 'ungrouped';
      const list = groups.get(key) || [];
      list.push(message);
      groups.set(key, list);
    });

    return Array.from(groups.entries())
      .map(([key, messages]) => ({ key, messages: [...messages].sort(compareMessageOrder) }))
      .sort((a, b) => {
        const aFirst = a.messages[0];
        const bFirst = b.messages[0];
        if (!aFirst || !bFirst) return 0;
        return compareMessageOrder(aFirst, bFirst);
      });
  }, [sessionDetailQuery.data?.messages]);

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

  const clearSessionFilter = () => {
    setSessionKeyword('');
    setSessionIdInput('');
    setSessionPage(1);
    setSelectedSessionId('');
    setIsSessionDrawerOpen(false);
  };

  return {
    sessionKeyword,
    setSessionKeyword,
    sessionIdInput,
    setSessionIdInput,
    sessionPage,
    setSessionPage,
    selectedSessionId,
    setSelectedSessionId,
    isSessionDrawerOpen,
    setIsSessionDrawerOpen,
    sessionCopyNotice,
    setSessionCopyNotice,
    expandedSessionMessageIds,
    setExpandedSessionMessageIds,
    expandedSessionRawInfoIds,
    setExpandedSessionRawInfoIds,
    expandedSessionPartsIds,
    setExpandedSessionPartsIds,
    expandedSessionPartContentIds,
    setExpandedSessionPartContentIds,
    sessionListQuery,
    sessionDetailQuery,
    sessions,
    totalSessionPages,
    groupedSessionMessages,
    copyText,
    buildSessionClipboardText,
    handleCopySessionContent,
    clearSessionFilter,
  };
};

export type UseSessionStateResult = ReturnType<typeof useSessionState>;
