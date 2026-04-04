import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { CHANNEL_INBOUND_QUEUE_KEY, RedisService } from '@libs/infra';
import { ChannelInboundService } from './channel-inbound.service';
import { FeishuInboundMessage } from './inbound.types';

@Injectable()
export class ChannelInboundWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChannelInboundWorkerService.name);
  private readonly queueKey = CHANNEL_INBOUND_QUEUE_KEY;
  private running = false;

  constructor(
    private readonly redisService: RedisService,
    private readonly channelInboundService: ChannelInboundService,
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

        const payload = await this.redisService.brpop(this.queueKey, 2);
        if (!payload) {
          continue;
        }

        await this.handlePayload(payload);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error || 'unknown_error');
        this.logger.warn(`Inbound worker consume loop error: ${reason}`);
        await this.sleep(1000);
      }
    }
  }

  private async handlePayload(payload: string): Promise<void> {
    let event: FeishuInboundMessage;
    try {
      event = JSON.parse(payload) as FeishuInboundMessage;
    } catch {
      this.logger.warn('Ignored malformed inbound payload');
      return;
    }

    if (!event?.externalUserId || !event?.externalChatId || !event?.messageId) {
      this.logger.warn('Ignored invalid inbound payload');
      return;
    }

    await this.channelInboundService.handleInboundEvent(event);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
