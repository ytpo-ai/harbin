import { createServiceLogger } from '@libs/common';
import type { RedisService } from '../../redis.service';
import type { MessageEnvelope } from '../message-envelope';
import type { MessageHandler, PublishResult, SubscribeOptions, Subscription } from '../message-bus.port';
import type { MessageAdapter } from '../message-adapter.port';
import type { TopicConfig } from '../topic-registry';
import { TopicRegistry } from '../topic-registry';

/**
 * Redis Pub/Sub 适配器 —— fire-and-forget 模式。
 *
 * - publish：将 envelope JSON 发布到动态 channel（backendKey + partitionKey）
 * - subscribe：注册 channel listener，接收到消息后包装为 MessageContext 回调 handler
 * - ack/nack：空操作（pub/sub 无确认语义）
 *
 * 向后兼容：保留与现有 `agent-runtime:{agentId}` 完全相同的 channel 名和 payload 格式。
 */
export class RedisPubSubAdapter implements MessageAdapter {
  readonly type = 'redis-pubsub' as const;
  private readonly logger = createServiceLogger('RedisPubSubAdapter');
  private readonly registry: TopicRegistry;

  constructor(
    private readonly redis: RedisService,
    registry: TopicRegistry,
  ) {
    this.registry = registry;
  }

  async publish(envelope: MessageEnvelope, config: TopicConfig): Promise<PublishResult> {
    const channel = this.registry.resolveBackendKey(config, envelope.headers.partitionKey);
    try {
      const message = JSON.stringify(envelope);
      await this.redis.publish(channel, message);
      return { messageId: envelope.messageId, accepted: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[pubsub_publish_failed] topic=${config.name} channel=${channel} error=${msg}`);
      return { messageId: envelope.messageId, accepted: false };
    }
  }

  async subscribe(
    config: TopicConfig,
    handler: MessageHandler<unknown>,
    options?: SubscribeOptions,
  ): Promise<Subscription> {
    // pubsub 模式下 partitionKey 可能在运行时动态变化，这里使用 backendKey 原样注册。
    // 如果 backendKey 包含 {partitionKey}，调用方需自行管理多个 subscription。
    const channel = config.backendKey || config.name;
    const listener = async (raw: string) => {
      try {
        const envelope = JSON.parse(raw) as MessageEnvelope;
        await handler({
          envelope,
          ack: async () => {
            /* no-op for pubsub */
          },
          nack: async () => {
            /* no-op for pubsub */
          },
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `[pubsub_consume_error] topic=${config.name} channel=${channel} error=${msg}`,
        );
      }
    };

    await this.redis.subscribe(channel, listener);

    return {
      unsubscribe: async () => {
        await this.redis.unsubscribe(channel, listener);
      },
    };
  }

  async healthCheck(): Promise<{ healthy: boolean; details?: string }> {
    const ready = this.redis.isReady();
    return { healthy: ready, details: ready ? 'redis pub/sub ready' : 'redis not ready' };
  }
}
