import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model } from 'mongoose';
import { randomUUID } from 'crypto';
import { CollaborationContextFactory } from '@libs/contracts';
import { CHANNEL_OUTBOUND_FEISHU_CHANNEL, RedisService } from '@libs/infra';
import { Agent, AgentDocument } from '@agent/schemas/agent.schema';
import { InnerMessage } from '@agents/schemas/inner-message.schema';
import { InnerMessageService } from './inner-message.service';
import { AgentService } from '../agents/agent.service';

@Injectable()
export class InnerMessageAgentRuntimeBridgeService {
  private readonly logger = new Logger(InnerMessageAgentRuntimeBridgeService.name);

  constructor(
    private readonly agentService: AgentService,
    private readonly innerMessageService: InnerMessageService,
    private readonly redisService: RedisService,
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
    const eventType = String(message?.eventType || '').trim() || 'inner.direct';
    const isScheduleMessage = eventType.startsWith('schedule.');

    try {
      const result = await this.agentService.executeTaskDetailed(
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
          collaborationContext: CollaborationContextFactory.innerMessage({
            messageId,
            eventType,
            senderAgentId: String(message?.senderAgentId || '').trim() || 'system',
            triggerSource: 'inner-message-runtime-bridge',
            meetingId: String(payload.meetingId || '').trim() || undefined,
            planId: String(payload.planId || '').trim() || undefined,
            scheduleId: String(payload.scheduleId || '').trim() || undefined,
            runtimeTaskType: isScheduleMessage ? 'scheduled_task' : 'internal_message',
            requireJsonResponse: true,
          }),
          sessionContext: {
            runtimeTaskType: isScheduleMessage ? 'scheduled_task' : 'internal_message',
            runtimeChannelHint: 'native',
            innerMessage: {
              messageId,
              eventType,
              mode: String(message?.mode || '').trim() || 'direct',
              senderAgentId: String(message?.senderAgentId || '').trim() || 'system',
              receiverAgentId,
              payload,
            },
            ...(isScheduleMessage
              ? {
                  scheduleContext: {
                    scheduleId: payload.scheduleId,
                    scheduleName: payload.scheduleName,
                    triggerType: payload.triggerType,
                  },
                }
              : {}),
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

      await this.publishChannelOutboundMessage({
        payload,
        responseText: String(result.response || '').trim(),
        receiverAgentId,
        runId: String(result.runId || '').trim() || undefined,
        sessionId: String(result.sessionId || '').trim() || undefined,
        eventType,
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

  private buildPrompt(message: InnerMessage, payload: Record<string, unknown>): string {
    const eventType = String(message?.eventType || '').trim() || 'inner.direct';
    if (eventType.startsWith('schedule.')) {
      return String(message?.content || '').trim() || this.buildDefaultSchedulePrompt(payload);
    }

    const senderAgentId = String(message?.senderAgentId || '').trim() || 'system';
    const title = String(message?.title || '').trim();
    const content = String(message?.content || '').trim();
    const isMeetingEndedEvent = eventType === 'meeting.ended';

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
      'payload:' + payloadJson,
      '',
      '要求：',
      '1) 若消息需要业务动作，直接调用相关工具完成。',
      '2) 收到消息需要第一时间回复（以内部消息方式）。',
      '2) meeting.ended 场景需要完成“读取会议详情 + 写入会议总结”的完整闭环。',
      '3) 若信息不足，先做最小可行响应并指出缺失信息。',
      '4) 。',
    ].join('\n');
  }

  private buildDefaultSchedulePrompt(payload: Record<string, unknown>): string {
    const scheduleName = String(payload.scheduleName || '').trim();
    const prompt = String(payload.prompt || '').trim();
    return [
      `你收到一条定时任务消息${scheduleName ? `（${scheduleName}）` : ''}。`,
      prompt || '请根据你的身份和能力自主完成此任务。',
      '',
      Object.keys(payload).length > 0 ? `参数: ${JSON.stringify(payload, null, 2)}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  private async publishChannelOutboundMessage(input: {
    payload: Record<string, unknown>;
    responseText: string;
    receiverAgentId: string;
    runId?: string;
    sessionId?: string;
    eventType: string;
  }): Promise<void> {
    const channelSource = String(input.payload.channelSource || '').trim().toLowerCase();
    if (channelSource !== 'feishu') {
      return;
    }

    const chatId = String(input.payload.channelChatId || '').trim();
    if (!chatId) {
      return;
    }

    const outboundPayload = {
      channelSource: 'feishu' as const,
      chatId,
      replyToMessageId: String(input.payload.channelMessageId || '').trim() || undefined,
      text: input.responseText || '任务已处理完成。',
      channelSessionId: String(input.payload.channelSessionId || '').trim() || undefined,
      employeeId: String(input.payload.employeeId || '').trim() || undefined,
      agentId: input.receiverAgentId,
      runId: input.runId,
      sessionId: input.sessionId,
      traceId: String(input.payload.traceId || '').trim() || undefined,
      eventType: input.eventType,
      sentAt: new Date().toISOString(),
    };

    await this.redisService.publish(CHANNEL_OUTBOUND_FEISHU_CHANNEL, outboundPayload);
  }
}
