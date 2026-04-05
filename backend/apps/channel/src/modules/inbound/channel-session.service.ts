import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ChannelSession, ChannelSessionDocument } from './schemas/channel-session.schema';

export interface SessionFilter {
  providerType: 'feishu-app';
  externalChatId: string;
  externalUserId: string;
}

@Injectable()
export class ChannelSessionService {
  private readonly timeoutMinutes = Math.max(1, Number(process.env.CHANNEL_SESSION_TIMEOUT_MINUTES || 30));
  private readonly meetingSessionAgentPlaceholder = 'meeting';

  constructor(
    @InjectModel(ChannelSession.name)
    private readonly sessionModel: Model<ChannelSessionDocument>,
  ) {}

  async getOrCreate(input: {
    providerType: 'feishu-app';
    externalChatId: string;
    externalUserId: string;
    employeeId: string;
    agentId: string;
  }): Promise<ChannelSessionDocument> {
    const now = new Date();
    const expiredBefore = new Date(now.getTime() - this.timeoutMinutes * 60 * 1000);

    const providerType = String(input.providerType || '').trim() as 'feishu-app';
    const externalChatId = String(input.externalChatId || '').trim();
    const externalUserId = String(input.externalUserId || '').trim();

    const session = await this.sessionModel
      .findOne({
        providerType,
        externalChatId,
        externalUserId,
      })
      .exec();

    if (!session) {
      return this.sessionModel.create({
        providerType,
        externalChatId,
        externalUserId,
        employeeId: String(input.employeeId || '').trim(),
        agentId: String(input.agentId || '').trim(),
        agentSessionId: undefined,
        lastMessageAt: now,
        messageCount: 1,
        isActive: true,
      });
    }

    const shouldReset = !session.isActive || !session.lastMessageAt || session.lastMessageAt < expiredBefore;
    session.isActive = true;
    session.lastMessageAt = now;
    session.employeeId = String(input.employeeId || '').trim();
    session.agentId = String(input.agentId || '').trim();
    session.messageCount = shouldReset ? 1 : Number(session.messageCount || 0) + 1;
    if (shouldReset) {
      session.agentSessionId = undefined;
    }

    return session.save();
  }

  async updateAgentSessionId(channelSessionId: string, agentSessionId: string): Promise<void> {
    const id = String(channelSessionId || '').trim();
    const sessionId = String(agentSessionId || '').trim();
    if (!id || !sessionId) {
      return;
    }

    await this.sessionModel
      .updateOne(
        { _id: id },
        {
          $set: {
            agentSessionId: sessionId,
            lastMessageAt: new Date(),
          },
        },
      )
      .exec();
  }

  async setActiveMeeting(filter: SessionFilter, meetingId: string, meetingType: string, employeeId?: string): Promise<void> {
    const normalizedMeetingId = String(meetingId || '').trim();
    const normalizedMeetingType = String(meetingType || '').trim();
    if (!normalizedMeetingId || !normalizedMeetingType) {
      return;
    }

    const normalizedEmployeeId = String(employeeId || '').trim();
    const update: Record<string, unknown> = {
      $set: {
        activeMeetingId: normalizedMeetingId,
        activeMeetingType: normalizedMeetingType,
        lastMessageAt: new Date(),
        isActive: true,
      },
    };

    const options: { upsert?: boolean; setDefaultsOnInsert?: boolean } = {};
    if (normalizedEmployeeId) {
      (update as Record<string, unknown>).$setOnInsert = {
        employeeId: normalizedEmployeeId,
        // Placeholder value for meeting-mode sessions created without an explicit target agent.
        agentId: this.meetingSessionAgentPlaceholder,
        messageCount: 0,
      };
      options.upsert = true;
      options.setDefaultsOnInsert = true;
    }

    await this.sessionModel.updateOne(this.normalizeFilter(filter), update, options).exec();
  }

  async clearActiveMeeting(filter: SessionFilter): Promise<void> {
    await this.sessionModel
      .updateOne(this.normalizeFilter(filter), {
        $set: {
          activeMeetingId: undefined,
          activeMeetingType: undefined,
          lastMessageAt: new Date(),
        },
      })
      .exec();
  }

  async clearActiveMeetingByMeetingId(meetingId: string): Promise<void> {
    const normalizedMeetingId = String(meetingId || '').trim();
    if (!normalizedMeetingId) {
      return;
    }

    await this.sessionModel
      .updateMany(
        { activeMeetingId: normalizedMeetingId },
        {
          $set: {
            activeMeetingId: undefined,
            activeMeetingType: undefined,
            lastMessageAt: new Date(),
          },
        },
      )
      .exec();
  }

  async getActiveMeeting(filter: SessionFilter): Promise<{ meetingId: string; meetingType: string } | undefined> {
    const session = await this.sessionModel.findOne(this.normalizeFilter(filter)).select({ activeMeetingId: 1, activeMeetingType: 1 }).exec();
    const meetingId = String(session?.activeMeetingId || '').trim();
    const meetingType = String(session?.activeMeetingType || '').trim();
    if (!meetingId || !meetingType) {
      return undefined;
    }

    return {
      meetingId,
      meetingType,
    };
  }

  async listSessionsWithActiveMeeting(): Promise<Array<{ meetingId: string; employeeId: string; chatId: string }>> {
    const sessions = await this.sessionModel
      .find({
        activeMeetingId: { $exists: true, $ne: '' },
      })
      .select({ activeMeetingId: 1, employeeId: 1, externalChatId: 1 })
      .lean()
      .exec();

    return sessions
      .map((session) => ({
        meetingId: String(session.activeMeetingId || '').trim(),
        employeeId: String(session.employeeId || '').trim(),
        chatId: String(session.externalChatId || '').trim(),
      }))
      .filter((session) => Boolean(session.meetingId && session.employeeId && session.chatId));
  }

  async reset(input: SessionFilter): Promise<boolean> {
    const result = await this.sessionModel
      .updateOne(
        this.normalizeFilter(input),
        {
          $set: {
            agentSessionId: undefined,
            activeMeetingId: undefined,
            activeMeetingType: undefined,
            messageCount: 0,
            lastMessageAt: new Date(),
          },
        },
      )
      .exec();

    return Number(result.matchedCount || 0) > 0;
  }

  private normalizeFilter(filter: SessionFilter): SessionFilter {
    return {
      providerType: String(filter.providerType || '').trim() as 'feishu-app',
      externalChatId: String(filter.externalChatId || '').trim(),
      externalUserId: String(filter.externalUserId || '').trim(),
    };
  }
}
