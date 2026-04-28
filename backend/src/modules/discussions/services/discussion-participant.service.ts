import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  DiscussionParticipant,
  DiscussionParticipantDocument,
  DiscussionParticipantRole,
  DiscussionParticipantType,
} from '../../../shared/schemas/discussion-participant.schema';
import { AddDiscussionParticipantDto, UpdateDiscussionParticipantDto } from '../discussion.types';

@Injectable()
export class DiscussionParticipantService {
  constructor(
    @InjectModel(DiscussionParticipant.name)
    private readonly discussionParticipantModel: Model<DiscussionParticipantDocument>,
  ) {}

  async addParticipant(spaceId: string, dto: AddDiscussionParticipantDto): Promise<DiscussionParticipant> {
    if (dto.type === DiscussionParticipantType.HUMAN && !dto.userId) {
      throw new BadRequestException('human 参与者必须提供 userId');
    }
    if (dto.type === DiscussionParticipantType.AI_AGENT && !dto.agentId) {
      throw new BadRequestException('ai_agent 参与者必须提供 agentId');
    }

    return this.discussionParticipantModel.create({
      ...dto,
      spaceId,
      expertiseTags: dto.expertiseTags || [],
      role: dto.role || DiscussionParticipantRole.ON_DEMAND,
    });
  }

  async ensureCreatorParticipant(spaceId: string, creatorId: string): Promise<void> {
    const existing = await this.discussionParticipantModel.findOne({ spaceId, userId: creatorId }).lean().exec();
    if (existing) {
      return;
    }

    await this.discussionParticipantModel.create({
      spaceId,
      type: DiscussionParticipantType.HUMAN,
      userId: creatorId,
      displayName: `用户-${creatorId}`,
      role: DiscussionParticipantRole.PRIMARY,
      expertiseTags: [],
    });
  }

  async listParticipants(spaceId: string): Promise<DiscussionParticipant[]> {
    return this.discussionParticipantModel.find({ spaceId }).sort({ createdAt: 1 }).lean().exec() as unknown as DiscussionParticipant[];
  }

  async updateParticipant(
    spaceId: string,
    participantId: string,
    dto: UpdateDiscussionParticipantDto,
  ): Promise<DiscussionParticipant> {
    const updated = await this.discussionParticipantModel
      .findOneAndUpdate({ id: participantId, spaceId }, { $set: dto }, { new: true })
      .lean()
      .exec();

    if (!updated) {
      throw new NotFoundException(`参与者不存在: ${participantId}`);
    }

    return updated as unknown as DiscussionParticipant;
  }

  async removeParticipant(spaceId: string, participantId: string): Promise<void> {
    const result = await this.discussionParticipantModel.deleteOne({ id: participantId, spaceId }).exec();
    if (result.deletedCount === 0) {
      throw new NotFoundException(`参与者不存在: ${participantId}`);
    }
  }

  async getParticipantById(spaceId: string, participantId: string): Promise<DiscussionParticipant> {
    const participant = await this.discussionParticipantModel.findOne({ id: participantId, spaceId }).lean().exec();
    if (!participant) {
      throw new NotFoundException(`参与者不存在: ${participantId}`);
    }
    return participant as unknown as DiscussionParticipant;
  }

  async getParticipantsByIds(spaceId: string, participantIds: string[]): Promise<DiscussionParticipant[]> {
    const ids = Array.from(new Set((participantIds || []).filter(Boolean)));
    if (!ids.length) {
      return [];
    }

    return this.discussionParticipantModel
      .find({ spaceId, id: { $in: ids } })
      .lean()
      .exec() as unknown as DiscussionParticipant[];
  }

  async resolveMentions(spaceId: string, content: string): Promise<Array<{ participantId: string; displayName: string; offset: number }>> {
    const mentionMatches = Array.from(content.matchAll(/@([^\s@]+)/g));
    if (!mentionMatches.length) {
      return [];
    }

    const participants = await this.discussionParticipantModel.find({ spaceId }).lean().exec();
    const byName = new Map<string, DiscussionParticipant>();

    for (const participant of participants) {
      byName.set(participant.displayName, participant as unknown as DiscussionParticipant);
    }

    return mentionMatches
      .map((match) => {
        const name = match[1] || '';
        const participant = byName.get(name);
        if (!participant) {
          return null;
        }

        return {
          participantId: participant.id,
          displayName: participant.displayName,
          offset: match.index || 0,
        };
      })
      .filter((item): item is { participantId: string; displayName: string; offset: number } => !!item);
  }

  async incrementMessageCount(spaceId: string, participantId: string): Promise<void> {
    await this.discussionParticipantModel.updateOne(
      { id: participantId, spaceId },
      { $inc: { messageCount: 1 }, $set: { lastActiveAt: new Date() } },
    ).exec();
  }
}
