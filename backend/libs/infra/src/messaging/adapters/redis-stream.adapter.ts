import { randomUUID } from 'crypto';
import { createServiceLogger } from '@libs/common';
import type { RedisService } from '../../redis.service';
import type { MessageEnvelope } from '../message-envelope';
import type { MessageHandler, NackOptions, PublishResult, SubscribeOptions, Subscription } from '../message-bus.port';
import type { MessageAdapter } from '../message-adapter.port';
import type { TopicConfig } from '../topic-registry';
import { TopicRegistry } from '../topic-registry';

/** 从环境变量读取的默认参数 */
const ENV_DEFAULTS = {
  batchSize: Math.max(1, Number(process.env.MESSAGE_BUS_STREAM_BATCH_SIZE || 10)),
  blockMs: Math.max(0, Number(process.env.MESSAGE_BUS_STREAM_BLOCK_MS || 2000)),
  maxRetries: Math.max(0, Number(process.env.MESSAGE_BUS_STREAM_MAX_RETRIES || 5)),
  retryBackoffMs: Math.max(100, Number(process.env.MESSAGE_BUS_STREAM_RETRY_BACKOFF_MS || 5000)),
  defaultMaxLen: Math.max(1000, Number(process.env.MESSAGE_BUS_STREAM_DEFAULT_MAX_LEN || 100000)),
};

/**
 * Redis Streams 适配器 —— reliable（至少一次投递）模式。
 *
 * - publish：xadd 写入 stream（带 MAXLEN 裁剪）
 * - subscribe：创建 consumer group → while 循环 xreadgroup → handler → xack / DLQ
 * - ack/nack：对应 xack 和重试/DLQ 逻辑
 * - 幂等：消费方通过 envelope.messageId 做幂等去重（框架不强制，由业务决定）
 */
export class RedisStreamAdapter implements MessageAdapter {
  readonly type = 'redis-stream' as const;
  private readonly logger = createServiceLogger('RedisStreamAdapter');
  private readonly registry: TopicRegistry;

  constructor(
    private readonly redis: RedisService,
    registry: TopicRegistry,
  ) {
    this.registry = registry;
  }

  // ── Publish ──────────────────────────────────────────────────────────────

  async publish(envelope: MessageEnvelope, config: TopicConfig): Promise<PublishResult> {
    const streamKey = this.registry.resolveBackendKey(config, envelope.headers.partitionKey);
    const maxLen = config.maxLen ?? ENV_DEFAULTS.defaultMaxLen;

    try {
      const fields: Record<string, string> = {
        event: JSON.stringify(envelope),
      };
      const sequenceId = await this.redis.xadd(streamKey, fields, { maxLen, approximate: true });
      return {
        messageId: envelope.messageId,
        sequenceId: sequenceId ?? undefined,
        accepted: !!sequenceId,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[stream_publish_failed] topic=${config.name} stream=${streamKey} error=${msg}`);
      return { messageId: envelope.messageId, accepted: false };
    }
  }

  // ── Subscribe ────────────────────────────────────────────────────────────

  async subscribe(
    config: TopicConfig,
    handler: MessageHandler<unknown>,
    options?: SubscribeOptions,
  ): Promise<Subscription> {
    const streamKey = this.registry.resolveBackendKey(config, undefined);
    const group = options?.group || config.consumerGroup || `${config.name}-group`;
    const consumer = options?.consumer || `consumer-${randomUUID().slice(0, 8)}`;
    const batchSize = options?.batchSize ?? ENV_DEFAULTS.batchSize;
    const blockMs = options?.blockMs ?? ENV_DEFAULTS.blockMs;
    const maxRetries = config.maxRetries ?? ENV_DEFAULTS.maxRetries;
    const dlqKey = config.dlqKey;

    let running = true;

    const loop = async () => {
      // 确保 consumer group 存在
      await this.ensureGroup(streamKey, group);

      while (running) {
        if (!this.redis.isReady()) {
          await this.sleep(1000);
          continue;
        }

        try {
          const results = await this.redis.xreadgroup(streamKey, group, consumer, {
            count: batchSize,
            blockMs,
            streamId: '>',
          });

          if (!results.length) continue;

          for (const streamResult of results) {
            for (const message of streamResult.messages) {
              if (!running) break;
              await this.processMessage(
                streamKey,
                group,
                message.id,
                message.fields,
                config,
                handler,
                maxRetries,
                dlqKey,
              );
            }
          }
        } catch (error) {
          if (!running) break;
          const msg = error instanceof Error ? error.message : String(error);
          this.logger.warn(
            `[stream_consume_error] topic=${config.name} stream=${streamKey} group=${group} error=${msg}`,
          );
          await this.sleep(1000);
        }
      }
    };

    // 启动 consumer loop（不阻塞当前调用）
    void loop();

    return {
      unsubscribe: async () => {
        running = false;
      },
    };
  }

  // ── 单条消息处理 ─────────────────────────────────────────────────────────

  private async processMessage(
    streamKey: string,
    group: string,
    entryId: string,
    fields: Record<string, string>,
    config: TopicConfig,
    handler: MessageHandler<unknown>,
    maxRetries: number,
    dlqKey?: string,
  ): Promise<void> {
    let envelope: MessageEnvelope;
    try {
      const raw = fields['event'] || fields['data'] || '';
      envelope = JSON.parse(raw) as MessageEnvelope;
    } catch {
      this.logger.warn(
        `[stream_parse_error] topic=${config.name} stream=${streamKey} entryId=${entryId} — moving to DLQ`,
      );
      await this.moveToDlq(streamKey, group, entryId, fields, dlqKey, 'parse_error');
      return;
    }

    const retryCount = envelope.headers?.retryCount ?? 0;
    let nackCalled = false;
    let nackReason: string | undefined;
    let nackNoRetry = false;

    try {
      await handler({
        envelope,
        ack: async () => {
          await this.redis.xack(streamKey, group, [entryId]);
        },
        nack: async (reason?: string, options?: NackOptions) => {
          nackCalled = true;
          nackReason = reason;
          nackNoRetry = options?.noRetry === true;
        },
      });

      // handler 正常返回且未调用 nack → 自动 ack
      if (!nackCalled) {
        await this.redis.xack(streamKey, group, [entryId]);
        return;
      }

      // handler 调用了 nack → 决定重试还是 DLQ
      await this.handleNack(
        streamKey,
        group,
        entryId,
        fields,
        envelope,
        retryCount,
        nackNoRetry ? 0 : maxRetries,
        dlqKey,
        nackReason,
        config,
      );
    } catch (error) {
      // handler 抛异常 → 等同可重试 nack
      const msg = error instanceof Error ? error.message : String(error);
      await this.handleNack(
        streamKey,
        group,
        entryId,
        fields,
        envelope,
        retryCount,
        maxRetries,
        dlqKey,
        msg,
        config,
      );
    }
  }

  // ── Nack 处理（重试 / DLQ）──────────────────────────────────────────────

  private async handleNack(
    streamKey: string,
    group: string,
    entryId: string,
    fields: Record<string, string>,
    envelope: MessageEnvelope,
    retryCount: number,
    maxRetries: number,
    dlqKey: string | undefined,
    reason: string | undefined,
    config: TopicConfig,
  ): Promise<void> {
    // 先 ack 当前条目（防止被 pending 反复消费）
    await this.redis.xack(streamKey, group, [entryId]);

    if (retryCount < maxRetries) {
      // 重试：写回同一 stream，retryCount + 1
      const retryEnvelope: MessageEnvelope = {
        ...envelope,
        headers: {
          ...envelope.headers,
          retryCount: retryCount + 1,
          correlationId: envelope.headers?.correlationId || envelope.messageId,
          lastNackReason: reason,
        },
      };
      const maxLen = config.maxLen ?? ENV_DEFAULTS.defaultMaxLen;
      await this.redis.xadd(streamKey, { event: JSON.stringify(retryEnvelope) }, { maxLen, approximate: true });
      this.logger.warn(
        `[stream_retry] topic=${config.name} messageId=${envelope.messageId} retry=${retryCount + 1}/${maxRetries} reason=${reason || 'unknown'}`,
      );
    } else {
      // 超过最大重试 → DLQ
      await this.moveToDlq(streamKey, group, entryId, fields, dlqKey, reason);
      this.logger.warn(
        `[stream_dlq] topic=${config.name} messageId=${envelope.messageId} retries_exhausted reason=${reason || 'unknown'}`,
      );
    }
  }

  // ── DLQ ──────────────────────────────────────────────────────────────────

  private async moveToDlq(
    streamKey: string,
    group: string,
    entryId: string,
    fields: Record<string, string>,
    dlqKey: string | undefined,
    reason: string | undefined,
  ): Promise<void> {
    const targetDlq = dlqKey || `${streamKey}:dlq`;
    try {
      await this.redis.xadd(
        targetDlq,
        {
          ...fields,
          dlq_reason: reason || 'unknown',
          dlq_source_stream: streamKey,
          dlq_source_group: group,
          dlq_source_entry_id: entryId,
          dlq_timestamp: new Date().toISOString(),
        },
        { maxLen: 10000, approximate: true },
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[stream_dlq_write_failed] stream=${streamKey} dlq=${targetDlq} error=${msg}`);
    }
  }

  // ── Consumer Group 管理 ─────────────────────────────────────────────────

  private async ensureGroup(streamKey: string, group: string): Promise<void> {
    try {
      await this.redis.xgroupCreate(streamKey, group, '0', true);
    } catch {
      // BUSYGROUP 已由 RedisService 静默处理
    }
  }

  // ── Health Check ────────────────────────────────────────────────────────

  async healthCheck(): Promise<{ healthy: boolean; details?: string }> {
    const ready = this.redis.isReady();
    return { healthy: ready, details: ready ? 'redis streams ready' : 'redis not ready' };
  }

  // ── Utils ───────────────────────────────────────────────────────────────

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
