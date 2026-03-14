import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AgentMessagesService, AGENT_MESSAGE_DISPATCH_QUEUE_KEY } from './agent-messages.service';
import { RedisService } from '@libs/infra';

interface DispatchEnvelope {
  dispatchId: string;
  messageId: string;
  receiverAgentId: string;
  attempt: number;
  maxAttempts: number;
  createdAt: string;
}

@Injectable()
export class AgentMessageDispatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AgentMessageDispatcherService.name);
  private running = false;

  constructor(
    private readonly agentMessagesService: AgentMessagesService,
    private readonly redisService: RedisService,
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

        const payload = await this.redisService.brpop(AGENT_MESSAGE_DISPATCH_QUEUE_KEY, 2);
        if (!payload) {
          continue;
        }

        await this.handlePayload(payload);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Agent message dispatch consume loop error: ${message}`);
        await this.sleep(1000);
      }
    }
  }

  private async handlePayload(payload: string): Promise<void> {
    let envelope: DispatchEnvelope;
    try {
      envelope = JSON.parse(payload) as DispatchEnvelope;
    } catch {
      this.logger.warn('Ignored malformed agent message dispatch payload');
      return;
    }

    if (!envelope?.messageId || !envelope?.receiverAgentId) {
      this.logger.warn('Ignored invalid agent message dispatch payload');
      return;
    }

    const message = await this.agentMessagesService.getMessageById(envelope.messageId);
    if (!message) {
      this.logger.warn(`Message not found for dispatch: messageId=${envelope.messageId}`);
      return;
    }

    try {
      const nextAttempt = Number(envelope.attempt || 0) + 1;
      await this.agentMessagesService.markDispatchAttempt(envelope.messageId, nextAttempt);

      await this.agentMessagesService.publishToAgentInbox(message);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const nextAttempt = Number(envelope.attempt || 0) + 1;
      const maxAttempts = Math.max(1, Number(envelope.maxAttempts || 3));

      if (nextAttempt < maxAttempts) {
        await this.agentMessagesService.requeueDispatch({
          ...envelope,
          attempt: nextAttempt,
          maxAttempts,
        });
        this.logger.warn(
          `Agent message dispatch retry queued messageId=${envelope.messageId} attempt=${nextAttempt}/${maxAttempts}: ${errorMessage}`,
        );
        return;
      }

      await this.agentMessagesService.markDispatchFailed(envelope.messageId, errorMessage);
      await this.agentMessagesService.deadLetterDispatch(
        {
          ...envelope,
          attempt: nextAttempt,
          maxAttempts,
        },
        errorMessage,
      );
      this.logger.error(
        `Agent message dispatch moved to dead letter messageId=${envelope.messageId} attempts=${maxAttempts}: ${errorMessage}`,
      );
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
