import { MessageBusService } from '../message-bus.service';
import type { RedisService } from '../../redis.service';

function createMockRedis(overrides?: Partial<RedisService>): RedisService {
  return {
    publish: jest.fn().mockResolvedValue(1),
    subscribe: jest.fn().mockResolvedValue(undefined),
    unsubscribe: jest.fn().mockResolvedValue(undefined),
    xadd: jest.fn().mockResolvedValue('1234567890-0'),
    xgroupCreate: jest.fn().mockResolvedValue(undefined),
    xreadgroup: jest.fn().mockResolvedValue([]),
    xack: jest.fn().mockResolvedValue(1),
    isReady: jest.fn().mockReturnValue(true),
    ...overrides,
  } as unknown as RedisService;
}

describe('MessageBusService', () => {
  let redis: RedisService;
  let service: MessageBusService;

  beforeEach(() => {
    process.env.MESSAGE_BUS_ENABLED = 'true';
    redis = createMockRedis();
    service = new MessageBusService(redis);
    service.onModuleInit();
  });

  afterEach(() => {
    delete process.env.MESSAGE_BUS_ENABLED;
  });

  describe('publish (fire-and-forget)', () => {
    it('should publish to redis pubsub for runtime.events topic', async () => {
      const result = await service.publish('runtime.events', {
        payload: { type: 'hook.started' },
        partitionKey: 'agent-abc',
      });

      expect(result.accepted).toBe(true);
      expect(result.messageId).toBeDefined();
      expect(redis.publish).toHaveBeenCalledWith(
        'agent-runtime:agent-abc',
        expect.any(String),
      );
    });
  });

  describe('publish (reliable)', () => {
    it('should xadd to stream for runtime.ei-sync topic', async () => {
      const result = await service.publish('runtime.ei-sync', {
        payload: { runId: 'run-1', events: [] },
      });

      expect(result.accepted).toBe(true);
      expect(result.sequenceId).toBe('1234567890-0');
      expect(redis.xadd).toHaveBeenCalledWith(
        'streams:runtime:ei-sync',
        expect.objectContaining({ event: expect.any(String) }),
        expect.objectContaining({ maxLen: 100000 }),
      );
    });
  });

  describe('publish unknown topic', () => {
    it('should throw for unregistered topic', async () => {
      await expect(
        service.publish('unknown.topic', { payload: {} }),
      ).rejects.toThrow('Unknown topic');
    });
  });

  describe('disabled mode', () => {
    it('should return not-accepted when disabled', async () => {
      process.env.MESSAGE_BUS_ENABLED = 'false';
      const disabled = new MessageBusService(redis);
      disabled.onModuleInit();

      const result = await disabled.publish('runtime.events', {
        payload: {},
        partitionKey: 'x',
      });
      expect(result.accepted).toBe(false);
    });

    it('should return no-op subscription when disabled', async () => {
      process.env.MESSAGE_BUS_ENABLED = 'false';
      const disabled = new MessageBusService(redis);
      disabled.onModuleInit();

      const sub = await disabled.subscribe('runtime.events', async () => {});
      expect(sub.unsubscribe).toBeDefined();
    });
  });

  describe('subscribe', () => {
    it('should subscribe to pubsub topic', async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      const sub = await service.subscribe('runtime.events', handler);

      expect(sub.unsubscribe).toBeDefined();
      expect(redis.subscribe).toHaveBeenCalled();
    });

    it('should subscribe to stream topic', async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      const sub = await service.subscribe('runtime.ei-sync', handler, {
        group: 'ei-sync-group',
        consumer: 'test',
      });

      // Let the consumer loop start
      await new Promise((resolve) => setTimeout(resolve, 50));
      await sub.unsubscribe();

      expect(redis.xgroupCreate).toHaveBeenCalled();
    });
  });

  describe('registerTopic', () => {
    it('should allow registering new topics at runtime', () => {
      service.registerTopic({
        name: 'custom.topic',
        deliveryMode: 'reliable',
        adapter: 'redis-stream',
        backendKey: 'streams:custom',
        consumerGroup: 'custom-group',
        maxLen: 50000,
      });

      const topics = service.listTopics();
      expect(topics.some((t) => t.name === 'custom.topic')).toBe(true);
    });
  });

  describe('healthCheck', () => {
    it('should return adapter health status', async () => {
      const results = await service.healthCheck();
      expect(results.length).toBeGreaterThan(0);
      expect(results.every((r) => r.healthy)).toBe(true);
    });
  });

  describe('listTopics', () => {
    it('should return all default topics', () => {
      const topics = service.listTopics();
      expect(topics.length).toBeGreaterThanOrEqual(6);
      expect(topics.map((t) => t.name)).toContain('runtime.events');
      expect(topics.map((t) => t.name)).toContain('runtime.ei-sync');
      expect(topics.map((t) => t.name)).toContain('message-center.events');
      expect(topics.map((t) => t.name)).toContain('channel.events');
    });
  });
});
