import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { GatewayUserContext } from '@libs/contracts';
import { encodeUserContext, signEncodedContext } from '@libs/auth';

@Injectable()
export class InternalApiClient {
  private readonly logger = new Logger(InternalApiClient.name);
  private readonly orchestrationBaseUrl = process.env.LEGACY_SERVICE_URL || 'http://localhost:3001/api';
  private readonly backendBaseUrl = process.env.LEGACY_SERVICE_URL || 'http://localhost:3001/api';
  private readonly agentsBaseUrl = process.env.AGENTS_SERVICE_URL || 'http://localhost:3002/api';
  private readonly engineeringIntelligenceBaseUrl =
    process.env.ENGINEERING_INTELLIGENCE_SERVICE_URL || 'http://localhost:3004/api';
  private readonly contextSecret = String(process.env.INTERNAL_CONTEXT_SECRET || '').trim();

  constructor() {
    if (!this.contextSecret) {
      throw new Error('INTERNAL_CONTEXT_SECRET is required');
    }
  }

  buildSignedHeaders(context?: { actorId?: string; actorRole?: string; originSessionId?: string }): Record<string, string> {
    const now = Date.now();
    const actorId = String(context?.actorId || 'agents-service').trim() || 'agents-service';
    const actorRole = String(context?.actorRole || 'system').trim() || 'system';
    const originSessionId = String(context?.originSessionId || '').trim();
    const userContext: GatewayUserContext = {
      employeeId: actorId,
      role: actorRole,
      issuedAt: now,
      expiresAt: now + 60 * 1000,
    };
    const encoded = encodeUserContext(userContext);
    const signature = signEncodedContext(encoded, this.contextSecret);
    return {
      'x-user-context': encoded,
      'x-user-signature': signature,
      'x-actor-id': actorId,
      'x-actor-role': actorRole,
      ...(originSessionId ? { 'x-origin-session-id': originSessionId } : {}),
      'content-type': 'application/json',
    };
  }

  async callOrchestrationApi(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH',
    endpoint: string,
    body?: any,
  ): Promise<any> {
    return this.callApi({
      system: 'Orchestration',
      errorCode: 'orchestration_api_request_failed',
      method,
      endpoint,
      url: `${this.orchestrationBaseUrl}/orchestration${endpoint}`,
      body,
    });
  }

  async callEiApi(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH',
    endpoint: string,
    body?: any,
  ): Promise<any> {
    const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    return this.callApi({
      system: 'EI',
      errorCode: 'ei_api_request_failed',
      method,
      endpoint: normalizedEndpoint,
      url: `${this.engineeringIntelligenceBaseUrl}/engineering-intelligence${normalizedEndpoint}`,
      body,
    });
  }

  async callMeetingApi(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    endpoint: string,
    body?: any,
  ): Promise<any> {
    return this.callApi({
      system: 'Meeting',
      errorCode: 'meeting_api_request_failed',
      method,
      endpoint,
      url: `${this.backendBaseUrl}/meetings${endpoint}`,
      body,
    });
  }

  async callAgentsApi(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    endpoint: string,
    body?: any,
  ): Promise<any> {
    return this.callApi({
      system: 'Agents',
      errorCode: 'agents_api_request_failed',
      method,
      endpoint,
      url: `${this.agentsBaseUrl}${endpoint}`,
      body,
    });
  }

  async postEngineeringStatistics(payload: Record<string, unknown>): Promise<any> {
    const response = await axios.post(
      `${this.engineeringIntelligenceBaseUrl}/engineering-intelligence/statistics/snapshots`,
      payload,
      {
        headers: this.buildSignedHeaders(),
        timeout: Number(process.env.AGENTS_EXEC_TIMEOUT_MS || 120000),
      },
    );
    return response.data;
  }

  private async callApi(args: {
    system: string;
    errorCode: string;
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    endpoint: string;
    url: string;
    body?: any;
  }): Promise<any> {
    try {
      const response = await axios.request({
        method: args.method,
        url: args.url,
        headers: this.buildSignedHeaders(),
        data: args.body,
        timeout: Number(process.env.AGENTS_EXEC_TIMEOUT_MS || 120000),
      });
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const statusText = error.response?.statusText;
        const responseSummary = this.summarizeApiErrorBody(error.response?.data);
        this.logger.error(
          `${args.system} API request failed: ${args.method} ${args.endpoint}, status=${status || 'unknown'}${
            statusText ? ` ${statusText}` : ''
          }, response=${responseSummary}`,
        );
        throw new Error(
          `${args.errorCode}: ${args.method} ${args.endpoint} returned ${status || 'unknown'}; response=${responseSummary}`,
        );
      }
      throw error;
    }
  }

  private summarizeApiErrorBody(body: unknown): string {
    if (body === undefined || body === null) {
      return 'empty';
    }
    const maxLen = 800;
    let text: string;
    if (typeof body === 'string') {
      text = body;
    } else {
      try {
        text = JSON.stringify(body);
      } catch {
        text = String(body);
      }
    }
    return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text;
  }
}
