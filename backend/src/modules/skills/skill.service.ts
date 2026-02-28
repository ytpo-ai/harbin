import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { Agent, AgentDocument } from '../../shared/schemas/agent.schema';
import { AgentSkill, AgentSkillDocument, SkillProficiency } from '../../shared/schemas/agent-skill.schema';
import {
  Skill,
  SkillDocument,
  SkillSourceType,
  SkillStatus,
} from '../../shared/schemas/skill.schema';
import {
  SkillSuggestion,
  SkillSuggestionDocument,
  SkillSuggestionPriority,
  SkillSuggestionStatus,
} from '../../shared/schemas/skill-suggestion.schema';
import { SkillDocSyncService } from './skill-doc-sync.service';

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
}

interface AssignSkillInput {
  proficiencyLevel?: SkillProficiency;
  assignedBy?: string;
  enabled?: boolean;
  note?: string;
}

@Injectable()
export class SkillService {
  private readonly logger = new Logger(SkillService.name);

  constructor(
    @InjectModel(Skill.name) private readonly skillModel: Model<SkillDocument>,
    @InjectModel(AgentSkill.name) private readonly agentSkillModel: Model<AgentSkillDocument>,
    @InjectModel(SkillSuggestion.name) private readonly suggestionModel: Model<SkillSuggestionDocument>,
    @InjectModel(Agent.name) private readonly agentModel: Model<AgentDocument>,
    private readonly skillDocSyncService: SkillDocSyncService,
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
      lastVerifiedAt: new Date(),
    });

    await this.syncSkillDocsSafely(skill as unknown as Skill);
    return skill;
  }

  async getAllSkills(filters?: { status?: SkillStatus; category?: string }): Promise<Skill[]> {
    const query: Record<string, any> = {};
    if (filters?.status) query.status = filters.status;
    if (filters?.category?.trim()) query.category = filters.category.trim();
    return this.skillModel.find(query).sort({ updatedAt: -1 }).exec();
  }

  async getSkillById(skillId: string): Promise<Skill> {
    const skill = await this.skillModel.findOne({ id: skillId }).exec();
    if (!skill) throw new NotFoundException(`Skill not found: ${skillId}`);
    return skill;
  }

  async updateSkill(skillId: string, updates: Partial<CreateSkillInput>): Promise<Skill> {
    const existed = await this.getSkillById(skillId);
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
    await this.syncSkillDocsSafely(skill as unknown as Skill);
    return skill;
  }

  async deleteSkill(skillId: string): Promise<boolean> {
    const existed = await this.skillModel.findOne({ id: skillId }).exec();
    if (!existed) return false;
    await this.skillModel.deleteOne({ id: skillId }).exec();
    await this.agentSkillModel.deleteMany({ skillId }).exec();
    await this.suggestionModel.deleteMany({ skillId }).exec();
    await this.removeSkillDocSafely(existed.slug);
    await this.rebuildIndexSafely();
    return true;
  }

  async assignSkillToAgent(agentId: string, skillId: string, payload?: AssignSkillInput): Promise<AgentSkill> {
    const agent = await this.findAgent(agentId);
    if (!agent) {
      throw new NotFoundException(`Agent not found: ${agentId}`);
    }
    await this.getSkillById(skillId);

    const assigned = await this.agentSkillModel
      .findOneAndUpdate(
        { agentId, skillId },
        {
          agentId,
          skillId,
          proficiencyLevel: payload?.proficiencyLevel || 'beginner',
          assignedBy: payload?.assignedBy || 'AgentSkillManager',
          enabled: payload?.enabled ?? true,
          note: payload?.note,
        },
        { upsert: true, new: true },
      )
      .exec();

    await this.suggestionModel
      .updateMany(
        { agentId, skillId, status: { $in: ['pending', 'accepted'] } },
        { status: 'applied', appliedAt: new Date(), reviewedAt: new Date() },
      )
      .exec();
    await this.rebuildIndexSafely();
    return assigned;
  }

  async getAgentSkills(agentId: string): Promise<Array<{ assignment: AgentSkill; skill: Skill | null }>> {
    await this.ensureAgentExists(agentId);
    const assignments = await this.agentSkillModel.find({ agentId, enabled: true }).sort({ updatedAt: -1 }).exec();
    const skills = await this.skillModel.find({ id: { $in: assignments.map((item) => item.skillId) } }).exec();
    const skillMap = new Map<string, Skill>();
    for (const skill of skills) {
      skillMap.set(skill.id, skill as unknown as Skill);
    }

    return assignments.map((assignment) => ({
      assignment,
      skill: skillMap.get(assignment.skillId) || null,
    }));
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

  async suggestSkillsForAgent(payload: {
    agentId: string;
    contextTags?: string[];
    topK?: number;
    persist?: boolean;
  }): Promise<Array<{ skill: Skill; score: number; reason: string; priority: SkillSuggestionPriority }>> {
    const agent = await this.findAgent(payload.agentId);
    if (!agent) {
      throw new NotFoundException(`Agent not found: ${payload.agentId}`);
    }

    const topK = Math.max(1, Math.min(Number(payload.topK || 5), 20));
    const contextTags = this.uniqueStrings(payload.contextTags || []);
    const capabilityTags = this.uniqueStrings([...(agent.capabilities || []), ...(agent.tools || []), ...contextTags]);

    const assigned = await this.agentSkillModel.find({ agentId: payload.agentId, enabled: true }).exec();
    const assignedSkillIds = new Set(assigned.map((item) => item.skillId));

    const candidateSkills = await this.skillModel
      .find({ id: { $nin: Array.from(assignedSkillIds) }, status: { $in: ['active', 'experimental'] } })
      .exec();

    const ranked = candidateSkills
      .map((skill) => {
        const score = this.computeSuggestionScore(skill as unknown as Skill, capabilityTags);
        return {
          skill: skill as unknown as Skill,
          score,
          reason: this.buildSuggestionReason(skill as unknown as Skill, capabilityTags),
          priority: this.priorityFromScore(score),
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    if (payload.persist !== false) {
      for (const item of ranked) {
        const existed = await this.suggestionModel
          .findOne({
            agentId: payload.agentId,
            skillId: item.skill.id,
            status: { $in: ['pending', 'accepted'] },
          })
          .exec();

        const suggestion = existed
          ? await this.suggestionModel
              .findOneAndUpdate(
                { id: existed.id },
                {
                  reason: item.reason,
                  score: item.score,
                  priority: item.priority,
                  context: { contextTags, capabilityTags },
                  updatedAt: new Date(),
                },
                { new: true },
              )
              .exec()
          : await this.suggestionModel.create({
              id: uuidv4(),
              agentId: payload.agentId,
              skillId: item.skill.id,
              reason: item.reason,
              priority: item.priority,
              status: 'pending',
              score: item.score,
              suggestedBy: 'AgentSkillManager',
              context: { contextTags, capabilityTags },
            });

        await this.syncSuggestionDocsSafely(suggestion as unknown as SkillSuggestion, item.skill);
      }
      await this.rebuildIndexSafely();
    }

    return ranked;
  }

  async getSuggestionsForAgent(agentId: string, status?: SkillSuggestionStatus): Promise<SkillSuggestion[]> {
    await this.ensureAgentExists(agentId);
    const query: Record<string, any> = { agentId };
    if (status) query.status = status;
    return this.suggestionModel.find(query).sort({ createdAt: -1 }).exec();
  }

  async reviewSuggestion(suggestionId: string, payload: { status: SkillSuggestionStatus; note?: string }): Promise<SkillSuggestion> {
    if (!['pending', 'accepted', 'rejected', 'applied'].includes(payload.status)) {
      throw new BadRequestException('Invalid suggestion status');
    }

    const suggestion = await this.suggestionModel.findOne({ id: suggestionId }).exec();
    if (!suggestion) {
      throw new NotFoundException(`Suggestion not found: ${suggestionId}`);
    }

    suggestion.status = payload.status;
    suggestion.reviewedAt = new Date();
    if (payload.note?.trim()) {
      suggestion.context = {
        ...(suggestion.context || {}),
        reviewNote: payload.note.trim(),
      };
    }

    if (payload.status === 'applied') {
      suggestion.appliedAt = new Date();
      await this.assignSkillToAgent(suggestion.agentId, suggestion.skillId, {
        assignedBy: 'AgentSkillManager',
        proficiencyLevel: 'beginner',
      });
    }

    const saved = await suggestion.save();
    const skill = await this.skillModel.findOne({ id: saved.skillId }).exec();
    await this.syncSuggestionDocsSafely(saved as unknown as SkillSuggestion, (skill as unknown as Skill) || undefined);
    await this.rebuildIndexSafely();
    return saved;
  }

  async rebuildSkillDocs(): Promise<{ skills: number; suggestions: number }> {
    const skills = await this.skillModel.find().sort({ name: 1 }).exec();
    const suggestions = await this.suggestionModel.find().sort({ createdAt: -1 }).exec();

    for (const skill of skills) {
      await this.syncSkillDocsSafely(skill as unknown as Skill);
    }

    const skillMap = new Map<string, Skill>();
    for (const skill of skills) {
      skillMap.set(skill.id, skill as unknown as Skill);
    }

    for (const suggestion of suggestions) {
      await this.syncSuggestionDocsSafely(
        suggestion as unknown as SkillSuggestion,
        skillMap.get(suggestion.skillId),
      );
    }
    await this.rebuildIndexSafely();
    return {
      skills: skills.length,
      suggestions: suggestions.length,
    };
  }

  private priorityFromScore(score: number): SkillSuggestionPriority {
    if (score >= 85) return 'critical';
    if (score >= 70) return 'high';
    if (score >= 50) return 'medium';
    return 'low';
  }

  private computeSuggestionScore(skill: Skill, capabilityTags: string[]): number {
    const haystack = this.uniqueStrings([
      skill.name,
      skill.description,
      skill.category,
      ...(skill.tags || []),
    ]).join(' ').toLowerCase();
    const overlapCount = capabilityTags.filter((tag) => haystack.includes(tag.toLowerCase())).length;
    const base = skill.confidenceScore ?? 50;
    const overlapBoost = overlapCount * 8;
    const activeBoost = skill.status === 'active' ? 8 : 0;
    return this.normalizeScore(base + overlapBoost + activeBoost);
  }

  private buildSuggestionReason(skill: Skill, capabilityTags: string[]): string {
    const matched = capabilityTags.filter((tag) => {
      const lower = tag.toLowerCase();
      return (
        skill.name.toLowerCase().includes(lower) ||
        skill.description.toLowerCase().includes(lower) ||
        (skill.tags || []).some((skillTag) => skillTag.toLowerCase().includes(lower))
      );
    });
    if (!matched.length) {
      return `Skill ${skill.name} has a strong generic fit and can enhance this agent's capability breadth.`;
    }
    return `Skill ${skill.name} matches current context tags: ${matched.slice(0, 5).join(', ')}.`;
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

  private async findAgent(agentId: string): Promise<Agent | null> {
    const byId = await this.agentModel.findById(agentId).exec();
    if (byId) return byId as unknown as Agent;
    return this.agentModel.findOne({ id: agentId }).exec();
  }

  private async ensureAgentExists(agentId: string): Promise<void> {
    const agent = await this.findAgent(agentId);
    if (!agent) {
      throw new NotFoundException(`Agent not found: ${agentId}`);
    }
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

  private async syncSuggestionDocsSafely(suggestion: SkillSuggestion, skill?: Skill): Promise<void> {
    try {
      await this.skillDocSyncService.syncSuggestion(suggestion, skill);
    } catch (error) {
      this.skillDocSyncService.reportSyncError(error, `Failed to sync suggestion doc ${suggestion.id}`);
    }
  }

  private async rebuildIndexSafely(): Promise<void> {
    try {
      const [skills, suggestions] = await Promise.all([
        this.skillModel.find().sort({ name: 1 }).exec(),
        this.suggestionModel.find().sort({ createdAt: -1 }).exec(),
      ]);
      await this.skillDocSyncService.rebuildIndex(skills as unknown as Skill[], suggestions as unknown as SkillSuggestion[]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Skill index rebuild skipped: ${message}`);
    }
  }
}
