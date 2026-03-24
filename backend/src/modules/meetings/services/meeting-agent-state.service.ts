import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { RedisService } from '@libs/infra';
import { Meeting, MeetingDocument } from '../../../shared/schemas/meeting.schema';
import { MeetingAgentState, MeetingAgentStatePayload } from '../meeting.types';
import { MeetingEventService } from './meeting-event.service';

@Injectable()
export class MeetingAgentStateService {
  private readonly meetingAgentStateKeyPrefix = 'meeting:agent-state';
  private readonly meetingAgentStateTtlSeconds = 90;

  constructor(
    @InjectModel(Meeting.name) private readonly meetingModel: Model<MeetingDocument>,
    private readonly redisService: RedisService,
    private readonly eventService: MeetingEventService,
  ) {}

  private buildMeetingAgentStateKey(meetingId: string, agentId: string): string {
    return `${this.meetingAgentStateKeyPrefix}:${meetingId}:${agentId}`;
  }


  private buildMeetingAgentStatePattern(meetingId: string): string {
    return `${this.meetingAgentStateKeyPrefix}:${meetingId}:*`;
  }


  async setAgentState(
    meetingId: string,
    agentId: string,
    state: MeetingAgentState,
    options?: { reason?: string; token?: string },
  ): Promise<void> {
    const updatedAt = new Date().toISOString();
    const payload: MeetingAgentStatePayload = {
      agentId,
      state,
      updatedAt,
      reason: options?.reason,
      token: options?.token,
    };
    const key = this.buildMeetingAgentStateKey(meetingId, agentId);

    if (state === 'thinking') {
      await this.redisService.set(key, JSON.stringify(payload), this.meetingAgentStateTtlSeconds);
    } else {
      await this.redisService.del(key);
    }

    this.eventService.emitEvent(meetingId, {
      type: 'agent_state_changed',
      meetingId,
      data: payload,
      timestamp: new Date(),
    });
  }


  async clearAgentThinking(
    meetingId: string,
    agentId: string,
    options?: { reason?: string; token?: string },
  ): Promise<void> {
    const key = this.buildMeetingAgentStateKey(meetingId, agentId);
    if (options?.token) {
      const raw = await this.redisService.get(key);
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as MeetingAgentStatePayload;
          if (parsed.token && parsed.token !== options.token) {
            return;
          }
        } catch {
          // ignore parse failures and continue clearing stale key
        }
      }
    }

    await this.setAgentState(meetingId, agentId, 'idle', { reason: options?.reason });
  }


  async clearAllMeetingAgentThinking(meetingId: string, reason: string): Promise<void> {
    const states = await this.getMeetingAgentStates(meetingId);
    await Promise.all(states.map((item) => this.setAgentState(meetingId, item.agentId, 'idle', { reason })));
  }


  async getMeetingAgentStates(meetingId: string): Promise<MeetingAgentStatePayload[]> {
    const meeting = await this.meetingModel.findOne({ id: meetingId }).exec();
    if (!meeting) {
      throw new NotFoundException(`Meeting not found: ${meetingId}`);
    }

    const keys = await this.redisService.keys(this.buildMeetingAgentStatePattern(meetingId));
    if (keys.length === 0) {
      return [];
    }

    const states = await Promise.all(
      keys.map(async (key) => {
        const raw = await this.redisService.get(key);
        if (!raw) {
          return null;
        }
        try {
          return JSON.parse(raw) as MeetingAgentStatePayload;
        } catch {
          return null;
        }
      }),
    );

    return states
      .filter((item): item is MeetingAgentStatePayload => Boolean(item && item.agentId && item.state === 'thinking'))
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  }
}
