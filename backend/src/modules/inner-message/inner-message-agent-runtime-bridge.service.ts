import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model } from 'mongoose';
import { randomUUID } from 'crypto';
import { AgentClientService } from '../agents-client/agent-client.service';
import { Agent, AgentDocument } from '../../shared/schemas/agent.schema';
import { InnerMessage } from '../../shared/schemas/inner-message.schema';
import { InnerMessageService } from './inner-message.service';

@Injectable()
export class InnerMessageAgentRuntimeBridgeService {
  private readonly logger = new Logger(InnerMessageAgentRuntimeBridgeService.name);

  constructor(
    private readonly agentClientService: AgentClientService,
    private readonly innerMessageService: InnerMessageService,
    @InjectModel(Agent.name)
    private readonly agentModel: Model<AgentDocument>,
  ) {}

  async processMessage(message: InnerMessage): Promise<void> {
    const receiverAgentId = String(message?.receiverAgentId || '').trim();
    const messageId = String(message?.messageId || '').trim();
    if (!receiverAgentId || !messageId) {
      return;
    }

    const agent = await this.resolveActiveAgent(receiverAgentId);
    if (!agent) {
      return;
    }

    await this.innerMessageService.acknowledgeMessage(messageId, receiverAgentId, 'processing').catch(() => undefined);

    const payload = this.normalizePayload(message?.payload);
    const prompt = this.buildPrompt(message, payload);

    try {
      const result = await this.agentClientService.executeTaskDetailed(
        receiverAgentId,
        {
          id: `inner-message:${messageId}`,
          title: `处理内部消息 ${message?.eventType || 'inner.direct'}`,
          description: prompt,
          type: 'internal_message',
          priority: 'medium',
          status: 'pending',
          assignedAgents: [receiverAgentId],
          teamId: 'inner-message',
          messages: [
            {
              role: 'user',
              content: prompt,
              timestamp: new Date(),
            },
          ],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          teamContext: {
            ...(this.resolveTeamContext(payload) || {}),
          },
          sessionContext: {
            runtimeTaskType: 'internal_message',
            runtimeChannelHint: 'native',
            innerMessage: {
              messageId,
              eventType: String(message?.eventType || '').trim() || 'inner.direct',
              mode: String(message?.mode || '').trim() || 'direct',
              senderAgentId: String(message?.senderAgentId || '').trim() || 'system',
              receiverAgentId,
              payload,
            },
          },
          requestMeta: {
            requestId: `inner-msg-${randomUUID()}`,
            source: 'inner-message-runtime-bridge',
          },
        },
      );

      await this.innerMessageService.markMessageProcessed(messageId, receiverAgentId, {
        handled: true,
        by: 'agent-runtime-bridge',
        runId: result.runId,
        sessionId: result.sessionId,
        responsePreview: String(result.response || '').slice(0, 500),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Agent runtime bridge failed for message ${messageId}: ${reason}`);
      throw error;
    }
  }

  private async resolveActiveAgent(receiverAgentId: string): Promise<AgentDocument | null> {
    const normalized = String(receiverAgentId || '').trim();
    if (!normalized) {
      return null;
    }

    const query = isValidObjectId(normalized)
      ? { isActive: true, $or: [{ _id: normalized }, { id: normalized }] }
      : { isActive: true, id: normalized };

    return this.agentModel.findOne(query).exec();
  }

  private normalizePayload(payload: unknown): Record<string, unknown> {
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      return payload as Record<string, unknown>;
    }
    return {};
  }

  private resolveTeamContext(payload: Record<string, unknown>): Record<string, unknown> | null {
    const meetingId = String(payload.meetingId || '').trim();
    if (meetingId) {
      return { meetingId };
    }
    return null;
  }

  private buildPrompt(message: InnerMessage, payload: Record<string, unknown>): string {
    const eventType = String(message?.eventType || '').trim() || 'inner.direct';
    const senderAgentId = String(message?.senderAgentId || '').trim() || 'system';
    const title = String(message?.title || '').trim();
    const content = String(message?.content || '').trim();

    const payloadJson = Object.keys(payload).length ? JSON.stringify(payload, null, 2) : '{}';

    return [
      '你收到一条内部协作消息，请基于你的身份、能力与已授权工具自主完成处理。',
      '请先思考再行动，并在必要时调用工具执行。',
      '',
      `messageId: ${String(message?.messageId || '').trim()}`,
      `mode: ${String(message?.mode || '').trim() || 'direct'}`,
      `eventType: ${eventType}`,
      `senderAgentId: ${senderAgentId}`,
      `title: ${title}`,
      `content: ${content}`,
      'payload:',
      payloadJson,
      '',
      '要求：',
      '1) 若消息需要业务动作，直接调用相关工具完成。',
      '2) 若信息不足，先做最小可行响应并指出缺失信息。',
      '3) 输出简洁处理结果。',
    ].join('\n');
  }
}
