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
  id: string;
  runId?: string;
  taskId?: string;
  parentMessageId?: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  sequence: number;
  content: string;
  status?: 'pending' | 'streaming' | 'completed' | 'error';
  metadata?: Record<string, unknown>;
  modelID?: string;
  providerID?: string;
  finish?: 'stop' | 'tool-calls' | 'error' | 'cancelled' | 'paused' | 'max-rounds';
  tokens?: {
    input?: number;
    output?: number;
    reasoning?: number;
    cacheRead?: number;
    cacheWrite?: number;
    total?: number;
  };
  cost?: number;
  stepIndex?: number;
  timestamp: string;
}

export interface AgentRuntimeSessionPart {
  id: string;
  runId: string;
  taskId?: string;
  messageId: string;
  sequence: number;
  type: 'text' | 'reasoning' | 'tool_call' | 'tool_result' | 'system_event' | 'step_start' | 'step_finish';
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
  sessionType: 'meeting' | 'task' | 'plan' | 'chat';
  ownerType: 'agent' | 'employee' | 'system';
  ownerId: string;
  title: string;
  status: 'active' | 'archived' | 'closed';
  runIds?: string[];
  messageIds?: string[];
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
  sessionType?: 'meeting' | 'task' | 'plan' | 'chat';
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

export interface AgentRunListItem {
  id: string;
  agentId: string;
  agentName: string;
  taskTitle: string;
  taskDescription: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'paused';
  currentStep: number;
  startedAt: string;
  finishedAt?: string;
  error?: string;
  sessionId?: string;
  taskId?: string;
  roleCode?: string;
  executionChannel?: 'native' | 'opencode';
  metadata?: Record<string, unknown>;
  score?: number;
}

export interface AgentRunListResponse {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  items: AgentRunListItem[];
}

export interface AgentRunScoreDeduction {
  ruleId: string;
  points: number;
  round: number;
  toolId?: string;
  detail?: string;
  timestamp: string;
}

export interface AgentRunScore {
  id: string;
  runId: string;
  agentId: string;
  taskId?: string;
  sessionId?: string;
  score: number;
  baseScore: number;
  totalDeductions: number;
  stats: {
    totalRounds: number;
    totalToolCalls: number;
    successfulToolCalls: number;
    failedToolCalls: number;
  };
  deductionsByRule: Record<string, { count: number; totalPoints: number }>;
  deductions: AgentRunScoreDeduction[];
  ruleVersion: string;
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

export interface DiagnoseRunOptions {
  signal?: AbortSignal;
  onChunk?: (chunk: string) => void;
}

export const agentService = {
  normalizeAgentList(raw: unknown): Agent[] {
    const list = Array.isArray(raw)
      ? raw
      : Array.isArray((raw as any)?.items)
        ? (raw as any).items
        : Array.isArray((raw as any)?.data)
          ? (raw as any).data
          : [];

    return list
      .map((item: any) => {
        const id = String(item?.id || item?._id || '').trim();
        if (!id) {
          return null;
        }
        return {
          ...item,
          id,
        } as Agent;
      })
      .filter(Boolean) as Agent[];
  },

  // 获取所有agent
  async getAgents(): Promise<Agent[]> {
    const response = await api.get('/agents');
    return agentService.normalizeAgentList(response.data);
  },

  // 获取可分配agent（优先 active）
  async getAssignableAgents(): Promise<Agent[]> {
    try {
      const response = await api.get('/agents/active');
      const active = agentService.normalizeAgentList(response.data);
      if (active.length > 0) {
        return active;
      }
    } catch {
      // fallback to /agents
    }

    const all = await agentService.getAgents();
    return all.filter((agent) => agent.isActive !== false);
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
    const payload: Record<string, unknown> = { ...updates };
    if (Object.prototype.hasOwnProperty.call(updates, 'promptTemplateRef') && updates.promptTemplateRef === undefined) {
      payload.promptTemplateRef = null;
    }
    const response = await api.put(`/agents/${id}`, payload);
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

  async getRuntimeSessionMessages(sessionId: string): Promise<{ sessionId: string; total: number; messages: AgentRuntimeSessionMessage[] }> {
    const response = await api.get(`/agents/runtime/sessions/${encodeURIComponent(sessionId)}/messages`);
    return response.data;
  },

  async getRuntimeMessageParts(messageId: string): Promise<{ messageId: string; total: number; parts: AgentRuntimeSessionPart[] }> {
    const response = await api.get(`/agents/runtime/messages/${encodeURIComponent(messageId)}/parts`);
    return response.data;
  },

  async getRuntimeRunMessages(runId: string): Promise<{
    runId: string;
    total: number;
    messages: Array<AgentRuntimeSessionMessage & { parts: AgentRuntimeSessionPart[] }>;
  }> {
    const response = await api.get(`/agents/runtime/runs/${encodeURIComponent(runId)}/messages`);
    return response.data;
  },

  async getRuntimeRun(runId: string): Promise<AgentRuntimeRun | null> {
    const response = await api.get(`/agents/runtime/runs/${encodeURIComponent(runId)}`);
    return response.data?.run || null;
  },

  async listAgentRuns(
    agentId: string,
    filters?: {
      status?: string;
      from?: string;
      to?: string;
      page?: number;
      pageSize?: number;
    },
  ): Promise<AgentRunListResponse> {
    const params = new URLSearchParams();
    params.set('agentId', String(agentId || '').trim());
    Object.entries(filters || {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return;
      params.set(key, String(value));
    });
    const response = await api.get(`/agents/runtime/runs?${params.toString()}`);
    const payload = response.data || {};
    return {
      total: Number(payload.total || 0),
      page: Number(payload.page || 1),
      pageSize: Number(payload.pageSize || 20),
      totalPages: Number(payload.totalPages || 1),
      items: Array.isArray(payload.items) ? payload.items : [],
    };
  },

  async getRunScore(runId: string): Promise<AgentRunScore | null> {
    try {
      const response = await api.get(`/agents/runtime/runs/${encodeURIComponent(runId)}/score`, {
        timeout: 10000,
      });
      const payload = response.data;
      if (payload && typeof payload === 'object') {
        const nestedScore = (payload as { score?: unknown }).score;
        if (nestedScore && typeof nestedScore === 'object') {
          return nestedScore as AgentRunScore;
        }
      }
      return (payload as AgentRunScore) || null;
    } catch (error: any) {
      if (error?.response?.status === 404) {
        return null;
      }
      throw error;
    }
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

  async diagnoseRun(runId: string, question: string, options?: DiagnoseRunOptions): Promise<string> {
    const baseUrl = ((import.meta as any).env?.VITE_API_URL || api.defaults.baseURL || '/api').replace(/\/$/, '');
    const token = localStorage.getItem('auth_token') || localStorage.getItem('token') || '';
    const response = await fetch(`${baseUrl}/agents/runtime/runs/${encodeURIComponent(runId)}/diagnose`, {
      method: 'POST',
      headers: {
        Accept: 'text/event-stream',
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ question }),
      signal: options?.signal,
    });

    if (!response.ok || !response.body) {
      throw new Error(`诊断请求失败（${response.status}）`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let eventType = '';
    let eventData: string[] = [];
    let answer = '';

    const flush = () => {
      if (eventData.length === 0) {
        eventType = '';
        return;
      }
      const raw = eventData.join('\n');
      eventData = [];
      try {
        const parsed = JSON.parse(raw) as { type?: string; content?: string; error?: string };
        if (eventType === 'error' || parsed.type === 'error') {
          throw new Error(parsed.error || '诊断流式返回失败');
        }
        if (eventType === 'chunk' || parsed.type === 'chunk') {
          const chunk = String(parsed.content || '');
          answer += chunk;
          options?.onChunk?.(chunk);
        }
      } finally {
        eventType = '';
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        flush();
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line) {
          flush();
          continue;
        }
        if (line.startsWith('event:')) {
          eventType = line.slice(6).trim();
          continue;
        }
        if (line.startsWith('data:')) {
          eventData.push(line.slice(5).trimStart());
        }
      }
    }

    return answer;
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
