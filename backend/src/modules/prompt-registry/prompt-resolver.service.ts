import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { RedisService } from '@libs/infra';
import {
  PromptTemplate,
  PromptTemplateDocument,
  PromptTemplateStatus,
} from '../../shared/schemas/prompt-template.schema';
import { PromptResolveSource } from './prompt-resolver.constants';

const DEFAULT_PROMPT_CACHE_TTL_SECONDS = Math.max(60, Number(process.env.PROMPT_REGISTRY_CACHE_TTL_SECONDS || 7200));

interface PromptResolveInput {
  scene: string;
  role: string;
  defaultContent: string;
  sessionOverride?: string;
}

interface PromptResolveResult {
  content: string;
  source: PromptResolveSource;
  version?: number;
  updatedAt?: string;
}

@Injectable()
export class PromptResolverService {
  private readonly logger = new Logger(PromptResolverService.name);

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

    try {
      const published = await this.getLatestByStatus(scene, role, 'published');
      if (published?.content?.trim()) {
        const content = published.content.trim();
        await this.setCache(redisKey, {
          scene,
          role,
          content,
          version: Number(published.version || 0) || undefined,
          updatedAt: published.updatedAt ? new Date(published.updatedAt).toISOString() : undefined,
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

    try {
      const cached = await this.redisService.get(redisKey);
      if (cached) {
        const parsed = JSON.parse(cached) as {
          content?: string;
          version?: number;
          updatedAt?: string;
        };
        const cachedContent = String(parsed?.content || '').trim();
        if (cachedContent) {
          return {
            content: cachedContent,
            source: 'redis_cache',
            version: typeof parsed.version === 'number' ? parsed.version : undefined,
            updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : undefined,
          };
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || 'unknown');
      this.logger.warn(`[prompt_registry_cache_read_failed] scene=${scene} role=${role} error=${message}`);
    }

    return { content: defaultContent, source: 'code_default' };
  }

  async refreshPublishedCache(scene: string, role: string): Promise<void> {
    const normalizedScene = String(scene || '').trim();
    const normalizedRole = String(role || '').trim();
    if (!normalizedScene || !normalizedRole) {
      return;
    }

    const redisKey = this.cacheKey(normalizedScene, normalizedRole);
    await this.redisService.del(redisKey);

    const published = await this.getLatestByStatus(normalizedScene, normalizedRole, 'published');
    if (!published?.content?.trim()) {
      return;
    }

    await this.setCache(redisKey, {
      scene: normalizedScene,
      role: normalizedRole,
      content: published.content.trim(),
      version: Number(published.version || 0) || undefined,
      updatedAt: published.updatedAt ? new Date(published.updatedAt).toISOString() : undefined,
    });
  }

  private cacheKey(scene: string, role: string): string {
    return `prompt-registry:scene:${scene}:role:${role}:published`;
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
      DEFAULT_PROMPT_CACHE_TTL_SECONDS,
    );
  }
}
