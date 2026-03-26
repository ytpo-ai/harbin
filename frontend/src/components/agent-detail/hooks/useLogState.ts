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

type LogEnvironmentType = TaskGroup['environmentType'];

const pickFirstNonEmpty = (...values: Array<unknown>): string => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
};

const compactId = (value: string): string => {
  const normalized = value.trim();
  if (!normalized) return '';
  if (normalized.length <= 12) return normalized;
  return `${normalized.slice(0, 6)}...${normalized.slice(-4)}`;
};

const resolveEnvironmentType = (
  items: AgentActionLogItem[],
  contextType: AgentActionLogItem['contextType'],
): LogEnvironmentType => {
  for (const item of items) {
    const details = item.details || {};
    const explicit = details.environmentType;
    if (explicit === 'internal_message' || explicit === 'meeting_chat' || explicit === 'orchestration_plan' || explicit === 'chat') {
      return explicit;
    }
    const taskType = String(details.taskType || '').trim();
    const taskId = String(details.taskId || '').trim();
    if (taskType === 'internal_message' || taskId.startsWith('inner-message:')) {
      return 'internal_message';
    }
  }

  if (contextType === 'orchestration') {
    return 'orchestration_plan';
  }
  return 'meeting_chat';
};

const resolveMeetingTitle = (items: AgentActionLogItem[]): string => {
  for (const item of items) {
    const details = item.details || {};
    const title = pickFirstNonEmpty(details.meetingTitle);
    if (title) {
      return title;
    }
  }
  return '';
};

const resolvePlanTitle = (items: AgentActionLogItem[], contextId?: string): string => {
  for (const item of items) {
    const details = item.details || {};
    const title = pickFirstNonEmpty(details.planTitle);
    if (title) {
      return title;
    }
  }
  if (typeof contextId === 'string' && contextId.trim()) {
    return `计划#${compactId(contextId)}`;
  }
  return '未命名计划';
};

const resolveTaskTitle = (items: AgentActionLogItem[]): string => {
  for (const item of items) {
    const details = item.details || {};
    const title = pickFirstNonEmpty(details.taskTitle);
    if (title) {
      return title;
    }
  }
  return '';
};

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
      const environmentType = resolveEnvironmentType(sorted, first.contextType);
      const meetingTitle = resolveMeetingTitle(sorted);
      const planTitle = resolvePlanTitle(sorted, first.contextId);
      const explicitTaskTitle = resolveTaskTitle(sorted);

      let finalStatus: LogStatus = 'unknown';
      for (let i = sorted.length - 1; i >= 0; i -= 1) {
        const status = sorted[i].details?.status;
        if (status && status !== 'unknown') {
          finalStatus = status;
          break;
        }
      }
      if (sorted.some((item) => item.details?.status === 'failed')) finalStatus = 'failed';

      let title = explicitTaskTitle;
      if (!title) {
        if (environmentType === 'meeting_chat') {
          title = `执行${meetingTitle || '当前'}会议中任务`;
        } else if (environmentType === 'orchestration_plan') {
          title = `执行${planTitle}中任务`;
        } else if (environmentType === 'internal_message') {
          title = '执行内部消息触发任务';
        }
      }

      const environmentLabel =
        environmentType === 'internal_message'
          ? '内部消息触发'
          : environmentType === 'meeting_chat'
            ? `会议/聊天 · ${meetingTitle || first.contextId || '未命名会议'}`
            : environmentType === 'orchestration_plan'
              ? `计划编排 · ${planTitle} · 任务：${explicitTaskTitle || '未命名任务'}`
              : `聊天会话 · ${first.contextId || '-'}`;

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
        contextId: first.contextId,
        contextType: first.contextType,
        environmentType,
        environmentLabel,
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
