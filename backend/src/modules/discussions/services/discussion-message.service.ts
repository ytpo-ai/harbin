import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  DiscussionMessage,
  DiscussionMessageDocument,
  DiscussionMessageSenderType,
  DiscussionMessageType,
} from '../../../shared/schemas/discussion-message.schema';
import { DiscussionParticipantType } from '../../../shared/schemas/discussion-participant.schema';
import { DiscussionSedimentMode } from '../../../shared/schemas/discussion-space.schema';
import { SendDiscussionMessageDto, SendDiscussionMessageResult } from '../discussion.types';
import { DiscussionParticipantService } from './discussion-participant.service';
import { DiscussionMentionDispatchService } from './discussion-mention-dispatch.service';
import { DiscussionKnowledgeService } from './discussion-knowledge.service';
import { DiscussionSedimentService } from './discussion-sediment.service';
import { DiscussionSpaceService } from './discussion-space.service';
import { DiscussionThreadService } from './discussion-thread.service';

@Injectable()
export class DiscussionMessageService {
  constructor(
    @InjectModel(DiscussionMessage.name)
    private readonly discussionMessageModel: Model<DiscussionMessageDocument>,
    private readonly discussionThreadService: DiscussionThreadService,
    private readonly discussionParticipantService: DiscussionParticipantService,
    private readonly discussionMentionDispatchService: DiscussionMentionDispatchService,
    private readonly discussionKnowledgeService: DiscussionKnowledgeService,
    private readonly discussionSedimentService: DiscussionSedimentService,
    private readonly discussionSpaceService: DiscussionSpaceService,
  ) {}

  async sendMessage(spaceId: string, threadId: string, dto: SendDiscussionMessageDto): Promise<SendDiscussionMessageResult> {
    const senderType = dto.senderType || DiscussionMessageSenderType.USER;
    await this.discussionThreadService.getThreadById(spaceId, threadId);
    await this.discussionParticipantService.getParticipantById(spaceId, dto.participantId);
    const space = await this.discussionSpaceService.getSpaceById(spaceId);

    const latest = await this.discussionMessageModel.findOne({ spaceId, threadId }).sort({ sequence: -1 }).lean().exec();
    const nextSequence = (latest?.sequence || 0) + 1;
    const mentions = await this.discussionParticipantService.resolveMentions(spaceId, dto.content);

    const userMessage = await this.discussionMessageModel.create({
      spaceId,
      threadId,
      participantId: dto.participantId,
      senderType,
      content: dto.content,
      messageType: dto.messageType || DiscussionMessageType.TEXT,
      sequence: nextSequence,
      mentions,
      branchSuggestions: [],
      crossReferences: [],
      knowledgeEntryIds: [],
      metadata: dto.metadata,
    });

    const aiMessages: DiscussionMessage[] = [];
    const generatedKnowledgeEntryIds: string[] = [];
    let notifiedHumanParticipantIds: string[] = [];

    if (mentions.length && senderType === DiscussionMessageSenderType.USER) {
      const mentionTargets = await this.discussionParticipantService.getParticipantsByIds(
        spaceId,
        mentions.map((mention) => mention.participantId),
      );

      const dispatch = await this.discussionMentionDispatchService.dispatchMentions({
        spaceId,
        threadId,
        messageId: userMessage.id,
        mentionTargets,
        senderParticipantId: dto.participantId,
      });
      notifiedHumanParticipantIds = dispatch.notifiedHumanParticipantIds;

      let aiSequence = nextSequence + 1;
      for (const aiParticipant of dispatch.aiParticipants) {
        if (aiParticipant.type !== DiscussionParticipantType.AI_AGENT) {
          continue;
        }

        const reusableKnowledge = await this.discussionKnowledgeService.getReusableKnowledge(spaceId, {
          topicTags: aiParticipant.expertiseTags,
          limit: 3,
        });
        const knowledgeHints = reusableKnowledge.map((item) => `- ${item.title}: ${item.summary}`).join('\n');
        const responseContent = [
          `@${aiParticipant.displayName} 已收到召唤。`,
          aiParticipant.expertise ? `结合我的领域 (${aiParticipant.expertise})，建议先明确目标和时间窗口。` : '建议先明确目标和时间窗口，再拆解执行步骤。',
          knowledgeHints ? `可复用知识:\n${knowledgeHints}` : '当前知识库暂无高相关条目，建议先发起一次针对性检索。',
        ].join('\n\n');

        const aiMessage = await this.discussionMessageModel.create({
          spaceId,
          threadId,
          participantId: aiParticipant.id,
          senderType: DiscussionMessageSenderType.AI,
          content: responseContent,
          messageType: DiscussionMessageType.TEXT,
          sequence: aiSequence,
          mentions: [],
          branchSuggestions: [],
          crossReferences: [],
          knowledgeEntryIds: reusableKnowledge.map((item) => item.id),
          metadata: {
            agentId: aiParticipant.agentId,
            knowledgeHits: reusableKnowledge.length,
            mentionTriggered: true,
          },
        });
        aiSequence += 1;
        aiMessages.push(aiMessage);

        const derivedKnowledge = await this.discussionKnowledgeService.createDerivedKnowledgeEntry({
          spaceId,
          threadId,
          messageId: aiMessage.id,
          participantId: aiParticipant.id,
          title: `${aiParticipant.displayName} 回应：${dto.content.slice(0, 24)}`,
          content: responseContent,
          topicTags: aiParticipant.expertiseTags,
          domainTags: aiParticipant.expertiseTags?.slice(0, 2) || [],
        });
        generatedKnowledgeEntryIds.push(derivedKnowledge.id);

        if (reusableKnowledge.length) {
          await this.discussionKnowledgeService.linkKnowledgeToMessage(
            spaceId,
            aiMessage.id,
            reusableKnowledge.map((item) => item.id),
          );
        }

        await Promise.all([
          this.discussionThreadService.incrementMessageCount(spaceId, threadId, aiParticipant.id),
          this.discussionParticipantService.incrementMessageCount(spaceId, aiParticipant.id),
        ]);
      }
    }

    await Promise.all([
      this.discussionThreadService.incrementMessageCount(spaceId, threadId, dto.participantId),
      this.discussionParticipantService.incrementMessageCount(spaceId, dto.participantId),
      this.discussionSpaceService.incrementStatistics(spaceId, { totalMessages: 1 + aiMessages.length }),
    ]);

    let realtimeSedimentUpdated = false;
    if (space.sedimentMode === DiscussionSedimentMode.REALTIME) {
      await this.discussionSedimentService.generateSediment({
        spaceId,
        mode: DiscussionSedimentMode.REALTIME,
      });
      realtimeSedimentUpdated = true;
    }

    if (generatedKnowledgeEntryIds.length) {
      await this.discussionKnowledgeService.linkKnowledgeToMessage(spaceId, userMessage.id, generatedKnowledgeEntryIds);
    }

    return {
      userMessage,
      aiMessages,
      notifiedHumanParticipantIds,
      generatedKnowledgeEntryIds,
      realtimeSedimentUpdated,
    };
  }

  async listMessages(spaceId: string, threadId: string, limit = 100): Promise<DiscussionMessage[]> {
    await this.discussionThreadService.getThreadById(spaceId, threadId);

    return this.discussionMessageModel
      .find({ spaceId, threadId })
      .sort({ sequence: 1 })
      .limit(Math.max(1, Math.min(limit, 500)))
      .lean()
      .exec() as unknown as DiscussionMessage[];
  }

  async getMessageById(spaceId: string, threadId: string, messageId: string): Promise<DiscussionMessage> {
    const message = await this.discussionMessageModel.findOne({ id: messageId, spaceId, threadId }).lean().exec();
    if (!message) {
      throw new NotFoundException(`消息不存在: ${messageId}`);
    }
    return message as unknown as DiscussionMessage;
  }
}
