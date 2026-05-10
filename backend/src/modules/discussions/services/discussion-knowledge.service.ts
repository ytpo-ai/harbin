import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  DiscussionKnowledgeCredibility,
  DiscussionKnowledgeEntry,
  DiscussionKnowledgeEntryDocument,
  DiscussionKnowledgeEntryType,
  DiscussionKnowledgeSourceType,
} from '../../../shared/schemas/discussion-knowledge-entry.schema';
import {
  DiscussionSpace,
  DiscussionSpaceDocument,
  OutlineSectionStatus,
} from '../../../shared/schemas/discussion-space.schema';
import { DiscussionParticipant, DiscussionParticipantDocument } from '../../../shared/schemas/discussion-participant.schema';
import { DiscussionMessage, DiscussionMessageDocument } from '../../../shared/schemas/discussion-message.schema';
import { DiscussionSpaceService } from './discussion-space.service';
import {
  CreateDiscussionKnowledgeEntryDto,
  DeleteDiscussionKnowledgeEntryResult,
  ListDiscussionKnowledgeQuery,
} from '../discussion.types';

export function extractKeywordTags(content: string, max = 8): string[] {
  const cleaned = String(content || '')
    .toLowerCase()
    .replace(/[`~!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/g, ' ');
  const pieces = cleaned
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 3);
  const ignored = new Set(['this', 'that', 'with', 'from', 'have', 'will', 'what', 'where', 'when', 'about']);
  const score = new Map<string, number>();

  for (const piece of pieces) {
    if (ignored.has(piece)) {
      continue;
    }
    score.set(piece, (score.get(piece) || 0) + 1);
  }

  return Array.from(score.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.max(1, max))
    .map(([word]) => word);
}

export function inferCredibility(sourceType: DiscussionKnowledgeSourceType, sourceUrl?: string): DiscussionKnowledgeCredibility {
  if (sourceType === DiscussionKnowledgeSourceType.USER_INPUT || sourceType === DiscussionKnowledgeSourceType.DISCUSSION_DERIVED) {
    return DiscussionKnowledgeCredibility.UNVERIFIED;
  }

  if (!sourceUrl) {
    return DiscussionKnowledgeCredibility.MEDIUM;
  }

  const trustedDomains = ['gov', 'edu', 'reuters.com', 'bloomberg.com', 'iea.org', 'imf.org', 'worldbank.org'];
  const normalized = sourceUrl.toLowerCase();
  if (trustedDomains.some((domain) => normalized.includes(domain))) {
    return DiscussionKnowledgeCredibility.HIGH;
  }

  if (sourceType === DiscussionKnowledgeSourceType.WEB_SEARCH) {
    return DiscussionKnowledgeCredibility.MEDIUM;
  }

  return DiscussionKnowledgeCredibility.LOW;
}

function buildSummary(content: string, maxLength = 140): string {
  const normalized = String(content || '').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '无摘要';
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}...`;
}

export function buildReusableKnowledgeFilter(
  spaceId: string,
  input: { topicTags?: string[]; includeDerived?: boolean },
): Record<string, any> {
  const topicTags = (input.topicTags || []).filter(Boolean);
  const filter: Record<string, any> = {
    spaceId,
    isActive: true,
  };

  if (!input.includeDerived) {
    filter.sourceType = { $ne: DiscussionKnowledgeSourceType.DISCUSSION_DERIVED };
  }

  if (topicTags.length) {
    filter.$or = [{ topicTags: { $in: topicTags } }, { keywordTags: { $in: topicTags } }];
  }

  return filter;
}

export function resolveOutlineSectionStatusByKnowledgeCount(
  knowledgeCount: number,
  currentStatus?: OutlineSectionStatus,
): OutlineSectionStatus {
  if (currentStatus === 'review') {
    return 'review';
  }

  if (knowledgeCount <= 0) {
    return 'draft';
  }

  if (knowledgeCount >= 3) {
    return 'sufficient';
  }

  return 'enriching';
}

@Injectable()
export class DiscussionKnowledgeService {
  constructor(
    @InjectModel(DiscussionSpace.name)
    private readonly discussionSpaceModel: Model<DiscussionSpaceDocument>,
    @InjectModel(DiscussionKnowledgeEntry.name)
    private readonly discussionKnowledgeEntryModel: Model<DiscussionKnowledgeEntryDocument>,
    @InjectModel(DiscussionParticipant.name)
    private readonly discussionParticipantModel: Model<DiscussionParticipantDocument>,
    @InjectModel(DiscussionMessage.name)
    private readonly discussionMessageModel: Model<DiscussionMessageDocument>,
    private readonly discussionSpaceService: DiscussionSpaceService,
  ) {}

  private async syncOutlineSectionProgress(spaceId: string, outlineSectionId?: string): Promise<void> {
    const sectionId = String(outlineSectionId || '').trim();
    if (!sectionId) {
      return;
    }

    const [knowledgeCount, space] = await Promise.all([
      this.discussionKnowledgeEntryModel.countDocuments({
        spaceId,
        outlineSectionId: sectionId,
        isActive: true,
      }),
      this.discussionSpaceModel.findOne({ id: spaceId }).lean().exec(),
    ]);

    if (!space?.documentOutline || !Array.isArray((space.documentOutline as any).sections)) {
      return;
    }

    const currentOutline = space.documentOutline as Record<string, any>;
    const currentSections = (currentOutline.sections || []) as Array<Record<string, any>>;
    let changed = false;
    const nextSections = currentSections.map((section) => {
      if (String(section?.id || '') !== sectionId) {
        return section;
      }
      const nextStatus = resolveOutlineSectionStatusByKnowledgeCount(
        Number(knowledgeCount || 0),
        (section?.status || 'draft') as OutlineSectionStatus,
      );
      const prevKnowledgeCount = Number(section?.knowledgeCount || 0);
      const prevStatus = String(section?.status || 'draft');
      if (prevKnowledgeCount === Number(knowledgeCount || 0) && prevStatus === nextStatus) {
        return section;
      }
      changed = true;
      return {
        ...section,
        knowledgeCount: Number(knowledgeCount || 0),
        status: nextStatus,
      };
    });

    if (!changed) {
      return;
    }

    await this.discussionSpaceModel
      .updateOne(
        { id: spaceId },
        {
          $set: {
            documentOutline: {
              ...currentOutline,
              version: Number(currentOutline.version || 1) + 1,
              updatedAt: new Date(),
              sections: nextSections,
            },
          },
        },
      )
      .exec();
  }

  async createKnowledgeEntry(spaceId: string, dto: CreateDiscussionKnowledgeEntryDto): Promise<DiscussionKnowledgeEntry> {
    const keywordTags = dto.keywordTags?.length ? dto.keywordTags : extractKeywordTags(dto.content);
    const credibility = dto.credibility || inferCredibility(dto.sourceType, dto.sourceUrl);
    const summary = dto.summary?.trim() || buildSummary(dto.content);

    const created = await this.discussionKnowledgeEntryModel.create({
      ...dto,
      spaceId,
      summary,
      keywordTags,
      topicTags: dto.topicTags || [],
      domainTags: dto.domainTags || [],
      outlineSectionId: dto.outlineSectionId,
      entryType: dto.entryType || DiscussionKnowledgeEntryType.FACT,
      structuredData: dto.structuredData
        ? {
            ...dto.structuredData,
            measureDate: dto.structuredData.measureDate ? new Date(dto.structuredData.measureDate) : undefined,
          }
        : undefined,
      metadata: dto.metadata,
      credibility,
      contentDate: dto.contentDate ? new Date(dto.contentDate) : undefined,
      credibilityDetail: {
        sourceAuthority: credibility === DiscussionKnowledgeCredibility.HIGH ? 'high' : 'medium',
        contentFreshness: 'recent',
        crossValidated: false,
        userOverride: Boolean(dto.credibility),
        lastAssessedAt: new Date(),
      },
    });

    await Promise.all([
      this.discussionParticipantModel
        .updateOne({ id: dto.participantId, spaceId }, { $inc: { knowledgeContribution: 1 } })
        .exec(),
      this.discussionSpaceService.incrementStatistics(spaceId, { totalKnowledgeEntries: 1 }),
    ]);

    await this.syncOutlineSectionProgress(spaceId, dto.outlineSectionId);

    return created;
  }

  async createDerivedKnowledgeEntry(input: {
    spaceId: string;
    threadId: string;
    messageId: string;
    participantId: string;
    title: string;
    content: string;
    topicTags?: string[];
    domainTags?: string[];
  }): Promise<DiscussionKnowledgeEntry> {
    return this.createKnowledgeEntry(input.spaceId, {
      participantId: input.participantId,
      threadId: input.threadId,
      messageId: input.messageId,
      title: input.title,
      content: input.content,
      sourceType: DiscussionKnowledgeSourceType.DISCUSSION_DERIVED,
      sourceName: 'discussion-space',
      topicTags: input.topicTags || [],
      domainTags: input.domainTags || [],
    });
  }

  async listKnowledgeEntries(spaceId: string, query: ListDiscussionKnowledgeQuery): Promise<DiscussionKnowledgeEntry[]> {
    const filter: Record<string, any> = {
      spaceId,
      isActive: true,
    };
    const andFilters: Array<Record<string, any>> = [];

    if (query.threadId) {
      andFilters.push({
        $or: [
          { threadId: query.threadId },
          { threadId: { $exists: false } },
          { threadId: null },
          { threadId: '' },
        ],
      });
    }
    if (query.participantId) {
      filter.participantId = query.participantId;
    }
    if (query.outlineSectionId) {
      filter.outlineSectionId = query.outlineSectionId;
    }
    if (query.credibility) {
      filter.credibility = query.credibility;
    }
    if (query.keyword) {
      andFilters.push({
        $or: [
          { title: { $regex: query.keyword, $options: 'i' } },
          { summary: { $regex: query.keyword, $options: 'i' } },
          { keywordTags: { $in: [query.keyword.toLowerCase()] } },
        ],
      });
    }

    if (andFilters.length > 0) {
      filter.$and = andFilters;
    }

    const limit = Math.max(1, Math.min(Number(query.limit || 50), 200));
    return this.discussionKnowledgeEntryModel
      .find(filter)
      .sort({ referenceCount: -1, createdAt: -1 })
      .limit(limit)
      .lean()
      .exec() as unknown as DiscussionKnowledgeEntry[];
  }

  async getReusableKnowledge(spaceId: string, input: { topicTags?: string[]; limit?: number; includeDerived?: boolean }): Promise<DiscussionKnowledgeEntry[]> {
    const filter = buildReusableKnowledgeFilter(spaceId, input);

    return this.discussionKnowledgeEntryModel
      .find(filter)
      .sort({ credibility: 1, referenceCount: -1, createdAt: -1 })
      .limit(Math.max(1, Math.min(Number(input.limit || 5), 20)))
      .lean()
      .exec() as unknown as DiscussionKnowledgeEntry[];
  }

  async linkKnowledgeToMessage(spaceId: string, messageId: string, knowledgeEntryIds: string[]): Promise<void> {
    if (!knowledgeEntryIds.length) {
      return;
    }

    await Promise.all([
      this.discussionMessageModel
        .updateOne(
          { id: messageId, spaceId },
          {
            $addToSet: {
              knowledgeEntryIds: { $each: knowledgeEntryIds },
            },
          },
        )
        .exec(),
      this.discussionKnowledgeEntryModel
        .updateMany({ id: { $in: knowledgeEntryIds }, spaceId }, { $inc: { referenceCount: 1 } })
        .exec(),
    ]);
  }

  async linkExistingKnowledgeEntriesToMessage(input: {
    spaceId: string;
    threadId: string;
    messageId: string;
    knowledgeEntryIds: string[];
  }): Promise<string[]> {
    const deduplicatedIds = Array.from(new Set((input.knowledgeEntryIds || []).map((id) => String(id || '').trim()).filter(Boolean)));
    if (!deduplicatedIds.length) {
      throw new BadRequestException('knowledgeEntryIds 至少需要包含一个条目');
    }

    const message = await this.discussionMessageModel
      .findOne({ id: input.messageId, spaceId: input.spaceId, threadId: input.threadId })
      .lean()
      .exec();
    if (!message) {
      throw new NotFoundException(`消息不存在: ${input.messageId}`);
    }

    const existingKnowledgeEntries = await this.discussionKnowledgeEntryModel
      .find({
        spaceId: input.spaceId,
        id: { $in: deduplicatedIds },
        isActive: true,
      })
      .select({ id: 1 })
      .lean()
      .exec() as Array<Pick<DiscussionKnowledgeEntry, 'id'>>;

    const existingIds = new Set(existingKnowledgeEntries.map((item) => item.id));
    const missingIds = deduplicatedIds.filter((id) => !existingIds.has(id));
    if (missingIds.length) {
      throw new NotFoundException(`知识条目不存在或不可用: ${missingIds.join(',')}`);
    }

    await this.linkKnowledgeToMessage(input.spaceId, input.messageId, deduplicatedIds);
    return deduplicatedIds;
  }

  async deleteKnowledgeEntry(spaceId: string, knowledgeEntryId: string): Promise<DeleteDiscussionKnowledgeEntryResult> {
    const normalizedId = String(knowledgeEntryId || '').trim();
    if (!normalizedId) {
      throw new BadRequestException('knowledgeEntryId 不能为空');
    }

    const target = await this.discussionKnowledgeEntryModel
      .findOne({ id: normalizedId, spaceId, isActive: true })
      .lean()
      .exec();
    if (!target) {
      throw new NotFoundException(`知识条目不存在: ${normalizedId}`);
    }

    await Promise.all([
      this.discussionKnowledgeEntryModel
        .updateOne(
          { id: normalizedId, spaceId },
          {
            $set: {
              isActive: false,
            },
          },
        )
        .exec(),
      this.discussionMessageModel
        .updateMany(
          { spaceId },
          {
            $pull: {
              knowledgeEntryIds: normalizedId,
            },
          },
        )
        .exec(),
      this.discussionSpaceService.incrementStatistics(spaceId, { totalKnowledgeEntries: -1 }),
    ]);

    await this.syncOutlineSectionProgress(spaceId, String((target as Record<string, unknown>).outlineSectionId || '').trim() || undefined);

    return {
      removed: true,
      knowledgeEntryId: normalizedId,
    };
  }
}
