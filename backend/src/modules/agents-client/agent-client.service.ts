import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { encodeUserContext, signEncodedContext } from '@libs/auth';
import { GatewayUserContext } from '@libs/contracts';
import { Agent, Task, AIModel } from '../../shared/types';

@Injectable()
export class AgentClientService {
  private readonly logger = new Logger(AgentClientService.name);
  private readonly baseUrl = process.env.AGENTS_SERVICE_URL || 'http://localhost:3002';
  private readonly contextSecret = process.env.INTERNAL_CONTEXT_SECRET || 'internal-context-secret';
  private readonly timeout = Number(process.env.AGENTS_CLIENT_TIMEOUT_MS || 20000);

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

  async executeTask(agentId: string, task: Task, context?: any): Promise<string> {
    const response = await axios.post<{ response: string }>(
      `${this.baseUrl}/api/agents/${agentId}/execute`,
      { task, context },
      {
        headers: this.buildSignedHeaders({ 'content-type': 'application/json' }),
        timeout: Number(process.env.AGENTS_EXEC_TIMEOUT_MS || 120000),
      },
    );
    return response.data?.response || '';
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
}
