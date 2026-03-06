import api from '../lib/axios';

export interface AgentActionLogQuery {
  from?: string;
  to?: string;
  agentId?: string;
  contextType?: 'meeting' | 'plan' | 'task' | 'unknown' | '';
  contextId?: string;
  action?: string;
  status?: 'started' | 'completed' | 'failed' | '';
  page?: number;
  pageSize?: number;
}

export interface AgentActionLogItem {
  id: string;
  agentId: string;
  contextType: 'meeting' | 'plan' | 'task' | 'unknown';
  contextId?: string;
  action: string;
  details?: {
    status?: 'started' | 'completed' | 'failed';
    durationMs?: number;
    taskTitle?: string;
    taskId?: string;
    taskType?: string;
    runId?: string;
    sessionId?: string;
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
