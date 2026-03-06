import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { encodeUserContext, signEncodedContext } from '@libs/auth';
import { GatewayUserContext } from '@libs/contracts';
import { Agent, Task, AIModel } from '../../shared/types';
import { AgentActionLogService } from '../agent-action-logs/agent-action-log.service';
import { AgentActionContextType } from '../../shared/schemas/agent-action-log.schema';

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

@Injectable()
export class AgentClientService {
  private readonly logger = new Logger(AgentClientService.name);
  private readonly baseUrl = process.env.AGENTS_SERVICE_URL || 'http://localhost:3002';
  private readonly contextSecret = process.env.INTERNAL_CONTEXT_SECRET || 'internal-context-secret';
  private readonly timeout = Number(process.env.AGENTS_CLIENT_TIMEOUT_MS || 20000);

  constructor(private readonly agentActionLogService: AgentActionLogService) {}

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
    task: Task,
    context?: any,
  ): Promise<{ response: string; runId?: string; sessionId?: string }> {
    const startedAt = Date.now();
    const contextType = this.resolveContextType(context);
    const contextId = this.resolveContextId(context, task);
    const actionLabel = this.buildActionLabel(task, contextType);
    await this.agentActionLogService.record({
      agentId,
      contextType,
      contextId,
      action: actionLabel,
      status: 'started',
      details: {
        taskId: task.id,
        taskTitle: task.title,
        taskType: task.type,
      },
    });

    try {
      const response = await axios.post<{ response: string; runId?: string; sessionId?: string }>(
        `${this.baseUrl}/api/agents/${agentId}/execute`,
        { task, context },
        {
          headers: this.buildSignedHeaders({ 'content-type': 'application/json' }),
          timeout: Number(process.env.AGENTS_EXEC_TIMEOUT_MS || 120000),
        },
      );

      await this.agentActionLogService.record({
        agentId,
        contextType,
        contextId,
        action: actionLabel,
        status: 'completed',
        durationMs: Date.now() - startedAt,
        details: {
          taskId: task.id,
          taskTitle: task.title,
          taskType: task.type,
          runId: response.data?.runId,
          sessionId: response.data?.sessionId,
        },
      });
      return {
        response: response.data?.response || '',
        runId: response.data?.runId,
        sessionId: response.data?.sessionId,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await this.agentActionLogService.record({
        agentId,
        contextType,
        contextId,
        action: actionLabel,
        status: 'failed',
        durationMs: Date.now() - startedAt,
        details: {
          taskId: task.id,
          taskTitle: task.title,
          taskType: task.type,
          error: message,
        },
      });
      throw error;
    }
  }

  async executeTask(agentId: string, task: Task, context?: any): Promise<string> {
    const result = await this.executeTaskDetailed(agentId, task, context);
    return result.response;
  }

  private resolveContextType(context?: any): AgentActionContextType {
    const teamContext = context?.teamContext;
    if (!teamContext) return 'unknown';
    if (teamContext.meetingId) return 'meeting';
    if (teamContext.discussionId) return 'meeting';
    if (teamContext.planId) return 'plan';
    if (teamContext.taskId || teamContext.orchestrationTaskId) return 'task';
    if (teamContext.taskKey) return 'task';
    return 'unknown';
  }

  private resolveContextId(context?: any, task?: Task): string | undefined {
    const teamContext = context?.teamContext;
    if (teamContext?.meetingId) return teamContext.meetingId;
    if (teamContext?.discussionId) return teamContext.discussionId;
    if (teamContext?.planId) return teamContext.planId;
    if (teamContext?.taskId) return teamContext.taskId;
    if (teamContext?.orchestrationTaskId) return teamContext.orchestrationTaskId;
    if (teamContext?.taskKey) return teamContext.taskKey;
    if (task?.id) return task.id;
    const rawTask = task as { _id?: { toString?: () => string } } | undefined;
    return rawTask?._id?.toString ? rawTask._id.toString() : undefined;
  }

  private buildActionLabel(task: Task, contextType: AgentActionContextType): string {
    const taskType = task?.type ? task.type : 'task';
    return `${contextType}:${taskType}`;
  }

  async executeTool(toolId: string, agentId: string, parameters: any, taskId?: string): Promise<any> {
    const response = await axios.post<any>(
      `${this.baseUrl}/api/tools/${toolId}/execute`,
      { agentId, parameters, taskId },
      {
        headers: this.buildSignedHeaders({ 'content-type': 'application/json' }),
        timeout: Number(process.env.AGENTS_EXEC_TIMEOUT_MS || 120000),
      },
    );
    return response.data;
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
}
