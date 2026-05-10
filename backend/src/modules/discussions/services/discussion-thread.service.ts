import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  DiscussionThread,
  DiscussionThreadBranchOrigin,
  DiscussionThreadDocument,
  DiscussionThreadStatus,
} from '../../../shared/schemas/discussion-thread.schema';
import { DiscussionMessage, DiscussionMessageDocument } from '../../../shared/schemas/discussion-message.schema';
import { DiscussionKnowledgeEntry, DiscussionKnowledgeEntryDocument } from '../../../shared/schemas/discussion-knowledge-entry.schema';
import { CreateDiscussionThreadDto, DeleteDiscussionThreadResult, UpdateDiscussionThreadDto } from '../discussion.types';
import { DiscussionSpaceService } from './discussion-space.service';

export function canCreateBranch(maxBranchDepth: number | undefined, parentDepth: number): boolean {
  if (typeof maxBranchDepth !== 'number' || maxBranchDepth < 0) {
    return true;
  }
  return parentDepth + 1 <= maxBranchDepth;
}

export function collectThreadSubtreeIds(rootThreadId: string, threads: Pick<DiscussionThread, 'id' | 'parentThreadId'>[]): string[] {
  const byParent = new Map<string, string[]>();

  for (const thread of threads) {
    if (!thread.parentThreadId) {
      continue;
    }
    const children = byParent.get(thread.parentThreadId) || [];
    children.push(thread.id);
    byParent.set(thread.parentThreadId, children);
  }

  const visited = new Set<string>();
  const stack = [rootThreadId];

  while (stack.length) {
    const current = stack.pop();
    if (!current || visited.has(current)) {
      continue;
    }
    visited.add(current);
    const children = byParent.get(current) || [];
    for (const childId of children) {
      stack.push(childId);
    }
  }

  return Array.from(visited);
}

@Injectable()
export class DiscussionThreadService {
  constructor(
    @InjectModel(DiscussionThread.name)
    private readonly discussionThreadModel: Model<DiscussionThreadDocument>,
    @InjectModel(DiscussionMessage.name)
    private readonly discussionMessageModel: Model<DiscussionMessageDocument>,
    @InjectModel(DiscussionKnowledgeEntry.name)
    private readonly discussionKnowledgeEntryModel: Model<DiscussionKnowledgeEntryDocument>,
    private readonly discussionSpaceService: DiscussionSpaceService,
  ) {}

  async createRootThread(spaceId: string, title = '主讨论线'): Promise<DiscussionThread> {
    return this.discussionThreadModel.create({
      spaceId,
      title,
      branchOrigin: DiscussionThreadBranchOrigin.USER,
      depth: 0,
      status: DiscussionThreadStatus.ACTIVE,
      childThreadIds: [],
      activeParticipantIds: [],
      messageCount: 0,
    });
  }

  async createThread(spaceId: string, dto: CreateDiscussionThreadDto): Promise<DiscussionThread> {
    let depth = 0;

    if (dto.parentThreadId) {
      const parent = await this.discussionThreadModel.findOne({ id: dto.parentThreadId, spaceId }).lean().exec();
      if (!parent) {
        throw new NotFoundException(`父讨论线不存在: ${dto.parentThreadId}`);
      }

      const space = await this.discussionSpaceService.getSpaceById(spaceId);
      if (!canCreateBranch(space.settings?.maxBranchDepth, parent.depth)) {
        throw new BadRequestException(`已达到最大分叉深度: ${space.settings?.maxBranchDepth}`);
      }

      depth = parent.depth + 1;
    }

    const thread = await this.discussionThreadModel.create({
      ...dto,
      spaceId,
      depth,
      branchOrigin: dto.branchOrigin || DiscussionThreadBranchOrigin.USER,
      status: DiscussionThreadStatus.ACTIVE,
      childThreadIds: [],
      activeParticipantIds: [],
      messageCount: 0,
    });

    if (dto.parentThreadId) {
      await this.discussionThreadModel.updateOne(
        { id: dto.parentThreadId, spaceId },
        { $addToSet: { childThreadIds: thread.id } },
      ).exec();
    }

    await this.discussionSpaceService.incrementStatistics(spaceId, { totalThreads: 1 });
    return thread;
  }

  async getThreadById(spaceId: string, threadId: string): Promise<DiscussionThread> {
    const thread = await this.discussionThreadModel.findOne({ id: threadId, spaceId }).lean().exec();
    if (!thread) {
      throw new NotFoundException(`讨论线不存在: ${threadId}`);
    }
    return thread as unknown as DiscussionThread;
  }

  async updateThread(spaceId: string, threadId: string, dto: UpdateDiscussionThreadDto): Promise<DiscussionThread> {
    const updated = await this.discussionThreadModel
      .findOneAndUpdate({ id: threadId, spaceId }, { $set: dto }, { new: true })
      .lean()
      .exec();

    if (!updated) {
      throw new NotFoundException(`讨论线不存在: ${threadId}`);
    }

    return updated as unknown as DiscussionThread;
  }

  async getOrCreateSectionThread(spaceId: string, sectionId: string, sectionTitle?: string): Promise<DiscussionThread> {
    const normalizedSectionId = String(sectionId || '').trim();
    if (!normalizedSectionId) {
      throw new BadRequestException('章节 ID 不能为空');
    }

    const existed = await this.discussionThreadModel
      .findOne({
        spaceId,
        outlineSectionId: normalizedSectionId,
      })
      .sort({ createdAt: 1 })
      .lean()
      .exec();
    if (existed) {
      return existed as unknown as DiscussionThread;
    }

    const space = await this.discussionSpaceService.getSpaceById(spaceId);
    const rootThreadId = String(space.rootThreadId || '').trim();
    if (!rootThreadId) {
      throw new NotFoundException('讨论空间缺少主讨论线，无法创建章节讨论线');
    }

    const outlineSections = Array.isArray(space.documentOutline?.sections)
      ? space.documentOutline.sections
      : [];
    const matchedSection = outlineSections.find((item) => String(item.id || '').trim() === normalizedSectionId);
    if (!matchedSection) {
      throw new NotFoundException(`章节不存在: ${normalizedSectionId}`);
    }

    return this.createThread(spaceId, {
      title: String(sectionTitle || '').trim() || matchedSection.title || '章节讨论',
      parentThreadId: rootThreadId,
      contextSummary: matchedSection.description,
      outlineSectionId: normalizedSectionId,
    });
  }

  async listThreadTree(spaceId: string): Promise<Array<DiscussionThread & { children: any[] }>> {
    const threads = await this.discussionThreadModel.find({ spaceId }).sort({ createdAt: 1 }).lean().exec();
    const map = new Map<string, DiscussionThread & { children: any[] }>();

    for (const raw of threads) {
      map.set(raw.id, { ...(raw as unknown as DiscussionThread), children: [] });
    }

    const roots: Array<DiscussionThread & { children: any[] }> = [];

    for (const thread of map.values()) {
      if (!thread.parentThreadId) {
        roots.push(thread);
        continue;
      }
      const parent = map.get(thread.parentThreadId);
      if (parent) {
        parent.children.push(thread);
      }
    }

    return roots;
  }

  async deleteThread(spaceId: string, threadId: string): Promise<DeleteDiscussionThreadResult> {
    const space = await this.discussionSpaceService.getSpaceById(spaceId);
    if (space.rootThreadId && space.rootThreadId === threadId) {
      throw new BadRequestException('主讨论线不允许删除');
    }

    const threads = await this.discussionThreadModel.find({ spaceId }).lean().exec() as unknown as DiscussionThread[];
    const target = threads.find((item) => item.id === threadId);
    if (!target) {
      throw new NotFoundException(`讨论线不存在: ${threadId}`);
    }

    const deletedThreadIds = collectThreadSubtreeIds(threadId, threads);
    if (!deletedThreadIds.length) {
      throw new NotFoundException(`讨论线不存在: ${threadId}`);
    }

    const [deletedMessageCount, deletedKnowledgeCount] = await Promise.all([
      this.discussionMessageModel.countDocuments({ spaceId, threadId: { $in: deletedThreadIds } }).exec(),
      this.discussionKnowledgeEntryModel.countDocuments({ spaceId, threadId: { $in: deletedThreadIds } }).exec(),
    ]);

    await Promise.all([
      this.discussionThreadModel.deleteMany({ spaceId, id: { $in: deletedThreadIds } }).exec(),
      this.discussionMessageModel.deleteMany({ spaceId, threadId: { $in: deletedThreadIds } }).exec(),
      this.discussionKnowledgeEntryModel.deleteMany({ spaceId, threadId: { $in: deletedThreadIds } }).exec(),
    ]);

    if (target.parentThreadId) {
      await this.discussionThreadModel
        .updateOne(
          { spaceId, id: target.parentThreadId },
          { $pull: { childThreadIds: threadId } },
        )
        .exec();
    }

    await this.discussionSpaceService.incrementStatistics(spaceId, {
      totalThreads: -deletedThreadIds.length,
      totalMessages: -deletedMessageCount,
      totalKnowledgeEntries: -deletedKnowledgeCount,
    });

    return {
      deleted: true,
      threadId,
      deletedThreadIds,
    };
  }

  async incrementMessageCount(spaceId: string, threadId: string, participantId: string): Promise<void> {
    await this.discussionThreadModel.updateOne(
      { id: threadId, spaceId },
      {
        $inc: { messageCount: 1 },
        $addToSet: { activeParticipantIds: participantId },
      },
    ).exec();
  }

  async incrementSystemMessageCount(spaceId: string, threadId: string): Promise<void> {
    await this.discussionThreadModel
      .updateOne(
        { id: threadId, spaceId },
        {
          $inc: { messageCount: 1 },
        },
      )
      .exec();
  }
}
