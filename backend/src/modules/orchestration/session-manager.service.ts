import { Injectable, NotFoundException } from '@nestjs/common';
import { AgentClientService } from '../agents-client/agent-client.service';
import { CreateSessionDto, SessionQueryDto } from './dto';

@Injectable()
export class SessionManagerService {
  constructor(private readonly agentClientService: AgentClientService) {}

  async createSession(dto: CreateSessionDto): Promise<any> {
    const session = await this.agentClientService.createSession({
      sessionId: (dto as any).id,
      ownerType: dto.ownerType,
      ownerId: dto.ownerId,
      title: dto.title,
      planContext: (dto as any).planContext,
      meetingContext: (dto as any).meetingContext,
      metadata: (dto as any).metadata,
    });
    if (!session) {
      throw new NotFoundException('Failed to create session');
    }
    return session;
  }

  async getSessionOrThrow(sessionId: string): Promise<any> {
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

  async listSessions(query: SessionQueryDto): Promise<any[]> {
    return [];
  }

  async appendMessage(
    sessionId: string,
    message: { role: 'user' | 'assistant' | 'system'; content: string; metadata?: Record<string, any> },
  ): Promise<any> {
    const session = await this.agentClientService.appendSessionMessage(sessionId, {
      role: message.role,
      content: message.content,
      status: 'completed',
      metadata: message.metadata,
    });
    if (!session) {
      throw new NotFoundException('Session not found');
    }
    return session;
  }

  async appendMessages(
    sessionId: string,
    messages: { role: 'user' | 'assistant' | 'system'; content: string; metadata?: Record<string, any> }[],
  ): Promise<any> {
    let result: any = null;
    for (const message of messages) {
      result = await this.agentClientService.appendSessionMessage(sessionId, {
        role: message.role,
        content: message.content,
        status: 'completed',
        metadata: message.metadata,
      });
    }
    if (!result) {
      throw new NotFoundException('Session not found');
    }
    return result;
  }

  async archiveSession(sessionId: string, summary?: string): Promise<any> {
    const session = await this.agentClientService.archiveSession(sessionId, summary);
    if (!session) {
      throw new NotFoundException('Session not found');
    }
    return session;
  }

  async resumeSession(sessionId: string): Promise<any> {
    const session = await this.agentClientService.resumeSession(sessionId);
    if (!session) {
      throw new NotFoundException('Session not found');
    }
    return session;
  }

  async getOrCreateAgentSession(
    agentId: string,
    linkedPlanId: string,
    title: string,
    linkedTaskId?: string,
  ): Promise<any> {
    return this.createSession({
      ownerType: 'agent',
      ownerId: agentId,
      title,
      linkedPlanId,
      linkedTaskId,
      tags: ['orchestration', 'agent-run'],
    } as any);
  }
}
