import { useMemo, useState } from 'react';
import { useQuery } from 'react-query';
import { agentService } from '../../../services/agentService';
import {
  agentActionLogService,
  AgentActionLogItem,
  AgentActionLogQuery,
} from '../../../services/agentActionLogService';
import { AGENT_DETAIL_QUERY_KEYS, DEFAULT_LOG_PAGE_SIZE, LogStatus, TaskGroup } from '../constants';
import { getActionDescription, getActionSemantic } from '../utils';

export const useLogState = (agentId: string) => {
  const [logFilters, setLogFilters] = useState<AgentActionLogQuery>({
    page: 1,
    pageSize: DEFAULT_LOG_PAGE_SIZE,
    status: '',
    contextType: '',
  });
  const [expandedTaskKeys, setExpandedTaskKeys] = useState<Record<string, boolean>>({});
  const [taskViewModes, setTaskViewModes] = useState<Record<string, 'readable' | 'raw'>>({});
  const [handlingApprovalRunId, setHandlingApprovalRunId] = useState('');

  const logQuery = useQuery(
    AGENT_DETAIL_QUERY_KEYS.logs(agentId, logFilters),
    () => agentActionLogService.getAgentActionLogs({ ...logFilters, agentId }),
    { enabled: !!agentId, keepPreviousData: true },
  );

  const logs = logQuery.data?.logs || [];

  const latestRunIdFromLogs = useMemo(() => {
    for (const item of logs) {
      const runId = item.details?.runId;
      if (typeof runId === 'string' && runId.trim()) {
        return runId.trim();
      }
    }
    return '';
  }, [logs]);

  const approvalRunCandidates = useMemo(() => {
    return logs
      .filter((item) => item.details?.status === 'asked')
      .map((item) => String(item.details?.runId || '').trim())
      .filter(Boolean);
  }, [logs]);

  const approvalTargetRunId = approvalRunCandidates[0] || '';

  const runtimeRunQuery = useQuery(
    AGENT_DETAIL_QUERY_KEYS.runtimeRun(latestRunIdFromLogs),
    () => agentService.getRuntimeRun(latestRunIdFromLogs),
    {
      enabled: !!latestRunIdFromLogs,
      retry: false,
    },
  );

  const updateLogFilter = (patch: Partial<AgentActionLogQuery>) => {
    setLogFilters((prev) => ({ ...prev, ...patch, page: 1 }));
  };

  const toggleTaskExpanded = (key: string) => {
    setExpandedTaskKeys((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleTaskViewMode = (key: string) => {
    setTaskViewModes((prev) => ({
      ...prev,
      [key]: prev[key] === 'raw' ? 'readable' : 'raw',
    }));
    setExpandedTaskKeys((prev) => ({ ...prev, [key]: true }));
  };

  const taskGroups = useMemo(() => {
    if (!logs.length) return [];

    const groupMap = new Map<string, AgentActionLogItem[]>();
    for (const item of logs) {
      const runId = item.details?.runId;
      const key = typeof runId === 'string' && runId.trim() ? runId.trim() : `ungrouped-${item.id}`;
      const arr = groupMap.get(key);
      if (arr) arr.push(item);
      else groupMap.set(key, [item]);
    }

    const groups: TaskGroup[] = [];
    for (const [groupKey, items] of groupMap) {
      const sorted = [...items].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      const first = sorted[0];
      const last = sorted[sorted.length - 1];

      let finalStatus: LogStatus = 'unknown';
      for (let i = sorted.length - 1; i >= 0; i -= 1) {
        const status = sorted[i].details?.status;
        if (status && status !== 'unknown') {
          finalStatus = status;
          break;
        }
      }
      if (sorted.some((item) => item.details?.status === 'failed')) finalStatus = 'failed';

      const title = String(first.details?.taskTitle || first.details?.meetingTitle || '');

      let totalDurationMs = 0;
      const terminalAction = sorted.find((item) => item.details?.status === 'completed' || item.details?.status === 'failed');
      if (terminalAction?.details?.durationMs && typeof terminalAction.details.durationMs === 'number') {
        totalDurationMs = terminalAction.details.durationMs;
      } else {
        totalDurationMs = new Date(last.timestamp).getTime() - new Date(first.timestamp).getTime();
      }

      const lastSemantic = getActionSemantic(last.action);
      const lastDesc = getActionDescription(last);
      const lastActionSummary = lastDesc ? `${lastSemantic.label} · ${lastDesc}` : lastSemantic.label;

      groups.push({
        groupKey,
        title,
        contextType: first.contextType,
        finalStatus,
        startTime: first.timestamp,
        endTime: last.timestamp,
        actionCount: sorted.length,
        lastActionSummary,
        actions: sorted,
        totalDurationMs,
      });
    }

    groups.sort((a, b) => new Date(b.endTime).getTime() - new Date(a.endTime).getTime());
    return groups;
  }, [logs]);

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
      await Promise.all([logQuery.refetch(), runtimeRunQuery.refetch()]);
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
    expandedTaskKeys,
    taskViewModes,
    handlingApprovalRunId,
    logQuery,
    runtimeRunQuery,
    taskGroups,
    approvalRunCandidates,
    approvalTargetRunId,
    updateLogFilter,
    toggleTaskExpanded,
    toggleTaskViewMode,
    handleApprovalDecision,
  };
};

export type UseLogStateResult = ReturnType<typeof useLogState>;
