import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import {
  SkillMarketPlatform,
  SkillMarketPlatformDocument,
  SkillMarketPlatformStatus,
} from '@agent/schemas/skill-market-platform.schema';

interface PlatformPayload {
  name: string;
  url: string;
  priority?: number;
  status?: SkillMarketPlatformStatus;
  description?: string;
}

interface PlatformUpdates {
  name?: string;
  priority?: number;
  status?: SkillMarketPlatformStatus;
  description?: string;
}

@Injectable()
export class SkillMarketService {
  private readonly logger = new Logger(SkillMarketService.name);

  constructor(
    @InjectModel(SkillMarketPlatform.name)
    private readonly platformModel: Model<SkillMarketPlatformDocument>,
  ) {}

  async createPlatform(payload: PlatformPayload): Promise<SkillMarketPlatform> {
    if (!payload?.name?.trim()) {
      throw new BadRequestException('Platform name is required');
    }
    const normalizedUrl = this.normalizeUrl(payload.url);
    const existed = await this.platformModel.findOne({ url: normalizedUrl }).exec();
    if (existed) {
      throw new BadRequestException(`Platform URL already exists: ${normalizedUrl}`);
    }
    return this.platformModel.create({
      id: uuidv4(),
      name: payload.name.trim(),
      url: normalizedUrl,
      priority: this.normalizePriority(payload.priority),
      status: payload.status || 'active',
      description: payload.description?.trim() || undefined,
      repoCount: 0,
    });
  }

  async updatePlatform(platformId: string, updates: PlatformUpdates): Promise<SkillMarketPlatform> {
    const payload: Record<string, unknown> = {};
    if (Object.prototype.hasOwnProperty.call(updates, 'name')) {
      const name = String(updates.name || '').trim();
      if (!name) throw new BadRequestException('Platform name cannot be empty');
      payload.name = name;
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'priority')) {
      payload.priority = this.normalizePriority(updates.priority);
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'status')) {
      payload.status = updates.status;
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'description')) {
      payload.description = String(updates.description || '').trim() || undefined;
    }

    const platform = await this.platformModel
      .findOneAndUpdate({ id: platformId }, payload, { new: true })
      .exec();
    if (!platform) {
      throw new NotFoundException(`Platform not found: ${platformId}`);
    }
    return platform;
  }

  async deletePlatform(platformId: string): Promise<{ deleted: boolean }> {
    const platform = await this.platformModel.findOneAndDelete({ id: platformId }).exec();
    if (!platform) {
      throw new NotFoundException(`Platform not found: ${platformId}`);
    }
    return { deleted: true };
  }

  async listPlatforms(): Promise<SkillMarketPlatform[]> {
    return this.platformModel.find({}).sort({ priority: 1, updatedAt: -1 }).exec();
  }

  private normalizeUrl(url: string): string {
    const value = String(url || '').trim();
    if (!value) {
      throw new BadRequestException('Platform url is required');
    }
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new BadRequestException(`Invalid platform url: ${value}`);
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new BadRequestException('Platform url must be http or https');
    }
    const pathname = parsed.pathname.endsWith('/')
      ? parsed.pathname.slice(0, -1)
      : parsed.pathname;
    parsed.pathname = pathname || '/';
    return parsed.toString().replace(/\/$/, '');
  }

  private normalizePriority(priority?: number): number {
    const value = Number(priority);
    if (!Number.isFinite(value)) return 100;
    return Math.max(0, Math.floor(value));
  }
}
