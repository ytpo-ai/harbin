import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { createServiceLogger } from '@libs/common';

type MessageListener = (message: string) => void;

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = createServiceLogger(RedisService.name);
  private readonly redisUrl = this.buildRedisUrl();
  private readonly sanitizedRedisUrl = this.sanitizeRedisUrl(this.redisUrl);
  private readonly slowOpThresholdMs = Math.max(1, Number(process.env.REDIS_SLOW_OP_THRESHOLD_MS || 200));
  private readonly publisher: Redis;
  private readonly subscriber: Redis;
  private readonly blockingClient: Redis;
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
    this.blockingClient = new Redis(this.redisUrl, redisOptions);

    this.publisher.on('error', (err) => {
      this.ready = false;
      this.logger.warn(`Redis publisher unavailable: ${err.message}`);
    });

    this.subscriber.on('error', (err) => {
      this.ready = false;
      this.logger.warn(`Redis subscriber unavailable: ${err.message}`);
    });

    this.blockingClient.on('error', (err) => {
      this.ready = false;
      this.logger.warn(`Redis blocking client unavailable: ${err.message}`);
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
      await this.blockingClient.connect();
      this.ready = true;
      this.logger.log(`Redis connected: ${this.sanitizedRedisUrl}`);
    } catch (error) {
      this.ready = false;
      const message = error instanceof Error ? error.message : 'Unknown redis connection error';
      this.logger.warn(`Redis disabled, falling back to no-op bus: ${message}`);
    }
  }

  private sanitizeRedisUrl(url: string): string {
    try {
      const parsed = new URL(url);
      if (parsed.password) {
        parsed.password = '***';
      }
      return parsed.toString();
    } catch {
      return url.replace(/(redis:\/\/:)[^@]*@/, '$1***@');
    }
  }

  async publish(channel: string, payload: unknown): Promise<number> {
    if (!this.ready) return 0;
    const message = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return this.publisher.publish(channel, message);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (!this.ready) return;
    const startedAt = Date.now();
    try {
      if (ttlSeconds && ttlSeconds > 0) {
        await this.publisher.set(key, value, 'EX', ttlSeconds);
      } else {
        await this.publisher.set(key, value);
      }
      this.logSlowRedisOp('set', key, startedAt, {
        ttlSeconds: ttlSeconds && ttlSeconds > 0 ? ttlSeconds : undefined,
        valueBytes: Buffer.byteLength(value || '', 'utf8'),
      });
      return;
    } catch (error) {
      this.logRedisOpError('set', key, startedAt, error);
      throw error;
    }
  }

  async get(key: string): Promise<string | null> {
    if (!this.ready) return null;
    const startedAt = Date.now();
    try {
      const value = await this.publisher.get(key);
      this.logSlowRedisOp('get', key, startedAt, {
        hit: Boolean(value),
        valueBytes: value ? Buffer.byteLength(value, 'utf8') : 0,
      });
      return value;
    } catch (error) {
      this.logRedisOpError('get', key, startedAt, error);
      throw error;
    }
  }

  async del(key: string): Promise<number> {
    if (!this.ready) return 0;
    return this.publisher.del(key);
  }

  async delMany(keys: string[]): Promise<number> {
    if (!this.ready) return 0;
    if (!keys.length) return 0;
    return this.publisher.del(...keys);
  }

  async keys(pattern: string): Promise<string[]> {
    if (!this.ready) return [];
    return this.publisher.keys(pattern);
  }

  async expire(key: string, ttlSeconds: number): Promise<number> {
    if (!this.ready) return 0;
    if (!ttlSeconds || ttlSeconds <= 0) return 0;
    return this.publisher.expire(key, ttlSeconds);
  }

  async lpush(key: string, value: string): Promise<number> {
    if (!this.ready) return 0;
    const startedAt = Date.now();
    try {
      const nextLength = await this.publisher.lpush(key, value);
      this.logSlowRedisOp('lpush', key, startedAt, {
        valueBytes: Buffer.byteLength(value || '', 'utf8'),
        nextLength,
      });
      return nextLength;
    } catch (error) {
      this.logRedisOpError('lpush', key, startedAt, error);
      throw error;
    }
  }

  async sadd(key: string, members: string[]): Promise<number> {
    if (!this.ready) return 0;
    if (!members.length) return 0;
    return this.publisher.sadd(key, ...members);
  }

  async srem(key: string, members: string[]): Promise<number> {
    if (!this.ready) return 0;
    if (!members.length) return 0;
    return this.publisher.srem(key, ...members);
  }

  async smembers(key: string): Promise<string[]> {
    if (!this.ready) return [];
    return this.publisher.smembers(key);
  }

  async sunion(keys: string[]): Promise<string[]> {
    if (!this.ready) return [];
    if (!keys.length) return [];
    return this.publisher.sunion(...keys);
  }

  async hset(key: string, values: Record<string, string>): Promise<number> {
    if (!this.ready) return 0;
    if (!Object.keys(values).length) return 0;
    return this.publisher.hset(key, values);
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    if (!this.ready) return {};
    return this.publisher.hgetall(key);
  }

  async zadd(key: string, score: number, member: string): Promise<number> {
    if (!this.ready) return 0;
    return this.publisher.zadd(key, String(score), member);
  }

  async zrevrange(key: string, start: number, stop: number): Promise<string[]> {
    if (!this.ready) return [];
    return this.publisher.zrevrange(key, start, stop);
  }

  async incr(key: string): Promise<number> {
    if (!this.ready) return 0;
    return this.publisher.incr(key);
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    if (!this.ready) return [];
    return this.publisher.lrange(key, start, stop);
  }

  async llen(key: string): Promise<number> {
    if (!this.ready) return 0;
    return this.publisher.llen(key);
  }

  async ltrim(key: string, start: number, stop: number): Promise<'OK' | null> {
    if (!this.ready) return null;
    return this.publisher.ltrim(key, start, stop);
  }

  async brpop(key: string, timeoutSeconds = 1): Promise<string | null> {
    if (!this.ready) return null;
    const startedAt = Date.now();
    try {
      const response = await this.blockingClient.brpop(key, timeoutSeconds);
      const hit = Boolean(response && response.length >= 2);
      if (hit) {
        this.logSlowRedisOp('brpop', key, startedAt, {
          timeoutSeconds,
          hit,
        });
      }
      if (!response || response.length < 2) {
        return null;
      }
      return response[1] || null;
    } catch (error) {
      this.logRedisOpError('brpop', key, startedAt, error);
      throw error;
    }
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

  isReady(): boolean {
    return this.ready;
  }

  private normalizeKeyForLog(key: string): string {
    const normalized = String(key || '').trim();
    if (!normalized) return 'empty';
    if (normalized.length <= 96) return normalized;
    return `${normalized.slice(0, 96)}...`;
  }

  private logSlowRedisOp(op: string, key: string, startedAt: number, extras?: Record<string, unknown>): void {
    const durationMs = Date.now() - startedAt;
    if (durationMs < this.slowOpThresholdMs) {
      return;
    }
    const extraText = extras
      ? Object.entries(extras)
          .filter(([, value]) => value !== undefined)
          .map(([name, value]) => `${name}=${String(value)}`)
          .join(' ')
      : '';
    this.logger.warn(
      `[redis_slow_op] op=${op} key=${this.normalizeKeyForLog(key)} durationMs=${durationMs} publisherStatus=${this.publisher.status} subscriberStatus=${this.subscriber.status} blockingStatus=${this.blockingClient.status} ready=${this.ready}${extraText ? ` ${extraText}` : ''}`,
    );
  }

  private logRedisOpError(op: string, key: string, startedAt: number, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error || 'unknown');
    const durationMs = Date.now() - startedAt;
    this.logger.warn(
      `[redis_op_failed] op=${op} key=${this.normalizeKeyForLog(key)} durationMs=${durationMs} publisherStatus=${this.publisher.status} subscriberStatus=${this.subscriber.status} blockingStatus=${this.blockingClient.status} ready=${this.ready} error=${message}`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    try {
      if (this.publisher.status === 'ready') {
        await this.publisher.quit();
      }
      if (this.subscriber.status === 'ready') {
        await this.subscriber.quit();
      }
      if (this.blockingClient.status === 'ready') {
        await this.blockingClient.quit();
      }
    } catch {
      // noop
    }
  }
}
