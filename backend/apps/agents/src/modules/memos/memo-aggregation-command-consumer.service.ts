import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  MEMO_AGGREGATION_COMMAND_QUEUE_KEY,
  MEMO_AGGREGATION_DEAD_LETTER_KEY,
  MEMO_AGGREGATION_RESULT_CHANNEL,
  MemoAggregationCommandMessage,
} from '@libs/common';
import { RedisService } from '@libs/infra';
import { MemoService } from './memo.service';
import { MemoAggregationService } from './memo-aggregation.service';

@Injectable()
export class MemoAggregationCommandConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MemoAggregationCommandConsumerService.name);
  private readonly dedupTtlSeconds = Math.max(60, Number(process.env.MEMO_AGGREGATION_DEDUP_TTL_SECONDS || 24 * 60 * 60));
  private running = false;

  constructor(
    private readonly redisService: RedisService,
    private readonly memoService: MemoService,
    private readonly memoAggregationService: MemoAggregationService,
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
      if (!this.redisService.isReady()) {
        await this.sleep(1000);
        continue;
      }

      try {
        const payload = await this.redisService.brpop(MEMO_AGGREGATION_COMMAND_QUEUE_KEY, 2);
        if (!payload) {
          continue;
        }
        await this.handlePayload(payload);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Memo aggregation command consume loop error: ${message}`);
        await this.sleep(1000);
      }
    }
  }

  private async handlePayload(payload: string): Promise<void> {
    let command: MemoAggregationCommandMessage;
    try {
      command = JSON.parse(payload) as MemoAggregationCommandMessage;
    } catch {
      this.logger.warn('Ignored malformed memo aggregation command payload');
      return;
    }

    if (!command?.requestId || !command?.commandType) {
      this.logger.warn('Ignored invalid memo aggregation command payload');
      return;
    }

    const dedupKey = `memo:aggregation:processed:${command.requestId}`;
    const alreadyProcessed = await this.redisService.get(dedupKey);
    if (alreadyProcessed) {
      this.logger.log(`Skip duplicated memo aggregation command requestId=${command.requestId}`);
      return;
    }

    try {
      if (command.commandType === 'flush_events') {
        await this.memoService.flushEventQueue(command.agentId);
      } else if (command.commandType === 'full_aggregation') {
        await this.memoAggregationService.triggerFullAggregation();
      } else {
        throw new Error(`Unsupported command type: ${command.commandType}`);
      }

      await this.publishResult({
        requestId: command.requestId,
        commandType: command.commandType,
        status: 'completed',
        scheduleId: command.scheduleId,
        taskId: command.taskId,
        attempt: command.attempt,
        finishedAt: new Date().toISOString(),
      });
      await this.redisService.set(dedupKey, '1', this.dedupTtlSeconds);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const nextAttempt = Number(command.attempt || 1) + 1;
      const maxAttempts = Math.max(1, Number(command.maxAttempts || 3));

      if (nextAttempt <= maxAttempts) {
        const retryCommand: MemoAggregationCommandMessage = {
          ...command,
          attempt: nextAttempt,
        };
        await this.redisService.lpush(MEMO_AGGREGATION_COMMAND_QUEUE_KEY, JSON.stringify(retryCommand));
        this.logger.warn(
          `Memo aggregation command retry queued requestId=${command.requestId} attempt=${nextAttempt}/${maxAttempts}: ${errorMessage}`,
        );
      } else {
        await this.redisService.lpush(
          MEMO_AGGREGATION_DEAD_LETTER_KEY,
          JSON.stringify({
            ...command,
            failedAt: new Date().toISOString(),
            error: errorMessage,
          }),
        );
        this.logger.error(
          `Memo aggregation command moved to dead letter requestId=${command.requestId} attempts=${maxAttempts}: ${errorMessage}`,
        );
      }

      await this.publishResult({
        requestId: command.requestId,
        commandType: command.commandType,
        status: 'failed',
        scheduleId: command.scheduleId,
        taskId: command.taskId,
        attempt: command.attempt,
        error: errorMessage,
        finishedAt: new Date().toISOString(),
      });
    }
  }

  private async publishResult(payload: Record<string, unknown>): Promise<void> {
    await this.redisService.publish(MEMO_AGGREGATION_RESULT_CHANNEL, payload);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
