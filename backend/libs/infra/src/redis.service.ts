import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { createServiceLogger } from '@libs/common';

type MessageListener = (message: string) => void;

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = createServiceLogger(RedisService.name);
  private readonly redisUrl = this.buildRedisUrl();
  private readonly publisher: Redis;
  private readonly subscriber: Redis;
  private readonly listeners = new Map<string, Set<MessageListener>>();
  private ready = false;

  constructor() {
    const redisOptions = {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    };

    this.publisher = new Redis(this.redisUrl, redisOptions);
    this.subscriber = new Redis(this.redisUrl, redisOptions);

    this.publisher.on('error', (err) => {
      this.ready = false;
      this.logger.warn(`Redis publisher unavailable: ${err.message}`);
    });

    this.subscriber.on('error', (err) => {
      this.ready = false;
      this.logger.warn(`Redis subscriber unavailable: ${err.message}`);
    });

    this.subscriber.on('message', (channel, message) => {
      const channelListeners = this.listeners.get(channel);
      if (!channelListeners) return;
      channelListeners.forEach((listener) => listener(message));
    });

    void this.initialize();
  }

  private buildRedisUrl(): string {
    const password = process.env.REDIS_PASSWORD || '';
    const db = process.env.REDIS_DB || '0';

    const rawUrl = process.env.REDIS_URL;
    if (rawUrl) {
      try {
        const parsed = new URL(rawUrl);
        if (!parsed.password && password) {
          parsed.password = password;
        }
        if (!parsed.pathname || parsed.pathname === '/') {
          parsed.pathname = `/${db}`;
        }
        return parsed.toString();
      } catch {
        // fallback to host/port builder below
      }
    }

    const host = process.env.REDIS_HOST || '127.0.0.1';
    const port = process.env.REDIS_PORT || '6379';
    const authPart = password ? `:${encodeURIComponent(password)}@` : '';
    return `redis://${authPart}${host}:${port}/${db}`;
  }

  private async initialize(): Promise<void> {
    try {
      await this.publisher.connect();
      await this.subscriber.connect();
      this.ready = true;
      this.logger.log(`Redis connected: ${this.redisUrl}`);
    } catch (error) {
      this.ready = false;
      const message = error instanceof Error ? error.message : 'Unknown redis connection error';
      this.logger.warn(`Redis disabled, falling back to no-op bus: ${message}`);
    }
  }

  async publish(channel: string, payload: unknown): Promise<number> {
    if (!this.ready) return 0;
    const message = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return this.publisher.publish(channel, message);
  }

  async subscribe(channel: string, listener: MessageListener): Promise<void> {
    if (!this.ready) return;
    const existing = this.listeners.get(channel) || new Set<MessageListener>();
    const needsSubscribe = existing.size === 0;
    existing.add(listener);
    this.listeners.set(channel, existing);

    if (needsSubscribe) {
      await this.subscriber.subscribe(channel);
    }
  }

  async unsubscribe(channel: string, listener: MessageListener): Promise<void> {
    if (!this.ready) return;
    const existing = this.listeners.get(channel);
    if (!existing) return;

    existing.delete(listener);
    if (existing.size > 0) return;

    this.listeners.delete(channel);
    await this.subscriber.unsubscribe(channel);
  }

  async onModuleDestroy(): Promise<void> {
    try {
      if (this.publisher.status === 'ready') {
        await this.publisher.quit();
      }
      if (this.subscriber.status === 'ready') {
        await this.subscriber.quit();
      }
    } catch {
      // noop
    }
  }
}
