import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  AgentCollaborationMessage,
  AgentCollaborationMessageDocument,
} from '../../shared/schemas/agent-collaboration-message.schema';
import {
  AgentMessageSubscription,
  AgentMessageSubscriptionDocument,
} from '../../shared/schemas/agent-message-subscription.schema';
import { RedisService } from '@libs/infra';

export const AGENT_MESSAGE_DISPATCH_QUEUE_KEY = 'agent:message:dispatch';
export const AGENT_MESSAGE_DISPATCH_DEAD_LETTER_KEY = 'agent:message:dispatch:dead-letter';
export const ORCHESTRATION_TASK_EVENT_HOOK_CHANNEL = 'orchestration:task-events';

interface DispatchEnvelope {
  dispatchId: string;
  messageId: string;
  receiverAgentId: string;
  attempt: number;
  maxAttempts: number;
  createdAt: string;
}

interface DirectMessageInput {
  senderAgentId: string;
  receiverAgentId: string;
  eventType: string;
  title: string;
  content: string;
  payload?: Record<string, any>;
  source?: string;
  dedupKey?: string;
  maxAttempts?: number;
}

interface PublishMessageInput {
  senderAgentId: string;
  eventType: string;
  title: string;
  content: string;
  payload?: Record<string, any>;
  source?: string;
  dedupKey?: string;
  maxAttempts?: number;
}

interface PublishTaskEventInput {
  eventType: string;
  taskId: string;
  planId?: string;
  status?: string;
  senderAgentId?: string;
  payload?: Record<string, any>;
  title?: string;
  content?: string;
}

@Injectable()
export class AgentMessagesService {
  private readonly logger = new Logger(AgentMessagesService.name);

  constructor(
    @InjectModel(AgentCollaborationMessage.name)
    private readonly messageModel: Model<AgentCollaborationMessageDocument>,
    @InjectModel(AgentMessageSubscription.name)
    private readonly subscriptionModel: Model<AgentMessageSubscriptionDocument>,
    private readonly redisService: RedisService,
  ) {}

  async sendDirectMessage(input: DirectMessageInput): Promise<AgentCollaborationMessage> {
    const senderAgentId = String(input.senderAgentId || '').trim();
    const receiverAgentId = String(input.receiverAgentId || '').trim();
    const eventType = String(input.eventType || '').trim() || 'agent.direct';
    const title = String(input.title || '').trim();
    const content = String(input.content || '').trim();

    if (!senderAgentId || !receiverAgentId) {
      throw new BadRequestException('senderAgentId and receiverAgentId are required');
    }
    if (!title || !content) {
      throw new BadRequestException('title and content are required');
    }

    const created = await this.messageModel.create({
      mode: 'direct',
      eventType,
      senderAgentId,
      receiverAgentId,
      title,
      content,
      payload: input.payload || {},
      status: 'sent',
      sentAt: new Date(),
      attempt: 0,
      maxAttempts: Math.max(1, Number(input.maxAttempts || 3)),
      source: input.source || 'agent-messages',
      dedupKey: input.dedupKey || undefined,
    });

    await this.enqueueDispatch(created);
    return created;
  }

  async publishMessage(input: PublishMessageInput): Promise<{
    eventType: string;
    matchedSubscribers: number;
    createdMessages: number;
  }> {
    const senderAgentId = String(input.senderAgentId || '').trim();
    const eventType = String(input.eventType || '').trim();
    const title = String(input.title || '').trim();
    const content = String(input.content || '').trim();

    if (!senderAgentId || !eventType) {
      throw new BadRequestException('senderAgentId and eventType are required');
    }

    if (!title || !content) {
      throw new BadRequestException('title and content are required');
    }

    const subscriptions = await this.subscriptionModel
      .find({ eventType: { $in: [eventType, '*', this.toDomainWildcard(eventType)] }, isActive: true })
      .lean()
      .exec();

    if (!subscriptions.length) {
      return {
        eventType,
        matchedSubscribers: 0,
        createdMessages: 0,
      };
    }

    let createdMessages = 0;
    for (const subscription of subscriptions) {
      const receiverAgentId = String(subscription.subscriberAgentId || '').trim();
      if (!receiverAgentId) {
        continue;
      }

      if (!this.matchesSubscriptionFilters(subscription.filters || {}, input.payload || {})) {
        continue;
      }

      const created = await this.messageModel.create({
        mode: 'subscription',
        eventType,
        senderAgentId,
        receiverAgentId,
        title,
        content,
        payload: input.payload || {},
        status: 'sent',
        sentAt: new Date(),
        attempt: 0,
        maxAttempts: Math.max(1, Number(input.maxAttempts || 3)),
        source: input.source || 'agent-messages',
        dedupKey: input.dedupKey ? `${input.dedupKey}:${receiverAgentId}` : undefined,
      });

      createdMessages += 1;
      await this.enqueueDispatch(created);
    }

    return {
      eventType,
      matchedSubscribers: createdMessages,
      createdMessages,
    };
  }

  async publishTaskEvent(input: PublishTaskEventInput): Promise<void> {
    const eventType = String(input.eventType || '').trim();
    const taskId = String(input.taskId || '').trim();
    if (!eventType || !taskId) {
      throw new BadRequestException('eventType and taskId are required for task event publish');
    }

    const hookPayload = {
      eventType,
      taskId,
      planId: input.planId,
      status: input.status,
      senderAgentId: input.senderAgentId || 'orchestration-system',
      payload: input.payload || {},
      timestamp: new Date().toISOString(),
    };

    await this.redisService.publish(ORCHESTRATION_TASK_EVENT_HOOK_CHANNEL, hookPayload);

    await this.publishMessage({
      senderAgentId: input.senderAgentId || 'orchestration-system',
      eventType,
      title: input.title || `Task Event: ${eventType}`,
      content: input.content || `Task ${taskId} emitted event ${eventType}`,
      payload: {
        taskId,
        planId: input.planId,
        status: input.status,
        ...(input.payload || {}),
      },
      source: 'orchestration',
      dedupKey: `${eventType}:${taskId}:${input.status || 'na'}`,
    });
  }

  async createOrUpdateSubscription(input: {
    subscriberAgentId: string;
    eventType: string;
    filters?: Record<string, any>;
    isActive?: boolean;
    source?: string;
  }): Promise<AgentMessageSubscription> {
    const subscriberAgentId = String(input.subscriberAgentId || '').trim();
    const eventType = String(input.eventType || '').trim();
    if (!subscriberAgentId || !eventType) {
      throw new BadRequestException('subscriberAgentId and eventType are required');
    }

    return this.subscriptionModel
      .findOneAndUpdate(
        { subscriberAgentId, eventType },
        {
          $set: {
            filters: input.filters || {},
            isActive: input.isActive ?? true,
            source: input.source || 'agent-messages',
          },
          $setOnInsert: {
            subscriberAgentId,
            eventType,
          },
        },
        { upsert: true, new: true },
      )
      .exec();
  }

  async listSubscriptions(query: {
    subscriberAgentId?: string;
    eventType?: string;
    isActive?: boolean;
  }): Promise<AgentMessageSubscription[]> {
    const filter: Record<string, any> = {};
    if (query.subscriberAgentId) {
      filter.subscriberAgentId = String(query.subscriberAgentId).trim();
    }
    if (query.eventType) {
      filter.eventType = String(query.eventType).trim();
    }
    if (typeof query.isActive === 'boolean') {
      filter.isActive = query.isActive;
    }

    return this.subscriptionModel.find(filter).sort({ createdAt: -1 }).lean().exec() as any;
  }

  async acknowledgeMessage(messageId: string, receiverAgentId: string, status: 'delivered' | 'processing') {
    const now = new Date();
    const setPayload: Record<string, any> = {
      status,
    };
    if (status === 'delivered') {
      setPayload.deliveredAt = now;
    } else {
      setPayload.deliveredAt = now;
      setPayload.processingAt = now;
    }

    const updated = await this.messageModel
      .findOneAndUpdate(
        {
          messageId,
          receiverAgentId,
          status: { $in: ['sent', 'delivered', 'processing'] },
        },
        {
          $set: setPayload,
        },
        { new: true },
      )
      .lean()
      .exec();

    if (!updated) {
      throw new NotFoundException('Message not found or cannot be acknowledged');
    }

    return updated;
  }

  async markMessageProcessed(messageId: string, receiverAgentId: string, result?: Record<string, any>) {
    const updated = await this.messageModel
      .findOneAndUpdate(
        {
          messageId,
          receiverAgentId,
          status: { $in: ['delivered', 'processing'] },
        },
        {
          $set: {
            status: 'processed',
            processedAt: new Date(),
            ...(result ? { 'payload.processingResult': result } : {}),
          },
        },
        { new: true },
      )
      .lean()
      .exec();

    if (!updated) {
      throw new NotFoundException('Message not found or cannot be marked as processed');
    }

    return updated;
  }

  async getMessageById(messageId: string): Promise<AgentCollaborationMessageDocument | null> {
    return this.messageModel.findOne({ messageId }).exec();
  }

  async markDispatchAttempt(messageId: string, attempt: number): Promise<void> {
    await this.messageModel
      .updateOne(
        { messageId },
        {
          $set: {
            attempt,
          },
        },
      )
      .exec();
  }

  async markDispatchFailed(messageId: string, errorMessage: string): Promise<void> {
    await this.messageModel
      .updateOne(
        { messageId, status: { $in: ['sent', 'delivered', 'processing'] } },
        {
          $set: {
            status: 'failed',
            failedAt: new Date(),
            error: errorMessage,
          },
        },
      )
      .exec();
  }

  async publishToAgentInbox(message: AgentCollaborationMessage): Promise<number> {
    const channel = this.buildInboxChannel(message.receiverAgentId);
    const payload = {
      event: 'agent.message.received',
      messageId: message.messageId,
      mode: message.mode,
      eventType: message.eventType,
      senderAgentId: message.senderAgentId,
      receiverAgentId: message.receiverAgentId,
      title: message.title,
      content: message.content,
      payload: message.payload || {},
      sentAt: message.sentAt || new Date(),
    };
    return this.redisService.publish(channel, payload);
  }

  async requeueDispatch(envelope: DispatchEnvelope): Promise<void> {
    await this.redisService.lpush(AGENT_MESSAGE_DISPATCH_QUEUE_KEY, JSON.stringify(envelope));
  }

  async deadLetterDispatch(envelope: DispatchEnvelope, errorMessage: string): Promise<void> {
    await this.redisService.lpush(
      AGENT_MESSAGE_DISPATCH_DEAD_LETTER_KEY,
      JSON.stringify({
        ...envelope,
        error: errorMessage,
        failedAt: new Date().toISOString(),
      }),
    );
  }

  private async enqueueDispatch(message: AgentCollaborationMessage): Promise<void> {
    const envelope: DispatchEnvelope = {
      dispatchId: `${message.messageId}:${message.receiverAgentId}`,
      messageId: message.messageId,
      receiverAgentId: message.receiverAgentId,
      attempt: Number(message.attempt || 0),
      maxAttempts: Math.max(1, Number(message.maxAttempts || 3)),
      createdAt: new Date().toISOString(),
    };

    const queued = await this.redisService.lpush(
      AGENT_MESSAGE_DISPATCH_QUEUE_KEY,
      JSON.stringify(envelope),
    );

    if (!queued) {
      this.logger.warn(`Agent message enqueue failed or redis unavailable: messageId=${message.messageId}`);
    }
  }

  private buildInboxChannel(agentId: string): string {
    return `agent:inbox:${agentId}`;
  }

  private toDomainWildcard(eventType: string): string {
    const normalized = String(eventType || '').trim();
    const firstDotIndex = normalized.indexOf('.');
    if (firstDotIndex <= 0) {
      return '*';
    }
    return `${normalized.slice(0, firstDotIndex)}.*`;
  }

  private matchesSubscriptionFilters(filters: Record<string, any>, payload: Record<string, any>): boolean {
    const keys = Object.keys(filters || {});
    if (!keys.length) {
      return true;
    }

    return keys.every((key) => {
      const expected = filters[key];
      const actual = payload[key];

      if (expected === undefined || expected === null || expected === '') {
        return true;
      }

      if (Array.isArray(expected)) {
        return expected.map((item) => String(item)).includes(String(actual));
      }

      return String(actual) === String(expected);
    });
  }
}
