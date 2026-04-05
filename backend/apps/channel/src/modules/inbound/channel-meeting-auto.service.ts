import { Injectable } from '@nestjs/common';
import { ChannelApiClientService } from './channel-api-client.service';
import { ChannelMeetingRelayService } from './channel-meeting-relay.service';
import { ChannelSessionService, SessionFilter } from './channel-session.service';

interface MeetingRecord {
  id?: string;
  title?: string;
  type?: string;
  status?: string;
  participants?: Array<{
    participantId?: string;
    participantType?: 'employee' | 'agent' | string;
    isPresent?: boolean;
  }>;
}

@Injectable()
export class ChannelMeetingAutoService {
  constructor(
    private readonly apiClient: ChannelApiClientService,
    private readonly relayService: ChannelMeetingRelayService,
    private readonly sessionService: ChannelSessionService,
  ) {}

  async resolveOrCreateOneOnOneMeeting(input: {
    employeeId: string;
    agentId: string;
    sessionFilter: SessionFilter;
    chatId: string;
  }): Promise<string> {
    const employeeId = String(input.employeeId || '').trim();
    const agentId = String(input.agentId || '').trim();
    if (!employeeId || !agentId) {
      throw new Error('resolve_one_on_one_invalid_input');
    }

    let meetingId = await this.findReusableOneOnOneMeetingFromSession(input.sessionFilter, employeeId, agentId);
    if (!meetingId) {
      meetingId = await this.findActiveOneOnOneMeeting(employeeId, agentId);
    }
    if (!meetingId) {
      meetingId = await this.createOneOnOneMeeting(employeeId, agentId);
    }

    await this.ensureMeetingReady(meetingId, employeeId);
    await this.relayService.startRelay({
      meetingId,
      chatId: String(input.chatId || '').trim(),
      employeeId,
    });
    await this.sessionService.setActiveMeeting(input.sessionFilter, meetingId, 'one_on_one', employeeId);
    return meetingId;
  }

  async switchAgent(input: {
    employeeId: string;
    newAgentId: string;
    currentMeetingId: string;
    sessionFilter: SessionFilter;
    chatId: string;
  }): Promise<string> {
    const employeeId = String(input.employeeId || '').trim();
    const currentMeetingId = String(input.currentMeetingId || '').trim();
    if (currentMeetingId) {
      await this.callApiAsUser(employeeId, {
        method: 'post',
        url: `/api/meetings/${currentMeetingId}/end`,
      }).catch(() => undefined);
      await this.relayService.stopRelay(currentMeetingId, employeeId).catch(() => undefined);
      await this.sessionService.clearActiveMeeting(input.sessionFilter);
    }

    return this.resolveOrCreateOneOnOneMeeting({
      employeeId,
      agentId: input.newAgentId,
      sessionFilter: input.sessionFilter,
      chatId: input.chatId,
    });
  }

  async endOneOnOneMeeting(input: { meetingId: string; employeeId: string; sessionFilter: SessionFilter }): Promise<void> {
    const meetingId = String(input.meetingId || '').trim();
    const employeeId = String(input.employeeId || '').trim();
    if (!meetingId || !employeeId) {
      return;
    }

    await this.callApiAsUser(employeeId, {
      method: 'post',
      url: `/api/meetings/${meetingId}/end`,
    }).catch(() => undefined);

    await this.relayService.stopRelay(meetingId, employeeId).catch(() => undefined);
    await this.sessionService.clearActiveMeeting(input.sessionFilter);
  }

  private async findActiveOneOnOneMeeting(employeeId: string, agentId: string): Promise<string | undefined> {
    const response = await this.callApiAsUser(employeeId, {
      method: 'get',
      url: `/api/meetings/by-participant/${employeeId}`,
      params: {
        type: 'employee',
      },
    });
    const meetings = Array.isArray(response) ? response : [];

    const matched = meetings.find((item) => {
      const meeting = item as MeetingRecord;
      if (String(meeting.type || '').trim() !== 'one_on_one' || String(meeting.status || '').trim() !== 'active') {
        return false;
      }
      const participants = Array.isArray(meeting.participants) ? meeting.participants : [];
      const normalized = participants.map((participant) => `${participant.participantType}:${participant.participantId}`);
      const unique = Array.from(new Set(normalized));
      return unique.length === 2 && unique.includes(`employee:${employeeId}`) && unique.includes(`agent:${agentId}`);
    }) as MeetingRecord | undefined;

    const meetingId = String(matched?.id || '').trim();
    return meetingId || undefined;
  }

  private async createOneOnOneMeeting(employeeId: string, agentId: string): Promise<string> {
    const created = (await this.callApiAsUser(employeeId, {
      method: 'post',
      url: '/api/meetings',
      data: {
        title: `与 ${agentId} 的对话`,
        type: 'one_on_one',
        hostId: employeeId,
        hostType: 'employee',
        participantIds: [{ id: agentId, type: 'agent' }],
      },
    })) as Record<string, unknown>;

    const meetingId = String(created?.id || '').trim();
    if (!meetingId) {
      throw new Error('create_one_on_one_meeting_failed');
    }
    return meetingId;
  }

  private async ensureMeetingReady(meetingId: string, employeeId: string): Promise<void> {
    let meeting = (await this.callApiAsUser(employeeId, {
      method: 'get',
      url: `/api/meetings/${meetingId}`,
    })) as MeetingRecord;

    const status = String(meeting.status || '').trim();
    if (status === 'pending') {
      meeting = (await this.callApiAsUser(employeeId, {
        method: 'post',
        url: `/api/meetings/${meetingId}/start`,
        data: {
          id: employeeId,
          type: 'employee',
          name: employeeId,
          isHuman: true,
        },
      })) as MeetingRecord;
    } else if (status === 'paused') {
      meeting = (await this.callApiAsUser(employeeId, {
        method: 'post',
        url: `/api/meetings/${meetingId}/resume`,
      })) as MeetingRecord;
    }

    const participants = Array.isArray(meeting.participants) ? meeting.participants : [];
    const employeeInMeeting = participants.some(
      (participant) =>
        String(participant.participantType || '').trim() === 'employee' &&
        String(participant.participantId || '').trim() === employeeId &&
        participant.isPresent,
    );

    if (!employeeInMeeting) {
      await this.callApiAsUser(employeeId, {
        method: 'post',
        url: `/api/meetings/${meetingId}/join`,
        data: {
          id: employeeId,
          type: 'employee',
          name: employeeId,
          isHuman: true,
        },
      });
    }
  }

  private async findReusableOneOnOneMeetingFromSession(
    sessionFilter: SessionFilter,
    employeeId: string,
    agentId: string,
  ): Promise<string | undefined> {
    const activeMeeting = await this.sessionService.getActiveMeeting(sessionFilter);
    if (!activeMeeting || activeMeeting.meetingType !== 'one_on_one') {
      return undefined;
    }

    const meetingId = String(activeMeeting.meetingId || '').trim();
    if (!meetingId) {
      return undefined;
    }

    try {
      const meeting = (await this.callApiAsUser(employeeId, {
        method: 'get',
        url: `/api/meetings/${meetingId}`,
      })) as MeetingRecord;
      if (String(meeting.status || '').trim() !== 'active' || String(meeting.type || '').trim() !== 'one_on_one') {
        return undefined;
      }

      const participants = Array.isArray(meeting.participants) ? meeting.participants : [];
      const normalized = participants.map((participant) => `${participant.participantType}:${participant.participantId}`);
      const unique = Array.from(new Set(normalized));
      if (unique.length === 2 && unique.includes(`employee:${employeeId}`) && unique.includes(`agent:${agentId}`)) {
        return meetingId;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  private async callApiAsUser(
    employeeId: string,
    request: {
      method: 'get' | 'post' | 'patch' | 'delete';
      url: string;
      data?: Record<string, unknown>;
      params?: Record<string, string | number | boolean | undefined>;
    },
  ): Promise<Record<string, unknown> | Array<Record<string, unknown>>> {
    return this.apiClient.callApiAsUser(employeeId, request);
  }
}
