import { Injectable } from '@nestjs/common';
import { SkillService } from '../skills/skill.service';

@Injectable()
export class SkillToolHandler {
  constructor(private readonly skillService: SkillService) {}

  async listSkillsByTitle(params: {
    title?: string;
    search?: string;
    status?: string;
    category?: string;
    includeMetadata?: boolean;
    limit?: number;
    page?: number;
  }): Promise<any> {
    const title = String(params?.title || '').trim();
    const search = String(params?.search || title).trim();
    const status = String(params?.status || '').trim();
    const category = String(params?.category || '').trim();
    const includeMetadata = params?.includeMetadata === true;
    const page = Math.max(1, Math.min(Number(params?.page || 1), 1000));
    const pageSize = Math.max(1, Math.min(Number(params?.limit || 20), 100));

    const result = await this.skillService.getSkillsPaged(
      {
        status: (status || undefined) as any,
        category: category || undefined,
        search: search || undefined,
        page,
        pageSize,
      },
      {
        includeMetadata,
      },
    );

    return {
      total: result.total,
      page: result.page,
      limit: result.pageSize,
      totalPages: result.totalPages,
      keyword: search || undefined,
      status: status || undefined,
      category: category || undefined,
      items: result.items.map((skill: any) => ({
        id: skill.id,
        title: skill.name,
        name: skill.name,
        description: skill.description,
        category: skill.category,
        status: skill.status,
        tags: Array.isArray(skill.tags) ? skill.tags : [],
        provider: skill.provider,
        version: skill.version,
        confidenceScore: skill.confidenceScore,
        metadata: includeMetadata ? (skill.metadata || {}) : undefined,
        updatedAt: skill.updatedAt,
      })),
      fetchedAt: new Date().toISOString(),
    };
  }

  async createSkillByMcp(params: {
    title?: string;
    name?: string;
    description?: string;
    category?: string;
    tags?: string[];
    sourceType?: string;
    sourceUrl?: string;
    provider?: string;
    version?: string;
    status?: string;
    confidenceScore?: number;
    metadata?: Record<string, any>;
    content?: string;
    contentType?: string;
  }): Promise<any> {
    const name = String(params?.title || params?.name || '').trim();
    if (!name) {
      throw new Error('skill_master_create_skill requires title or name');
    }
    const description = String(params?.description || '').trim();
    if (!description) {
      throw new Error('skill_master_create_skill requires description');
    }

    const tags = Array.isArray(params?.tags)
      ? params.tags.map((tag) => String(tag || '').trim()).filter(Boolean)
      : [];

    const created = await this.skillService.createSkill({
      name,
      description,
      category: params?.category,
      tags,
      sourceType: params?.sourceType as any,
      sourceUrl: params?.sourceUrl,
      provider: params?.provider,
      version: params?.version,
      status: params?.status as any,
      confidenceScore: params?.confidenceScore,
      discoveredBy: 'SkillMasterMCP',
      metadata: params?.metadata,
      content: params?.content,
      contentType: params?.contentType,
    });

    return {
      created: true,
      skill: {
        id: (created as any).id,
        title: (created as any).name,
        name: (created as any).name,
        description: (created as any).description,
        category: (created as any).category,
        status: (created as any).status,
        tags: Array.isArray((created as any).tags) ? (created as any).tags : [],
        provider: (created as any).provider,
        version: (created as any).version,
        confidenceScore: (created as any).confidenceScore,
        createdAt: (created as any).createdAt,
      },
      createdAt: new Date().toISOString(),
    };
  }
}
