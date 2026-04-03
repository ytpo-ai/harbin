import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  CHANNEL_CONSUMER_GROUP,
  CHANNEL_EVENTS_DLQ_STREAM,
  CHANNEL_EVENTS_STREAM,
  ChannelEventEnvelope,
  RedisService,
  validateChannelEventEnvelope,
} from '@libs/infra';
import { hostname } from 'os';
import { ChannelMessage } from '../../contracts/channel-message.types';
import { ChannelConfigService } from './channel-config.service';
import { ChannelProviderRegistry } from './channel-provider.registry';

const CHANNEL_EVENT_FIELD = 'event';

@Injectable()
export class ChannelDispatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChannelDispatcherService.name);
  private readonly consumerName = `${hostname()}-${process.pid}`;
  private running = false;

  constructor(
    private readonly redisService: RedisService,
    private readonly channelConfigService: ChannelConfigService,
    private readonly providerRegistry: ChannelProviderRegistry,
  ) {}

  onModuleInit(): void {
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

        await this.redisService.xgroupCreate(CHANNEL_EVENTS_STREAM, CHANNEL_CONSUMER_GROUP, '0', true);

        const batches = await this.redisService.xreadgroup(
          CHANNEL_EVENTS_STREAM,
          CHANNEL_CONSUMER_GROUP,
          this.consumerName,
          {
            count: 20,
            blockMs: 2000,
            streamId: '>',
          },
        );

        if (!batches.length) {
          continue;
        }

        for (const batch of batches) {
          for (const message of batch.messages) {
            await this.consumeOneMessage(message.id, message.fields || {});
          }
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error || 'unknown');
        this.logger.warn(`Channel dispatcher consume loop error: ${reason}`);
        await this.sleep(1000);
      }
    }
  }

  private async consumeOneMessage(streamMessageId: string, fields: Record<string, string>): Promise<void> {
    const raw = String(fields[CHANNEL_EVENT_FIELD] || '').trim();
    if (!raw) {
      await this.ack(streamMessageId);
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'invalid_json';
      await this.moveToDlq(streamMessageId, raw, reason);
      return;
    }

    const validated = validateChannelEventEnvelope(parsed);
    if (!validated.ok || !validated.event) {
      await this.moveToDlq(streamMessageId, raw, validated.error || 'contract_validation_failed');
      return;
    }

    try {
      const allFailed = await this.dispatchOneEvent(validated.event);
      if (allFailed) {
        await this.moveToDlq(streamMessageId, raw, 'all_deliveries_failed');
        return;
      }
      await this.ack(streamMessageId);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error || 'dispatch_failed');
      await this.moveToDlq(streamMessageId, raw, reason);
    }
  }

  private async dispatchOneEvent(event: ChannelEventEnvelope): Promise<boolean> {
    const targets = await this.channelConfigService.findActiveTargetsByEventType(event.eventType);
    if (!targets.length) {
      return false;
    }

    let successCount = 0;
    for (const target of targets) {
      const message = this.buildChannelMessage(event);
      let deliveryResult;

      try {
        const provider = this.providerRegistry.getProvider(target.providerType);
        deliveryResult = await provider.send(target, message);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error || 'unknown_provider_error');
        deliveryResult = {
          success: false,
          providerType: target.providerType,
          errorMessage: reason,
          deliveredAt: new Date(),
        };
      }

      if (deliveryResult.success) {
        successCount += 1;
      }

      await this.channelConfigService.createDeliveryLog({
        configId: target.configId,
        eventId: event.eventId,
        eventType: event.eventType,
        providerType: target.providerType,
        status: deliveryResult.success ? 'success' : 'failed',
        attempt: 1,
        errorMessage: deliveryResult.errorMessage,
        requestPayload: {
          contentType: message.contentType,
          title: message.title,
        },
        responsePayload: {
          success: deliveryResult.success,
          statusCode: deliveryResult.statusCode,
        },
        deliveredAt: deliveryResult.deliveredAt,
      });
    }

    return successCount === 0;
  }

  private buildChannelMessage(event: ChannelEventEnvelope): ChannelMessage {
    const extra = (event.data.extra || {}) as Record<string, unknown>;
    const status = String(extra.status || '').trim();
    return {
      title: event.data.title,
      content: event.data.content,
      contentType: 'card',
      payload: {
        status,
        summary: String(extra.summary || event.data.content || '').trim(),
        actionUrl: event.data.actionUrl,
      },
      sourceEvent: {
        eventId: event.eventId,
        eventType: event.eventType,
        occurredAt: event.occurredAt,
      },
    };
  }

  private async moveToDlq(streamMessageId: string, eventRaw: string, reason: string): Promise<void> {
    await this.redisService.xadd(
      CHANNEL_EVENTS_DLQ_STREAM,
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
    this.logger.error(`Moved channel event to DLQ: streamMessageId=${streamMessageId} reason=${reason}`);
  }

  private async ack(streamMessageId: string): Promise<void> {
    await this.redisService.xack(CHANNEL_EVENTS_STREAM, CHANNEL_CONSUMER_GROUP, [streamMessageId]);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
