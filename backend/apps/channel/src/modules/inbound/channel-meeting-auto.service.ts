import { Injectable } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { ChannelAuthBridgeService } from './channel-auth-bridge.service';
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
  private readonly gatewayBaseUrl = process.env.GATEWAY_SERVICE_URL || 'http://127.0.0.1:3100';
  private readonly executeTimeoutMs = Math.max(5000, Number(process.env.CHANNEL_AGENT_EXECUTE_TIMEOUT_MS || 120000));
  private readonly httpClient: AxiosInstance;

  constructor(
    private readonly authBridgeService: ChannelAuthBridgeService,
    private readonly relayService: ChannelMeetingRelayService,
    private readonly sessionService: ChannelSessionService,
  ) {
    this.httpClient = axios.create({
      baseURL: this.gatewayBaseUrl,
      timeout: this.executeTimeoutMs,
      validateStatus: () => true,
    });
  }

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

    let meetingId = await this.findActiveOneOnOneMeeting(employeeId, agentId);
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
      url: '/api/meetings',
      params: {
        status: 'active',
        type: 'one_on_one',
      },
    });
    const meetings = Array.isArray(response) ? response : [];

    const matched = meetings.find((item) => {
      const meeting = item as MeetingRecord;
      if (String(meeting.type || '').trim() !== 'one_on_one') {
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
    const meeting = (await this.callApiAsUser(employeeId, {
      method: 'get',
      url: `/api/meetings/${meetingId}`,
    })) as MeetingRecord;

    const status = String(meeting.status || '').trim();
    if (status === 'pending') {
      await this.callApiAsUser(employeeId, {
        method: 'post',
        url: `/api/meetings/${meetingId}/start`,
        data: {
          id: employeeId,
          type: 'employee',
          name: employeeId,
          isHuman: true,
        },
      });
    } else if (status === 'paused') {
      await this.callApiAsUser(employeeId, {
        method: 'post',
        url: `/api/meetings/${meetingId}/resume`,
      });
    }

    const latestMeeting = (await this.callApiAsUser(employeeId, {
      method: 'get',
      url: `/api/meetings/${meetingId}`,
    })) as MeetingRecord;
    const participants = Array.isArray(latestMeeting.participants) ? latestMeeting.participants : [];
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

  private async callApiAsUser(
    employeeId: string,
    request: {
      method: 'get' | 'post' | 'patch' | 'delete';
      url: string;
      data?: Record<string, unknown>;
      params?: Record<string, string | number | boolean | undefined>;
    },
  ): Promise<Record<string, unknown> | Array<Record<string, unknown>>> {
    const headers = await this.authBridgeService.buildSignedHeaders(employeeId, {
      'content-type': 'application/json',
    });

    const response = await this.httpClient.request({
      method: request.method,
      url: request.url,
      data: request.data,
      params: request.params,
      headers,
    });

    if (response.status >= 400) {
      throw new Error(`api_request_failed:${response.status}`);
    }

    const payload = response.data;
    if (payload && typeof payload === 'object' && 'data' in payload) {
      const data = (payload as { data?: unknown }).data;
      if (Array.isArray(data)) {
        return data.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'));
      }
      if (data && typeof data === 'object') {
        return data as Record<string, unknown>;
      }
    }
    if (Array.isArray(payload)) {
      return payload.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'));
    }
    if (payload && typeof payload === 'object') {
      return payload as Record<string, unknown>;
    }

    return {};
  }
}
