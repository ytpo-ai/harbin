import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomUUID } from 'crypto';
import {
  DiscussionSpace,
  DiscussionSpaceCategory,
  DiscussionSpaceDocument,
  DocumentOutline,
  OutlineSection,
  OutlineSectionStatus,
} from '../../../shared/schemas/discussion-space.schema';
import {
  DiscussionKnowledgeEntry,
  DiscussionKnowledgeEntryDocument,
} from '../../../shared/schemas/discussion-knowledge-entry.schema';
import {
  CreateDiscussionOutlineSectionDto,
  DiscussionKnowledgeCoverageResult,
  UpdateDiscussionOutlineDto,
  UpdateDiscussionOutlineSectionDto,
} from '../discussion.types';

@Injectable()
export class DiscussionOutlineService {
  constructor(
    @InjectModel(DiscussionSpace.name)
    private readonly discussionSpaceModel: Model<DiscussionSpaceDocument>,
    @InjectModel(DiscussionKnowledgeEntry.name)
    private readonly discussionKnowledgeEntryModel: Model<DiscussionKnowledgeEntryDocument>,
  ) {}

  private buildSection(input: Partial<OutlineSection> & { title: string; order: number; depth: number }): OutlineSection {
    return {
      id: input.id || randomUUID(),
      title: input.title,
      description: input.description,
      parentSectionId: input.parentSectionId,
      order: Number.isFinite(input.order) ? Number(input.order) : 0,
      depth: Number.isFinite(input.depth) ? Number(input.depth) : 0,
      status: input.status || 'draft',
      knowledgeCount: Number(input.knowledgeCount || 0),
      childSectionIds: Array.isArray(input.childSectionIds) ? input.childSectionIds.filter(Boolean) : [],
      metadata: input.metadata,
    };
  }

  private normalizeOutline(raw: unknown, spaceTitle: string): DocumentOutline {
    const now = new Date();
    if (!raw || typeof raw !== 'object') {
      return {
        version: 1,
        title: `${spaceTitle} 大纲`,
        sections: [],
        createdAt: now,
        updatedAt: now,
        generatedBy: 'human',
      };
    }

    const candidate = raw as Record<string, any>;
    const rawSections = Array.isArray(candidate.sections) ? candidate.sections : [];

    if (rawSections.length && typeof rawSections[0] === 'string') {
      return {
        version: Number(candidate.version || 1),
        title: String(candidate.title || `${spaceTitle} 大纲`),
        sections: rawSections.map((title: string, index: number) =>
          this.buildSection({
            title,
            order: index,
            depth: 0,
          }),
        ),
        createdAt: candidate.createdAt ? new Date(candidate.createdAt) : now,
        updatedAt: candidate.updatedAt ? new Date(candidate.updatedAt) : now,
        generatedBy: 'hybrid',
      };
    }

    return {
      version: Number(candidate.version || 1),
      title: String(candidate.title || `${spaceTitle} 大纲`),
      sections: rawSections.map((section: any, index: number) =>
        this.buildSection({
          ...section,
          title: String(section?.title || `章节 ${index + 1}`),
          order: Number.isFinite(section?.order) ? Number(section.order) : index,
          depth: Number.isFinite(section?.depth) ? Number(section.depth) : 0,
          status: (section?.status || 'draft') as OutlineSectionStatus,
        }),
      ),
      createdAt: candidate.createdAt ? new Date(candidate.createdAt) : now,
      updatedAt: candidate.updatedAt ? new Date(candidate.updatedAt) : now,
      generatedBy: (candidate.generatedBy || 'human') as DocumentOutline['generatedBy'],
      agentId: candidate.agentId,
      runId: candidate.runId,
      sessionId: candidate.sessionId,
    };
  }

  private rebuildChildSectionIds(sections: OutlineSection[]): OutlineSection[] {
    const childrenMap = new Map<string, string[]>();
    for (const section of sections) {
      if (!section.parentSectionId) {
        continue;
      }
      if (!childrenMap.has(section.parentSectionId)) {
        childrenMap.set(section.parentSectionId, []);
      }
      childrenMap.get(section.parentSectionId)?.push(section.id);
    }

    return sections.map((section) => ({
      ...section,
      childSectionIds: childrenMap.get(section.id) || [],
    }));
  }

  async getOutline(spaceId: string): Promise<DocumentOutline> {
    const space = await this.discussionSpaceModel.findOne({ id: spaceId }).lean().exec();
    if (!space) {
      throw new NotFoundException(`讨论空间不存在: ${spaceId}`);
    }
    return this.normalizeOutline(space.documentOutline, space.title);
  }

  async generateOutline(spaceId: string, input?: { industryContext?: string }): Promise<DocumentOutline> {
    const space = await this.discussionSpaceModel.findOne({ id: spaceId }).lean().exec();
    if (!space) {
      throw new NotFoundException(`讨论空间不存在: ${spaceId}`);
    }

    const context = input?.industryContext?.trim() || (space.metadata as any)?.industryContext || '目标行业';
    const now = new Date();
    const sections: OutlineSection[] = [
      this.buildSection({ title: `${context} 发展脉络`, order: 0, depth: 0, metadata: { isStructuredData: false } }),
      this.buildSection({ title: '核心公司图谱', order: 1, depth: 0, metadata: { isStructuredData: true, collectFrequency: 'weekly' } }),
      this.buildSection({ title: '关键人物与组织', order: 2, depth: 0, metadata: { isStructuredData: false } }),
      this.buildSection({ title: '趋势叙事与争议焦点', order: 3, depth: 0, metadata: { isStructuredData: false } }),
      this.buildSection({ title: '关键数据指标追踪', order: 4, depth: 0, metadata: { isStructuredData: true, collectFrequency: 'daily' } }),
      this.buildSection({ title: '下一步调研与采集任务', order: 5, depth: 0, metadata: { isStructuredData: true, collectFrequency: 'weekly' } }),
    ];

    const current = this.normalizeOutline(space.documentOutline, space.title);
    const outline: DocumentOutline = {
      version: (current.version || 1) + 1,
      title: `${space.title} 行业观察大纲`,
      sections: this.rebuildChildSectionIds(sections),
      createdAt: current.createdAt || now,
      updatedAt: now,
      generatedBy: space.category === DiscussionSpaceCategory.INDUSTRY_OBSERVATION ? 'hybrid' : 'human',
    };

    await this.discussionSpaceModel.updateOne({ id: spaceId }, { $set: { documentOutline: outline } }).exec();
    return outline;
  }

  async updateOutline(spaceId: string, dto: UpdateDiscussionOutlineDto): Promise<DocumentOutline> {
    const space = await this.discussionSpaceModel.findOne({ id: spaceId }).lean().exec();
    if (!space) {
      throw new NotFoundException(`讨论空间不存在: ${spaceId}`);
    }

    const current = this.normalizeOutline(space.documentOutline, space.title);
    const now = new Date();
    const normalizedSections = this.rebuildChildSectionIds(
      (dto.sections || []).map((section, index) =>
        this.buildSection({
          ...section,
          title: String(section.title || `章节 ${index + 1}`),
          order: Number.isFinite(section.order) ? Number(section.order) : index,
          depth: Number.isFinite(section.depth) ? Number(section.depth) : 0,
        }),
      ),
    );

    const nextOutline: DocumentOutline = {
      ...current,
      title: dto.title?.trim() || current.title,
      sections: normalizedSections,
      version: current.version + 1,
      updatedAt: now,
      generatedBy: dto.generatedBy || 'human',
    };

    await this.discussionSpaceModel.updateOne({ id: spaceId }, { $set: { documentOutline: nextOutline } }).exec();
    return nextOutline;
  }

  async addSection(spaceId: string, dto: CreateDiscussionOutlineSectionDto): Promise<DocumentOutline> {
    const current = await this.getOutline(spaceId);
    const order = Number.isFinite(dto.order) ? Number(dto.order) : current.sections.length;
    const parent = dto.parentSectionId ? current.sections.find((item) => item.id === dto.parentSectionId) : undefined;
    const depth = parent ? parent.depth + 1 : 0;

    const added = this.buildSection({
      title: dto.title,
      description: dto.description,
      parentSectionId: dto.parentSectionId,
      order,
      depth,
      status: dto.status || 'draft',
      metadata: dto.metadata,
    });

    return this.updateOutline(spaceId, {
      sections: [...current.sections, added],
      generatedBy: 'human',
      title: current.title,
    });
  }

  async updateSection(spaceId: string, sectionId: string, dto: UpdateDiscussionOutlineSectionDto): Promise<DocumentOutline> {
    const current = await this.getOutline(spaceId);
    const sections = current.sections.map((section) => {
      if (section.id !== sectionId) {
        return section;
      }
      return {
        ...section,
        title: dto.title?.trim() || section.title,
        description: dto.description !== undefined ? dto.description : section.description,
        parentSectionId: dto.parentSectionId !== undefined ? dto.parentSectionId : section.parentSectionId,
        order: dto.order !== undefined ? Number(dto.order) : section.order,
        status: dto.status || section.status,
        metadata: dto.metadata || section.metadata,
      };
    });

    return this.updateOutline(spaceId, {
      sections,
      generatedBy: 'human',
      title: current.title,
    });
  }

  async deleteSection(spaceId: string, sectionId: string): Promise<DocumentOutline> {
    const current = await this.getOutline(spaceId);
    const toDelete = new Set<string>([sectionId]);

    let changed = true;
    while (changed) {
      changed = false;
      for (const section of current.sections) {
        if (section.parentSectionId && toDelete.has(section.parentSectionId) && !toDelete.has(section.id)) {
          toDelete.add(section.id);
          changed = true;
        }
      }
    }

    return this.updateOutline(spaceId, {
      sections: current.sections.filter((item) => !toDelete.has(item.id)),
      generatedBy: 'human',
      title: current.title,
    });
  }

  async getKnowledgeCoverage(spaceId: string): Promise<DiscussionKnowledgeCoverageResult> {
    const outline = await this.getOutline(spaceId);
    const sectionIds = outline.sections.map((item) => item.id);
    if (!sectionIds.length) {
      return {
        totalSections: 0,
        coveredSections: 0,
        sufficientSections: 0,
        coverage: 0,
        sectionDetails: [],
      };
    }

    const coverageAgg = await this.discussionKnowledgeEntryModel.aggregate([
      {
        $match: {
          spaceId,
          isActive: true,
          outlineSectionId: { $in: sectionIds },
        },
      },
      {
        $group: {
          _id: '$outlineSectionId',
          knowledgeCount: { $sum: 1 },
          latestEntryDate: { $max: '$createdAt' },
        },
      },
    ]);

    const sectionStatMap = new Map<string, { knowledgeCount: number; latestEntryDate?: Date }>();
    for (const item of coverageAgg) {
      if (!item?._id) {
        continue;
      }
      sectionStatMap.set(String(item._id), {
        knowledgeCount: Number(item.knowledgeCount || 0),
        latestEntryDate: item.latestEntryDate ? new Date(item.latestEntryDate) : undefined,
      });
    }

    const sectionDetails = outline.sections.map((section) => {
      const stat = sectionStatMap.get(section.id);
      const knowledgeCount = stat?.knowledgeCount || section.knowledgeCount || 0;
      return {
        sectionId: section.id,
        sectionTitle: section.title,
        knowledgeCount,
        status: section.status,
        latestEntryDate: stat?.latestEntryDate,
      };
    });

    const totalSections = sectionDetails.length;
    const coveredSections = sectionDetails.filter((item) => item.knowledgeCount > 0).length;
    const sufficientSections = sectionDetails.filter((item) => item.status === 'sufficient').length;

    return {
      totalSections,
      coveredSections,
      sufficientSections,
      coverage: totalSections ? Number((coveredSections / totalSections).toFixed(4)) : 0,
      sectionDetails,
    };
  }
}
