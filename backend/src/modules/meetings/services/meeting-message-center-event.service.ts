import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  buildMessageCenterEvent,
  MESSAGE_CENTER_EVENT_SOURCE_MEETING,
  MESSAGE_CENTER_EVENT_STREAM_KEY,
  RedisService,
} from '@libs/infra';
import { MeetingDocument } from '../../../shared/schemas/meeting.schema';

@Injectable()
export class MeetingMessageCenterEventService {
  private readonly logger = new Logger(MeetingMessageCenterEventService.name);

  constructor(private readonly redisService: RedisService) {}

  async publishMeetingEndedMessage(meeting: MeetingDocument): Promise<void> {
    const meetingId = String(meeting?.id || '').trim();
    if (!meetingId) {
      return;
    }

    const receivers = this.resolveReceiverIds(meeting);
    if (!receivers.length) {
      return;
    }

    const endedAt = meeting.endedAt ? new Date(meeting.endedAt).toISOString() : new Date().toISOString();
    const streamIds: string[] = [];

    for (const receiverId of receivers) {
      try {
        const event = buildMessageCenterEvent({
          eventType: 'meeting.session.ended',
          source: MESSAGE_CENTER_EVENT_SOURCE_MEETING,
          traceId: randomUUID(),
          occurredAt: endedAt,
          data: {
            receiverId,
            messageType: 'system_alert',
            title: '会议已结束',
            content: `会议《${meeting.title || meetingId}》已结束，可查看会议详情与总结。`,
            actionUrl: `/meetings/${encodeURIComponent(meetingId)}`,
            bizKey: `meeting:${meetingId}:ended:${receiverId}`,
            priority: 'normal',
            extra: {
              meetingId,
              endedAt,
              status: 'ended',
              hostId: String(meeting.hostId || '').trim(),
              hostType: String(meeting.hostType || '').trim(),
            },
          },
        });

        const streamId = await this.redisService.xadd(
          MESSAGE_CENTER_EVENT_STREAM_KEY,
          {
            event: JSON.stringify(event),
          },
          {
            maxLen: 10000,
          },
        );
        if (streamId) {
          streamIds.push(streamId);
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error || 'unknown');
        this.logger.warn(
          `Failed to publish meeting-ended message-center event (non-blocking): meetingId=${meetingId} receiverId=${receiverId} reason=${reason}`,
        );
      }
    }

    this.logger.log(
      `Published meeting-ended message-center events: meetingId=${meetingId} receivers=${receivers.length} streamIds=${streamIds.join(',') || 'n/a'}`,
    );
  }

  private resolveReceiverIds(meeting: MeetingDocument): string[] {
    const receiverIds = new Set<string>();

    if (meeting.hostType === 'employee' && String(meeting.hostId || '').trim()) {
      receiverIds.add(String(meeting.hostId).trim());
    }

    for (const participant of meeting.participants || []) {
      if (!participant) {
        continue;
      }

      if (participant.participantType === 'employee') {
        const participantId = String(participant.participantId || '').trim();
        if (participantId) {
          receiverIds.add(participantId);
        }
        continue;
      }

      const mappedEmployeeId = String(participant.assistantForEmployeeId || '').trim();
      if (mappedEmployeeId) {
        receiverIds.add(mappedEmployeeId);
      }
    }

    return Array.from(receiverIds.values());
  }
}
