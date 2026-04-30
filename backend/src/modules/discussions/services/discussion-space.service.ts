import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  DiscussionSpace,
  DiscussionSpaceCategory,
  DiscussionSpaceDocument,
  DiscussionSpaceStatus,
} from '../../../shared/schemas/discussion-space.schema';
import { CreateDiscussionSpaceDto, ListDiscussionSpacesQuery, UpdateDiscussionSpaceDto } from '../discussion.types';

@Injectable()
export class DiscussionSpaceService {
  constructor(
    @InjectModel(DiscussionSpace.name)
    private readonly discussionSpaceModel: Model<DiscussionSpaceDocument>,
  ) {}

  async createSpace(dto: CreateDiscussionSpaceDto): Promise<DiscussionSpace> {
    const { industryContext, ...spacePayload } = dto;
    const normalizedIndustryContext = industryContext?.trim();
    return this.discussionSpaceModel.create({
      ...spacePayload,
      category: dto.category || DiscussionSpaceCategory.GENERAL,
      metadata: normalizedIndustryContext ? { industryContext: normalizedIndustryContext } : undefined,
      status: DiscussionSpaceStatus.ACTIVE,
      statistics: {
        totalThreads: 1,
        totalMessages: 0,
        totalKnowledgeEntries: 0,
        totalTokensConsumed: 0,
        totalCost: 0,
      },
    });
  }

  async listSpaces(query: ListDiscussionSpacesQuery): Promise<DiscussionSpace[]> {
    const filter: Record<string, any> = {};

    if (query.status) {
      filter.status = query.status;
    }
    if (query.category) {
      filter.category = query.category;
    }
    if (query.creatorId) {
      filter.creatorId = query.creatorId;
    }
    if (query.projectId) {
      filter.projectId = query.projectId;
    }
    if (query.tags?.length) {
      filter.tags = { $in: query.tags };
    }

    return this.discussionSpaceModel.find(filter).sort({ createdAt: -1 }).lean().exec() as unknown as DiscussionSpace[];
  }

  async getSpaceById(spaceId: string): Promise<DiscussionSpace> {
    const space = await this.discussionSpaceModel.findOne({ id: spaceId }).lean().exec();
    if (!space) {
      throw new NotFoundException(`讨论空间不存在: ${spaceId}`);
    }
    return space as unknown as DiscussionSpace;
  }

  async updateSpace(spaceId: string, dto: UpdateDiscussionSpaceDto): Promise<DiscussionSpace> {
    const updated = await this.discussionSpaceModel
      .findOneAndUpdate({ id: spaceId }, { $set: dto }, { new: true })
      .lean()
      .exec();

    if (!updated) {
      throw new NotFoundException(`讨论空间不存在: ${spaceId}`);
    }

    return updated as unknown as DiscussionSpace;
  }

  async updateStatus(spaceId: string, status: DiscussionSpaceStatus): Promise<DiscussionSpace> {
    const updated = await this.discussionSpaceModel
      .findOneAndUpdate({ id: spaceId }, { $set: { status } }, { new: true })
      .lean()
      .exec();

    if (!updated) {
      throw new NotFoundException(`讨论空间不存在: ${spaceId}`);
    }

    return updated as unknown as DiscussionSpace;
  }

  async archiveSpace(spaceId: string): Promise<DiscussionSpace> {
    return this.updateStatus(spaceId, DiscussionSpaceStatus.ARCHIVED);
  }

  async setRootThread(spaceId: string, rootThreadId: string): Promise<void> {
    await this.discussionSpaceModel.updateOne({ id: spaceId }, { $set: { rootThreadId } }).exec();
  }

  async clearDefaultReplyAgentIfMatched(spaceId: string, participantId: string): Promise<void> {
    await this.discussionSpaceModel.updateOne(
      {
        id: spaceId,
        'settings.defaultReplyAgentId': participantId,
      },
      {
        $unset: {
          'settings.defaultReplyAgentId': '',
        },
      },
    ).exec();
  }

  async incrementStatistics(
    spaceId: string,
    patch: { totalThreads?: number; totalMessages?: number; totalKnowledgeEntries?: number; totalTokensConsumed?: number; totalCost?: number },
  ) {
    const $inc: Record<string, number> = {};

    if (patch.totalThreads) {
      $inc['statistics.totalThreads'] = patch.totalThreads;
    }
    if (patch.totalMessages) {
      $inc['statistics.totalMessages'] = patch.totalMessages;
    }
    if (patch.totalKnowledgeEntries) {
      $inc['statistics.totalKnowledgeEntries'] = patch.totalKnowledgeEntries;
    }
    if (patch.totalTokensConsumed) {
      $inc['statistics.totalTokensConsumed'] = patch.totalTokensConsumed;
    }
    if (patch.totalCost) {
      $inc['statistics.totalCost'] = patch.totalCost;
    }

    if (Object.keys($inc).length) {
      await this.discussionSpaceModel.updateOne({ id: spaceId }, { $inc }).exec();
    }
  }
}
