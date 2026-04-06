import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  buildChannelEventFromMessageCenter,
  MESSAGE_BUS,
  type MessageBus,
  type MessageContext,
  type Subscription,
  MessageCenterEventEnvelope,
  RedisService,
  validateMessageCenterEventEnvelope,
} from '@libs/infra';
import { hostname } from 'os';
import { MessageCenterService } from './message-center.service';

const CHANNEL_FORWARD_EVENT_TYPES_REDIS_KEY =
  String(process.env.CHANNEL_FORWARD_EVENT_TYPES_REDIS_KEY || '').trim()
  || 'config:message-center:channel-forward-event-types';
const CHANNEL_FORWARD_EVENT_TYPES_DEFAULT = [
  'orchestration.task.completed',
  'agent.action.completed',
  'system.alert.scheduler',
  'meeting.session.ended',
  'meeting.summary.generated',
  'scheduler.report.generated',
];

@Injectable()
export class MessageCenterEventConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MessageCenterEventConsumerService.name);
  private readonly consumerName = `${hostname()}-${process.pid}`;
  private readonly forwardTypeReloadIntervalMs = Math.max(
    1000,
    Number(process.env.CHANNEL_FORWARD_EVENT_TYPES_RELOAD_MS || 10000),
  );
  private forwardEventTypes = new Set<string>();
  private lastForwardTypeReloadAt = 0;
  private subscription?: Subscription;

  constructor(
    private readonly redisService: RedisService,
    private readonly messageCenterService: MessageCenterService,
    @Inject(MESSAGE_BUS) private readonly messageBus: MessageBus,
  ) {}

  async onModuleInit(): Promise<void> {
    this.forwardEventTypes = this.parseForwardEventTypes(String(process.env.CHANNEL_FORWARD_EVENT_TYPES || ''));

    // [MESSAGE_BUS] 通过消息总线订阅 message-center.events topic
    this.subscription = await this.messageBus.subscribe(
      'message-center.events',
      (context: MessageContext<unknown>) => this.handleMessage(context),
      {
        group: 'message-center-group',
        consumer: this.consumerName,
        batchSize: 20,
        blockMs: 2000,
      },
    );
    this.logger.log('Message-center event consumer started via MessageBus');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.subscription) {
      await this.subscription.unsubscribe();
      this.subscription = undefined;
    }
  }

  // ── [MESSAGE_BUS] 消息处理入口 ─────────────────────────────────────────

  private async handleMessage(context: MessageContext<unknown>): Promise<void> {
    const { envelope } = context;
    await this.reloadForwardEventTypesIfNeeded();

    // payload 可能是两种格式：
    // 1) 新格式（通过 messageBus.publish）：payload 就是 MessageCenterEventEnvelope
    // 2) 旧格式兼容：直接从 stream fields.event 解析出的 JSON
    const rawPayload = envelope.payload;

    const validated = validateMessageCenterEventEnvelope(rawPayload);
    if (!validated.ok || !validated.event) {
      this.logger.warn(
        `[message-center] validation failed messageId=${envelope.messageId} error=${validated.error}`,
      );
      // 校验失败是永久性错误，不重试，直接进 DLQ
      await context.nack(validated.error || 'contract_validation_failed', { noRetry: true });
      return;
    }

    let created = false;
    try {
      const persisted = await this.persistAsSystemMessage(validated.event);
      created = persisted.created;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error || 'persist_failed');
      await context.nack(reason);
      return;
    }

    if (created) {
      try {
        await this.forwardToChannelIfNeeded(validated.event);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error || 'forward_failed');
        this.logger.warn(
          `Forward message-center event to channel stream failed unexpectedly (non-blocking): eventId=${validated.event.eventId} reason=${reason}`,
        );
      }
    }

    await context.ack();
  }

  // ── Forward to channel.events ──────────────────────────────────────────

  private async forwardToChannelIfNeeded(event: MessageCenterEventEnvelope): Promise<void> {
    if (!this.forwardEventTypes.has(event.eventType)) {
      return;
    }

    const channelEvent = buildChannelEventFromMessageCenter(event);
    try {
      // [MESSAGE_BUS] 通过消息总线发布到 channel.events topic
      await this.messageBus.publish('channel.events', {
        payload: channelEvent,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error || 'unknown');
      this.logger.warn(
        `Forward message-center event to channel stream failed (non-blocking): eventId=${event.eventId} eventType=${event.eventType} reason=${reason}`,
      );
    }
  }

  private async persistAsSystemMessage(event: MessageCenterEventEnvelope): Promise<{ created: boolean }> {
    if (!String(event.data.receiverId || '').trim()) {
      return { created: true };
    }

    return this.messageCenterService.createSystemMessage({
      receiverId: String(event.data.receiverId || '').trim(),
      type: event.data.messageType,
      title: event.data.title,
      content: event.data.content,
      source: event.source,
      eventId: event.eventId,
      dedupKey: event.data.bizKey,
      payload: {
        eventType: event.eventType,
        eventVersion: event.version,
        traceId: event.traceId,
        occurredAt: event.occurredAt,
        redirectPath: event.data.actionUrl || undefined,
        ...event.data.extra,
      },
    });
  }

  private async reloadForwardEventTypesIfNeeded(): Promise<void> {
    const now = Date.now();
    if (now - this.lastForwardTypeReloadAt < this.forwardTypeReloadIntervalMs) {
      return;
    }
    this.lastForwardTypeReloadAt = now;

    let next = this.parseForwardEventTypes(String(process.env.CHANNEL_FORWARD_EVENT_TYPES || ''));

    try {
      const redisRaw = await this.redisService.get(CHANNEL_FORWARD_EVENT_TYPES_REDIS_KEY);
      if (redisRaw && redisRaw.trim()) {
        next = this.parseForwardEventTypes(redisRaw);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error || 'unknown');
      this.logger.warn(`Load channel forward event types from redis failed: reason=${reason}`);
    }

    if (!this.sameSet(this.forwardEventTypes, next)) {
      this.forwardEventTypes = next;
      this.logger.log(`Updated channel forward event types: ${Array.from(next.values()).join(',')}`);
    }
  }

  private parseForwardEventTypes(raw: string): Set<string> {
    const parsed = String(raw || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    const values = parsed.length ? parsed : CHANNEL_FORWARD_EVENT_TYPES_DEFAULT;
    return new Set(values);
  }

  private sameSet(left: Set<string>, right: Set<string>): boolean {
    if (left.size !== right.size) {
      return false;
    }
    for (const value of left.values()) {
      if (!right.has(value)) {
        return false;
      }
    }
    return true;
  }

}
