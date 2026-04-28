import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  DiscussionThread,
  DiscussionThreadBranchOrigin,
  DiscussionThreadDocument,
  DiscussionThreadStatus,
} from '../../../shared/schemas/discussion-thread.schema';
import { CreateDiscussionThreadDto, UpdateDiscussionThreadDto } from '../discussion.types';
import { DiscussionSpaceService } from './discussion-space.service';

export function canCreateBranch(maxBranchDepth: number | undefined, parentDepth: number): boolean {
  if (typeof maxBranchDepth !== 'number' || maxBranchDepth < 0) {
    return true;
  }
  return parentDepth + 1 <= maxBranchDepth;
}

@Injectable()
export class DiscussionThreadService {
  constructor(
    @InjectModel(DiscussionThread.name)
    private readonly discussionThreadModel: Model<DiscussionThreadDocument>,
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

  async incrementMessageCount(spaceId: string, threadId: string, participantId: string): Promise<void> {
    await this.discussionThreadModel.updateOne(
      { id: threadId, spaceId },
      {
        $inc: { messageCount: 1 },
        $addToSet: { activeParticipantIds: participantId },
      },
    ).exec();
  }
}
