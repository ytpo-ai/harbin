import { randomUUID } from 'crypto';

/**
 * 分布式追踪 & 元数据头。
 * 所有适配器共享同一信封头结构，保证端到端可观测。
 */
export interface MessageHeaders {
  /** 分布式追踪 ID */
  traceId?: string;
  /** 消息分区键（用于保序 / 动态 channel 路由） */
  partitionKey?: string;
  /** 来源服务标识 */
  source?: string;
  /** schema 版本号 */
  schemaVersion?: string;
  /** 重试计数（由框架自动管理，业务不应设置） */
  retryCount?: number;
  /** 原始 messageId（重试时保留首次 ID，用于幂等关联） */
  correlationId?: string;
  /** 自定义扩展头 */
  [key: string]: unknown;
}

/**
 * 统一消息信封。所有通过 MessageBus 发布 / 消费的消息都使用此结构。
 */
export interface MessageEnvelope<T = unknown> {
  /** 全局唯一消息 ID，用于幂等 */
  messageId: string;
  /** topic 名称，路由到对应适配器 */
  topic: string;
  /** 消息体 */
  payload: T;
  /** 追踪 & 元数据头 */
  headers: MessageHeaders;
  /** 消息创建时间 ISO8601 */
  timestamp: string;
}

/**
 * 根据 topic + payload 构建完整信封，自动填充 messageId / timestamp / traceId。
 */
export function buildMessageEnvelope<T>(
  topic: string,
  payload: T,
  headers?: Partial<MessageHeaders>,
): MessageEnvelope<T> {
  const messageId = randomUUID();
  return {
    messageId,
    topic,
    payload,
    headers: {
      traceId: randomUUID(),
      retryCount: 0,
      correlationId: messageId,
      ...headers,
    },
    timestamp: new Date().toISOString(),
  };
}
