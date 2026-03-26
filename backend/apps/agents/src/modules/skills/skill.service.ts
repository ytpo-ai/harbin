import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
import { Agent, AgentDocument } from '@agent/schemas/agent.schema';
import {
  Skill,
  SkillDocument,
  SkillSourceType,
  SkillStatus,
  PlanningRule,
} from '../../schemas/agent-skill.schema';
import { LoadedSkillDoc, SkillDocLoaderService } from './skill-doc-loader.service';
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
  planningRules?: PlanningRule[];
  promptTemplateRef?: {
    scene?: string;
    role?: string;
  };
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

export interface SkillPagedResult {
  items: Skill[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface SkillDocSyncResult {
  scanned: number;
  inserted: number;
  updated: number;
  skipped: number;
  failed: number;
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
    private readonly skillDocLoaderService: SkillDocLoaderService,
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
      promptTemplateRef: this.normalizePromptTemplateRef(payload.promptTemplateRef),
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
    if (Object.prototype.hasOwnProperty.call(updates, 'promptTemplateRef')) {
      const normalizedPromptTemplateRef = this.normalizePromptTemplateRef((updates as any).promptTemplateRef);
      if (normalizedPromptTemplateRef) {
        updatePayload.promptTemplateRef = normalizedPromptTemplateRef;
      } else {
        updatePayload.$unset = {
          ...(updatePayload.$unset || {}),
          promptTemplateRef: 1,
        };
      }
    }

    const skill = await this.skillModel.findOneAndUpdate({ id: skillId }, updatePayload, { new: true }).exec();
    if (!skill) {
      throw new NotFoundException(`Skill not found: ${skillId}`);
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
      }
    }
    return {
      query,
      totalFound: items.length,
      added,
      updated,
      skills: materialized,
    };
  }

  async syncSkillDocsToDb(): Promise<SkillDocSyncResult> {
    const docs = await this.skillDocLoaderService.loadDocs();
    const result: SkillDocSyncResult = {
      scanned: docs.length,
      inserted: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
    };

    for (const doc of docs) {
      const synced = await this.syncSingleSkillDoc(doc);
      result.inserted += synced.inserted;
      result.updated += synced.updated;
      result.skipped += synced.skipped;
      result.failed += synced.failed;
    }

    return result;
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

  private normalizePromptTemplateRef(input: unknown): { scene: string; role: string } | undefined {
    if (input === undefined || input === null) {
      return undefined;
    }
    if (typeof input !== 'object' || Array.isArray(input)) {
      throw new BadRequestException('promptTemplateRef must be an object with scene and role');
    }

    const scene = String((input as any).scene || '').trim();
    const role = String((input as any).role || '').trim();
    if (!scene || !role) {
      throw new BadRequestException('promptTemplateRef requires non-empty scene and role');
    }
    return { scene, role };
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

  private async syncSingleSkillDoc(doc: LoadedSkillDoc): Promise<{
    inserted: number;
    updated: number;
    skipped: number;
    failed: number;
  }> {
    const slug = this.normalizeSkillDocSlug(doc);
    const name = doc.name?.trim();
    const description = doc.description?.trim();
    if (!slug || !name || !description) {
      this.logger.warn(`Skip invalid skill doc: ${doc.filePath}`);
      return { inserted: 0, updated: 0, skipped: 1, failed: 0 };
    }

    try {
      const existed = await this.skillModel.findOne({ slug }).exec();
      const payload = this.buildSkillDocUpdatePayload(doc, {
        slug,
        name,
        description,
      });

      if (!existed) {
        const created = await this.skillModel.create({
          id: uuidv4(),
          ...payload,
        });
        await this.cacheSkillIndex(created as unknown as Skill);
        await this.cacheSkillDetail(created as unknown as Skill, false);
        if (payload.content && payload.contentHash) {
          await this.cacheSkillContent(created.id, payload.contentHash, {
            content: payload.content,
            contentType: payload.contentType,
            contentHash: payload.contentHash,
            contentSize: payload.contentSize,
            contentUpdatedAt: payload.contentUpdatedAt,
          });
        }
        return { inserted: 1, updated: 0, skipped: 0, failed: 0 };
      }

      const contentChanged = String((existed as any).contentHash || '') !== String(payload.contentHash || '');
      const metadataChanged = this.hasMetadataChanged(existed, payload);
      if (!contentChanged && !metadataChanged) {
        return { inserted: 0, updated: 0, skipped: 1, failed: 0 };
      }

      const updated = await this.skillModel.findOneAndUpdate({ id: existed.id }, payload, { new: true }).exec();
      if (!updated) {
        return { inserted: 0, updated: 0, skipped: 0, failed: 1 };
      }
      await this.invalidateSkillCaches(existed as unknown as Skill);
      await this.cacheSkillIndex(updated as unknown as Skill);
      await this.cacheSkillDetail(updated as unknown as Skill, false);
      if (payload.content && payload.contentHash) {
        await this.cacheSkillContent(updated.id, payload.contentHash, {
          content: payload.content,
          contentType: payload.contentType,
          contentHash: payload.contentHash,
          contentSize: payload.contentSize,
          contentUpdatedAt: payload.contentUpdatedAt,
        });
      }
      await this.invalidateEnabledSkillCacheBySkillIds([updated.id]);
      return { inserted: 0, updated: 1, skipped: 0, failed: 0 };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed syncing skill doc ${doc.filePath}: ${message}`);
      return { inserted: 0, updated: 0, skipped: 0, failed: 1 };
    }
  }

  private normalizeSkillDocSlug(doc: LoadedSkillDoc): string | null {
    const source = doc.slug?.trim() || doc.name?.trim();
    if (!source) return null;
    try {
      return this.normalizeSlug(source);
    } catch {
      return null;
    }
  }

  private buildSkillDocUpdatePayload(
    doc: LoadedSkillDoc,
    normalized: { slug: string; name: string; description: string },
  ): Record<string, any> {
    const now = new Date();
    return {
      slug: normalized.slug,
      name: normalized.name,
      description: normalized.description,
      category: doc.category?.trim() || 'general',
      tags: this.uniqueStrings(doc.tags || []),
      sourceType: doc.sourceType || 'manual',
      sourceUrl: doc.sourceUrl?.trim(),
      provider: doc.provider?.trim() || 'system',
      version: doc.version?.trim() || '1.0.0',
      status: doc.status || 'active',
      confidenceScore: this.normalizeScore(doc.confidenceScore ?? 60),
      discoveredBy: doc.discoveredBy?.trim() || 'SkillDocSync',
      metadata: doc.metadata || {},
      metadataUpdatedAt: now,
      planningRules: doc.planningRules || [],
      content: doc.content,
      contentType: doc.contentType || 'text/markdown',
      contentHash: doc.contentHash,
      contentSize: doc.contentSize || 0,
      contentUpdatedAt: doc.content ? now : undefined,
      lastVerifiedAt: now,
      updatedAt: now,
    };
  }

  private hasMetadataChanged(existed: SkillDocument, next: Record<string, any>): boolean {
    const keys: Array<keyof SkillDocument | string> = [
      'name',
      'slug',
      'description',
      'category',
      'sourceType',
      'sourceUrl',
      'provider',
      'version',
      'status',
      'confidenceScore',
      'discoveredBy',
      'contentType',
      'contentSize',
      'contentHash',
    ];
    for (const key of keys) {
      if (String((existed as any)[key] || '') !== String(next[key] || '')) {
        return true;
      }
    }

    const existedTags = this.uniqueStrings(((existed as any).tags || []).map((tag: any) => String(tag || '')));
    const nextTags = this.uniqueStrings((next.tags || []).map((tag: any) => String(tag || '')));
    if (JSON.stringify(existedTags) !== JSON.stringify(nextTags)) {
      return true;
    }

    const existedMetadata = (existed as any).metadata || {};
    const nextMetadata = next.metadata || {};
    if (JSON.stringify(existedMetadata) !== JSON.stringify(nextMetadata)) {
      return true;
    }

    const existedPlanningRules = (existed as any).planningRules || [];
    const nextPlanningRules = next.planningRules || [];
    return JSON.stringify(existedPlanningRules) !== JSON.stringify(nextPlanningRules);
  }
}
