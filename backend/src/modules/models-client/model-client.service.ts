import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { encodeUserContext, signEncodedContext } from '@libs/auth';
import { GatewayUserContext } from '@libs/contracts';
import { AIModel } from '../../shared/types';

export interface FounderModelSelection {
  ceo: AIModel | null;
  cto: AIModel | null;
}

@Injectable()
export class ModelClientService {
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

  async getFounderModels(): Promise<FounderModelSelection> {
    const response = await axios.get<FounderModelSelection>(`${this.baseUrl}/api/model-management/founder-models`, {
      headers: this.buildSignedHeaders(),
      timeout: Number(process.env.AGENTS_CLIENT_TIMEOUT_MS || 15000),
    });
    return response.data;
  }
}
