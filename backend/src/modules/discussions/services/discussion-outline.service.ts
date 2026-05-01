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
import { AgentClientService } from '../../agents-client/agent-client.service';
import { AgentExecutionTask } from '../../../shared/types';

const OUTLINE_TASK_RETENTION_MS = 30 * 60 * 1000;
const INDUSTRY_RESEARCH_ROLE_CODE = 'industry-research';

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
    private readonly agentClientService: AgentClientService,
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
    }, OUTLINE_TASK_RETENTION_MS);
  }

  private extractAgentCandidateValue(candidate: Record<string, unknown>, key: string): string {
    const value = candidate[key];
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
  }

  private isOutlineResearchAgent(candidate: Record<string, unknown>): boolean {
    const roleCode = this.extractAgentCandidateValue(candidate, 'roleCode');
    const agentType = this.extractAgentCandidateValue(candidate, 'agentType');
    const roleName = this.extractAgentCandidateValue(candidate, 'roleName');
    const name = this.extractAgentCandidateValue(candidate, 'name');
    const description = this.extractAgentCandidateValue(candidate, 'description');

    if (roleCode === INDUSTRY_RESEARCH_ROLE_CODE) {
      return true;
    }
    if (agentType === 'industry-research' || agentType === 'research') {
      return true;
    }

    const labels = `${roleName} ${name} ${description}`;
    return labels.includes('行业研究') || labels.includes('industry research') || labels.includes('行业观察');
  }

  private async resolveOutlineAgentId(space: DiscussionSpaceDocument): Promise<string | null> {
    const defaultReplyAgentId = String(space.settings?.defaultReplyAgentId || '').trim();
    if (defaultReplyAgentId) {
      const matched = await this.agentClientService.getAgent(defaultReplyAgentId);
      if (matched?.id && matched.isActive) {
        return String(matched.id);
      }
    }

    const projectAgents = await this.agentClientService.getActiveAgents(space.projectId ? { projectId: space.projectId } : undefined);
    const projectMatch = projectAgents.find((item) => this.isOutlineResearchAgent(item as unknown as Record<string, unknown>));
    if (projectMatch?.id) {
      return String(projectMatch.id);
    }

    if (space.projectId) {
      const globalAgents = await this.agentClientService.getActiveAgents();
      const globalMatch = globalAgents.find((item) => this.isOutlineResearchAgent(item as unknown as Record<string, unknown>));
      if (globalMatch?.id) {
        return String(globalMatch.id);
      }
    }

    return null;
  }

  private buildDefaultOutlineSections(context: string): OutlineSection[] {
    return [
      this.buildSection({ title: `${context} 发展脉络`, order: 0, depth: 0, metadata: { isStructuredData: false } }),
      this.buildSection({ title: '核心公司图谱', order: 1, depth: 0, metadata: { isStructuredData: true, collectFrequency: 'weekly' } }),
      this.buildSection({ title: '关键人物与组织', order: 2, depth: 0, metadata: { isStructuredData: false } }),
      this.buildSection({ title: '趋势叙事与争议焦点', order: 3, depth: 0, metadata: { isStructuredData: false } }),
      this.buildSection({ title: '关键数据指标追踪', order: 4, depth: 0, metadata: { isStructuredData: true, collectFrequency: 'daily' } }),
      this.buildSection({ title: '下一步调研与采集任务', order: 5, depth: 0, metadata: { isStructuredData: true, collectFrequency: 'weekly' } }),
    ];
  }

  private buildOutlineGenerationTask(input: {
    spaceId: string;
    spaceTitle: string;
    industryContext: string;
    category: DiscussionSpaceCategory;
  }): AgentExecutionTask {
    const description = [
      `你是行业研究专家。请为讨论空间生成结构化文档大纲，必须输出 JSON。`,
      `讨论空间：${input.spaceTitle}`,
      `分类：${input.category}`,
      `行业上下文：${input.industryContext}`,
      '要求：',
      '1. 覆盖行业脉络、核心公司、关键人物、趋势叙事、数据验证、输出节奏。',
      '2. 章节支持父子层级，顶层章节建议 5-8 个，每个顶层包含 2-4 个子章节。',
      '3. 每个章节包含 title/description/order/depth，并尽量补充 metadata：suggestedDataSources/collectFrequency/isStructuredData。',
      '4. 输出必须是 JSON，不要附加解释文本。',
      '输出格式：',
      '{',
      '  "title": "...",',
      '  "sections": [',
      '    {',
      '      "id": "optional",',
      '      "title": "...",',
      '      "description": "...",',
      '      "parentSectionId": "optional",',
      '      "order": 0,',
      '      "depth": 0,',
      '      "metadata": {',
      '        "suggestedDataSources": ["..."],',
      '        "collectFrequency": "daily|weekly|monthly",',
      '        "isStructuredData": true',
      '      }',
      '    }',
      '  ]',
      '}',
    ].join('\n');

    return {
      id: this.buildTaskId(input.spaceId),
      title: `Discussion outline generation | ${input.spaceTitle}`,
      description,
      type: 'discussion_outline_generate',
      priority: 'medium',
      status: 'pending',
      assignedAgents: [],
      teamId: input.spaceId,
      messages: [],
    };
  }

  private parseOutlinePayload(raw: string): { title?: string; sections: Array<Record<string, unknown>> } | null {
    const text = String(raw || '').trim();
    if (!text) {
      return null;
    }

    const candidates: string[] = [text];
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced?.[1]) {
      candidates.unshift(fenced[1].trim());
    }

    const firstJsonStart = text.search(/[\[{]/);
    if (firstJsonStart >= 0) {
      candidates.push(text.slice(firstJsonStart).trim());
    }

    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(candidate) as unknown;
        if (Array.isArray(parsed)) {
          return { sections: parsed as Array<Record<string, unknown>> };
        }
        if (parsed && typeof parsed === 'object') {
          const payload = parsed as Record<string, unknown>;
          const sections = Array.isArray(payload.sections) ? (payload.sections as Array<Record<string, unknown>>) : [];
          if (sections.length) {
            return {
              title: typeof payload.title === 'string' ? payload.title : undefined,
              sections,
            };
          }
        }
      } catch (_error) {
        continue;
      }
    }

    return null;
  }

  private normalizeGeneratedSections(rawSections: Array<Record<string, unknown>>): OutlineSection[] {
    const generated = rawSections
      .filter((item) => item && typeof item === 'object' && String(item.title || '').trim())
      .map((item, index) => {
        const title = String(item.title || '').trim() || `章节 ${index + 1}`;
        const rawOrder = Number(item.order);
        const rawDepth = Number(item.depth);
        const metadata = item.metadata && typeof item.metadata === 'object'
          ? {
              suggestedDataSources: Array.isArray((item.metadata as Record<string, unknown>).suggestedDataSources)
                ? ((item.metadata as Record<string, unknown>).suggestedDataSources as unknown[])
                    .map((value) => String(value || '').trim())
                    .filter(Boolean)
                : undefined,
              collectFrequency: ['daily', 'weekly', 'monthly'].includes(String((item.metadata as Record<string, unknown>).collectFrequency || '').trim())
                ? String((item.metadata as Record<string, unknown>).collectFrequency || '').trim()
                : undefined,
              isStructuredData: Boolean((item.metadata as Record<string, unknown>).isStructuredData),
            }
          : undefined;

        return this.buildSection({
          id: String(item.id || '').trim() || randomUUID(),
          title,
          description: String(item.description || '').trim() || undefined,
          parentSectionId: String(item.parentSectionId || '').trim() || undefined,
          order: Number.isFinite(rawOrder) ? rawOrder : index,
          depth: Number.isFinite(rawDepth) ? Math.max(0, rawDepth) : 0,
          metadata,
          status: 'draft',
          knowledgeCount: 0,
        });
      });

    return this.rebuildChildSectionIds(generated);
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
    const space = await this.discussionSpaceModel.findOne({ id: spaceId }).exec();
    if (!space) {
      throw new NotFoundException(`讨论空间不存在: ${spaceId}`);
    }

    const context = input?.industryContext?.trim() || (space.metadata as any)?.industryContext || '目标行业';
    const now = new Date();
    const defaultSections = this.buildDefaultOutlineSections(context);

    let sections = defaultSections;
    let generatedBy: DocumentOutline['generatedBy'] = 'human';
    let runtimeRunId: string | undefined;
    let runtimeSessionId: string | undefined;
    let runtimeAgentId: string | undefined;

    try {
      const agentId = await this.resolveOutlineAgentId(space);
      if (agentId) {
        const task = this.buildOutlineGenerationTask({
          spaceId,
          spaceTitle: space.title,
          industryContext: context,
          category: space.category,
        });
        task.assignedAgents = [agentId];

        const runtime = await this.agentClientService.executeTaskDetailed(agentId, task, {
          executionMode: 'chat',
          source: 'discussion_outline_runtime',
          agentSessionId: this.buildTaskId(spaceId),
          collaborationContext: {
            scene: 'discussion',
            spaceId,
            category: space.category,
            industryContext: context,
          },
          requestMeta: {
            source: 'discussion-outline-service',
          },
        });

        const parsedPayload = this.parseOutlinePayload(runtime.response);
        const parsedSections = parsedPayload?.sections?.length ? this.normalizeGeneratedSections(parsedPayload.sections) : [];
        if (parsedSections.length) {
          sections = parsedSections;
          generatedBy = 'agent';
        } else {
          generatedBy = space.category === DiscussionSpaceCategory.INDUSTRY_OBSERVATION ? 'hybrid' : 'human';
        }

        runtimeRunId = runtime.runId;
        runtimeSessionId = runtime.sessionId;
        runtimeAgentId = agentId;
      } else {
        generatedBy = space.category === DiscussionSpaceCategory.INDUSTRY_OBSERVATION ? 'hybrid' : 'human';
      }
    } catch (error) {
      this.logger.warn(
        `Outline runtime generation failed, fallback to default template: spaceId=${spaceId} reason=${error instanceof Error ? error.message : 'unknown'}`,
      );
      generatedBy = space.category === DiscussionSpaceCategory.INDUSTRY_OBSERVATION ? 'hybrid' : 'human';
      sections = defaultSections;
    }

    const current = this.normalizeOutline(space.documentOutline, space.title);
    const outline: DocumentOutline = {
      version: (current.version || 1) + 1,
      title: `${space.title} 行业观察大纲`,
      sections,
      createdAt: current.createdAt || now,
      updatedAt: now,
      generatedBy,
      agentId: runtimeAgentId || current.agentId,
      runId: runtimeRunId || current.runId,
      sessionId: runtimeSessionId || current.sessionId,
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
