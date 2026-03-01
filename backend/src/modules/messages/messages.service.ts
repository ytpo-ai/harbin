import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Message, MessageDocument, MessageSceneType, MessageSenderType } from '../../shared/schemas/message.schema';

export interface AppendMessageDto {
  sceneType: MessageSceneType;
  sceneId: string;
  threadId?: string;
  senderType: MessageSenderType;
  senderId: string;
  senderRole?: 'user' | 'assistant' | 'system';
  content: string;
  messageType?: string;
  metadata?: Record<string, any>;
  occurredAt?: Date;
  model?: string;
  provider?: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  costUsd?: number;
  toolCalls?: string[];
  traceId?: string;
  evalTags?: string[];
}

export interface ListMessagesQuery {
  sceneType: MessageSceneType;
  sceneId: string;
  limit?: number;
  before?: Date;
}

@Injectable()
export class MessagesService {
  constructor(
    @InjectModel(Message.name) private readonly messageModel: Model<MessageDocument>,
  ) {}

  async appendMessage(dto: AppendMessageDto): Promise<Message> {
    return this.messageModel.create({
      sceneType: dto.sceneType,
      sceneId: dto.sceneId,
      threadId: dto.threadId,
      senderType: dto.senderType,
      senderId: dto.senderId,
      senderRole: dto.senderRole,
      content: dto.content,
      messageType: dto.messageType || 'opinion',
      metadata: dto.metadata,
      occurredAt: dto.occurredAt || new Date(),
      model: dto.model,
      provider: dto.provider,
      inputTokens: dto.inputTokens,
      outputTokens: dto.outputTokens,
      latencyMs: dto.latencyMs,
      costUsd: dto.costUsd,
      toolCalls: dto.toolCalls,
      traceId: dto.traceId,
      evalTags: dto.evalTags,
    });
  }

  async appendMessages(dtos: AppendMessageDto[]): Promise<void> {
    if (!dtos.length) {
      return;
    }

    await this.messageModel.insertMany(
      dtos.map((dto) => ({
        sceneType: dto.sceneType,
        sceneId: dto.sceneId,
        threadId: dto.threadId,
        senderType: dto.senderType,
        senderId: dto.senderId,
        senderRole: dto.senderRole,
        content: dto.content,
        messageType: dto.messageType || 'opinion',
        metadata: dto.metadata,
        occurredAt: dto.occurredAt || new Date(),
        model: dto.model,
        provider: dto.provider,
        inputTokens: dto.inputTokens,
        outputTokens: dto.outputTokens,
        latencyMs: dto.latencyMs,
        costUsd: dto.costUsd,
        toolCalls: dto.toolCalls,
        traceId: dto.traceId,
        evalTags: dto.evalTags,
      })),
      { ordered: true },
    );
  }

  async listSceneMessages(query: ListMessagesQuery): Promise<Message[]> {
    const limit = Math.min(Math.max(query.limit || 50, 1), 500);

    const filter: Record<string, any> = {
      sceneType: query.sceneType,
      sceneId: query.sceneId,
    };

    if (query.before) {
      filter.occurredAt = { $lt: query.before };
    }

    const docs = await this.messageModel
      .find(filter)
      .sort({ occurredAt: -1 })
      .limit(limit)
      .lean()
      .exec();

    return docs.reverse() as Message[];
  }

  async getRecentSceneMessages(sceneType: MessageSceneType, sceneId: string, limit = 20): Promise<Message[]> {
    return this.listSceneMessages({
      sceneType,
      sceneId,
      limit,
    });
  }
}
