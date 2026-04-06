import { RedisPubSubAdapter } from '../adapters/redis-pubsub.adapter';
import { TopicRegistry } from '../topic-registry';
import type { MessageEnvelope } from '../message-envelope';
import type { TopicConfig } from '../topic-registry';
import type { RedisService } from '../../redis.service';

function createMockRedis(overrides?: Partial<RedisService>): RedisService {
  return {
    publish: jest.fn().mockResolvedValue(1),
    subscribe: jest.fn().mockResolvedValue(undefined),
    unsubscribe: jest.fn().mockResolvedValue(undefined),
    isReady: jest.fn().mockReturnValue(true),
    ...overrides,
  } as unknown as RedisService;
}

function createEnvelope(overrides?: Partial<MessageEnvelope>): MessageEnvelope {
  return {
    messageId: 'msg-001',
    topic: 'runtime.events',
    payload: { foo: 'bar' },
    headers: { traceId: 'trace-001', partitionKey: 'agent-123' },
    timestamp: '2026-04-07T00:00:00.000Z',
    ...overrides,
  };
}

describe('RedisPubSubAdapter', () => {
  let redis: RedisService;
  let registry: TopicRegistry;
  let adapter: RedisPubSubAdapter;

  const topicConfig: TopicConfig = {
    name: 'runtime.events',
    deliveryMode: 'fire-and-forget',
    adapter: 'redis-pubsub',
    backendKey: 'agent-runtime:{partitionKey}',
  };

  beforeEach(() => {
    redis = createMockRedis();
    registry = new TopicRegistry([topicConfig]);
    adapter = new RedisPubSubAdapter(redis, registry);
  });

  describe('publish', () => {
    it('should publish JSON envelope to resolved channel', async () => {
      const envelope = createEnvelope();
      const result = await adapter.publish(envelope, topicConfig);

      expect(result.accepted).toBe(true);
      expect(result.messageId).toBe('msg-001');
      expect(redis.publish).toHaveBeenCalledWith(
        'agent-runtime:agent-123',
        JSON.stringify(envelope),
      );
    });

    it('should return accepted=false when redis.publish throws', async () => {
      redis = createMockRedis({ publish: jest.fn().mockRejectedValue(new Error('conn lost')) });
      adapter = new RedisPubSubAdapter(redis, registry);

      const result = await adapter.publish(createEnvelope(), topicConfig);
      expect(result.accepted).toBe(false);
    });

    it('should use topic name when no partitionKey provided', async () => {
      const config: TopicConfig = { ...topicConfig, backendKey: 'some-channel' };
      const envelope = createEnvelope({ headers: { traceId: 'trace-001' } });
      await adapter.publish(envelope, config);

      expect(redis.publish).toHaveBeenCalledWith('some-channel', expect.any(String));
    });
  });

  describe('subscribe', () => {
    it('should register listener with redis and return unsubscribe handle', async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      const sub = await adapter.subscribe(topicConfig, handler);

      expect(redis.subscribe).toHaveBeenCalledWith(
        'agent-runtime:{partitionKey}',
        expect.any(Function),
      );
      expect(sub.unsubscribe).toBeDefined();
    });

    it('should call handler with parsed envelope when message arrives', async () => {
      let capturedListener: ((msg: string) => void) | undefined;
      redis = createMockRedis({
        subscribe: jest.fn().mockImplementation((_ch: string, listener: (msg: string) => void) => {
          capturedListener = listener;
          return Promise.resolve();
        }),
      });
      adapter = new RedisPubSubAdapter(redis, registry);

      const handler = jest.fn().mockResolvedValue(undefined);
      await adapter.subscribe(topicConfig, handler);

      const envelope = createEnvelope();
      capturedListener!(JSON.stringify(envelope));

      // Give async handler time to execute
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          envelope: expect.objectContaining({ messageId: 'msg-001' }),
        }),
      );
    });
  });

  describe('healthCheck', () => {
    it('should return healthy when redis is ready', async () => {
      const result = await adapter.healthCheck();
      expect(result.healthy).toBe(true);
    });

    it('should return unhealthy when redis is not ready', async () => {
      redis = createMockRedis({ isReady: jest.fn().mockReturnValue(false) });
      adapter = new RedisPubSubAdapter(redis, registry);

      const result = await adapter.healthCheck();
      expect(result.healthy).toBe(false);
    });
  });
});
