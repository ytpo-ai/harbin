import { RedisStreamAdapter } from '../adapters/redis-stream.adapter';
import { TopicRegistry } from '../topic-registry';
import type { MessageEnvelope } from '../message-envelope';
import type { TopicConfig } from '../topic-registry';
import type { RedisService } from '../../redis.service';

function createMockRedis(overrides?: Partial<RedisService>): RedisService {
  return {
    xadd: jest.fn().mockResolvedValue('1234567890-0'),
    xgroupCreate: jest.fn().mockResolvedValue(undefined),
    xreadgroup: jest.fn().mockResolvedValue([]),
    xack: jest.fn().mockResolvedValue(1),
    isReady: jest.fn().mockReturnValue(true),
    ...overrides,
  } as unknown as RedisService;
}

function createEnvelope(overrides?: Partial<MessageEnvelope>): MessageEnvelope {
  return {
    messageId: 'msg-001',
    topic: 'runtime.ei-sync',
    payload: { runId: 'run-1', events: [] },
    headers: { traceId: 'trace-001', retryCount: 0, correlationId: 'msg-001' },
    timestamp: '2026-04-07T00:00:00.000Z',
    ...overrides,
  };
}

describe('RedisStreamAdapter', () => {
  let redis: RedisService;
  let registry: TopicRegistry;
  let adapter: RedisStreamAdapter;

  const topicConfig: TopicConfig = {
    name: 'runtime.ei-sync',
    deliveryMode: 'reliable',
    adapter: 'redis-stream',
    backendKey: 'streams:runtime:ei-sync',
    consumerGroup: 'ei-sync-group',
    dlqKey: 'streams:runtime:ei-sync:dlq',
    maxRetries: 3,
    retryBackoffMs: 100,
    maxLen: 10000,
  };

  beforeEach(() => {
    redis = createMockRedis();
    registry = new TopicRegistry([topicConfig]);
    adapter = new RedisStreamAdapter(redis, registry);
  });

  describe('publish', () => {
    it('should xadd envelope JSON to the correct stream with maxLen', async () => {
      const envelope = createEnvelope();
      const result = await adapter.publish(envelope, topicConfig);

      expect(result.accepted).toBe(true);
      expect(result.messageId).toBe('msg-001');
      expect(result.sequenceId).toBe('1234567890-0');
      expect(redis.xadd).toHaveBeenCalledWith(
        'streams:runtime:ei-sync',
        { event: JSON.stringify(envelope) },
        { maxLen: 10000, approximate: true },
      );
    });

    it('should return accepted=false when xadd returns null', async () => {
      redis = createMockRedis({ xadd: jest.fn().mockResolvedValue(null) });
      adapter = new RedisStreamAdapter(redis, registry);

      const result = await adapter.publish(createEnvelope(), topicConfig);
      expect(result.accepted).toBe(false);
    });

    it('should return accepted=false when xadd throws', async () => {
      redis = createMockRedis({ xadd: jest.fn().mockRejectedValue(new Error('stream error')) });
      adapter = new RedisStreamAdapter(redis, registry);

      const result = await adapter.publish(createEnvelope(), topicConfig);
      expect(result.accepted).toBe(false);
    });
  });

  describe('subscribe', () => {
    it('should ensure consumer group is created', async () => {
      // subscribe starts an async loop; we just verify the group is created
      const handler = jest.fn().mockResolvedValue(undefined);
      const sub = await adapter.subscribe(topicConfig, handler, {
        group: 'ei-sync-group',
        consumer: 'test-consumer',
      });

      // Let the loop start and make one iteration
      await new Promise((resolve) => setTimeout(resolve, 50));
      await sub.unsubscribe();

      expect(redis.xgroupCreate).toHaveBeenCalledWith(
        'streams:runtime:ei-sync',
        'ei-sync-group',
        '0',
        true,
      );
    });

    it('should call handler and auto-ack on success', async () => {
      const envelope = createEnvelope();
      const handler = jest.fn().mockResolvedValue(undefined);

      // First call returns messages, subsequent calls return empty
      let callCount = 0;
      redis = createMockRedis({
        xreadgroup: jest.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            return Promise.resolve([
              {
                stream: 'streams:runtime:ei-sync',
                messages: [{ id: '1-0', fields: { event: JSON.stringify(envelope) } }],
              },
            ]);
          }
          return Promise.resolve([]);
        }),
      });
      adapter = new RedisStreamAdapter(redis, registry);

      const sub = await adapter.subscribe(topicConfig, handler, {
        group: 'ei-sync-group',
        consumer: 'test-consumer',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));
      await sub.unsubscribe();

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          envelope: expect.objectContaining({ messageId: 'msg-001' }),
        }),
      );
      // Auto ack should be called
      expect(redis.xack).toHaveBeenCalledWith(
        'streams:runtime:ei-sync',
        'ei-sync-group',
        ['1-0'],
      );
    });

    it('should move to DLQ when handler throws and retries exhausted', async () => {
      const envelope = createEnvelope({
        headers: { traceId: 'trace-001', retryCount: 3, correlationId: 'msg-001' },
      });

      const handler = jest.fn().mockRejectedValue(new Error('process failed'));

      let callCount = 0;
      redis = createMockRedis({
        xreadgroup: jest.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            return Promise.resolve([
              {
                stream: 'streams:runtime:ei-sync',
                messages: [{ id: '2-0', fields: { event: JSON.stringify(envelope) } }],
              },
            ]);
          }
          return Promise.resolve([]);
        }),
      });
      adapter = new RedisStreamAdapter(redis, registry);

      const sub = await adapter.subscribe(topicConfig, handler, {
        group: 'ei-sync-group',
        consumer: 'test-consumer',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));
      await sub.unsubscribe();

      // Should ack the failed message (to prevent re-delivery of same entry)
      expect(redis.xack).toHaveBeenCalledWith(
        'streams:runtime:ei-sync',
        'ei-sync-group',
        ['2-0'],
      );

      // Should xadd to DLQ
      expect(redis.xadd).toHaveBeenCalledWith(
        'streams:runtime:ei-sync:dlq',
        expect.objectContaining({
          event: JSON.stringify(envelope),
          dlq_reason: 'process failed',
          dlq_source_stream: 'streams:runtime:ei-sync',
        }),
        expect.objectContaining({ maxLen: 10000 }),
      );
    });

    it('should retry when handler throws and retries not exhausted', async () => {
      const envelope = createEnvelope({
        headers: { traceId: 'trace-001', retryCount: 1, correlationId: 'msg-001' },
      });

      const handler = jest.fn().mockRejectedValue(new Error('temp failure'));

      let callCount = 0;
      redis = createMockRedis({
        xreadgroup: jest.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            return Promise.resolve([
              {
                stream: 'streams:runtime:ei-sync',
                messages: [{ id: '3-0', fields: { event: JSON.stringify(envelope) } }],
              },
            ]);
          }
          return Promise.resolve([]);
        }),
      });
      adapter = new RedisStreamAdapter(redis, registry);

      const sub = await adapter.subscribe(topicConfig, handler, {
        group: 'ei-sync-group',
        consumer: 'test-consumer',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));
      await sub.unsubscribe();

      // Should ack the original entry
      expect(redis.xack).toHaveBeenCalledWith(
        'streams:runtime:ei-sync',
        'ei-sync-group',
        ['3-0'],
      );

      // Should xadd retry envelope back to stream (retryCount incremented)
      expect(redis.xadd).toHaveBeenCalledWith(
        'streams:runtime:ei-sync',
        expect.objectContaining({
          event: expect.stringContaining('"retryCount":2'),
        }),
        expect.objectContaining({ maxLen: 10000 }),
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
      adapter = new RedisStreamAdapter(redis, registry);

      const result = await adapter.healthCheck();
      expect(result.healthy).toBe(false);
    });
  });
});
