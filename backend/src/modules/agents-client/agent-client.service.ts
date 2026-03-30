import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { encodeUserContext, signEncodedContext } from '@libs/auth';
import { GatewayUserContext } from '@libs/contracts';
import {
  MEMO_AGGREGATION_COMMAND_QUEUE_KEY,
  MemoAggregationCommandMessage,
  MemoAggregationCommandType,
} from '@libs/common';
import { RedisService } from '@libs/infra';
import { randomUUID } from 'crypto';
import { Readable } from 'stream';
import { Agent, AgentExecutionTask, AIModel, ToolExecution } from '../../shared/types';

export interface AgentMemoSnapshotItem {
  id: string;
  memoKind: 'identity' | 'todo' | 'topic';
  title: string;
  slug?: string;
  content: string;
  updatedAt?: string;
}

export interface AgentMemoSnapshot {
  agentId: string;
  refreshedAt: string;
  identity: AgentMemoSnapshotItem[];
  todo: AgentMemoSnapshotItem[];
  topic: AgentMemoSnapshotItem[];
}

export type AgentExecutionMode = 'chat' | 'task';

export type AsyncAgentTaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface CreateAsyncAgentTaskResult {
  taskId: string;
  runId?: string;
  status: AsyncAgentTaskStatus;
}

export interface AsyncAgentTaskSnapshot {
  taskId: string;
  runId?: string;
  sessionId?: string;
  status: AsyncAgentTaskStatus;
  progress?: number;
  currentStep?: string;
  error?: string;
  resultSummary?: Record<string, unknown>;
  startedAt?: string;
  finishedAt?: string;
}

export interface AsyncAgentTaskCompletionResult {
  status: 'succeeded' | 'failed' | 'cancelled';
  runId?: string;
  sessionId?: string;
  output?: string;
  error?: string;
  snapshot?: AsyncAgentTaskSnapshot;
}

interface PublishInnerMessageInput {
  senderAgentId?: string;
  eventType: string;
  title: string;
  content: string;
  payload?: Record<string, any>;
  source?: string;
  dedupKey?: string;
  maxAttempts?: number;
}

interface SendDirectInnerMessageInput {
  senderAgentId?: string;
  receiverAgentId: string;
  eventType: string;
  title: string;
  content: string;
  payload?: Record<string, any>;
  source?: string;
  dedupKey?: string;
  maxAttempts?: number;
}

interface PublishTaskLifecycleEventInput {
  eventType: string;
  taskId: string;
  planId?: string;
  status?: string;
  senderAgentId?: string;
  payload?: Record<string, any>;
  title?: string;
  content?: string;
}

interface ListInnerMessagesInput {
  page?: number;
  pageSize?: number;
  mode?: 'direct' | 'subscription';
  status?: 'sent' | 'delivered' | 'processing' | 'processed' | 'failed';
  eventType?: string;
  source?: string;
  scheduleId?: string;
  messageId?: string;
}

interface ListInnerMessagesResult {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  items: Array<Record<string, any>>;
  fetchedAt?: string;
}

@Injectable()
export class AgentClientService {
  private readonly logger = new Logger(AgentClientService.name);
  private readonly baseUrl = process.env.AGENTS_SERVICE_URL || 'http://localhost:3002';
  private readonly contextSecret = process.env.INTERNAL_CONTEXT_SECRET || 'internal-context-secret';
  private readonly timeout = Number(process.env.AGENTS_CLIENT_TIMEOUT_MS || 20000);

  constructor(
    private readonly redisService: RedisService,
  ) {}

  private buildSignedHeaders(extra?: Record<string, string>): Record<string, string> {
    const now = Date.now();
    const context: GatewayUserContext = {
      employeeId: 'legacy-service',
      role: 'system',
      issuedAt: now,
      expiresAt: now + 60 * 1000,
    };

    const encoded = encodeUserContext(context);
    const signature = signEncodedContext(encoded, this.contextSecret);

    return {
      'x-user-context': encoded,
      'x-user-signature': signature,
      ...(extra || {}),
    };
  }

  async resolvePrompt(input: {
    scene: string;
    role: string;
    defaultContent: string;
  }): Promise<{ content: string; source: string; version?: number }> {
    try {
      const response = await axios.get(`${this.baseUrl}/api/prompt-registry/templates/effective`, {
        params: {
          scene: input.scene,
          role: input.role,
        },
        headers: this.buildSignedHeaders(),
        timeout: this.timeout,
      });

      const content = String(response.data?.content || '').trim();
      if (content) {
        return {
          content,
          source: String(response.data?.source || 'api'),
          version: typeof response.data?.version === 'number' ? response.data.version : undefined,
        };
      }

      return {
        content: input.defaultContent,
        source: 'code_default',
      };
    } catch (error) {
      this.logger.warn(
        `[prompt_resolve_http_failed] scene=${input.scene} role=${input.role} error=${error instanceof Error ? error.message : 'unknown'}`,
      );
      return {
        content: input.defaultContent,
        source: 'code_default',
      };
    }
  }

  async getAgent(agentId: string): Promise<Agent | null> {
    try {
      const response = await axios.get<Agent>(`${this.baseUrl}/api/agents/${agentId}`, {
        headers: this.buildSignedHeaders(),
        timeout: this.timeout,
      });
      return response.data;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to fetch agent ${agentId}: ${message}`);
      return null;
    }
  }

  async getAllAgents(): Promise<Agent[]> {
    const response = await axios.get<Agent[]>(`${this.baseUrl}/api/agents`, {
      headers: this.buildSignedHeaders(),
      timeout: this.timeout,
    });
    return response.data;
  }

  async getActiveAgents(): Promise<Agent[]> {
    const response = await axios.get<Agent[]>(`${this.baseUrl}/api/agents/active`, {
      headers: this.buildSignedHeaders(),
      timeout: this.timeout,
    });
    return response.data;
  }

  async getToolExecutions(agentId?: string, toolId?: string): Promise<ToolExecution[]> {
    const response = await axios.get<ToolExecution[]>(`${this.baseUrl}/api/tools/executions/history`, {
      params: {
        ...(agentId ? { agentId } : {}),
        ...(toolId ? { toolId } : {}),
      },
      headers: this.buildSignedHeaders(),
      timeout: Number(process.env.AGENTS_CLIENT_TIMEOUT_MS || 15000),
    });
    return response.data;
  }

  async createAgent(agentData: Omit<Agent, 'id' | 'createdAt' | 'updatedAt'>): Promise<Agent> {
    const response = await axios.post<Agent>(`${this.baseUrl}/api/agents`, agentData, {
      headers: this.buildSignedHeaders({ 'content-type': 'application/json' }),
      timeout: this.timeout,
    });
    return response.data;
  }

  async updateAgent(agentId: string, updates: Partial<Agent>): Promise<Agent | null> {
    try {
      const response = await axios.put<Agent>(`${this.baseUrl}/api/agents/${agentId}`, updates, {
        headers: this.buildSignedHeaders({ 'content-type': 'application/json' }),
        timeout: this.timeout,
      });
      return response.data;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to update agent ${agentId}: ${message}`);
      return null;
    }
  }

  async executeTaskDetailed(
    agentId: string,
    task: AgentExecutionTask,
    context?: any,
  ): Promise<{ response: string; runId?: string; sessionId?: string }> {
    const startedAt = Date.now();
    const requestId = randomUUID();
    const executionMode = this.resolveExecutionMode(context);
    const contextType = this.resolveContextType(context);
    const contextId = this.resolveContextId(context, task);
    const contextSessionId = this.resolveAgentSessionId(context);

    try {
      this.logger.log(
        `[agents_execute_request] requestId=${requestId} agentId=${agentId} taskId=${task.id || 'unknown'} contextType=${contextType} contextId=${contextId || 'none'} executionMode=${executionMode} sessionId=${contextSessionId || 'none'} title="${this.compactLogText(task.title)}"`,
      );
      const response = await axios.post<{ response: string; runId?: string; sessionId?: string }>(
        `${this.baseUrl}/api/agents/${agentId}/execute`,
        {
          task,
          context: {
            ...(context || {}),
            requestMeta: {
              requestId,
              source: 'legacy-agent-client',
            },
          },
        },
        {
          headers: this.buildSignedHeaders({
            'content-type': 'application/json',
            'x-request-id': requestId,
          }),
          timeout: Number(process.env.AGENTS_EXEC_TIMEOUT_MS || 120000),
        },
      );

      this.logger.log(
        `[agents_execute_response] requestId=${requestId} agentId=${agentId} taskId=${task.id || 'unknown'} status=success durationMs=${Date.now() - startedAt} runId=${response.data?.runId || 'none'} sessionId=${response.data?.sessionId || 'none'} responseLength=${(response.data?.response || '').length}`,
      );

      return {
        response: response.data?.response || '',
        runId: response.data?.runId,
        sessionId: response.data?.sessionId,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const axiosError = error as {
        response?: {
          status?: number;
          data?: any;
        };
      };
      const status = axiosError?.response?.status;
      const errorDetail = this.extractErrorDetail(axiosError?.response?.data);
      this.logger.error(
        `[agents_execute_failed] requestId=${requestId} agentId=${agentId} taskId=${task.id || 'unknown'} status=${status || 'unknown'} durationMs=${Date.now() - startedAt} error=${this.compactLogText(message)} detail="${errorDetail}"`,
      );
      throw error;
    }
  }

  private compactLogText(value: unknown, maxLength = 120): string {
    const normalized = String(value || '').replace(/\s+/g, ' ').trim();
    if (!normalized) return '';
    return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
  }

  private extractErrorDetail(payload: any): string {
    if (!payload) return 'none';
    if (typeof payload === 'string') {
      return this.compactLogText(payload, 300) || 'none';
    }
    if (typeof payload === 'object') {
      const message = payload.message;
      const error = payload.error;
      const code = payload.code || payload.errorCode;
      const parts = [
        code ? `code=${this.compactLogText(code, 80)}` : '',
        message
          ? `message=${Array.isArray(message)
            ? this.compactLogText(message.join('; '), 300)
            : this.compactLogText(message, 300)}`
          : '',
        error ? `error=${this.compactLogText(error, 120)}` : '',
      ].filter(Boolean);
      return parts.join(' ') || this.compactLogText(JSON.stringify(payload), 300) || 'none';
    }
    return this.compactLogText(payload, 300) || 'none';
  }

  async executeTask(agentId: string, task: AgentExecutionTask, context?: any): Promise<string> {
    const result = await this.executeTaskDetailed(agentId, task, context);
    return result.response;
  }

  async createAsyncAgentTask(input: {
    agentId: string;
    prompt: string;
    sessionContext?: Record<string, unknown>;
    idempotencyKey?: string;
  }): Promise<CreateAsyncAgentTaskResult> {
    const response = await axios.post<CreateAsyncAgentTaskResult>(
      `${this.baseUrl}/api/agents/tasks`,
      {
        agentId: input.agentId,
        task: input.prompt,
        sessionContext: input.sessionContext,
        idempotencyKey: input.idempotencyKey,
      },
      {
        headers: this.buildSignedHeaders({ 'content-type': 'application/json' }),
        timeout: Number(process.env.AGENTS_EXEC_TIMEOUT_MS || 120000),
      },
    );
    return response.data;
  }

  async getAsyncAgentTask(taskId: string): Promise<AsyncAgentTaskSnapshot> {
    const normalizedTaskId = String(taskId || '').trim();
    if (!normalizedTaskId) {
      throw new Error('taskId is required');
    }
    const response = await axios.get<AsyncAgentTaskSnapshot>(
      `${this.baseUrl}/api/agents/tasks/${encodeURIComponent(normalizedTaskId)}`,
      {
        headers: this.buildSignedHeaders(),
        timeout: Number(process.env.AGENTS_EXEC_TIMEOUT_MS || 120000),
      },
    );
    return response.data;
  }

  async waitForAsyncAgentTaskCompletionBySse(
    taskId: string,
    options?: { timeoutMs?: number; signal?: AbortSignal },
  ): Promise<AsyncAgentTaskCompletionResult> {
    const normalizedTaskId = String(taskId || '').trim();
    if (!normalizedTaskId) {
      throw new Error('taskId is required');
    }

    const timeoutMs = Math.max(1000, Number(options?.timeoutMs || process.env.AGENTS_EXEC_TIMEOUT_MS || 120000));
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
    const linkedSignal = options?.signal;
    const abortByLinkedSignal = () => controller.abort();
    if (linkedSignal) {
      if (linkedSignal.aborted) {
        clearTimeout(timeoutHandle);
        controller.abort();
      } else {
        linkedSignal.addEventListener('abort', abortByLinkedSignal, { once: true });
      }
    }

    try {
      const response = await axios.get<Readable>(
        `${this.baseUrl}/api/agents/tasks/${encodeURIComponent(normalizedTaskId)}/events`,
        {
          headers: this.buildSignedHeaders({ accept: 'text/event-stream' }),
          responseType: 'stream',
          timeout: 0,
          signal: controller.signal,
        },
      );

      return await this.consumeAsyncTaskSseStream(response.data, normalizedTaskId);
    } catch (error: any) {
      if (error?.code === 'ERR_CANCELED' || error?.name === 'CanceledError') {
        throw new Error(`Async agent task SSE wait timeout: ${normalizedTaskId}`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutHandle);
      if (linkedSignal) {
        linkedSignal.removeEventListener('abort', abortByLinkedSignal);
      }
    }
  }

  private async consumeAsyncTaskSseStream(
    stream: Readable,
    taskId: string,
  ): Promise<AsyncAgentTaskCompletionResult> {
    let buffer = '';
    let eventType = 'message';
    let dataLines: string[] = [];

    const resolveFromEvent = (payload: any, sseEventType: string): AsyncAgentTaskCompletionResult | null => {
      if (!payload || typeof payload !== 'object') {
        return null;
      }
      const event = (payload.data && typeof payload.data === 'object') ? payload.data : payload;
      const type = String(event.type || sseEventType || '').toLowerCase();
      const body = event.payload && typeof event.payload === 'object' ? event.payload : {};

      const status = String((body as any).status || '').toLowerCase();
      if (type === 'result' || status === 'succeeded') {
        return {
          status: 'succeeded',
          runId: typeof event.runId === 'string' ? event.runId : undefined,
          sessionId: typeof (body as any).sessionId === 'string' ? (body as any).sessionId : undefined,
          output: typeof (body as any).response === 'string' ? (body as any).response : undefined,
        };
      }
      if (type === 'error' || status === 'failed') {
        return {
          status: 'failed',
          runId: typeof event.runId === 'string' ? event.runId : undefined,
          error: typeof (body as any).error === 'string' ? (body as any).error : 'Async agent task failed',
        };
      }
      if (status === 'cancelled') {
        return {
          status: 'cancelled',
          runId: typeof event.runId === 'string' ? event.runId : undefined,
          error: typeof (body as any).error === 'string' ? (body as any).error : 'Async agent task cancelled',
        };
      }
      return null;
    };

    const flush = (): AsyncAgentTaskCompletionResult | null => {
      if (!dataLines.length) {
        eventType = 'message';
        return null;
      }
      const raw = dataLines.join('\n').trim();
      dataLines = [];
      const currentType = eventType;
      eventType = 'message';
      if (!raw || raw === '[DONE]') {
        return null;
      }
      try {
        const parsed = JSON.parse(raw);
        return resolveFromEvent(parsed, currentType);
      } catch {
        return null;
      }
    };

    try {
      for await (const chunk of stream) {
        buffer += chunk.toString('utf8');
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line) {
            const terminal = flush();
            if (terminal) {
              return terminal;
            }
            continue;
          }

          if (line.startsWith('event:')) {
            eventType = line.slice('event:'.length).trim() || 'message';
            continue;
          }
          if (line.startsWith('data:')) {
            dataLines.push(line.slice('data:'.length).trimStart());
          }
        }
      }
    } finally {
      if (typeof stream.destroy === 'function') {
        stream.destroy();
      }
    }

    throw new Error(`Async agent task SSE stream ended before terminal event: ${taskId}`);
  }

  private resolveContextType(context?: any): 'chat' | 'orchestration' {
    const collaborationContext = context?.collaborationContext;
    if (!collaborationContext) return 'chat';
    if (collaborationContext.planId) return 'orchestration';
    if (collaborationContext.taskId || collaborationContext.orchestrationTaskId || collaborationContext.taskKey) return 'orchestration';
    return 'chat';
  }

  private resolveContextId(context?: any, task?: AgentExecutionTask): string | undefined {
    const collaborationContext = context?.collaborationContext;
    if (collaborationContext?.meetingId) return collaborationContext.meetingId;
    if (collaborationContext?.planId) return collaborationContext.planId;
    if (collaborationContext?.taskId) return collaborationContext.taskId;
    if (collaborationContext?.orchestrationTaskId) return collaborationContext.orchestrationTaskId;
    if (collaborationContext?.taskKey) return collaborationContext.taskKey;
    if (task?.id) return task.id;
    const rawTask = task as { _id?: { toString?: () => string } } | undefined;
    return rawTask?._id?.toString ? rawTask._id.toString() : undefined;
  }

  private resolveExecutionMode(context?: any): AgentExecutionMode {
    const mode = String(context?.executionMode || '').toLowerCase();
    return mode === 'chat' ? 'chat' : 'task';
  }

  private resolveAgentSessionId(context?: any): string | undefined {
    const candidates = [
      context?.agentSessionId,
      context?.sessionId,
      context?.collaborationContext?.agentSessionId,
      context?.collaborationContext?.sessionId,
    ];
    for (const value of candidates) {
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
    return undefined;
  }

  async executeTool(
    toolId: string,
    agentId: string,
    parameters: any,
    taskId?: string,
    executionContext?: Record<string, unknown>,
  ): Promise<any> {
    const response = await axios.post<any>(
      `${this.baseUrl}/api/tools/${toolId}/execute`,
      { agentId, parameters, taskId, executionContext },
      {
        headers: this.buildSignedHeaders({ 'content-type': 'application/json' }),
        timeout: Number(process.env.AGENTS_EXEC_TIMEOUT_MS || 120000),
      },
    );
    return response.data;
  }

  async executeToolQuery(
    toolId: string,
    agentId: string,
    parameters: any,
    options?: {
      context?: any;
      source?: string;
    },
  ): Promise<any> {
    const context = options?.context;
    const source = options?.source || 'chat_query';
    return this.executeTool(
      toolId,
      agentId,
      parameters,
      context?.collaborationContext?.taskId,
      {
        ...(context || {}),
        source,
        executionMode: 'chat',
      },
    );
  }

  async publishInnerMessage(input: PublishInnerMessageInput): Promise<any> {
    const response = await axios.post(
      `${this.baseUrl}/api/inner-messages/publish`,
      input,
      {
        headers: this.buildSignedHeaders({ 'content-type': 'application/json' }),
        timeout: this.timeout,
      },
    );
    return response.data;
  }

  async sendDirectInnerMessage(input: SendDirectInnerMessageInput): Promise<{ messageId: string; accepted: boolean }> {
    const response = await axios.post(
      `${this.baseUrl}/api/inner-messages/direct`,
      input,
      {
        headers: this.buildSignedHeaders({ 'content-type': 'application/json' }),
        timeout: this.timeout,
      },
    );

    const data = response.data?.data || {};
    const messageId = String(data.messageId || data.id || '').trim();
    return {
      messageId,
      accepted: Boolean(response.data?.success && messageId),
    };
  }

  async publishTaskLifecycleEvent(input: PublishTaskLifecycleEventInput): Promise<any> {
    const response = await axios.post(
      `${this.baseUrl}/api/inner-messages/publish`,
      {
        senderAgentId: input.senderAgentId || 'orchestration-system',
        eventType: input.eventType,
        title: input.title || `Task Event: ${input.eventType}`,
        content: input.content || `Task ${input.taskId} emitted event ${input.eventType}`,
        payload: {
          taskId: input.taskId,
          planId: input.planId,
          status: input.status,
          ...(input.payload || {}),
        },
        source: 'orchestration',
        dedupKey: `${input.eventType}:${input.taskId}:${input.status || 'na'}`,
      },
      {
        headers: this.buildSignedHeaders({ 'content-type': 'application/json' }),
        timeout: this.timeout,
      },
    );

    return response.data;
  }

  async listInnerMessages(input: ListInnerMessagesInput): Promise<ListInnerMessagesResult> {
    const response = await axios.get(`${this.baseUrl}/api/message-center/inner-messages`, {
      headers: this.buildSignedHeaders(),
      timeout: this.timeout,
      params: {
        ...(input.page ? { page: input.page } : {}),
        ...(input.pageSize ? { pageSize: input.pageSize } : {}),
        ...(input.mode ? { mode: input.mode } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(input.eventType ? { eventType: input.eventType } : {}),
        ...(input.source ? { source: input.source } : {}),
        ...(input.scheduleId ? { scheduleId: input.scheduleId } : {}),
        ...(input.messageId ? { messageId: input.messageId } : {}),
      },
    });

    const data = response.data?.data || {};
    return {
      total: Number(data.total || 0),
      page: Number(data.page || 1),
      pageSize: Number(data.pageSize || 20),
      totalPages: Number(data.totalPages || 0),
      items: Array.isArray(data.items) ? data.items : [],
      fetchedAt: data.fetchedAt,
    };
  }

  async testAgentConnection(
    agentId: string,
    body?: { model?: AIModel; apiKeyId?: string },
  ): Promise<any> {
    const response = await axios.post<any>(`${this.baseUrl}/api/agents/${agentId}/test`, body || {}, {
      headers: this.buildSignedHeaders({ 'content-type': 'application/json' }),
      timeout: this.timeout,
    });
    return response.data;
  }

  async getAgentMemoSnapshot(agentId: string): Promise<AgentMemoSnapshot | null> {
    const normalizedAgentId = String(agentId || '').trim();
    if (!normalizedAgentId) return null;

    const fetchByKind = async (memoKind: 'identity' | 'todo' | 'topic') => {
      const response = await axios.get<{ items?: any[] }>(`${this.baseUrl}/api/memos`, {
        headers: this.buildSignedHeaders(),
        timeout: this.timeout,
        params: {
          agentId: normalizedAgentId,
          memoKind,
          page: 1,
          pageSize: memoKind === 'topic' ? 5 : 2,
        },
      });
      const rows = Array.isArray(response.data?.items) ? response.data.items : [];
      return rows.map((item) => ({
        id: String(item?.id || ''),
        memoKind,
        title: String(item?.title || ''),
        slug: item?.slug ? String(item.slug) : undefined,
        content: String(item?.content || '').slice(0, 3000),
        updatedAt: item?.updatedAt ? String(item.updatedAt) : undefined,
      })) as AgentMemoSnapshotItem[];
    };

    try {
      const [identity, todo, topic] = await Promise.all([
        fetchByKind('identity'),
        fetchByKind('todo'),
        fetchByKind('topic'),
      ]);
      return {
        agentId: normalizedAgentId,
        refreshedAt: new Date().toISOString(),
        identity,
        todo,
        topic,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Failed to fetch memo snapshot for agent ${normalizedAgentId}: ${message}`);
      return null;
    }
  }

  async flushMemoEvents(agentId?: string): Promise<{ agents: number; events: number; topics: number } | null> {
    try {
      const response = await axios.post<{ agents: number; events: number; topics: number }>(
        `${this.baseUrl}/api/memos/events/flush`,
        agentId ? { agentId } : {},
        {
          headers: this.buildSignedHeaders({ 'content-type': 'application/json' }),
          timeout: this.timeout,
        },
      );
      return response.data;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Failed to flush memo events: ${message}`);
      return null;
    }
  }

  async triggerMemoFullAggregation(): Promise<{ success: boolean; type: string } | null> {
    try {
      const response = await axios.post<{ success: boolean; type: string }>(
        `${this.baseUrl}/api/memos/aggregation/full`,
        {},
        {
          headers: this.buildSignedHeaders({ 'content-type': 'application/json' }),
          timeout: Number(process.env.AGENTS_EXEC_TIMEOUT_MS || 120000),
        },
      );
      return response.data;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Failed to trigger full memo aggregation: ${message}`);
      return null;
    }
  }

  async enqueueMemoAggregationCommand(options: {
    commandType: MemoAggregationCommandType;
    scheduleId?: string;
    taskId?: string;
    agentId?: string;
    triggeredBy?: string;
    maxAttempts?: number;
  }): Promise<{ accepted: boolean; queued: boolean; requestId: string }> {
    const command: MemoAggregationCommandMessage = {
      requestId: randomUUID(),
      commandType: options.commandType,
      scheduleId: options.scheduleId,
      taskId: options.taskId,
      agentId: options.agentId,
      triggeredBy: options.triggeredBy || 'scheduler',
      requestedAt: new Date().toISOString(),
      attempt: 1,
      maxAttempts: Math.max(1, Number(options.maxAttempts || process.env.MEMO_AGGREGATION_MAX_ATTEMPTS || 3)),
    };

    const queued = await this.redisService.lpush(MEMO_AGGREGATION_COMMAND_QUEUE_KEY, JSON.stringify(command));
    if (!queued) {
      this.logger.warn(`Failed to enqueue memo aggregation command ${command.requestId}: redis unavailable`);
      return { accepted: false, queued: false, requestId: command.requestId };
    }

    return { accepted: true, queued: true, requestId: command.requestId };
  }

  async getSession(sessionId: string): Promise<any> {
    try {
      const response = await axios.get(`${this.baseUrl}/api/agents/runtime/sessions/${sessionId}`, {
        headers: this.buildSignedHeaders(),
        timeout: this.timeout,
      });
      return response.data;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Failed to get session ${sessionId}: ${message}`);
      return null;
    }
  }

  async createSession(input: {
    sessionId?: string;
    ownerType?: 'agent' | 'employee' | 'system';
    ownerId: string;
    title: string;
    planContext?: Record<string, unknown>;
    meetingContext?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }): Promise<any> {
    try {
      const response = await axios.post(`${this.baseUrl}/api/agents/runtime/sessions`, input, {
        headers: this.buildSignedHeaders({ 'content-type': 'application/json' }),
        timeout: this.timeout,
      });
      return response.data;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Failed to create session: ${message}`);
      return null;
    }
  }

  async appendSessionMessage(
    sessionId: string,
    message: {
      role: 'system' | 'user' | 'assistant' | 'tool';
      content: string;
      status?: 'pending' | 'streaming' | 'completed' | 'error';
      metadata?: Record<string, unknown>;
    },
  ): Promise<any> {
    try {
      const response = await axios.post(`${this.baseUrl}/api/agents/runtime/sessions/${sessionId}/messages`, message, {
        headers: this.buildSignedHeaders({ 'content-type': 'application/json' }),
        timeout: this.timeout,
      });
      return response.data;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Failed to append message to session ${sessionId}: ${message}`);
      return null;
    }
  }

  async archiveSession(sessionId: string, summary?: string): Promise<any> {
    try {
      const response = await axios.post(
        `${this.baseUrl}/api/agents/runtime/sessions/${sessionId}/archive`,
        { summary },
        {
          headers: this.buildSignedHeaders({ 'content-type': 'application/json' }),
          timeout: this.timeout,
        },
      );
      return response.data;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Failed to archive session ${sessionId}: ${message}`);
      return null;
    }
  }

  async resumeSession(sessionId: string): Promise<any> {
    try {
      const response = await axios.post(`${this.baseUrl}/api/agents/runtime/sessions/${sessionId}/resume`, {}, {
        headers: this.buildSignedHeaders({ 'content-type': 'application/json' }),
        timeout: this.timeout,
      });
      return response.data;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Failed to resume session ${sessionId}: ${message}`);
      return null;
    }
  }

  async getOrCreateMeetingSession(
    meetingId: string,
    agentId: string,
    title: string,
    meetingContext?: {
      meetingId: string;
      agendaId?: string;
      meetingType?: string;
      latestSummary?: string;
    },
  ): Promise<any> {
    try {
      const response = await axios.post(
        `${this.baseUrl}/api/agents/runtime/sessions/meeting`,
        { meetingId, agentId, title, meetingContext },
        {
          headers: this.buildSignedHeaders({ 'content-type': 'application/json' }),
          timeout: this.timeout,
        },
      );
      return response.data;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Failed to get/create meeting session: ${message}`);
      return null;
    }
  }

  async getOrCreateTaskSession(
    taskId: string,
    agentId: string,
    title: string,
    planContext?: {
      linkedPlanId?: string;
      linkedTaskId?: string;
      latestTaskInput?: string;
      latestTaskOutput?: string;
      lastRunId?: string;
    },
  ): Promise<any> {
    try {
      const response = await axios.post(
        `${this.baseUrl}/api/agents/runtime/sessions/task`,
        { taskId, agentId, title, planContext },
        {
          headers: this.buildSignedHeaders({ 'content-type': 'application/json' }),
          timeout: this.timeout,
        },
      );
      return response.data;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Failed to get/create task session: ${message}`);
      return null;
    }
  }

  async getOrCreatePlanSession(
    planId: string,
    agentId: string,
    title: string,
    options?: {
      currentTaskId?: string;
      orchestrationRunId?: string;
      domainContext?: {
        domainType?: string;
        description?: string;
        constraints?: string[];
        knowledgeRefs?: string[];
        metadata?: Record<string, unknown>;
      };
      collaborationContext?: Record<string, unknown>;
    },
  ): Promise<any> {
    try {
      const response = await axios.post(
        `${this.baseUrl}/api/agents/runtime/sessions/plan`,
        { planId, agentId, title, ...options },
        {
          headers: this.buildSignedHeaders({ 'content-type': 'application/json' }),
          timeout: this.timeout,
        },
      );
      return response.data;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Failed to get/create plan session: ${message}`);
      return null;
    }
  }
}
