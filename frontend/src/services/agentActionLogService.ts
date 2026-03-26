import api from '../lib/axios';

export interface AgentActionLogQuery {
  from?: string;
  to?: string;
  agentId?: string;
  contextType?: 'chat' | 'orchestration' | '';
  contextId?: string;
  action?: string;
  status?:
    | 'started'
    | 'completed'
    | 'failed'
    | 'paused'
    | 'resumed'
    | 'cancelled'
    | 'pending'
    | 'running'
    | 'asked'
    | 'replied'
    | 'denied'
    | 'step_started'
    | '';
  page?: number;
  pageSize?: number;
}

export interface AgentActionLogItem {
  id: string;
  agentId: string;
  contextType: 'chat' | 'orchestration';
  contextId?: string;
  action: string;
  details?: {
    status?:
      | 'started'
      | 'completed'
      | 'failed'
      | 'paused'
      | 'resumed'
      | 'cancelled'
      | 'pending'
      | 'running'
      | 'asked'
      | 'replied'
      | 'denied'
      | 'step_started'
      | 'unknown';
    durationMs?: number;
    taskTitle?: string;
    taskId?: string;
    taskType?: string;
    runId?: string;
    sessionId?: string;
    agentSessionId?: string;
    meetingTitle?: string;
    meetingId?: string;
    planId?: string;
    planTitle?: string;
    environmentType?: 'internal_message' | 'meeting_chat' | 'orchestration_plan' | 'chat';
    error?: string;
    [key: string]: unknown;
  };
  timestamp: string;
}

export interface AgentActionLogListResponse {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  logs: AgentActionLogItem[];
  fetchedAt: string;
}

class AgentActionLogService {
  async getAgentActionLogs(query: AgentActionLogQuery): Promise<AgentActionLogListResponse> {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return;
      params.append(key, String(value));
    });

    const response = await api.get(`/agent-action-logs?${params.toString()}`);
    return response.data.data;
  }
}

export const agentActionLogService = new AgentActionLogService();
