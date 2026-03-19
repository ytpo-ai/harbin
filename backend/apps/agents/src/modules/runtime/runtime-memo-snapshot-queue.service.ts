import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { RedisService } from '@libs/infra';
import { v4 as uuidv4 } from 'uuid';
import { RuntimePersistenceService } from './runtime-persistence.service';

const RUNTIME_MEMO_SNAPSHOT_QUEUE_KEY = 'queue:runtime:memo-snapshot:commands';
const RUNTIME_MEMO_SNAPSHOT_DEAD_LETTER_KEY = 'queue:runtime:memo-snapshot:dead-letter';

type SessionMemoSnapshot = {
  agentId: string;
  refreshedAt: string;
  identity: Array<{ id: string; memoKind: string; title: string; slug?: string; content: string; updatedAt?: string }>;
  todo: Array<{ id: string; memoKind: string; title: string; slug?: string; content: string; updatedAt?: string }>;
  topic: Array<{ id: string; memoKind: string; title: string; slug?: string; content: string; updatedAt?: string }>;
};

type RuntimeMemoSnapshotCommand = {
  requestId: string;
  sessionId: string;
  snapshot: SessionMemoSnapshot;
  idempotencyKey: string;
  attempt: number;
  maxAttempts: number;
};

@Injectable()
export class RuntimeMemoSnapshotQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RuntimeMemoSnapshotQueueService.name);
  private readonly dedupTtlSeconds = Math.max(
    60,
    Number(process.env.RUNTIME_MEMO_SNAPSHOT_DEDUP_TTL_SECONDS || 24 * 60 * 60),
  );
  private readonly maxAttempts = Math.max(1, Number(process.env.RUNTIME_MEMO_SNAPSHOT_MAX_ATTEMPTS || 3));
  private running = false;

  constructor(
    private readonly redisService: RedisService,
    private readonly persistence: RuntimePersistenceService,
  ) {}

  onModuleInit(): void {
    this.running = true;
    void this.consumeLoop();
  }

  onModuleDestroy(): void {
    this.running = false;
  }

  async enqueueSnapshotUpdate(sessionId: string, snapshot: SessionMemoSnapshot): Promise<{ queued: boolean; requestId: string }> {
    const normalizedSessionId = String(sessionId || '').trim();
    if (!normalizedSessionId) {
      return { queued: false, requestId: '' };
    }
    const requestId = uuidv4();
    const idempotencyKey = `snapshot:${normalizedSessionId}:${snapshot.refreshedAt || ''}`.slice(0, 180);
    const command: RuntimeMemoSnapshotCommand = {
      requestId,
      sessionId: normalizedSessionId,
      snapshot,
      idempotencyKey,
      attempt: 1,
      maxAttempts: this.maxAttempts,
    };
    await this.redisService.lpush(RUNTIME_MEMO_SNAPSHOT_QUEUE_KEY, JSON.stringify(command));
    return { queued: true, requestId };
  }

  private async consumeLoop(): Promise<void> {
    while (this.running) {
      if (!this.redisService.isReady()) {
        await this.sleep(1000);
        continue;
      }

      try {
        const payload = await this.redisService.brpop(RUNTIME_MEMO_SNAPSHOT_QUEUE_KEY, 2);
        if (!payload) {
          continue;
        }
        await this.handlePayload(payload);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Runtime memo snapshot consume loop error: ${message}`);
        await this.sleep(1000);
      }
    }
  }

  private async handlePayload(payload: string): Promise<void> {
    let command: RuntimeMemoSnapshotCommand;
    try {
      command = JSON.parse(payload) as RuntimeMemoSnapshotCommand;
    } catch {
      this.logger.warn('Ignored malformed runtime memo snapshot payload');
      return;
    }

    if (!command?.requestId || !command?.sessionId || !command?.snapshot) {
      this.logger.warn('Ignored invalid runtime memo snapshot payload');
      return;
    }

    const dedupKey = `runtime:memo-snapshot:processed:${command.idempotencyKey || command.requestId}`;
    const alreadyProcessed = await this.redisService.get(dedupKey);
    if (alreadyProcessed) {
      return;
    }

    try {
      await this.persistence.updateSessionMemoSnapshot(command.sessionId, command.snapshot);
      await this.redisService.set(dedupKey, '1', this.dedupTtlSeconds);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const nextAttempt = Number(command.attempt || 1) + 1;
      const maxAttempts = Math.max(1, Number(command.maxAttempts || this.maxAttempts));
      if (nextAttempt <= maxAttempts) {
        await this.redisService.lpush(
          RUNTIME_MEMO_SNAPSHOT_QUEUE_KEY,
          JSON.stringify({
            ...command,
            attempt: nextAttempt,
          }),
        );
        this.logger.warn(
          `Runtime memo snapshot retry queued requestId=${command.requestId} attempt=${nextAttempt}/${maxAttempts}: ${errorMessage}`,
        );
      } else {
        await this.redisService.lpush(
          RUNTIME_MEMO_SNAPSHOT_DEAD_LETTER_KEY,
          JSON.stringify({
            ...command,
            failedAt: new Date().toISOString(),
            error: errorMessage,
          }),
        );
        this.logger.error(
          `Runtime memo snapshot moved to dead letter requestId=${command.requestId} attempts=${maxAttempts}: ${errorMessage}`,
        );
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
