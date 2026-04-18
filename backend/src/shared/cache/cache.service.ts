import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

interface RedisConfig {
  url: string;
}

@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly client: Redis;

  constructor(private readonly configService: ConfigService) {
    const redisConfig = this.configService.get<RedisConfig>('redis') as RedisConfig;
    this.client = new Redis(redisConfig.url, {
      maxRetriesPerRequest: 3,
      lazyConnect: false,
    });
  }

  async get<T = string>(key: string): Promise<T | null> {
    const value = await this.client.get(key);
    if (value === null) {
      return null;
    }

    try {
      return JSON.parse(value) as T;
    } catch {
      return value as T;
    }
  }

  async set(key: string, value: string | Record<string, unknown>, ttlSeconds?: number): Promise<void> {
    const payload = typeof value === 'string' ? value : JSON.stringify(value);
    if (ttlSeconds && ttlSeconds > 0) {
      await this.client.set(key, payload, 'EX', ttlSeconds);
      return;
    }

    await this.client.set(key, payload);
  }

  async del(key: string): Promise<number> {
    return this.client.del(key);
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}
