import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { encodeUserContext, signEncodedContext } from '@libs/auth';
import { GatewayUserContext } from '@libs/contracts';
import { unwrapResponseEnvelope } from '../../../shared/common/utils/unwrap-response-envelope';

type CreateRequirementFromDiscussionInput = {
  title: string;
  description?: string;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  projectId?: string;
  createdById?: string;
  createdByName?: string;
  source: {
    spaceId: string;
    spaceTitle: string;
    threadId: string;
    threadTitle: string;
    messageId: string;
    messagePreview: string;
  };
};

@Injectable()
export class DiscussionRequirementBridgeService {
  private readonly baseUrl = process.env.ENGINEERING_INTELLIGENCE_SERVICE_URL || 'http://localhost:3004';
  private readonly contextSecret = process.env.INTERNAL_CONTEXT_SECRET || 'internal-context-secret';
  private readonly timeout = Number(process.env.ENGINEERING_INTELLIGENCE_CLIENT_TIMEOUT_MS || 20000);

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
      'content-type': 'application/json',
    };
  }

  async createRequirementFromDiscussion(input: CreateRequirementFromDiscussionInput): Promise<{ requirementId: string; title: string }> {
    const projectId = String(input.projectId || '').trim();
    const payload = {
      title: String(input.title || '').trim(),
      description: String(input.description || '').trim(),
      priority: input.priority || 'medium',
      category: 'feature',
      complexity: 'low',
      createdById: input.createdById ? String(input.createdById).trim() : undefined,
      createdByName: input.createdByName ? String(input.createdByName).trim() : undefined,
      createdByType: 'human' as const,
      projectId: projectId || undefined,
      localProjectId: projectId || undefined,
      discussionSource: {
        spaceId: input.source.spaceId,
        spaceTitle: input.source.spaceTitle,
        threadId: input.source.threadId,
        threadTitle: input.source.threadTitle,
        messageId: input.source.messageId,
        messagePreview: input.source.messagePreview,
      },
    };

    const response = await axios.post(
      `${this.baseUrl}/api/ei/requirements`,
      payload,
      {
        headers: this.buildSignedHeaders(),
        timeout: this.timeout,
      },
    );
    const result = unwrapResponseEnvelope<{ requirementId: string; title: string }>(response.data);
    return {
      requirementId: String(result.requirementId || ''),
      title: String(result.title || payload.title),
    };
  }
}
