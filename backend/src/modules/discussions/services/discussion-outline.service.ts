import { Injectable, Logger, MessageEvent, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomUUID } from 'crypto';
import { Observable, Subject } from 'rxjs';
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
  DiscussionOutlineTaskEventPayload,
  DiscussionOutlineTaskSnapshot,
  DiscussionOutlineTaskStatus,
  DiscussionKnowledgeCoverageResult,
  EnrichAllDiscussionOutlineSectionsResult,
  EnrichDiscussionOutlineSectionResult,
  UpdateDiscussionOutlineDto,
  UpdateDiscussionOutlineSectionDto,
} from '../discussion.types';
import { DiscussionKnowledgeService } from './discussion-knowledge.service';
import { DiscussionKnowledgeSourceType } from '../../../shared/schemas/discussion-knowledge-entry.schema';

@Injectable()
export class DiscussionOutlineService {
  private readonly logger = new Logger(DiscussionOutlineService.name);
  private readonly outlineTaskStore = new Map<string, DiscussionOutlineTaskSnapshot>();
  private readonly outlineTaskChannels = new Map<string, Set<Subject<MessageEvent>>>();

  constructor(
    @InjectModel(DiscussionSpace.name)
    private readonly discussionSpaceModel: Model<DiscussionSpaceDocument>,
    @InjectModel(DiscussionKnowledgeEntry.name)
    private readonly discussionKnowledgeEntryModel: Model<DiscussionKnowledgeEntryDocument>,
    private readonly discussionKnowledgeService: DiscussionKnowledgeService,
  ) {}

  private buildTaskId(spaceId: string): string {
    return `discussion-outline-${spaceId}-${randomUUID()}`;
  }

  private touchTask(task: DiscussionOutlineTaskSnapshot): DiscussionOutlineTaskSnapshot {
    const next: DiscussionOutlineTaskSnapshot = {
      ...task,
      updatedAt: new Date().toISOString(),
    };
    this.outlineTaskStore.set(task.taskId, next);
    return next;
  }

  private emitTaskEvent(taskId: string, payload: DiscussionOutlineTaskEventPayload): void {
    const channels = this.outlineTaskChannels.get(taskId);
    if (!channels?.size) {
      return;
    }

    const event: MessageEvent = {
      data: payload,
    };

    for (const channel of channels) {
      channel.next(event);
    }
  }

  private scheduleTaskCleanup(taskId: string): void {
    setTimeout(() => {
      this.outlineTaskStore.delete(taskId);
      this.outlineTaskChannels.delete(taskId);
    }, 30 * 60 * 1000);
  }

  private createTaskSnapshot(input: {
    spaceId: string;
    taskType: DiscussionOutlineTaskSnapshot['taskType'];
    sectionId?: string;
  }): DiscussionOutlineTaskSnapshot {
    const now = new Date().toISOString();
    const task: DiscussionOutlineTaskSnapshot = {
      taskId: this.buildTaskId(input.spaceId),
      spaceId: input.spaceId,
      taskType: input.taskType,
      sectionId: input.sectionId,
      status: 'queued',
      createdAt: now,
      updatedAt: now,
    };
    this.outlineTaskStore.set(task.taskId, task);
    return task;
  }

  private markTaskStatus(taskId: string, status: DiscussionOutlineTaskStatus): DiscussionOutlineTaskSnapshot {
    const current = this.outlineTaskStore.get(taskId);
    if (!current) {
      throw new NotFoundException(`大纲任务不存在: ${taskId}`);
    }
    const next = this.touchTask({
      ...current,
      status,
      startedAt: status === 'running' ? new Date().toISOString() : current.startedAt,
      finishedAt: status === 'succeeded' || status === 'failed' ? new Date().toISOString() : current.finishedAt,
      error: status === 'failed' ? current.error : undefined,
    });
    return next;
  }

  private buildEnrichmentContent(section: OutlineSection, index: number): { title: string; content: string; summary: string } {
    const title = `${section.title} 补充观察 ${index + 1}`;
    const content = [
      `研究章节：${section.title}`,
      section.description ? `章节说明：${section.description}` : undefined,
      '建议从至少 2 个来源交叉验证该章节的关键结论。',
      section.metadata?.isStructuredData
        ? '重点补充可量化指标（数值、单位、时间区间、对比基准）。'
        : '重点补充事实脉络、观点分歧和影响分析。',
      '后续可将关键结论沉淀到结构化报告章节中。',
    ]
      .filter(Boolean)
      .join('\n');

    return {
      title,
      content,
      summary: `${section.title} 的补充知识条目（自动生成）`,
    };
  }

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

  async enrichSection(spaceId: string, sectionId: string): Promise<EnrichDiscussionOutlineSectionResult> {
    const outline = await this.getOutline(spaceId);
    const section = outline.sections.find((item) => item.id === sectionId);
    if (!section) {
      throw new NotFoundException(`章节不存在: ${sectionId}`);
    }

    const existingCount = await this.discussionKnowledgeEntryModel.countDocuments({
      spaceId,
      outlineSectionId: sectionId,
      isActive: true,
    });

    const targetThreshold = 5;
    const remaining = Math.max(0, targetThreshold - Number(existingCount || 0));
    const addCount = Math.min(3, remaining);

    for (let index = 0; index < addCount; index += 1) {
      const generated = this.buildEnrichmentContent(section, index);
      await this.discussionKnowledgeService.createKnowledgeEntry(spaceId, {
        participantId: 'system',
        title: generated.title,
        content: generated.content,
        summary: generated.summary,
        outlineSectionId: section.id,
        entryType: section.metadata?.isStructuredData ? 'data_point' : 'analysis',
        sourceType: DiscussionKnowledgeSourceType.DISCUSSION_DERIVED,
        sourceName: 'outline-enricher',
        topicTags: [section.title],
      });
    }

    return {
      sectionId,
      enrichedCount: addCount,
      outline: await this.getOutline(spaceId),
    };
  }

  async enrichAllDraftSections(spaceId: string): Promise<EnrichAllDiscussionOutlineSectionsResult> {
    const outline = await this.getOutline(spaceId);
    const draftSections = outline.sections.filter((item) => item.status === 'draft');

    let enrichedCount = 0;
    for (const section of draftSections) {
      const result = await this.enrichSection(spaceId, section.id);
      enrichedCount += result.enrichedCount;
    }

    return {
      processedSectionIds: draftSections.map((item) => item.id),
      enrichedCount,
      outline: await this.getOutline(spaceId),
    };
  }

  async createGenerateOutlineTask(spaceId: string, input?: { industryContext?: string }): Promise<DiscussionOutlineTaskSnapshot> {
    const task = this.createTaskSnapshot({ spaceId, taskType: 'generate' });

    setTimeout(async () => {
      try {
        const running = this.markTaskStatus(task.taskId, 'running');
        this.emitTaskEvent(task.taskId, {
          type: 'discussion.outline.task.running',
          data: { task: running },
        });

        const outline = await this.generateOutline(spaceId, input);
        const succeeded = this.touchTask({
          ...running,
          status: 'succeeded',
          finishedAt: new Date().toISOString(),
          result: { outline },
        });

        this.emitTaskEvent(task.taskId, {
          type: 'discussion.outline.task.succeeded',
          data: { task: succeeded },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'outline_generate_failed';
        const current = this.outlineTaskStore.get(task.taskId);
        if (!current) {
          return;
        }
        const failed = this.touchTask({
          ...current,
          status: 'failed',
          finishedAt: new Date().toISOString(),
          error: message,
        });
        this.emitTaskEvent(task.taskId, {
          type: 'discussion.outline.task.failed',
          data: { task: failed },
        });
        this.logger.warn(`Generate outline task failed: spaceId=${spaceId} taskId=${task.taskId} reason=${message}`);
      } finally {
        this.scheduleTaskCleanup(task.taskId);
      }
    }, 0);

    return task;
  }

  async createEnrichSectionTask(spaceId: string, sectionId: string): Promise<DiscussionOutlineTaskSnapshot> {
    const task = this.createTaskSnapshot({ spaceId, taskType: 'enrich_section', sectionId });

    setTimeout(async () => {
      try {
        const running = this.markTaskStatus(task.taskId, 'running');
        this.emitTaskEvent(task.taskId, {
          type: 'discussion.outline.task.running',
          data: { task: running },
        });

        const result = await this.enrichSection(spaceId, sectionId);
        const succeeded = this.touchTask({
          ...running,
          status: 'succeeded',
          finishedAt: new Date().toISOString(),
          result: {
            outline: result.outline,
            enrichedCount: result.enrichedCount,
          },
        });

        this.emitTaskEvent(task.taskId, {
          type: 'discussion.outline.task.succeeded',
          data: { task: succeeded },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'outline_enrich_failed';
        const current = this.outlineTaskStore.get(task.taskId);
        if (!current) {
          return;
        }
        const failed = this.touchTask({
          ...current,
          status: 'failed',
          finishedAt: new Date().toISOString(),
          error: message,
        });
        this.emitTaskEvent(task.taskId, {
          type: 'discussion.outline.task.failed',
          data: { task: failed },
        });
        this.logger.warn(`Enrich section task failed: spaceId=${spaceId} sectionId=${sectionId} taskId=${task.taskId} reason=${message}`);
      } finally {
        this.scheduleTaskCleanup(task.taskId);
      }
    }, 0);

    return task;
  }

  async streamOutlineTaskEvents(spaceId: string, taskId: string): Promise<Observable<MessageEvent>> {
    const task = this.outlineTaskStore.get(taskId);
    if (!task || task.spaceId !== spaceId) {
      throw new NotFoundException(`大纲任务不存在: ${taskId}`);
    }

    return new Observable<MessageEvent>((subscriber) => {
      let channels = this.outlineTaskChannels.get(taskId);
      if (!channels) {
        channels = new Set<Subject<MessageEvent>>();
        this.outlineTaskChannels.set(taskId, channels);
      }

      const channel = new Subject<MessageEvent>();
      const subscription = channel.subscribe({
        next: (event) => subscriber.next(event),
        error: (error) => subscriber.error(error),
        complete: () => subscriber.complete(),
      });

      channels.add(channel);
      channel.next({
        data: {
          type: 'discussion.outline.task.snapshot',
          data: {
            task,
          },
        },
      });

      return () => {
        subscription.unsubscribe();
        const target = this.outlineTaskChannels.get(taskId);
        if (!target) {
          return;
        }
        target.delete(channel);
        channel.complete();
        if (!target.size) {
          this.outlineTaskChannels.delete(taskId);
        }
      };
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
