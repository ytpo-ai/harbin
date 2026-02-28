import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AgentSession, AgentSessionDocument } from '../../shared/schemas/agent-session.schema';
import { CreateSessionDto, SessionQueryDto } from './dto';

@Injectable()
export class SessionManagerService {
  constructor(
    @InjectModel(AgentSession.name) private readonly agentSessionModel: Model<AgentSessionDocument>,
  ) {}

  async createSession(organizationId: string, dto: CreateSessionDto): Promise<AgentSession> {
    const session = new this.agentSessionModel({
      ...dto,
      organizationId,
      status: 'active',
      lastActiveAt: new Date(),
      tags: dto.tags || [],
    });
    return session.save();
  }

  async getSessionOrThrow(organizationId: string, sessionId: string): Promise<AgentSession> {
    const session = await this.agentSessionModel.findOne({ _id: sessionId, organizationId }).exec();
    if (!session) {
      throw new NotFoundException('Session not found');
    }
    return session;
  }

  async listSessions(organizationId: string, query: SessionQueryDto): Promise<AgentSession[]> {
    const filter: Record<string, any> = { organizationId };
    if (query.ownerType) {
      filter.ownerType = query.ownerType;
    }
    if (query.status) {
      filter.status = query.status;
    }
    if (query.ownerId) {
      filter.ownerId = query.ownerId;
    }
    if (query.linkedPlanId) {
      filter.linkedPlanId = query.linkedPlanId;
    }

    return this.agentSessionModel.find(filter).sort({ lastActiveAt: -1 }).exec();
  }

  async appendMessage(
    organizationId: string,
    sessionId: string,
    message: { role: 'user' | 'assistant' | 'system'; content: string; metadata?: Record<string, any> },
  ): Promise<AgentSession> {
    const updated = await this.agentSessionModel
      .findOneAndUpdate(
        { _id: sessionId, organizationId },
        {
          $push: {
            messages: {
              ...message,
              timestamp: new Date(),
            },
          },
          $set: {
            lastActiveAt: new Date(),
            status: 'active',
          },
        },
        { new: true },
      )
      .exec();
    if (!updated) {
      throw new NotFoundException('Session not found');
    }
    return updated;
  }

  async appendMessages(
    organizationId: string,
    sessionId: string,
    messages: { role: 'user' | 'assistant' | 'system'; content: string; metadata?: Record<string, any> }[],
  ): Promise<AgentSession> {
    const payload = messages.map((message) => ({
      ...message,
      timestamp: new Date(),
    }));

    const updated = await this.agentSessionModel
      .findOneAndUpdate(
        { _id: sessionId, organizationId },
        {
          $push: {
            messages: { $each: payload },
          },
          $set: {
            lastActiveAt: new Date(),
            status: 'active',
          },
        },
        { new: true },
      )
      .exec();
    if (!updated) {
      throw new NotFoundException('Session not found');
    }
    return updated;
  }

  async archiveSession(organizationId: string, sessionId: string, summary?: string): Promise<AgentSession> {
    const updated = await this.agentSessionModel
      .findOneAndUpdate(
        { _id: sessionId, organizationId },
        {
          $set: {
            status: 'archived',
            contextSummary: summary,
            lastActiveAt: new Date(),
          },
        },
        { new: true },
      )
      .exec();
    if (!updated) {
      throw new NotFoundException('Session not found');
    }
    return updated;
  }

  async resumeSession(organizationId: string, sessionId: string): Promise<AgentSession> {
    const updated = await this.agentSessionModel
      .findOneAndUpdate(
        { _id: sessionId, organizationId },
        {
          $set: {
            status: 'active',
            lastActiveAt: new Date(),
          },
        },
        { new: true },
      )
      .exec();
    if (!updated) {
      throw new NotFoundException('Session not found');
    }
    return updated;
  }

  async getOrCreateAgentSession(
    organizationId: string,
    agentId: string,
    linkedPlanId: string,
    title: string,
    linkedTaskId?: string,
  ): Promise<AgentSession> {
    const existing = await this.agentSessionModel
      .findOne({
        organizationId,
        ownerType: 'agent',
        ownerId: agentId,
        linkedPlanId,
        status: 'active',
      })
      .sort({ createdAt: -1 })
      .exec();

    if (existing) {
      return existing;
    }

    return this.createSession(organizationId, {
      ownerType: 'agent',
      ownerId: agentId,
      linkedPlanId,
      linkedTaskId,
      title,
      tags: ['orchestration', 'agent-run'],
    });
  }
}
