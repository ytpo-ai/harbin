import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { RedisService } from '@libs/infra';
import {
  PromptTemplate,
  PromptTemplateDocument,
  PromptTemplateStatus,
} from '../../schemas/prompt-template.schema';
import { PromptResolveSource } from './prompt-resolver.constants';

export interface PromptResolveInput {
  scene: string;
  role: string;
  defaultContent: string;
  sessionOverride?: string;
}

export interface PromptResolveResult {
  content: string;
  source: PromptResolveSource;
  version?: number;
  updatedAt?: string;
}

interface PromptPublishedCachePayload {
  content: string;
  version?: number;
  updatedAt?: string;
}

type LocalPromptCacheRecord = {
  payload: PromptPublishedCachePayload;
  expiresAt: number;
};

type LocalPromptExistenceRecord = {
  exists: boolean;
  expiresAt: number;
};

@Injectable()
export class PromptResolverService {
  private readonly logger = new Logger(PromptResolverService.name);
  private readonly localPromptCache = new Map<string, LocalPromptCacheRecord>();
  private readonly localPromptExistence = new Map<string, LocalPromptExistenceRecord>();
  private readonly localCacheTtlMs = Number(process.env.PROMPT_REGISTRY_LOCAL_CACHE_TTL_MS || 300_000);
  private readonly redisReadTimeoutMs = Number(process.env.PROMPT_REGISTRY_REDIS_READ_TIMEOUT_MS || 250);
  private readonly redisBypassMs = Number(process.env.PROMPT_REGISTRY_REDIS_BYPASS_MS || 60_000);
  private redisBypassUntil = 0;

  constructor(
    @InjectModel(PromptTemplate.name)
    private readonly promptTemplateModel: Model<PromptTemplateDocument>,
    private readonly redisService: RedisService,
  ) {}

  async resolve(input: PromptResolveInput): Promise<PromptResolveResult> {
    const scene = String(input.scene || '').trim();
    const role = String(input.role || '').trim();
    const defaultContent = String(input.defaultContent || '').trim();
    const sessionOverride = String(input.sessionOverride || '').trim();

    if (!scene || !role) {
      return { content: defaultContent, source: 'code_default' };
    }

    if (sessionOverride) {
      return { content: sessionOverride, source: 'session_override' };
    }

    const redisKey = this.cacheKey(scene, role);

    const cached = await this.readPublishedCache(scene, role, redisKey);
    if (cached) {
      return {
        content: cached.content,
        source: 'redis_cache',
        version: cached.version,
        updatedAt: cached.updatedAt,
      };
    }

    try {
      const published = await this.getLatestByStatus(scene, role, 'published');
      if (published?.content?.trim()) {
        const content = published.content.trim();
        await this.cachePublishedTemplate({
          scene,
          role,
          content,
          version: Number(published.version || 0) || undefined,
          updatedAt: published.updatedAt,
        });
        return {
          content,
          source: 'db_published',
          version: Number(published.version || 0) || undefined,
          updatedAt: published.updatedAt ? new Date(published.updatedAt).toISOString() : undefined,
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || 'unknown');
      this.logger.warn(`[prompt_registry_db_read_failed] scene=${scene} role=${role} error=${message}`);
    }

    return { content: defaultContent, source: 'code_default' };
  }

  async hasPublishedCache(scene: string, role: string): Promise<boolean> {
    const normalizedScene = String(scene || '').trim();
    const normalizedRole = String(role || '').trim();
    if (!normalizedScene || !normalizedRole) {
      return false;
    }

    const localKey = this.localCacheKey(normalizedScene, normalizedRole);
    const cachedExistence = this.localPromptExistence.get(localKey);
    if (cachedExistence && cachedExistence.expiresAt > Date.now()) {
      return cachedExistence.exists;
    }

    if (this.isRedisBypassed()) {
      this.localPromptExistence.set(localKey, {
        exists: false,
        expiresAt: Date.now() + this.localCacheTtlMs,
      });
      return false;
    }

    const redisKey = this.cacheKey(normalizedScene, normalizedRole);
    const cached = await this.readPublishedCache(normalizedScene, normalizedRole, redisKey);
    return Boolean(cached);
  }

  async cachePublishedTemplate(input: {
    scene: string;
    role: string;
    content: string;
    version?: number;
    updatedAt?: Date | string;
  }): Promise<void> {
    const scene = String(input.scene || '').trim();
    const role = String(input.role || '').trim();
    const content = String(input.content || '').trim();
    if (!scene || !role || !content) {
      return;
    }

    const updatedAt = input.updatedAt ? new Date(input.updatedAt) : undefined;

    const payload: PromptPublishedCachePayload = {
      content,
      version: Number(input.version || 0) || undefined,
      updatedAt: updatedAt && !Number.isNaN(updatedAt.getTime()) ? updatedAt.toISOString() : undefined,
    };

    this.setLocalPromptCache(scene, role, payload);

    await this.setCache(this.cacheKey(scene, role), {
      scene,
      role,
      content: payload.content,
      version: payload.version,
      updatedAt: payload.updatedAt,
    });
  }

  async clearPublishedCache(scene: string, role: string): Promise<void> {
    const normalizedScene = String(scene || '').trim();
    const normalizedRole = String(role || '').trim();
    if (!normalizedScene || !normalizedRole) {
      return;
    }

    this.clearLocalPromptCache(normalizedScene, normalizedRole);

    await this.redisService.del(this.cacheKey(normalizedScene, normalizedRole));
  }

  async refreshPublishedCache(scene: string, role: string): Promise<void> {
    const normalizedScene = String(scene || '').trim();
    const normalizedRole = String(role || '').trim();
    if (!normalizedScene || !normalizedRole) {
      return;
    }

    await this.clearPublishedCache(normalizedScene, normalizedRole);

    const published = await this.getLatestByStatus(normalizedScene, normalizedRole, 'published');
    if (!published?.content?.trim()) {
      return;
    }

    await this.cachePublishedTemplate({
      scene: normalizedScene,
      role: normalizedRole,
      content: published.content.trim(),
      version: Number(published.version || 0) || undefined,
      updatedAt: published.updatedAt,
    });
  }

  private cacheKey(scene: string, role: string): string {
    return `prompt-registry:scene:${scene}:role:${role}:published`;
  }

  private localCacheKey(scene: string, role: string): string {
    return `${scene}::${role}`;
  }

  private isRedisBypassed(): boolean {
    return Date.now() < this.redisBypassUntil;
  }

  private tripRedisBypass(): void {
    this.redisBypassUntil = Date.now() + this.redisBypassMs;
  }

  private setLocalPromptCache(scene: string, role: string, payload: PromptPublishedCachePayload): void {
    const key = this.localCacheKey(scene, role);
    const expiresAt = Date.now() + this.localCacheTtlMs;
    this.localPromptCache.set(key, {
      payload,
      expiresAt,
    });
    this.localPromptExistence.set(key, {
      exists: true,
      expiresAt,
    });
  }

  private clearLocalPromptCache(scene: string, role: string): void {
    const key = this.localCacheKey(scene, role);
    this.localPromptCache.delete(key);
    this.localPromptExistence.delete(key);
  }

  private async getRedisWithTimeout(key: string): Promise<{ status: 'ok'; value: string | null } | { status: 'timeout' }> {
    if (!Number.isFinite(this.redisReadTimeoutMs) || this.redisReadTimeoutMs <= 0) {
      const value = await this.redisService.get(key);
      return { status: 'ok', value };
    }

    return await Promise.race([
      this.redisService.get(key).then((value) => ({ status: 'ok' as const, value })),
      new Promise<{ status: 'timeout' }>((resolve) => {
        setTimeout(() => resolve({ status: 'timeout' }), this.redisReadTimeoutMs);
      }),
    ]);
  }

  private async getLatestByStatus(
    scene: string,
    role: string,
    status: PromptTemplateStatus,
  ): Promise<PromptTemplateDocument | null> {
    return this.promptTemplateModel.findOne({ scene, role, status }).sort({ version: -1, updatedAt: -1 }).exec();
  }

  private async setCache(
    key: string,
    value: {
      scene: string;
      role: string;
      content: string;
      version?: number;
      updatedAt?: string;
    },
  ): Promise<void> {
    await this.redisService.set(
      key,
      JSON.stringify({
        ...value,
        cachedAt: new Date().toISOString(),
      }),
    );
  }

  private async readPublishedCache(
    scene: string,
    role: string,
    key: string,
  ): Promise<PromptPublishedCachePayload | null> {
    const localKey = this.localCacheKey(scene, role);
    const localCached = this.localPromptCache.get(localKey);
    if (localCached && localCached.expiresAt > Date.now()) {
      return localCached.payload;
    }

    const localExistence = this.localPromptExistence.get(localKey);
    if (localExistence && localExistence.expiresAt > Date.now() && !localExistence.exists) {
      return null;
    }

    if (this.isRedisBypassed()) {
      this.localPromptExistence.set(localKey, {
        exists: false,
        expiresAt: Date.now() + this.localCacheTtlMs,
      });
      return null;
    }

    try {
      const redisResult = await this.getRedisWithTimeout(key);
      if (redisResult.status === 'timeout') {
        this.tripRedisBypass();
        this.localPromptExistence.set(localKey, {
          exists: false,
          expiresAt: Date.now() + this.localCacheTtlMs,
        });
        this.logger.warn(
          `[prompt_registry_cache_read_timeout] scene=${scene} role=${role} timeoutMs=${this.redisReadTimeoutMs} bypassMs=${this.redisBypassMs}`,
        );
        return null;
      }

      const cached = redisResult.value;
      if (!cached) {
        this.localPromptExistence.set(localKey, {
          exists: false,
          expiresAt: Date.now() + this.localCacheTtlMs,
        });
        return null;
      }

      const parsed = JSON.parse(cached) as {
        content?: string;
        version?: number;
        updatedAt?: string;
      };
      const content = String(parsed?.content || '').trim();
      if (!content) {
        this.localPromptExistence.set(localKey, {
          exists: false,
          expiresAt: Date.now() + this.localCacheTtlMs,
        });
        return null;
      }

      const payload = {
        content,
        version: typeof parsed.version === 'number' ? parsed.version : undefined,
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : undefined,
      };
      this.setLocalPromptCache(scene, role, payload);

      return payload;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || 'unknown');
      this.logger.warn(`[prompt_registry_cache_read_failed] scene=${scene} role=${role} error=${message}`);
      this.tripRedisBypass();
      this.localPromptExistence.set(localKey, {
        exists: false,
        expiresAt: Date.now() + this.localCacheTtlMs,
      });
      return null;
    }
  }
}
