import api from './api';
import { Agent, AIModel } from '../types';

export type AgentTier = 'leadership' | 'operations' | 'temporary';

export interface AgentMcpProfile {
  roleCode: string;
  role: string;
  tools: string[];
  permissions: string[];
  permissionsManual?: string[];
  permissionsDerived?: string[];
  capabilities?: string[];
  exposed: boolean;
  description?: string;
}

export interface AgentBusinessRole {
  id: string;
  code: string;
  name: string;
  tier: AgentTier;
  description?: string;
  capabilities?: string[];
  tools?: string[];
  promptTemplate?: string;
  status: 'active' | 'inactive';
}

export interface AgentToolPermissionSet {
  roleId?: string;
  roleCode: string;
  roleName: string;
  roleStatus: 'active' | 'inactive' | 'unknown';
  tools: string[];
  permissions: string[];
  permissionsManual?: string[];
  permissionsDerived?: string[];
  capabilities?: string[];
  exposed: boolean;
  description?: string;
}

export interface AgentTestResult {
  success: boolean;
  agent?: string;
  model?: string;
  response?: string;
  responseLength?: number;
  duration?: string;
  error?: string;
  note?: string;
  keySource?: 'custom' | 'system';
  timestamp: string;
}

export interface StreamChunkEvent {
  sessionId: string;
  type: 'start' | 'chunk' | 'done' | 'error';
  payload?: string;
  timestamp: number;
}

export interface AgentStreamHandlers {
  onStart?: () => void;
  onChunk?: (chunk: string, fullText: string) => void;
  onDone?: (fullText: string) => void;
  onError?: (message: string) => void;
}

export interface AgentRuntimeSessionMessage {
  id?: string;
  runId?: string;
  taskId?: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  status?: 'pending' | 'streaming' | 'completed' | 'error';
  metadata?: Record<string, unknown>;
  timestamp: string;
}

export interface AgentRuntimeSessionPart {
  id: string;
  runId: string;
  taskId?: string;
  messageId: string;
  sequence: number;
  type: 'text' | 'reasoning' | 'tool_call' | 'tool_result' | 'system_event';
  status: 'pending' | 'running' | 'completed' | 'error' | 'cancelled';
  toolId?: string;
  toolCallId?: string;
  input?: unknown;
  output?: unknown;
  content?: string;
  error?: string;
  startedAt?: string;
  endedAt?: string;
  timestamp: string;
}

export interface AgentRuntimeSession {
  _id?: string;
  id: string;
  sessionType: 'meeting' | 'task';
  ownerType: 'agent' | 'employee' | 'system';
  ownerId: string;
  title: string;
  status: 'active' | 'archived' | 'closed';
  runIds?: string[];
  messages: AgentRuntimeSessionMessage[];
  parts?: AgentRuntimeSessionPart[];
  planContext?: {
    linkedPlanId?: string;
    linkedTaskId?: string;
    latestTaskInput?: string;
    latestTaskOutput?: string;
    lastRunId?: string;
  };
  meetingContext?: {
    meetingId?: string;
    agendaId?: string;
    latestSummary?: string;
  };
  lastActiveAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AgentRuntimeSessionListQuery {
  ownerType?: 'agent' | 'employee' | 'system';
  ownerId?: string;
  status?: 'active' | 'archived' | 'closed';
  sessionType?: 'meeting' | 'task';
  keyword?: string;
  page?: number;
  pageSize?: number;
}

export interface AgentRuntimeSessionListResponse {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  sessions: AgentRuntimeSession[];
}

export interface AgentRuntimeRun {
  id: string;
  status: string;
  currentStep: number;
  taskId?: string;
  sessionId?: string;
  roleCode?: string;
  executionChannel?: 'native' | 'opencode';
  executionData?: Record<string, unknown>;
  sync?: {
    state: 'pending' | 'synced' | 'failed';
    lastSyncAt?: string;
    retryCount: number;
    nextRetryAt?: string;
    lastError?: string;
    deadLettered?: boolean;
  };
  agentId: string;
  startedAt: string;
  finishedAt?: string;
  error?: string;
}

export interface AgentTaskEvent {
  id: string;
  type: 'status' | 'progress' | 'token' | 'tool' | 'result' | 'error' | 'heartbeat';
  taskId: string;
  runId?: string;
  sequence: number;
  timestamp: string;
  payload: Record<string, unknown>;
}

export interface AgentTaskInfo {
  taskId: string;
  runId?: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  progress: number;
  attempt?: number;
  maxAttempts?: number;
  nextRetryAt?: string;
  lastAttemptAt?: string;
  stepTimeoutMs?: number;
  taskTimeoutMs?: number;
  currentStep?: string;
  error?: string;
  resultSummary?: Record<string, unknown>;
  lastEventAt?: string;
  startedAt?: string;
  finishedAt?: string;
  cancelRequested?: boolean;
  serveId?: string;
}

export interface CreateAgentTaskPayload {
  agentId: string;
  task: string;
  sessionContext?: Record<string, unknown>;
  idempotencyKey?: string;
}

export interface StreamAgentTaskEventsOptions {
  taskId: string;
  lastEventId?: string;
  lastSequence?: number;
  signal?: AbortSignal;
  onEvent: (event: AgentTaskEvent) => void;
  onOpen?: () => void;
}

export const agentService = {
  // 获取所有agent
  async getAgents(): Promise<Agent[]> {
    const response = await api.get('/agents');
    return response.data;
  },

  // 获取单个agent
  async getAgent(id: string): Promise<Agent> {
    const response = await api.get(`/agents/${id}`);
    return response.data;
  },

  // 创建agent
  async createAgent(agentData: Omit<Agent, 'id' | 'createdAt' | 'updatedAt'>): Promise<Agent> {
    const response = await api.post('/agents', agentData);
    return response.data;
  },

  // 更新agent
  async updateAgent(id: string, updates: Partial<Agent>): Promise<Agent> {
    const response = await api.put(`/agents/${id}`, updates);
    return response.data;
  },

  // 删除agent
  async deleteAgent(id: string): Promise<boolean> {
    await api.delete(`/agents/${id}`);
    return true;
  },

  // 获取agent能力
  async getAgentCapabilities(id: string): Promise<string[]> {
    const response = await api.get(`/agents/${id}/capabilities`);
    return response.data;
  },

  // 检查agent是否可用
  async isAgentAvailable(id: string): Promise<boolean> {
    const response = await api.get(`/agents/${id}/available`);
    return response.data;
  },

  // 执行任务
  async executeTask(id: string, task: any, context?: any): Promise<{ response: string }> {
    const response = await api.post(`/agents/${id}/execute`, { task, context });
    return response.data;
  },

  // 测试Agent模型连接
  async testAgent(id: string, payload?: { model?: AIModel; apiKeyId?: string }): Promise<AgentTestResult> {
    const response = await api.post(`/agents/${id}/test`, payload || {});
    return response.data;
  },

  async getMcpProfiles(): Promise<AgentMcpProfile[]> {
    const response = await api.get('/agents/mcp/profiles');
    return response.data;
  },

  async getMcpProfile(roleCode: string): Promise<AgentMcpProfile> {
    const response = await api.get(`/agents/mcp/profiles/${encodeURIComponent(roleCode)}`);
    return response.data;
  },

  async upsertMcpProfile(
    roleCode: string,
    updates: Pick<AgentMcpProfile, 'role' | 'tools' | 'permissions' | 'exposed' | 'description'>,
  ): Promise<AgentMcpProfile> {
    const response = await api.put(`/agents/mcp/profiles/${encodeURIComponent(roleCode)}`, updates);
    return response.data;
  },

  async getRoles(status: 'active' | 'inactive' | 'all' = 'active'): Promise<AgentBusinessRole[]> {
    const query = status === 'all' ? '' : `?status=${status}`;
    const response = await api.get(`/agents/roles${query}`);
    return response.data;
  },

  async getToolPermissionSets(): Promise<AgentToolPermissionSet[]> {
    const response = await api.get('/agents/tool-permission-sets');
    return response.data;
  },

  async upsertToolPermissionSet(
    roleCode: string,
    updates: Pick<AgentToolPermissionSet, 'tools' | 'permissions' | 'exposed' | 'description'>,
  ): Promise<AgentToolPermissionSet> {
    const response = await api.put(`/agents/tool-permission-sets/${encodeURIComponent(roleCode)}`, updates);
    return response.data;
  },

  async getAgentRuntimeSessions(query: AgentRuntimeSessionListQuery): Promise<AgentRuntimeSessionListResponse> {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return;
      params.append(key, String(value));
    });
    const suffix = params.toString() ? `?${params.toString()}` : '';
    const response = await api.get(`/agents/runtime/sessions${suffix}`);
    return response.data;
  },

  async getAgentRuntimeSession(sessionId: string): Promise<AgentRuntimeSession> {
    const response = await api.get(`/agents/runtime/sessions/${encodeURIComponent(sessionId)}`);
    return response.data;
  },

  async getRuntimeRun(runId: string): Promise<AgentRuntimeRun | null> {
    const response = await api.get(`/agents/runtime/runs/${encodeURIComponent(runId)}`);
    return response.data?.run || null;
  },

  async resumeRuntimeRun(runId: string, reason?: string): Promise<{ success: boolean }> {
    const response = await api.post(`/agents/runtime/runs/${encodeURIComponent(runId)}/resume`, {
      reason: reason || 'manual_resume_from_ui',
    });
    return response.data;
  },

  async cancelRuntimeRun(runId: string, reason?: string): Promise<{ success: boolean }> {
    const response = await api.post(`/agents/runtime/runs/${encodeURIComponent(runId)}/cancel`, {
      reason: reason || 'manual_cancel_from_ui',
    });
    return response.data;
  },

  async createAgentTask(payload: CreateAgentTaskPayload): Promise<{ taskId: string; runId?: string; status: string }> {
    const response = await api.post('/agents/tasks', payload);
    return response.data;
  },

  async getAgentTask(taskId: string): Promise<AgentTaskInfo> {
    const response = await api.get(`/agents/tasks/${encodeURIComponent(taskId)}`);
    return response.data;
  },

  async cancelAgentTask(taskId: string, reason?: string): Promise<{ success: boolean; taskId: string; cancelRequested: boolean }> {
    const response = await api.post(`/agents/tasks/${encodeURIComponent(taskId)}/cancel`, {
      reason,
    });
    return response.data;
  },

  async streamAgentTaskEvents(options: StreamAgentTaskEventsOptions): Promise<void> {
    const baseUrl = ((import.meta as any).env?.VITE_API_URL || api.defaults.baseURL || '/api').replace(/\/$/, '');
    const token = localStorage.getItem('auth_token') || localStorage.getItem('token') || '';
    const query = new URLSearchParams();
    if (options.lastEventId) query.set('lastEventId', options.lastEventId);
    if (typeof options.lastSequence === 'number' && Number.isFinite(options.lastSequence) && options.lastSequence >= 0) {
      query.set('lastSequence', String(Math.floor(options.lastSequence)));
    }
    const suffix = query.toString() ? `?${query.toString()}` : '';
    const url = `${baseUrl}/agents/tasks/${encodeURIComponent(options.taskId)}/events${suffix}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'text/event-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.lastEventId ? { 'Last-Event-ID': options.lastEventId } : {}),
      },
      signal: options.signal,
    });

    if (!response.ok || !response.body) {
      throw new Error(`SSE stream failed with status ${response.status}`);
    }

    options.onOpen?.();

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let currentId = '';
    let currentData: string[] = [];

    const flushEvent = () => {
      if (currentData.length === 0) {
        currentId = '';
        return;
      }
      const raw = currentData.join('\n').trim();
      currentData = [];
      if (!raw) {
        currentId = '';
        return;
      }

      try {
        const parsed = JSON.parse(raw) as AgentTaskEvent;
        const normalized: AgentTaskEvent = {
          ...parsed,
          id: parsed.id || currentId,
        };
        options.onEvent(normalized);
      } catch {
        // ignore malformed chunk
      }
      currentId = '';
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        flushEvent();
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line) {
          flushEvent();
          continue;
        }
        if (line.startsWith('id:')) {
          currentId = line.slice(3).trim();
          continue;
        }
        if (line.startsWith('data:')) {
          currentData.push(line.slice(5).trimStart());
        }
      }
    }
  },

  // 流式测试Agent模型连接（WS + Redis channel）
  async testAgentStream(
    id: string,
    payload: { model?: AIModel; apiKeyId?: string },
    handlers?: AgentStreamHandlers,
  ): Promise<AgentTestResult> {
    const sessionId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const wsBase = (import.meta as any).env?.VITE_WS_URL || 'ws://localhost:3003/ws';
    const channel = `stream:${sessionId}`;

    return new Promise<AgentTestResult>((resolve) => {
      const startedAt = Date.now();
      let fullText = '';
      let settled = false;

      const finish = (result: AgentTestResult, ws?: WebSocket) => {
        if (settled) return;
        settled = true;
        try {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ action: 'unsubscribe', channel }));
            ws.close();
          }
        } catch {
          // noop
        }
        resolve(result);
      };

      const ws = new WebSocket(wsBase);

      ws.onopen = async () => {
        try {
          ws.send(JSON.stringify({ action: 'subscribe', channel }));
          await api.post(`/agents/${id}/test-stream`, {
            ...payload,
            sessionId,
          });
        } catch (error: any) {
          const message = error?.response?.data?.message || error?.message || '启动流式测试失败';
          handlers?.onError?.(message);
          finish({
            success: false,
            error: message,
            timestamp: new Date().toISOString(),
          }, ws);
        }
      };

      ws.onmessage = (event) => {
        let data: StreamChunkEvent;
        try {
          data = JSON.parse(event.data as string) as StreamChunkEvent;
        } catch {
          return;
        }

        if (!data || data.sessionId !== sessionId) return;

        if (data.type === 'start') {
          handlers?.onStart?.();
          return;
        }

        if (data.type === 'chunk') {
          const chunk = data.payload || '';
          fullText += chunk;
          handlers?.onChunk?.(chunk, fullText);
          return;
        }

        if (data.type === 'error') {
          const message = data.payload || '流式测试失败';
          handlers?.onError?.(message);
          finish({
            success: false,
            error: message,
            response: fullText,
            responseLength: fullText.length,
            duration: `${Date.now() - startedAt}ms`,
            timestamp: new Date().toISOString(),
          }, ws);
          return;
        }

        if (data.type === 'done') {
          handlers?.onDone?.(fullText);
          finish({
            success: true,
            response: fullText,
            responseLength: fullText.length,
            duration: `${Date.now() - startedAt}ms`,
            timestamp: new Date().toISOString(),
          }, ws);
        }
      };

      ws.onerror = () => {
        const message = 'WebSocket连接失败';
        handlers?.onError?.(message);
        finish({
          success: false,
          error: message,
          timestamp: new Date().toISOString(),
        }, ws);
      };

      setTimeout(() => {
        if (settled) return;
        const message = '流式测试超时（45s）';
        handlers?.onError?.(message);
        finish({
          success: false,
          error: message,
          response: fullText,
          responseLength: fullText.length,
          duration: `${Date.now() - startedAt}ms`,
          timestamp: new Date().toISOString(),
        }, ws);
      }, 45000);
    });
  }
};
