import { useMemo, useState } from 'react';
import { useQuery } from 'react-query';
import { AgentRunScore, agentService } from '../../../services/agentService';
import { AGENT_DETAIL_QUERY_KEYS, DEFAULT_LOG_PAGE_SIZE, RunDetailTab } from '../constants';

export interface AgentRunLogFilters {
  from?: string;
  to?: string;
  status?: string;
  page: number;
  pageSize: number;
}

export type RunMessagePartRecord = {
  id: string;
  type: string;
  status: string;
  toolId?: string;
  toolCallId?: string;
  content?: string;
  input?: unknown;
  output?: unknown;
  error?: string;
  startedAt?: string;
  endedAt?: string;
};

export type RunMessageRecord = {
  id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: string;
  stepIndex?: number;
  tokens?: {
    input?: number;
    output?: number;
    reasoning?: number;
    cacheRead?: number;
    cacheWrite?: number;
    total?: number;
  };
  parts: RunMessagePartRecord[];
};

type RunScoreState = {
  loading: boolean;
  data: AgentRunScore | null;
  error?: string;
  errorCode?: number;
  loadingStartedAt?: number;
};

type RunMessagesState = {
  loading: boolean;
  data: RunMessageRecord[];
  error?: string;
};

export const useLogState = (agentId: string) => {
  const [logFilters, setLogFilters] = useState<AgentRunLogFilters>({
    page: 1,
    pageSize: DEFAULT_LOG_PAGE_SIZE,
    status: '',
  });
  const [expandedRunKeys, setExpandedRunKeys] = useState<Record<string, boolean>>({});
  const [detailTabs, setDetailTabs] = useState<Record<string, RunDetailTab>>({});
  const [runScores, setRunScores] = useState<Record<string, RunScoreState>>({});
  const [runMessages, setRunMessages] = useState<Record<string, RunMessagesState>>({});
  const [handlingApprovalRunId, setHandlingApprovalRunId] = useState('');

  const logQuery = useQuery(
    AGENT_DETAIL_QUERY_KEYS.logs(agentId, logFilters),
    () =>
      agentService.listAgentRuns(agentId, {
        status: logFilters.status || undefined,
        from: logFilters.from,
        to: logFilters.to,
        page: logFilters.page,
        pageSize: logFilters.pageSize,
      }),
    { enabled: !!agentId, keepPreviousData: true },
  );

  const runs = logQuery.data?.items || [];

  const approvalRunCandidates = useMemo(
    () => runs.filter((item) => item.status === 'paused').map((item) => item.id),
    [runs],
  );
  const approvalTargetRunId = approvalRunCandidates[0] || '';

  const loadRunScore = async (runId: string) => {
    if (!runId) return;

    const cached = runScores[runId];
    if (cached?.loading) {
      const loadingForMs = Date.now() - Number(cached.loadingStartedAt || 0);
      if (loadingForMs < 15000) {
        return;
      }
    }
    if (cached && !cached.error && cached.data !== undefined) {
      return;
    }

    setRunScores((prev) => ({
      ...prev,
      [runId]: {
        loading: true,
        data: null,
        loadingStartedAt: Date.now(),
      },
    }));

    try {
      const data = await agentService.getRunScore(runId);
      setRunScores((prev) => ({
        ...prev,
        [runId]: {
          loading: false,
          data,
          loadingStartedAt: undefined,
        },
      }));
    } catch (error: any) {
      const message = error instanceof Error ? error.message : '评分加载失败';
      const errorCode = typeof error?.response?.status === 'number' ? Number(error.response.status) : undefined;
      setRunScores((prev) => ({
        ...prev,
        [runId]: {
          loading: false,
          data: null,
          error: message,
          errorCode,
          loadingStartedAt: undefined,
        },
      }));
    }
  };

  const loadRunMessages = async (runId: string) => {
    if (!runId) return;
    const cached = runMessages[runId];
    if (cached?.loading || cached?.data?.length) {
      return;
    }

    setRunMessages((prev) => ({
      ...prev,
      [runId]: {
        loading: true,
        data: [],
      },
    }));

    try {
      const result = await agentService.getRuntimeRunMessages(runId);
      setRunMessages((prev) => ({
        ...prev,
        [runId]: {
          loading: false,
          data: result.messages.map((message) => ({
            id: message.id,
            role: message.role,
            content: message.content,
            timestamp: message.timestamp,
            stepIndex: message.stepIndex,
            tokens: message.tokens,
            parts: (message.parts || []).map((part) => ({
              id: part.id,
              type: part.type,
              status: part.status,
              toolId: part.toolId,
              toolCallId: part.toolCallId,
              content: part.content,
              input: part.input,
              output: part.output,
              error: part.error,
              startedAt: part.startedAt,
              endedAt: part.endedAt,
            })),
          })),
        },
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : '执行流程加载失败';
      setRunMessages((prev) => ({
        ...prev,
        [runId]: {
          loading: false,
          data: [],
          error: message,
        },
      }));
    }
  };

  const updateLogFilter = (patch: Partial<AgentRunLogFilters>) => {
    setLogFilters((prev) => ({ ...prev, ...patch, page: 1 }));
  };

  const toggleTaskExpanded = (runId: string) => {
    setExpandedRunKeys((prev) => {
      const nextExpanded = !prev[runId];
      if (nextExpanded) {
        void loadRunScore(runId);
        void loadRunMessages(runId);
      }
      return { ...prev, [runId]: nextExpanded };
    });
  };

  const setDetailTab = (runId: string, tab: RunDetailTab) => {
    setDetailTabs((prev) => ({
      ...prev,
      [runId]: tab,
    }));
    setExpandedRunKeys((prev) => ({ ...prev, [runId]: true }));
  };

  const runItems = useMemo(
    () =>
      runs.map((run) => {
        const start = new Date(run.startedAt).getTime();
        const end = run.finishedAt ? new Date(run.finishedAt).getTime() : Date.now();
        const totalDurationMs = Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : 0;
        return { run, totalDurationMs };
      }),
    [runs],
  );

  const handleApprovalDecision = async (approved: boolean) => {
    if (!approvalTargetRunId) {
      window.alert('暂无可处理的授权请求');
      return;
    }

    setHandlingApprovalRunId(approvalTargetRunId);
    try {
      if (approved) {
        await agentService.resumeRuntimeRun(approvalTargetRunId, 'approved_from_agent_detail');
      } else {
        await agentService.cancelRuntimeRun(approvalTargetRunId, 'rejected_from_agent_detail');
      }
      await logQuery.refetch();
    } catch (error) {
      const message = error instanceof Error ? error.message : '授权处理失败';
      window.alert(message);
    } finally {
      setHandlingApprovalRunId('');
    }
  };

  return {
    logFilters,
    setLogFilters,
    expandedRunKeys,
    detailTabs,
    runScores,
    runMessages,
    handlingApprovalRunId,
    logQuery,
    runItems,
    approvalRunCandidates,
    approvalTargetRunId,
    updateLogFilter,
    toggleTaskExpanded,
    setDetailTab,
    handleApprovalDecision,
  };
};

export type UseLogStateResult = ReturnType<typeof useLogState>;
