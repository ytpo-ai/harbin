import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { Meeting, MeetingDocument, MeetingMessage, MeetingStatus } from '../../../shared/schemas/meeting.schema';
import { MessagesService } from '../../messages/messages.service';
import { MeetingMessageDto } from '../meeting.types';
import { MeetingEventService } from './meeting-event.service';
import { MeetingAgentStateService } from './meeting-agent-state.service';
import { MeetingLifecycleService } from './meeting-lifecycle.service';

@Injectable()
export class MeetingMessageService {
  private onHumanMessageSentHook?: (meetingId: string, message: MeetingMessage) => Promise<void>;

  constructor(
    @InjectModel(Meeting.name) private readonly meetingModel: Model<MeetingDocument>,
    private readonly messagesService: MessagesService,
    private readonly eventService: MeetingEventService,
    private readonly agentStateService: MeetingAgentStateService,
    private readonly lifecycleService: MeetingLifecycleService,
  ) {}

  setOnHumanMessageSentHook(hook: (meetingId: string, message: MeetingMessage) => Promise<void>): void {
    this.onHumanMessageSentHook = hook;
  }

  private async triggerAgentResponses(meetingId: string, triggerMessage: MeetingMessage): Promise<void> {
    if (!this.onHumanMessageSentHook) return;
    await this.onHumanMessageSentHook(meetingId, triggerMessage);
  }

  async sendMessage(meetingId: string, dto: MeetingMessageDto): Promise<MeetingMessage> {
    const meeting = await this.meetingModel.findOne({ id: meetingId }).exec();
    if (!meeting) {
      throw new NotFoundException(`Meeting not found: ${meetingId}`);
    }

    this.lifecycleService.ensureMeetingCompatibility(meeting);

    if (meeting.status !== MeetingStatus.ACTIVE) {
      throw new ConflictException('Meeting is not active');
    }

    const isSystemMessage = dto.senderType === 'system';

    // Check if sender is host
    const isHost =
      !isSystemMessage &&
      meeting.hostId === dto.senderId &&
      (meeting.hostType as 'employee' | 'agent') === dto.senderType;

    // Find participant in the meeting
    const participant = isSystemMessage
      ? undefined
      : meeting.participants.find(
          p => p.participantId === dto.senderId && p.participantType === dto.senderType,
        );

    if (participant && !participant.isPresent) {
      participant.isPresent = true;
      participant.joinedAt = participant.joinedAt || new Date();
    }

    if (!isSystemMessage && !participant && !isHost) {
      throw new ConflictException('Participant is not in the meeting or not present');
    }

    const message: MeetingMessage = {
      id: uuidv4(),
      senderId: dto.senderId,
      senderType: dto.senderType,
      content: dto.content,
      type: dto.type || 'opinion',
      timestamp: new Date(),
      metadata: dto.metadata || {},
    };

    meeting.messages.push(message);
    meeting.messageCount += 1;
    
    // Update participant stats
    if (participant) {
      participant.messageCount += 1;
      participant.hasSpoken = true;
    }
    
    await meeting.save();

    await this.messagesService.appendMessage({
      sceneType: 'meeting',
      sceneId: meetingId,
      senderType: message.senderType,
      senderId: message.senderId,
      content: message.content,
      messageType: message.type,
      metadata: {
        ...(message.metadata || {}),
        meetingId,
      },
      occurredAt: message.timestamp,
      traceId: message.id,
    });

    this.eventService.emitEvent(meetingId, {
      type: 'message',
      meetingId,
      data: message,
      timestamp: new Date(),
    });

    // 触发Agent响应（仅在人类发言后触发，避免Agent之间无限互相触发）
    if (dto.senderType === 'employee') {
      await this.triggerAgentResponses(meetingId, message);
    }

    return message;
  }

  async addSystemMessage(meetingId: string, content: string): Promise<void> {
    const meeting = await this.meetingModel.findOne({ id: meetingId }).exec();
    if (!meeting) return;

    this.lifecycleService.ensureMeetingCompatibility(meeting);

    const message: MeetingMessage = {
      id: uuidv4(),
      senderId: 'system',
      senderType: 'system',
      content,
      type: 'conclusion',
      timestamp: new Date(),
    };

    meeting.messages.push(message);
    meeting.messageCount += 1;
    await meeting.save();

    await this.messagesService.appendMessage({
      sceneType: 'meeting',
      sceneId: meetingId,
      senderType: 'system',
      senderId: 'system',
      senderRole: 'system',
      content,
      messageType: 'conclusion',
      metadata: {
        meetingId,
      },
      occurredAt: message.timestamp,
      traceId: message.id,
    });

    this.eventService.emitEvent(meetingId, {
      type: 'message',
      meetingId,
      data: message,
      timestamp: new Date(),
    });
  }


  analyzeMessageType(response: string): MeetingMessage['type'] {
    const lowerResponse = response.toLowerCase();
    
    if (lowerResponse.includes('?') || lowerResponse.includes('？')) {
      return 'question';
    } else if (lowerResponse.includes('同意') || lowerResponse.includes('赞成') || lowerResponse.includes('agree')) {
      return 'agreement';
    } else if (lowerResponse.includes('不同意') || lowerResponse.includes('反对') || lowerResponse.includes('disagree')) {
      return 'disagreement';
    } else if (lowerResponse.includes('建议') || lowerResponse.includes('propose')) {
      return 'suggestion';
    } else if (lowerResponse.includes('总结') || lowerResponse.includes('conclusion')) {
      return 'conclusion';
    }
    
    return 'opinion';
  }


  private hasAgentRepliedToMessage(meeting: MeetingDocument, messageId: string): boolean {
    return (meeting.messages || []).some((item) => {
      if (!item || item.senderType !== 'agent') {
        return false;
      }
      const metadata = (item.metadata || {}) as Record<string, unknown>;
      return metadata.relatedMessageId === messageId;
    });
  }


  getMessageById(meeting: MeetingDocument, messageId: string): MeetingDocument['messages'][number] | null {
    const target = (meeting.messages || []).find((item) => item.id === messageId);
    return target || null;
  }


  private assertMessageController(message: MeetingDocument['messages'][number], employeeId: string): void {
    if (message.senderType !== 'employee' || message.senderId !== employeeId) {
      throw new ConflictException('Only the original sender can control this message');
    }
  }


  async pauseMessageResponse(meetingId: string, messageId: string, employeeId: string): Promise<MeetingDocument['messages'][number]> {
    const meeting = await this.meetingModel.findOne({ id: meetingId }).exec();
    if (!meeting) {
      throw new NotFoundException(`Meeting not found: ${meetingId}`);
    }

    this.lifecycleService.ensureMeetingCompatibility(meeting);

    if (meeting.status !== MeetingStatus.ACTIVE) {
      throw new ConflictException('Only active meetings support message pause');
    }

    const message = this.getMessageById(meeting, messageId);
    if (!message) {
      throw new NotFoundException(`Message not found: ${messageId}`);
    }

    this.assertMessageController(message, employeeId);

    if (this.hasAgentRepliedToMessage(meeting, messageId)) {
      throw new ConflictException('Message already has replies and cannot be paused');
    }

    const metadata = {
      ...(message.metadata || {}),
      pendingResponsePaused: true,
      pendingResponsePausedAt: new Date().toISOString(),
    } as Record<string, unknown>;

    message.metadata = metadata as MeetingMessage['metadata'];
    await meeting.save();
    await this.agentStateService.clearAllMeetingAgentThinking(meetingId, 'message_response_paused');

    return message;
  }


  async revokePausedMessage(meetingId: string, messageId: string, employeeId: string): Promise<Meeting> {
    const meeting = await this.meetingModel.findOne({ id: meetingId }).exec();
    if (!meeting) {
      throw new NotFoundException(`Meeting not found: ${meetingId}`);
    }

    this.lifecycleService.ensureMeetingCompatibility(meeting);

    if (meeting.status !== MeetingStatus.ACTIVE) {
      throw new ConflictException('Only active meetings support message revoke');
    }

    const targetMessage = this.getMessageById(meeting, messageId);
    if (!targetMessage) {
      throw new NotFoundException(`Message not found: ${messageId}`);
    }

    this.assertMessageController(targetMessage, employeeId);

    if (!targetMessage.metadata?.pendingResponsePaused) {
      throw new ConflictException('Message must be paused before revoke');
    }

    if (this.hasAgentRepliedToMessage(meeting, messageId)) {
      throw new ConflictException('Message already has replies and cannot be revoked');
    }

    const messageIndex = meeting.messages.findIndex((item) => item.id === messageId);
    if (messageIndex < 0) {
      throw new NotFoundException(`Message not found: ${messageId}`);
    }

    const [removedMessage] = meeting.messages.splice(messageIndex, 1);
    meeting.messageCount = Math.max(0, (meeting.messageCount || 0) - 1);

    const senderParticipant = meeting.participants.find(
      (participant) =>
        participant.participantId === removedMessage.senderId &&
        participant.participantType === removedMessage.senderType,
    );

    if (senderParticipant) {
      senderParticipant.messageCount = Math.max(0, (senderParticipant.messageCount || 0) - 1);
      if (senderParticipant.messageCount === 0) {
        senderParticipant.hasSpoken = false;
      }
    }

    await meeting.save();
    await this.agentStateService.clearAllMeetingAgentThinking(meetingId, 'message_revoked');

    return meeting;
  }
}
