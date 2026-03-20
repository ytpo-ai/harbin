import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InnerMessageService, INNER_MESSAGE_DISPATCH_QUEUE_KEY } from './inner-message.service';
import { RedisService } from '@libs/infra';
import { InnerMessageAgentRuntimeBridgeService } from './inner-message-agent-runtime-bridge.service';

interface DispatchEnvelope {
  dispatchId: string;
  messageId: string;
  receiverAgentId: string;
  attempt: number;
  maxAttempts: number;
  createdAt: string;
}

@Injectable()
export class InnerMessageDispatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InnerMessageDispatcherService.name);
  private running = false;

  constructor(
    private readonly innerMessageService: InnerMessageService,
    private readonly redisService: RedisService,
    private readonly innerMessageAgentRuntimeBridgeService: InnerMessageAgentRuntimeBridgeService,
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

        const payload = await this.redisService.brpop(INNER_MESSAGE_DISPATCH_QUEUE_KEY, 2);
        if (!payload) {
          continue;
        }

        await this.handlePayload(payload);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Inner message dispatch consume loop error: ${message}`);
        await this.sleep(1000);
      }
    }
  }

  private async handlePayload(payload: string): Promise<void> {
    let envelope: DispatchEnvelope;
    try {
      envelope = JSON.parse(payload) as DispatchEnvelope;
    } catch {
      this.logger.warn('Ignored malformed inner message dispatch payload');
      return;
    }

    if (!envelope?.messageId || !envelope?.receiverAgentId) {
      this.logger.warn('Ignored invalid inner message dispatch payload');
      return;
    }

    const message = await this.innerMessageService.getMessageById(envelope.messageId);
    if (!message) {
      this.logger.warn(`Message not found for dispatch: messageId=${envelope.messageId}`);
      return;
    }

    if (['processed', 'failed'].includes(String(message.status || '').trim())) {
      return;
    }

    try {
      const nextAttempt = Number(envelope.attempt || 0) + 1;
      await this.innerMessageService.markDispatchAttempt(envelope.messageId, nextAttempt);

      await this.innerMessageService.publishToAgentInbox(message);
      await this.innerMessageAgentRuntimeBridgeService.processMessage(message);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const nextAttempt = Number(envelope.attempt || 0) + 1;
      const maxAttempts = Math.max(1, Number(envelope.maxAttempts || 3));

      if (nextAttempt < maxAttempts) {
        await this.innerMessageService.requeueDispatch({
          ...envelope,
          attempt: nextAttempt,
          maxAttempts,
        });
        this.logger.warn(
          `Inner message dispatch retry queued messageId=${envelope.messageId} attempt=${nextAttempt}/${maxAttempts}: ${errorMessage}`,
        );
        return;
      }

      await this.innerMessageService.markDispatchFailed(envelope.messageId, errorMessage);
      await this.innerMessageService.deadLetterDispatch(
        {
          ...envelope,
          attempt: nextAttempt,
          maxAttempts,
        },
        errorMessage,
      );
      this.logger.error(
        `Inner message dispatch moved to dead letter messageId=${envelope.messageId} attempts=${maxAttempts}: ${errorMessage}`,
      );
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
