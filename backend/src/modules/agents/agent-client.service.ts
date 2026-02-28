import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { encodeUserContext, signEncodedContext } from '@libs/auth';
import { GatewayUserContext } from '@libs/contracts';
import { Agent } from '../../shared/types';

@Injectable()
export class AgentClientService {
  private readonly logger = new Logger(AgentClientService.name);
  private readonly baseUrl = process.env.AGENTS_SERVICE_URL || 'http://localhost:3002';
  private readonly contextSecret = process.env.INTERNAL_CONTEXT_SECRET || 'internal-context-secret';

  private buildSignedHeaders(): Record<string, string> {
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
    };
  }

  async getAgent(agentId: string): Promise<Agent | null> {
    try {
      const response = await axios.get<Agent>(`${this.baseUrl}/api/agents/${agentId}`, {
        headers: this.buildSignedHeaders(),
        timeout: Number(process.env.AGENTS_CLIENT_TIMEOUT_MS || 15000),
      });
      return response.data;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to fetch agent ${agentId}: ${message}`);
      return null;
    }
  }

  async createAgent(agentData: Omit<Agent, 'id' | 'createdAt' | 'updatedAt'>): Promise<Agent> {
    const response = await axios.post<Agent>(`${this.baseUrl}/api/agents`, agentData, {
      headers: {
        ...this.buildSignedHeaders(),
        'content-type': 'application/json',
      },
      timeout: Number(process.env.AGENTS_CLIENT_TIMEOUT_MS || 15000),
    });
    return response.data;
  }
}
