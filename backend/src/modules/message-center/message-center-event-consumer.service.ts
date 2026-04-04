import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  buildChannelEventFromMessageCenter,
  CHANNEL_EVENTS_STREAM,
  MESSAGE_CENTER_EVENT_CONSUMER_GROUP,
  MESSAGE_CENTER_EVENT_STREAM_KEY,
  MessageCenterEventEnvelope,
  RedisService,
  validateMessageCenterEventEnvelope,
} from '@libs/infra';
import { hostname } from 'os';
import { MessageCenterService } from './message-center.service';

const MESSAGE_CENTER_EVENT_FIELD = 'event';
const MESSAGE_CENTER_EVENT_DLQ_STREAM_KEY = 'streams:message-center:events:dlq';
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
  private running = false;

  constructor(
    private readonly redisService: RedisService,
    private readonly messageCenterService: MessageCenterService,
  ) {}

  onModuleInit(): void {
    this.forwardEventTypes = this.parseForwardEventTypes(String(process.env.CHANNEL_FORWARD_EVENT_TYPES || ''));
    this.running = true;
    void this.consumeLoop();
  }

  onModuleDestroy(): void {
    this.running = false;
  }

  private async consumeLoop(): Promise<void> {
    while (this.running) {
      try {
        if (!this.redisService.isReady()) {
          await this.sleep(1000);
          continue;
        }

        await this.reloadForwardEventTypesIfNeeded();

        await this.redisService.xgroupCreate(
          MESSAGE_CENTER_EVENT_STREAM_KEY,
          MESSAGE_CENTER_EVENT_CONSUMER_GROUP,
          '0',
          true,
        );

        const readResult = await this.redisService.xreadgroup(
          MESSAGE_CENTER_EVENT_STREAM_KEY,
          MESSAGE_CENTER_EVENT_CONSUMER_GROUP,
          this.consumerName,
          {
            count: 20,
            blockMs: 2000,
            streamId: '>',
          },
        );

        if (!readResult.length) {
          continue;
        }

        for (const streamBatch of readResult) {
          for (const message of streamBatch.messages) {
            await this.consumeOneMessage(message.id, message.fields || {});
          }
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error || 'unknown');
        this.logger.warn(`Message-center event consume loop error: ${reason}`);
        await this.sleep(1000);
      }
    }
  }

  private async consumeOneMessage(streamMessageId: string, fields: Record<string, string>): Promise<void> {
    const eventRaw = String(fields[MESSAGE_CENTER_EVENT_FIELD] || '').trim();
    if (!eventRaw) {
      await this.ack(streamMessageId);
      return;
    }

    let parsedEvent: unknown;
    try {
      parsedEvent = JSON.parse(eventRaw);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error || 'invalid_json');
      await this.moveToDlq(streamMessageId, eventRaw, reason);
      return;
    }

    const validated = validateMessageCenterEventEnvelope(parsedEvent);
    if (!validated.ok || !validated.event) {
      await this.moveToDlq(streamMessageId, eventRaw, validated.error || 'contract_validation_failed');
      return;
    }

    let created = false;
    try {
      const persisted = await this.persistAsSystemMessage(validated.event);
      created = persisted.created;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error || 'persist_failed');
      await this.moveToDlq(streamMessageId, eventRaw, reason);
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

    await this.ack(streamMessageId);
  }

  private async forwardToChannelIfNeeded(event: MessageCenterEventEnvelope): Promise<void> {
    if (!this.forwardEventTypes.has(event.eventType)) {
      return;
    }

    const channelEvent = buildChannelEventFromMessageCenter(event);
    try {
      await this.redisService.xadd(
        CHANNEL_EVENTS_STREAM,
        {
          event: JSON.stringify(channelEvent),
        },
        {
          maxLen: 10000,
        },
      );
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

  private async moveToDlq(streamMessageId: string, eventRaw: string, reason: string): Promise<void> {
    await this.redisService.xadd(
      MESSAGE_CENTER_EVENT_DLQ_STREAM_KEY,
      {
        streamMessageId,
        reason,
        event: eventRaw,
        failedAt: new Date().toISOString(),
      },
      {
        maxLen: 20000,
      },
    );
    await this.ack(streamMessageId);
    this.logger.error(
      `Moved message-center event to DLQ: streamMessageId=${streamMessageId} reason=${reason}`,
    );
  }

  private async ack(streamMessageId: string): Promise<void> {
    await this.redisService.xack(
      MESSAGE_CENTER_EVENT_STREAM_KEY,
      MESSAGE_CENTER_EVENT_CONSUMER_GROUP,
      [streamMessageId],
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
