// ── Types & Interfaces ───────────────────────────────────────────────────────
export type { MessageEnvelope, MessageHeaders } from './message-envelope';
export { buildMessageEnvelope } from './message-envelope';

export type {
  MessageBus,
  PublishInput,
  PublishResult,
  MessageContext,
  MessageHandler,
  NackOptions,
  SubscribeOptions,
  Subscription,
} from './message-bus.port';
export { MESSAGE_BUS } from './message-bus.port';

export type { MessageAdapter, AdapterType } from './message-adapter.port';

export type { TopicConfig, DeliveryMode } from './topic-registry';
export { TopicRegistry, DEFAULT_TOPICS } from './topic-registry';

// ── Services ─────────────────────────────────────────────────────────────────
export { TopicRouterService } from './topic-router.service';
export { MessageBusService } from './message-bus.service';

// ── Adapters ─────────────────────────────────────────────────────────────────
export { RedisPubSubAdapter } from './adapters/redis-pubsub.adapter';
export { RedisStreamAdapter } from './adapters/redis-stream.adapter';
