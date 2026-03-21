import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { RedisService } from '@libs/infra';
import { RuntimeEvent } from './contracts/runtime-event.contract';
import { RuntimePersistenceService } from './runtime-persistence.service';
import { RuntimeActionLogIngestionService } from './runtime-action-log.service';

@Injectable()
export class HookDispatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HookDispatcherService.name);
  private timer?: NodeJS.Timeout;
  private flushing = false;
  private metrics = {
    published: 0,
    failed: 0,
    replayPublished: 0,
    replayFailed: 0,
    flushRuns: 0,
    lastFlushAt: 0,
  };

  constructor(
    private readonly redisService: RedisService,
    private readonly persistence: RuntimePersistenceService,
    private readonly runtimeActionLogIngestionService: RuntimeActionLogIngestionService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.flushOutbox();
    }, 2000);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async dispatch(event: RuntimeEvent, options?: { channel?: string; updateOutboxStatus?: boolean; replay?: boolean }): Promise<void> {
    const channel = options?.channel || this.getChannel(event);
    const shouldUpdateOutboxStatus = options?.updateOutboxStatus !== false;
    try {
      if (!this.redisService.isReady()) {
        throw new Error('Redis pub/sub is not ready');
      }
      await this.redisService.publish(channel, event);
      if (!options?.replay) {
        await this.runtimeActionLogIngestionService.syncRuntimeEvent(event);
      }
      if (options?.replay) {
        this.metrics.replayPublished += 1;
      } else {
        this.metrics.published += 1;
      }
      if (shouldUpdateOutboxStatus) {
        await this.persistence.markEventDispatched(event.eventId);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown hook dispatch error';
      if (options?.replay) {
        this.metrics.replayFailed += 1;
      } else {
        this.metrics.failed += 1;
      }
      this.logger.warn(`Hook dispatch failed eventId=${event.eventId} type=${event.eventType}: ${message}`);
      if (shouldUpdateOutboxStatus) {
        await this.persistence.markEventFailed(event.eventId, message);
      }
    }
  }

  async flushOutbox(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      this.metrics.flushRuns += 1;
      this.metrics.lastFlushAt = Date.now();
      const records = await this.persistence.findDispatchableEvents(100);
      for (const record of records) {
        const event: RuntimeEvent = {
          eventId: record.eventId,
          eventType: record.eventType as RuntimeEvent['eventType'],
          agentId: record.agentId,
          sessionId: record.sessionId,
          runId: record.runId,
          taskId: record.taskId,
          messageId: record.messageId,
          partId: record.partId,
          toolCallId: record.toolCallId,
          sequence: record.sequence,
          timestamp: record.timestamp.getTime(),
          traceId: (record.payload?.traceId as string) || `trace-replay-${record.eventId}`,
          payload: record.payload || {},
        };
        await this.dispatch(event);
      }
    } finally {
      this.flushing = false;
    }
  }

  getMetrics() {
    return {
      ...this.metrics,
      queueFlushing: this.flushing,
    };
  }

  private getChannel(event: RuntimeEvent): string {
    return `agent-runtime:${event.agentId}`;
  }
}
