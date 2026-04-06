import type { MessageEnvelope } from './message-envelope';
import type { MessageHandler, PublishResult, SubscribeOptions, Subscription } from './message-bus.port';
import type { TopicConfig } from './topic-registry';

export type AdapterType = 'redis-pubsub' | 'redis-stream' | 'rabbitmq';

/**
 * 消息适配器接口。
 * 每种底层中间件实现一个 adapter，由 TopicRouter 按 topic 配置分发。
 */
export interface MessageAdapter {
  readonly type: AdapterType;

  /** 发布消息到底层中间件 */
  publish(envelope: MessageEnvelope, config: TopicConfig): Promise<PublishResult>;

  /** 订阅底层中间件，拉取消息并回调 handler */
  subscribe(
    config: TopicConfig,
    handler: MessageHandler<unknown>,
    options?: SubscribeOptions,
  ): Promise<Subscription>;

  /** 健康探针 */
  healthCheck(): Promise<{ healthy: boolean; details?: string }>;
}
