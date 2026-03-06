import { Injectable, NotFoundException } from '@nestjs/common';
import { AgentClientService } from '../agents-client/agent-client.service';
import { CreateSessionDto, SessionQueryDto } from './dto';

@Injectable()
export class SessionManagerService {
  constructor(private readonly agentClientService: AgentClientService) {}

  async createSession(organizationId: string, dto: CreateSessionDto): Promise<any> {
    const session = await this.agentClientService.createSession({
      sessionId: (dto as any).id,
      ownerType: dto.ownerType,
      ownerId: dto.ownerId,
      title: dto.title,
      planContext: (dto as any).planContext,
      meetingContext: (dto as any).meetingContext,
      metadata: { ...(dto as any).metadata, organizationId },
    });
    if (!session) {
      throw new NotFoundException('Failed to create session');
    }
    return session;
  }

  async getSessionOrThrow(organizationId: string, sessionId: string): Promise<any> {
    const normalized = String(sessionId || '').trim();
    if (!normalized) {
      throw new NotFoundException('Session not found');
    }

    const session = await this.agentClientService.getSession(normalized);
    if (!session) {
      throw new NotFoundException('Session not found');
    }
    return session;
  }

  async listSessions(organizationId: string, query: SessionQueryDto): Promise<any[]> {
    return [];
  }

  async appendMessage(
    organizationId: string,
    sessionId: string,
    message: { role: 'user' | 'assistant' | 'system'; content: string; metadata?: Record<string, any> },
  ): Promise<any> {
    const session = await this.agentClientService.appendSessionMessage(sessionId, {
      role: message.role,
      content: message.content,
      status: 'completed',
      metadata: { ...message.metadata, organizationId },
    });
    if (!session) {
      throw new NotFoundException('Session not found');
    }
    return session;
  }

  async appendMessages(
    organizationId: string,
    sessionId: string,
    messages: { role: 'user' | 'assistant' | 'system'; content: string; metadata?: Record<string, any> }[],
  ): Promise<any> {
    let result: any = null;
    for (const message of messages) {
      result = await this.agentClientService.appendSessionMessage(sessionId, {
        role: message.role,
        content: message.content,
        status: 'completed',
        metadata: { ...message.metadata, organizationId },
      });
    }
    if (!result) {
      throw new NotFoundException('Session not found');
    }
    return result;
  }

  async archiveSession(organizationId: string, sessionId: string, summary?: string): Promise<any> {
    const session = await this.agentClientService.archiveSession(sessionId, summary);
    if (!session) {
      throw new NotFoundException('Session not found');
    }
    return session;
  }

  async resumeSession(organizationId: string, sessionId: string): Promise<any> {
    const session = await this.agentClientService.resumeSession(sessionId);
    if (!session) {
      throw new NotFoundException('Session not found');
    }
    return session;
  }

  async getOrCreateAgentSession(
    organizationId: string,
    agentId: string,
    linkedPlanId: string,
    title: string,
    linkedTaskId?: string,
  ): Promise<any> {
    return this.createSession(organizationId, {
      ownerType: 'agent',
      ownerId: agentId,
      title,
      linkedPlanId,
      linkedTaskId,
      tags: ['orchestration', 'agent-run'],
    } as any);
  }
}
