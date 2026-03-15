import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
import { Agent, AgentDocument } from '../../../../../src/shared/schemas/agent.schema';
import {
  Skill,
  SkillDocument,
  SkillSourceType,
  SkillStatus,
} from '../../schemas/skill.schema';
import { SkillDocSyncService } from './skill-doc-sync.service';
import { MemoEventBusService } from '../memos/memo-event-bus.service';
import { RedisService } from '@libs/infra';

interface CreateSkillInput {
  name: string;
  slug?: string;
  description: string;
  category?: string;
  tags?: string[];
  sourceType?: SkillSourceType;
  sourceUrl?: string;
  provider?: string;
  version?: string;
  status?: SkillStatus;
  confidenceScore?: number;
  discoveredBy?: string;
  metadata?: Record<string, any>;
  content?: string;
  contentType?: string;
}

interface SkillReadOptions {
  includeContent?: boolean;
  includeMetadata?: boolean;
}

interface AssignSkillInput {
  enabled?: boolean;
}

interface SkillListFilters {
  status?: SkillStatus;
  category?: string;
  search?: string;
}

interface SkillPagedResult {
  items: Skill[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

@Injectable()
export class SkillService {
  private readonly logger = new Logger(SkillService.name);
  private readonly skillIndexCacheTtlSeconds = Math.max(60, Number(process.env.SKILL_INDEX_CACHE_TTL_SECONDS || 1800));
  private readonly skillDetailCacheTtlSeconds = Math.max(60, Number(process.env.SKILL_DETAIL_CACHE_TTL_SECONDS || 900));
  private readonly skillContentCacheTtlSeconds = Math.max(60, Number(process.env.SKILL_CONTENT_CACHE_TTL_SECONDS || 900));

  constructor(
    @InjectModel(Skill.name) private readonly skillModel: Model<SkillDocument>,
    @InjectModel(Agent.name) private readonly agentModel: Model<AgentDocument>,
    private readonly skillDocSyncService: SkillDocSyncService,
    private readonly memoEventBus: MemoEventBusService,
    private readonly redisService: RedisService,
  ) {}

  async createSkill(payload: CreateSkillInput): Promise<Skill> {
    if (!payload?.name?.trim()) {
      throw new BadRequestException('Skill name is required');
    }
    if (!payload?.description?.trim()) {
      throw new BadRequestException('Skill description is required');
    }

    const normalizedName = payload.name.trim();
    const slug = this.normalizeSlug(payload.slug || normalizedName);
    const normalizedContent = this.normalizeOptionalContent(payload.content);
    const contentHash = normalizedContent ? this.computeContentHash(normalizedContent) : undefined;
    const skill = await this.skillModel.create({
      id: uuidv4(),
      name: normalizedName,
      slug,
      description: payload.description.trim(),
      category: payload.category?.trim() || 'general',
      tags: this.uniqueStrings(payload.tags || []),
      sourceType: payload.sourceType || 'manual',
      sourceUrl: payload.sourceUrl,
      provider: payload.provider || 'system',
      version: payload.version || '1.0.0',
      status: payload.status || 'active',
      confidenceScore: this.normalizeScore(payload.confidenceScore ?? 60),
      discoveredBy: payload.discoveredBy || 'AgentSkillManager',
      metadata: payload.metadata || {},
      metadataUpdatedAt: new Date(),
      content: normalizedContent,
      contentType: payload.contentType?.trim() || 'text/markdown',
      contentHash,
      contentSize: normalizedContent ? Buffer.byteLength(normalizedContent, 'utf8') : 0,
      contentUpdatedAt: normalizedContent ? new Date() : undefined,
      lastVerifiedAt: new Date(),
    });

    await this.cacheSkillIndex(skill as unknown as Skill);
    await this.cacheSkillDetail(skill as unknown as Skill, false);
    if (normalizedContent && contentHash) {
      await this.cacheSkillContent(skill.id, contentHash, {
        content: normalizedContent,
        contentType: (skill as any).contentType || 'text/markdown',
        contentHash,
        contentUpdatedAt: (skill as any).contentUpdatedAt,
        contentSize: (skill as any).contentSize || Buffer.byteLength(normalizedContent, 'utf8'),
      });
    }

    await this.syncSkillDocsSafely(skill as unknown as Skill);
    return skill;
  }

  async getAllSkills(filters?: SkillListFilters, options?: SkillReadOptions): Promise<Skill[]> {
    const query = this.buildSkillsQuery(filters);
    const projection = this.buildSkillProjection({
      includeContent: options?.includeContent,
      includeMetadata: options?.includeMetadata !== false,
    });
    return this.skillModel.find(query, projection).sort({ updatedAt: -1 }).exec();
  }

  async getSkillsPaged(
    filters?: SkillListFilters & { page?: number; pageSize?: number },
    options?: SkillReadOptions,
  ): Promise<SkillPagedResult> {
    const query = this.buildSkillsQuery(filters);
    const page = Math.max(1, Number(filters?.page || 1));
    const pageSize = Math.max(1, Math.min(100, Number(filters?.pageSize || 10)));
    const skip = (page - 1) * pageSize;
    const projection = this.buildSkillProjection({
      includeContent: options?.includeContent,
      includeMetadata: options?.includeMetadata !== false,
    });

    const [items, total] = await Promise.all([
      this.skillModel.find(query, projection).sort({ updatedAt: -1 }).skip(skip).limit(pageSize).exec(),
      this.skillModel.countDocuments(query).exec(),
    ]);

    return {
      items: items as unknown as Skill[],
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async getSkillById(skillId: string, options?: SkillReadOptions): Promise<Skill> {
    const includeContent = options?.includeContent === true;
    if (!includeContent) {
      const cached = await this.loadSkillDetailFromCache(skillId);
      if (cached) return cached as Skill;
    }

    const projection = this.buildSkillProjection({
      includeContent,
      includeMetadata: options?.includeMetadata !== false,
    });
    const skill = await this.skillModel.findOne({ id: skillId }, projection).exec();
    if (!skill) throw new NotFoundException(`Skill not found: ${skillId}`);
    await this.cacheSkillIndex(skill as unknown as Skill);
    await this.cacheSkillDetail(skill as unknown as Skill, includeContent);
    return skill;
  }

  async getSkillContentById(skillId: string): Promise<{
    id: string;
    content: string;
    contentType: string;
    contentHash: string;
    contentSize: number;
    contentUpdatedAt?: Date;
  }> {
    const latestHash = await this.redisService.get(this.skillContentLatestKey(skillId));
    if (latestHash) {
      const cached = await this.redisService.get(this.skillContentCacheKey(skillId, latestHash));
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (parsed?.contentHash && typeof parsed.content === 'string') {
            return {
              id: skillId,
              content: parsed.content,
              contentType: parsed.contentType || 'text/markdown',
              contentHash: parsed.contentHash,
              contentSize: Number(parsed.contentSize || 0),
              contentUpdatedAt: parsed.contentUpdatedAt ? new Date(parsed.contentUpdatedAt) : undefined,
            };
          }
        } catch {
          // ignore cache parse error and fallback to DB
        }
      }
    }

    const skill = await this.skillModel
      .findOne({ id: skillId }, { id: 1, content: 1, contentType: 1, contentHash: 1, contentSize: 1, contentUpdatedAt: 1 })
      .exec();
    if (!skill) throw new NotFoundException(`Skill not found: ${skillId}`);
    const content = this.normalizeOptionalContent((skill as any).content);
    if (!content) {
      throw new NotFoundException(`Skill content not found: ${skillId}`);
    }
    const contentHash = String((skill as any).contentHash || this.computeContentHash(content));
    const result = {
      id: skillId,
      content,
      contentType: String((skill as any).contentType || 'text/markdown'),
      contentHash,
      contentSize: Number((skill as any).contentSize || Buffer.byteLength(content, 'utf8')),
      contentUpdatedAt: (skill as any).contentUpdatedAt,
    };
    await this.cacheSkillContent(skillId, contentHash, result);
    return result;
  }

  async updateSkill(skillId: string, updates: Partial<CreateSkillInput>): Promise<Skill> {
    const existed = await this.getSkillById(skillId, { includeContent: true });
    const updatePayload: Record<string, any> = {
      ...updates,
      updatedAt: new Date(),
    };
    if (updates.name) {
      updatePayload.name = updates.name.trim();
    }
    if (updates.description) {
      updatePayload.description = updates.description.trim();
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'slug')) {
      updatePayload.slug = this.normalizeSlug((updates.slug || updatePayload.name || existed.name) as string);
    }
    if (updates.tags) {
      updatePayload.tags = this.uniqueStrings(updates.tags);
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'metadata')) {
      updatePayload.metadata = updates.metadata || {};
      updatePayload.metadataUpdatedAt = new Date();
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'content')) {
      const normalizedContent = this.normalizeOptionalContent(updates.content);
      updatePayload.content = normalizedContent;
      updatePayload.contentType = updates.contentType?.trim() || (existed as any).contentType || 'text/markdown';
      updatePayload.contentHash = normalizedContent ? this.computeContentHash(normalizedContent) : undefined;
      updatePayload.contentSize = normalizedContent ? Buffer.byteLength(normalizedContent, 'utf8') : 0;
      updatePayload.contentUpdatedAt = new Date();
    } else if (Object.prototype.hasOwnProperty.call(updates, 'contentType') && updates.contentType?.trim()) {
      updatePayload.contentType = updates.contentType.trim();
    }
    if (typeof updates.confidenceScore === 'number') {
      updatePayload.confidenceScore = this.normalizeScore(updates.confidenceScore);
    }

    const skill = await this.skillModel.findOneAndUpdate({ id: skillId }, updatePayload, { new: true }).exec();
    if (!skill) {
      throw new NotFoundException(`Skill not found: ${skillId}`);
    }

    if (existed.slug !== skill.slug) {
      await this.removeSkillDocSafely(existed.slug);
    }
    await this.invalidateSkillCaches(existed as unknown as Skill);
    await this.cacheSkillIndex(skill as unknown as Skill);
    await this.cacheSkillDetail(skill as unknown as Skill, false);
    const nextContent = this.normalizeOptionalContent((skill as any).content);
    const nextHash = String((skill as any).contentHash || '');
    if (nextContent && nextHash) {
      await this.cacheSkillContent(skill.id, nextHash, {
        content: nextContent,
        contentType: String((skill as any).contentType || 'text/markdown'),
        contentHash: nextHash,
        contentSize: Number((skill as any).contentSize || Buffer.byteLength(nextContent, 'utf8')),
        contentUpdatedAt: (skill as any).contentUpdatedAt,
      });
    }
    await this.syncSkillDocsSafely(skill as unknown as Skill);
    await this.invalidateEnabledSkillCacheBySkillIds([skillId]);
    return skill;
  }

  async deleteSkill(skillId: string): Promise<boolean> {
    const existed = await this.skillModel.findOne({ id: skillId }).exec();
    if (!existed) return false;
    await this.invalidateEnabledSkillCacheBySkillIds([skillId]);
    await this.invalidateSkillCaches(existed as unknown as Skill);
    await this.skillModel.deleteOne({ id: skillId }).exec();
    await this.agentModel.updateMany({ skills: skillId }, { $pull: { skills: skillId } }).exec();
    await this.removeSkillDocSafely(existed.slug);
    await this.rebuildIndexSafely();
    return true;
  }

  async assignSkillToAgent(
    agentId: string,
    skillId: string,
    payload?: AssignSkillInput,
  ): Promise<{ agentId: string; skillId: string; enabled: boolean; skills: string[] }> {
    const agent = await this.findAgent(agentId);
    if (!agent) {
      throw new NotFoundException(`Agent not found: ${agentId}`);
    }
    await this.getSkillById(skillId);

    const enabled = payload?.enabled ?? true;
    const update = enabled
      ? { $addToSet: { skills: skillId } }
      : { $pull: { skills: skillId } };
    const updatedAgent = await this.agentModel
      .findOneAndUpdate({ _id: (agent as any)._id }, update, { new: true })
      .exec();

    this.memoEventBus.emit({
      name: 'agent.skill_changed',
      agentId,
      memoKinds: ['identity', 'custom'],
    });
    await this.invalidateEnabledSkillCacheByAgentIds([agentId]);
    await this.rebuildIndexSafely();
    return {
      agentId,
      skillId,
      enabled,
      skills: this.uniqueStrings((updatedAgent?.skills || []).map((item: any) => String(item || '').trim())),
    };
  }

  async getAgentSkills(agentId: string): Promise<Array<{ skillId: string; skill: Skill | null }>> {
    const agent = await this.findAgent(agentId);
    if (!agent) {
      throw new NotFoundException(`Agent not found: ${agentId}`);
    }
    const skillIds = this.uniqueStrings((agent.skills || []).map((item) => String(item || '').trim()));
    if (!skillIds.length) return [];

    const skills = await this.skillModel.find({ id: { $in: skillIds } }).exec();
    const skillMap = new Map(skills.map((item) => [item.id, item as unknown as Skill]));
    return skillIds.map((skillId) => ({
      skillId,
      skill: skillMap.get(skillId) || null,
    }));
  }

  async getSkillAgents(skillId: string): Promise<Array<{ id: string; name: string }>> {
    const agents = await this.agentModel
      .find({ skills: skillId })
      .sort({ updatedAt: -1 })
      .select({ id: 1, name: 1 })
      .lean()
      .exec();

    return (agents || []).map((agent: any) => ({
      id: String(agent.id || agent._id || ''),
      name: String(agent.name || ''),
    }));
  }

  async getAllSkillAgents(): Promise<Record<string, Array<{ agentId: string; agentName: string }>>> {
    const agents = await this.agentModel
      .find({ skills: { $exists: true, $ne: [] } })
      .select({ id: 1, name: 1, skills: 1 })
      .lean()
      .exec();
    const result: Record<string, Array<{ agentId: string; agentName: string }>> = {};
    for (const agent of agents as any[]) {
      const agentId = String(agent.id || agent._id || '').trim();
      if (!agentId) continue;
      const agentName = String(agent.name || agentId);
      const skillIds = this.uniqueStrings((agent.skills || []).map((item: any) => String(item || '').trim()));
      for (const skillId of skillIds) {
        if (!result[skillId]) {
          result[skillId] = [];
        }
        result[skillId].push({ agentId, agentName });
      }
    }
    return result;
  }

  async discoverSkillsFromInternet(payload: {
    query: string;
    maxResults?: number;
    sourceType?: SkillSourceType;
    dryRun?: boolean;
  }): Promise<{
    query: string;
    totalFound: number;
    added: number;
    updated: number;
    skills: Skill[];
  }> {
    const query = payload?.query?.trim();
    if (!query) {
      throw new BadRequestException('query is required');
    }
    const maxResults = Math.max(1, Math.min(Number(payload.maxResults || 8), 20));
    const sourceType = payload.sourceType || 'github';
    const dryRun = payload.dryRun === true;

    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(`${query} agent skill`)}&sort=stars&order=desc&per_page=${maxResults}`;
    const response = await axios.get(url, {
      timeout: 12000,
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'AI-Agent-Team-AgentSkillManager',
      },
    });

    const items = Array.isArray(response.data?.items) ? response.data.items : [];
    const materialized: Skill[] = [];
    let added = 0;
    let updated = 0;

    for (const item of items) {
      const name = String(item?.name || '').trim();
      if (!name) continue;
      const provider = String(item?.owner?.login || 'github-community').trim();
      const slug = this.normalizeSlug(name);
      const candidate = {
        name,
        slug,
        description: String(item?.description || `Discovered by AgentSkillManager from query: ${query}`),
        category: 'community',
        tags: this.uniqueStrings([query, 'agent', 'skill', ...(name.split(/[-_\s]+/g) || [])]),
        sourceType,
        sourceUrl: String(item?.html_url || ''),
        provider,
        version: '1.0.0',
        status: 'experimental' as SkillStatus,
        confidenceScore: this.normalizeScore(Math.min(95, 35 + Math.floor(Number(item?.stargazers_count || 0) / 200))),
        discoveredBy: 'AgentSkillManager',
        metadata: {
          stars: Number(item?.stargazers_count || 0),
          language: item?.language || 'unknown',
          fullName: item?.full_name || '',
          discoveredAt: new Date().toISOString(),
        },
      };

      if (dryRun) {
        materialized.push(candidate as unknown as Skill);
        continue;
      }

      const existed = await this.skillModel
        .findOne({ slug: candidate.slug, provider: candidate.provider, version: candidate.version })
        .exec();

      if (!existed) {
        const created = await this.skillModel.create({ id: uuidv4(), ...candidate, lastVerifiedAt: new Date() });
        materialized.push(created as unknown as Skill);
        added += 1;
        await this.cacheSkillIndex(created as unknown as Skill);
        await this.cacheSkillDetail(created as unknown as Skill, false);
        await this.syncSkillDocsSafely(created as unknown as Skill);
      } else {
        existed.description = candidate.description;
        existed.tags = candidate.tags;
        existed.category = candidate.category;
        existed.sourceType = candidate.sourceType;
        existed.sourceUrl = candidate.sourceUrl;
        existed.confidenceScore = candidate.confidenceScore;
        existed.metadata = candidate.metadata;
        existed.lastVerifiedAt = new Date();
        await existed.save();
        materialized.push(existed as unknown as Skill);
        updated += 1;
        await this.cacheSkillIndex(existed as unknown as Skill);
        await this.cacheSkillDetail(existed as unknown as Skill, false);
        await this.syncSkillDocsSafely(existed as unknown as Skill);
      }
    }

    await this.rebuildIndexSafely();
    return {
      query,
      totalFound: items.length,
      added,
      updated,
      skills: materialized,
    };
  }

  async rebuildSkillDocs(): Promise<{ skills: number }> {
    const skills = await this.skillModel.find().sort({ name: 1 }).exec();

    for (const skill of skills) {
      await this.syncSkillDocsSafely(skill as unknown as Skill);
    }
    await this.rebuildIndexSafely();
    return {
      skills: skills.length,
    };
  }

  private normalizeSlug(value: string): string {
    const normalized = value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '');
    if (!normalized) {
      throw new BadRequestException('Invalid skill slug');
    }
    return normalized;
  }

  private normalizeScore(score: number): number {
    return Math.max(0, Math.min(100, Math.round(Number(score || 0))));
  }

  private uniqueStrings(items: string[]): string[] {
    const normalized = items.map((item) => String(item || '').trim()).filter(Boolean);
    return Array.from(new Set(normalized));
  }

  private buildSkillProjection(options?: SkillReadOptions): Record<string, 0> | undefined {
    const projection: Record<string, 0> = {};
    if (options?.includeContent !== true) {
      projection.content = 0;
    }
    if (options?.includeMetadata !== true) {
      projection.metadata = 0;
    }
    return Object.keys(projection).length ? projection : undefined;
  }

  private normalizeOptionalContent(content?: string): string | undefined {
    if (typeof content !== 'string') return undefined;
    const normalized = content.trim();
    return normalized.length ? normalized : undefined;
  }

  private computeContentHash(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  private skillIndexCacheKey(slug: string): string {
    return `skill:index:${slug}`;
  }

  private skillDetailCacheKey(skillId: string): string {
    return `skill:detail:${skillId}`;
  }

  private skillContentLatestKey(skillId: string): string {
    return `skill:content:latest:${skillId}`;
  }

  private skillContentCacheKey(skillId: string, contentHash: string): string {
    return `skill:content:${skillId}:${contentHash}`;
  }

  private async cacheSkillIndex(skill: Skill): Promise<void> {
    const payload = {
      id: skill.id,
      slug: skill.slug,
      name: skill.name,
      description: skill.description,
      status: skill.status,
      category: skill.category,
      tags: skill.tags || [],
      provider: skill.provider,
      version: skill.version,
      metadata: skill.metadata || {},
      updatedAt: (skill as any).updatedAt,
    };
    await this.redisService.set(this.skillIndexCacheKey(skill.slug), JSON.stringify(payload), this.skillIndexCacheTtlSeconds);
  }

  private async cacheSkillDetail(skill: Skill, includeContent: boolean): Promise<void> {
    const payload: Record<string, any> = this.toPlainSkill(skill);
    if (!includeContent) {
      delete payload.content;
    }
    await this.redisService.set(this.skillDetailCacheKey(skill.id), JSON.stringify(payload), this.skillDetailCacheTtlSeconds);
  }

  private async loadSkillDetailFromCache(skillId: string): Promise<Skill | null> {
    const cached = await this.redisService.get(this.skillDetailCacheKey(skillId));
    if (!cached) return null;
    try {
      return JSON.parse(cached) as Skill;
    } catch {
      return null;
    }
  }

  private async cacheSkillContent(
    skillId: string,
    contentHash: string,
    payload: {
      content: string;
      contentType: string;
      contentHash: string;
      contentSize: number;
      contentUpdatedAt?: Date;
    },
  ): Promise<void> {
    await this.redisService.set(
      this.skillContentCacheKey(skillId, contentHash),
      JSON.stringify(payload),
      this.skillContentCacheTtlSeconds,
    );
    await this.redisService.set(this.skillContentLatestKey(skillId), contentHash, this.skillContentCacheTtlSeconds);
  }

  private async invalidateSkillContentCache(skillId: string, oldHash?: string): Promise<void> {
    if (oldHash?.trim()) {
      await this.redisService.del(this.skillContentCacheKey(skillId, oldHash.trim()));
    }
    const latestHash = await this.redisService.get(this.skillContentLatestKey(skillId));
    if (latestHash?.trim()) {
      await this.redisService.del(this.skillContentCacheKey(skillId, latestHash.trim()));
    }
    await this.redisService.del(this.skillContentLatestKey(skillId));
  }

  private async invalidateSkillCaches(skill: Skill): Promise<void> {
    await this.redisService.del(this.skillIndexCacheKey(skill.slug));
    await this.redisService.del(this.skillDetailCacheKey(skill.id));
    await this.invalidateSkillContentCache(skill.id, (skill as any).contentHash);
  }

  private toPlainSkill(skill: Skill): Record<string, any> {
    const doc = skill as any;
    if (typeof doc?.toObject === 'function') {
      return doc.toObject();
    }
    return { ...doc };
  }

  private async invalidateEnabledSkillCacheBySkillIds(skillIds: string[]): Promise<void> {
    const normalizedSkillIds = this.uniqueStrings(skillIds || []);
    if (!normalizedSkillIds.length) return;
    const agents = await this.agentModel
      .find({ skills: { $in: normalizedSkillIds } })
      .select({ id: 1, _id: 1 })
      .lean()
      .exec();
    const agentIds = (agents || [])
      .map((item: any) => String(item.id || item._id || '').trim())
      .filter(Boolean);
    await this.invalidateEnabledSkillCacheByAgentIds(agentIds);
  }

  private async invalidateEnabledSkillCacheByAgentIds(agentIds: string[]): Promise<void> {
    const normalizedAgentIds = this.uniqueStrings(agentIds || []);
    if (!normalizedAgentIds.length) return;
    await Promise.all(
      normalizedAgentIds.map((agentId) => this.redisService.del(this.enabledSkillCacheKey(agentId))),
    );
  }

  private enabledSkillCacheKey(agentId: string): string {
    return `agent:enabled-skills:${agentId}`;
  }

  private buildSkillsQuery(filters?: SkillListFilters): Record<string, any> {
    const query: Record<string, any> = {};
    if (filters?.status) query.status = filters.status;
    if (filters?.category?.trim()) query.category = filters.category.trim();
    if (filters?.search?.trim()) {
      const escaped = this.escapeRegex(filters.search.trim());
      const regex = new RegExp(escaped, 'i');
      query.$or = [
        { name: regex },
        { description: regex },
        { category: regex },
        { provider: regex },
        { version: regex },
        { tags: regex },
      ];
    }
    return query;
  }

  private escapeRegex(input: string): string {
    return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private async findAgent(agentId: string): Promise<Agent | null> {
    const byId = await this.agentModel.findById(agentId).exec();
    if (byId) return byId as unknown as Agent;
    return this.agentModel.findOne({ id: agentId }).exec();
  }

  private async syncSkillDocsSafely(skill: Skill): Promise<void> {
    try {
      await this.skillDocSyncService.syncSkill(skill);
    } catch (error) {
      this.skillDocSyncService.reportSyncError(error, `Failed to sync skill doc ${skill.slug}`);
    }
  }

  private async removeSkillDocSafely(slug: string): Promise<void> {
    try {
      await this.skillDocSyncService.removeSkill(slug);
    } catch (error) {
      this.skillDocSyncService.reportSyncError(error, `Failed to remove skill doc ${slug}`);
    }
  }

  private async rebuildIndexSafely(): Promise<void> {
    try {
      const skills = await this.skillModel.find().sort({ name: 1 }).exec();
      await this.skillDocSyncService.rebuildIndex(skills as unknown as Skill[]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Skill index rebuild skipped: ${message}`);
    }
  }
}
