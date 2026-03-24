import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AgentClientService } from '../../agents-client/agent-client.service';
import { Meeting, MeetingDocument } from '../../../shared/schemas/meeting.schema';
import { MEETING_ENDED_EVENT_TYPE } from '../meeting-inner-message.constants';
import { SaveMeetingSummaryDto } from '../meeting.types';
import { MeetingEventService } from './meeting-event.service';
import { MeetingLifecycleService } from './meeting-lifecycle.service';

@Injectable()
export class MeetingSummaryService {
  private readonly logger = new Logger(MeetingSummaryService.name);
  private readonly meetingSummaryEventSenderAgentId = 'meeting-system';

  constructor(
    @InjectModel(Meeting.name) private readonly meetingModel: Model<MeetingDocument>,
    private readonly agentClientService: AgentClientService,
    private readonly eventService: MeetingEventService,
    private readonly lifecycleService: MeetingLifecycleService,
  ) {}

  async publishMeetingEndedSummaryEvent(meeting: MeetingDocument): Promise<void> {
    const meetingId = String(meeting?.id || '').trim();
    if (!meetingId) {
      return;
    }

    const endedAt = meeting.endedAt ? new Date(meeting.endedAt).toISOString() : new Date().toISOString();
    const dedupKey = `${MEETING_ENDED_EVENT_TYPE}:${meetingId}:${endedAt}`;

    try {
      await this.agentClientService.publishInnerMessage({
        senderAgentId: this.meetingSummaryEventSenderAgentId,
        eventType: MEETING_ENDED_EVENT_TYPE,
        title: `会议结束：${meeting.title}`,
        content: `会议 ${meetingId} 已结束，请生成会后总结。`,
        payload: {
          meetingId,
          title: meeting.title,
          endedAt,
          hostId: meeting.hostId,
          hostType: meeting.hostType,
          status: meeting.status,
        },
        source: 'meeting-service',
        dedupKey,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to publish meeting ended event for meeting ${meetingId}: ${reason}`);
    }
  }


  async generateMeetingSummary(meetingId: string, payload: SaveMeetingSummaryDto): Promise<{ generated: boolean; reason?: string }> {
    const meeting = await this.meetingModel.findOne({ id: meetingId }).exec();
    if (!meeting) {
      return { generated: false, reason: 'meeting_not_found' };
    }

    this.lifecycleService.ensureMeetingCompatibility(meeting);

    const summaryContent = String(payload?.summary || '').trim();
    if (!summaryContent) {
      return { generated: false, reason: 'empty_summary' };
    }

    const existingSummaryContent = String(meeting.summary?.content || '').trim();
    if (!payload?.overwrite && existingSummaryContent && meeting.summary?.generatedAt) {
      return { generated: false, reason: 'already_generated' };
    }

    meeting.summary = {
      content: summaryContent,
      actionItems: this.normalizeSummaryItems(payload?.actionItems),
      decisions: this.normalizeSummaryItems(payload?.decisions),
      generatedAt: new Date(),
    };

    await meeting.save();

    this.eventService.emitEvent(meetingId, {
      type: 'summary_generated',
      meetingId,
      data: {
        summary: summaryContent,
        generatedByAgentId: String(payload?.generatedByAgentId || '').trim() || undefined,
      },
      timestamp: new Date(),
    });

    this.logger.log(`Generated summary for meeting ${meetingId}`);
    return { generated: true };
  }


  private normalizeSummaryItems(values?: string[]): string[] {
    if (!Array.isArray(values)) {
      return [];
    }
    return values
      .map((item) => String(item || '').trim())
      .filter(Boolean);
  }
}
