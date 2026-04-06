import type { MessageEnvelope, MessageHeaders } from './message-envelope';

// ── Publish ──────────────────────────────────────────────────────────────────

export interface PublishInput<T = unknown> {
  payload: T;
  headers?: Partial<MessageHeaders>;
  /** 覆盖默认分区键（pubsub 模式下用于拼接 channel 名） */
  partitionKey?: string;
}

export interface PublishResult {
  messageId: string;
  /** stream 模式下为 stream entry ID */
  sequenceId?: string;
  accepted: boolean;
}

// ── Subscribe ────────────────────────────────────────────────────────────────

export interface MessageContext<T = unknown> {
  envelope: MessageEnvelope<T>;
  /** 确认消费成功（reliable 模式有效） */
  ack(): Promise<void>;
  /** 拒绝消费，触发重试或进入 DLQ（reliable 模式有效） */
  nack(reason?: string): Promise<void>;
}

export interface MessageHandler<T = unknown> {
  (context: MessageContext<T>): Promise<void>;
}

export interface SubscribeOptions {
  /** Consumer group 名称（reliable 模式必填） */
  group?: string;
  /** Consumer 实例名称 */
  consumer?: string;
  /** 批量拉取大小 */
  batchSize?: number;
  /** 阻塞等待超时 ms */
  blockMs?: number;
}

export interface Subscription {
  unsubscribe(): Promise<void>;
}

// ── MessageBus Port ──────────────────────────────────────────────────────────

/** DI token，业务层通过 @Inject(MESSAGE_BUS) 获取 */
export const MESSAGE_BUS = Symbol('MESSAGE_BUS');

/**
 * 统一消息总线接口（Port）。
 * 业务代码面向此接口编程，不感知底层中间件。
 */
export interface MessageBus {
  /**
   * 发布消息到指定 topic。
   * - fire-and-forget 模式：不等待消费确认，适合实时通知
   * - reliable 模式：保证至少一次投递，支持 ack/nack
   */
  publish<T>(topic: string, message: PublishInput<T>): Promise<PublishResult>;

  /**
   * 订阅指定 topic。
   * 返回 Subscription 对象用于取消订阅。
   */
  subscribe<T>(
    topic: string,
    handler: MessageHandler<T>,
    options?: SubscribeOptions,
  ): Promise<Subscription>;
}
