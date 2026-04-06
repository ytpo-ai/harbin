import type { AdapterType } from './message-adapter.port';

export type DeliveryMode = 'fire-and-forget' | 'reliable';

export interface TopicConfig {
  /** topic 名称（全局唯一，业务代码使用此名称发布/订阅） */
  name: string;
  /** 投递语义 */
  deliveryMode: DeliveryMode;
  /** 首选适配器 */
  adapter: AdapterType;
  /**
   * 底层 key（channel / stream key）。
   * 支持 `{partitionKey}` 占位符，运行时用 headers.partitionKey 替换。
   * 如不指定，默认基于 topic 名称生成。
   */
  backendKey?: string;
  /** Consumer group（reliable 模式） */
  consumerGroup?: string;
  /** DLQ stream/queue key */
  dlqKey?: string;
  /** 最大重试次数（默认 5） */
  maxRetries?: number;
  /** 重试退避基数 ms（默认 5000） */
  retryBackoffMs?: number;
  /** Stream maxLen（防止无限增长，默认 100000） */
  maxLen?: number;
}

// ── 默认 Topic 注册表（首批） ─────────────────────────────────────────────────

export const DEFAULT_TOPICS: TopicConfig[] = [
  // ── fire-and-forget（PubSub）──────────────────────────────────────────────
  {
    name: 'runtime.events',
    deliveryMode: 'fire-and-forget',
    adapter: 'redis-pubsub',
    backendKey: 'agent-runtime:{partitionKey}',
  },
  {
    name: 'task.events',
    deliveryMode: 'fire-and-forget',
    adapter: 'redis-pubsub',
    backendKey: 'agent-task-events:{partitionKey}',
  },
  {
    name: 'meeting.events',
    deliveryMode: 'fire-and-forget',
    adapter: 'redis-pubsub',
    backendKey: 'meeting:{partitionKey}',
  },

  // ── reliable（Redis Streams）──────────────────────────────────────────────
  {
    name: 'runtime.ei-sync',
    deliveryMode: 'reliable',
    adapter: 'redis-stream',
    backendKey: 'streams:runtime:ei-sync',
    consumerGroup: 'ei-sync-group',
    dlqKey: 'streams:runtime:ei-sync:dlq',
    maxRetries: 5,
    retryBackoffMs: 5000,
    maxLen: 100000,
  },
  {
    name: 'message-center.events',
    deliveryMode: 'reliable',
    adapter: 'redis-stream',
    backendKey: 'streams:message-center:events',
    consumerGroup: 'message-center-group',
    dlqKey: 'streams:message-center:events:dlq',
    maxRetries: 5,
    retryBackoffMs: 5000,
    maxLen: 100000,
  },
  {
    name: 'channel.events',
    deliveryMode: 'reliable',
    adapter: 'redis-stream',
    backendKey: 'streams:channel:events',
    consumerGroup: 'channel-group',
    dlqKey: 'streams:channel:events:dlq',
    maxRetries: 5,
    retryBackoffMs: 5000,
    maxLen: 100000,
  },
];

/**
 * TopicRegistry：管理 topic 注册表，支持运行时注册和查询。
 */
export class TopicRegistry {
  private readonly topics = new Map<string, TopicConfig>();

  constructor(initialTopics: TopicConfig[] = DEFAULT_TOPICS) {
    for (const topic of initialTopics) {
      this.topics.set(topic.name, topic);
    }
  }

  /** 注册 / 覆盖一个 topic 配置 */
  register(config: TopicConfig): void {
    this.topics.set(config.name, config);
  }

  /** 查询 topic 配置，不存在则返回 undefined */
  get(topicName: string): TopicConfig | undefined {
    return this.topics.get(topicName);
  }

  /** 列出所有已注册 topic */
  list(): TopicConfig[] {
    return Array.from(this.topics.values());
  }

  /** 解析 backendKey 中的 {partitionKey} 占位符 */
  resolveBackendKey(config: TopicConfig, partitionKey?: string): string {
    const raw = config.backendKey || `streams:${config.name.replace(/\./g, ':')}`;
    if (!partitionKey) return raw;
    return raw.replace('{partitionKey}', partitionKey);
  }
}
