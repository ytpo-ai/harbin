import { TopicRouterService } from '../topic-router.service';
import { TopicRegistry } from '../topic-registry';
import type { TopicConfig } from '../topic-registry';
import type { MessageAdapter } from '../message-adapter.port';

function createMockAdapter(type: 'redis-pubsub' | 'redis-stream'): MessageAdapter {
  return {
    type,
    publish: jest.fn().mockResolvedValue({ messageId: 'msg-1', accepted: true }),
    subscribe: jest.fn().mockResolvedValue({ unsubscribe: jest.fn() }),
    healthCheck: jest.fn().mockResolvedValue({ healthy: true }),
  };
}

describe('TopicRouterService', () => {
  let registry: TopicRegistry;
  let router: TopicRouterService;

  const pubsubTopic: TopicConfig = {
    name: 'runtime.events',
    deliveryMode: 'fire-and-forget',
    adapter: 'redis-pubsub',
    backendKey: 'agent-runtime:{partitionKey}',
  };

  const streamTopic: TopicConfig = {
    name: 'runtime.ei-sync',
    deliveryMode: 'reliable',
    adapter: 'redis-stream',
    backendKey: 'streams:runtime:ei-sync',
    consumerGroup: 'ei-sync-group',
    dlqKey: 'streams:runtime:ei-sync:dlq',
    maxRetries: 5,
    maxLen: 100000,
  };

  beforeEach(() => {
    registry = new TopicRegistry([pubsubTopic, streamTopic]);
    router = new TopicRouterService(registry);
  });

  describe('resolve', () => {
    it('should resolve to redis-pubsub adapter for fire-and-forget topic', () => {
      const pubsub = createMockAdapter('redis-pubsub');
      router.registerAdapter(pubsub);

      const { adapter, config } = router.resolve('runtime.events');
      expect(adapter).toBe(pubsub);
      expect(config.name).toBe('runtime.events');
      expect(config.deliveryMode).toBe('fire-and-forget');
    });

    it('should resolve to redis-stream adapter for reliable topic', () => {
      const stream = createMockAdapter('redis-stream');
      router.registerAdapter(stream);

      const { adapter, config } = router.resolve('runtime.ei-sync');
      expect(adapter).toBe(stream);
      expect(config.name).toBe('runtime.ei-sync');
      expect(config.deliveryMode).toBe('reliable');
    });

    it('should throw for unknown topic', () => {
      expect(() => router.resolve('unknown.topic')).toThrow('Unknown topic');
    });

    it('should throw when adapter not registered', () => {
      // topic registered but no adapter
      expect(() => router.resolve('runtime.events')).toThrow('No adapter registered');
    });
  });

  describe('healthCheck', () => {
    it('should return health of all registered adapters', async () => {
      const pubsub = createMockAdapter('redis-pubsub');
      const stream = createMockAdapter('redis-stream');
      router.registerAdapter(pubsub);
      router.registerAdapter(stream);

      const results = await router.healthCheck();
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.healthy)).toBe(true);
    });
  });

  describe('getRegistry', () => {
    it('should return the registry instance', () => {
      expect(router.getRegistry()).toBe(registry);
    });
  });
});
