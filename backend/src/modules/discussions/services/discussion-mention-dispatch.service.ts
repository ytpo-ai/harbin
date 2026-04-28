import { Injectable, Logger } from '@nestjs/common';
import {
  DiscussionParticipant,
  DiscussionParticipantType,
} from '../../../shared/schemas/discussion-participant.schema';
import { MessageCenterService } from '../../message-center/message-center.service';
import { DiscussionSpaceService } from './discussion-space.service';

export interface MentionDispatchResult {
  aiParticipants: DiscussionParticipant[];
  notifiedHumanParticipantIds: string[];
}

@Injectable()
export class DiscussionMentionDispatchService {
  private readonly logger = new Logger(DiscussionMentionDispatchService.name);

  constructor(
    private readonly messageCenterService: MessageCenterService,
    private readonly discussionSpaceService: DiscussionSpaceService,
  ) {}

  async dispatchMentions(input: {
    spaceId: string;
    threadId: string;
    messageId: string;
    mentionTargets: DiscussionParticipant[];
    senderParticipantId: string;
  }): Promise<MentionDispatchResult> {
    const aiParticipants: DiscussionParticipant[] = [];
    const notifiedHumanParticipantIds: string[] = [];
    if (!input.mentionTargets.length) {
      return { aiParticipants, notifiedHumanParticipantIds };
    }

    const space = await this.discussionSpaceService.getSpaceById(input.spaceId);

    for (const participant of input.mentionTargets) {
      if (participant.type === DiscussionParticipantType.AI_AGENT) {
        aiParticipants.push(participant);
        continue;
      }

      const receiverId = String(participant.userId || '').trim();
      if (!receiverId) {
        continue;
      }

      try {
        await this.messageCenterService.createSystemMessage({
          receiverId,
          type: 'system_alert',
          source: 'discussion-service',
          title: `讨论中有人@你：${space.title}`,
          content: `${participant.displayName} 在讨论中被提及，请及时查看上下文并参与回复。`,
          dedupKey: `discussion:mention:${input.spaceId}:${input.threadId}:${input.messageId}:${participant.id}`,
          payload: {
            spaceId: input.spaceId,
            threadId: input.threadId,
            messageId: input.messageId,
            mentionedParticipantId: participant.id,
            senderParticipantId: input.senderParticipantId,
            actionUrl: `/discussions/${encodeURIComponent(input.spaceId)}?threadId=${encodeURIComponent(input.threadId)}`,
          },
        });
        notifiedHumanParticipantIds.push(participant.id);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error || 'unknown');
        this.logger.warn(
          `Failed to notify mentioned human participant (non-blocking): spaceId=${input.spaceId} participantId=${participant.id} reason=${reason}`,
        );
      }
    }

    return {
      aiParticipants,
      notifiedHumanParticipantIds,
    };
  }
}
