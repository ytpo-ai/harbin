import { Injectable, OnModuleInit } from '@nestjs/common';
import { createServiceLogger } from '@libs/common';
import { RedisService } from '../redis.service';
import { buildMessageEnvelope } from './message-envelope';
import type { MessageBus, MessageHandler, PublishInput, PublishResult, SubscribeOptions, Subscription } from './message-bus.port';
import type { AdapterType } from './message-adapter.port';
import { TopicRegistry, DEFAULT_TOPICS } from './topic-registry';
import type { TopicConfig } from './topic-registry';
import { TopicRouterService } from './topic-router.service';
import { RedisPubSubAdapter } from './adapters/redis-pubsub.adapter';
import { RedisStreamAdapter } from './adapters/redis-stream.adapter';

/**
 * MessageBusService —— MessageBus 接口的 NestJS Injectable 实现。
 *
 * 初始化时：
 * 1. 创建 TopicRegistry 并加载默认 topic
 * 2. 创建 RedisPubSubAdapter / RedisStreamAdapter
 * 3. 注册到 TopicRouter
 *
 * 业务层通过 @Inject(MESSAGE_BUS) 获取此服务。
 */
@Injectable()
export class MessageBusService implements MessageBus, OnModuleInit {
  private readonly logger = createServiceLogger('MessageBusService');
  private readonly registry: TopicRegistry;
  private readonly router: TopicRouterService;
  private readonly enabled: boolean;

  constructor(private readonly redis: RedisService) {
    this.enabled = process.env.MESSAGE_BUS_ENABLED !== 'false';
    this.registry = new TopicRegistry(DEFAULT_TOPICS);
    this.router = new TopicRouterService(this.registry);
  }

  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.log('MessageBus disabled (MESSAGE_BUS_ENABLED=false)');
      return;
    }

    // 注册内置适配器
    const pubsubAdapter = new RedisPubSubAdapter(this.redis, this.registry);
    const streamAdapter = new RedisStreamAdapter(this.redis, this.registry);

    this.router.registerAdapter(pubsubAdapter);
    this.router.registerAdapter(streamAdapter);

    const topicCount = this.registry.list().length;
    this.logger.log(`MessageBus initialized — ${topicCount} topics registered, 2 adapters (redis-pubsub, redis-stream)`);
  }

  // ── MessageBus 接口实现 ─────────────────────────────────────────────────

  async publish<T>(topic: string, message: PublishInput<T>): Promise<PublishResult> {
    if (!this.enabled) {
      return { messageId: 'disabled', accepted: false };
    }

    const { adapter, config } = this.router.resolve(topic);
    const envelope = buildMessageEnvelope(topic, message.payload, {
      ...message.headers,
      partitionKey: message.partitionKey ?? message.headers?.partitionKey,
    });

    return adapter.publish(envelope, config);
  }

  async subscribe<T>(
    topic: string,
    handler: MessageHandler<T>,
    options?: SubscribeOptions,
  ): Promise<Subscription> {
    if (!this.enabled) {
      return { unsubscribe: async () => {} };
    }

    const { adapter, config } = this.router.resolve(topic);
    return adapter.subscribe(config, handler as MessageHandler<unknown>, options);
  }

  // ── 扩展方法（非接口方法，供运维 / 健康检查使用）──────────────────────────

  /** 运行时注册额外的 topic */
  registerTopic(config: TopicConfig): void {
    this.registry.register(config);
    this.logger.log(`Topic registered at runtime: ${config.name} (adapter=${config.adapter})`);
  }

  /** 获取所有 adapter 健康状态 */
  async healthCheck(): Promise<
    Array<{ type: AdapterType; healthy: boolean; details?: string }>
  > {
    return this.router.healthCheck();
  }

  /** 列出所有已注册 topic */
  listTopics(): TopicConfig[] {
    return this.registry.list();
  }

  /** 获取 TopicRouter 引用（高级用法） */
  getRouter(): TopicRouterService {
    return this.router;
  }
}
