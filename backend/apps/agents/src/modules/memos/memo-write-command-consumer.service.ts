import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  MEMO_WRITE_COMMAND_QUEUE_KEY,
  MEMO_WRITE_DEAD_LETTER_KEY,
  MEMO_WRITE_RESULT_CHANNEL,
  MemoWriteCommandMessage,
} from '@libs/common';
import { RedisService } from '@libs/infra';
import { MemoService } from './memo.service';

@Injectable()
export class MemoWriteCommandConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MemoWriteCommandConsumerService.name);
  private readonly dedupTtlSeconds = Math.max(60, Number(process.env.MEMO_WRITE_DEDUP_TTL_SECONDS || 24 * 60 * 60));
  private running = false;

  constructor(
    private readonly redisService: RedisService,
    private readonly memoService: MemoService,
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
        const payload = await this.redisService.brpop(MEMO_WRITE_COMMAND_QUEUE_KEY, 2);
        if (!payload) {
          continue;
        }
        await this.handlePayload(payload);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Memo write command consume loop error: ${message}`);
        await this.sleep(1000);
      }
    }
  }

  private async handlePayload(payload: string): Promise<void> {
    let command: MemoWriteCommandMessage;
    try {
      command = JSON.parse(payload) as MemoWriteCommandMessage;
    } catch {
      this.logger.warn('Ignored malformed memo write command payload');
      return;
    }

    if (!command?.requestId || !command?.commandType || !command.payload || typeof command.payload !== 'object') {
      this.logger.warn('Ignored invalid memo write command payload');
      return;
    }

    const dedupKey = `memo:write:processed:${command.idempotencyKey || command.requestId}`;
    const alreadyProcessed = await this.redisService.get(dedupKey);
    if (alreadyProcessed) {
      this.logger.log(`Skip duplicated memo write command requestId=${command.requestId}`);
      return;
    }

    try {
      await this.executeCommand(command);
      await this.redisService.set(dedupKey, '1', this.dedupTtlSeconds);
      await this.publishResult({
        requestId: command.requestId,
        commandType: command.commandType,
        status: 'completed',
        attempt: command.attempt,
        finishedAt: new Date().toISOString(),
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const nextAttempt = Number(command.attempt || 1) + 1;
      const maxAttempts = Math.max(1, Number(command.maxAttempts || 3));

      if (nextAttempt <= maxAttempts) {
        const retryCommand: MemoWriteCommandMessage = {
          ...command,
          attempt: nextAttempt,
        };
        await this.redisService.lpush(MEMO_WRITE_COMMAND_QUEUE_KEY, JSON.stringify(retryCommand));
        this.logger.warn(
          `Memo write command retry queued requestId=${command.requestId} attempt=${nextAttempt}/${maxAttempts}: ${errorMessage}`,
        );
      } else {
        await this.redisService.lpush(
          MEMO_WRITE_DEAD_LETTER_KEY,
          JSON.stringify({
            ...command,
            failedAt: new Date().toISOString(),
            error: errorMessage,
          }),
        );
        this.logger.error(
          `Memo write command moved to dead letter requestId=${command.requestId} attempts=${maxAttempts}: ${errorMessage}`,
        );
      }

      await this.publishResult({
        requestId: command.requestId,
        commandType: command.commandType,
        status: 'failed',
        attempt: command.attempt,
        error: errorMessage,
        finishedAt: new Date().toISOString(),
      });
    }
  }

  private async executeCommand(command: MemoWriteCommandMessage): Promise<void> {
    const payload = command.payload as Record<string, any>;
    switch (command.commandType) {
      case 'create_memo':
        await this.memoService.createMemo(payload.body, payload.options);
        return;
      case 'update_memo':
        await this.memoService.updateMemo(payload.id, payload.updates, payload.options);
        return;
      case 'delete_memo':
        await this.memoService.deleteMemo(payload.id);
        return;
      case 'upsert_task_todo':
        await this.memoService.upsertTaskTodo(payload.agentId, payload.task || {});
        return;
      case 'update_todo_status':
        await this.memoService.updateTodoStatus(payload.id, payload.status, payload.note, payload.options);
        return;
      case 'complete_task_todo':
        await this.memoService.completeTaskTodo(payload.agentId, payload.taskId, payload.note, payload.status);
        return;
      case 'record_behavior':
        await this.memoService.recordBehavior(payload as {
          agentId: string;
          event: 'task_start' | 'decision' | 'task_complete' | 'task_failed';
          taskId?: string;
          title?: string;
          details: string;
          tags?: string[];
          topic?: string;
        });
        return;
      default:
        throw new Error(`Unsupported command type: ${command.commandType}`);
    }
  }

  private async publishResult(payload: Record<string, unknown>): Promise<void> {
    await this.redisService.publish(MEMO_WRITE_RESULT_CHANNEL, payload);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
