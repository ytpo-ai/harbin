import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

export type DiscussionMessageDocument = DiscussionMessage & Document;

export enum DiscussionMessageSenderType {
  USER = 'user',
  AI = 'ai',
  SYSTEM = 'system',
}

export enum DiscussionMessageType {
  TEXT = 'text',
  BRANCH_CONTEXT = 'branch_context',
  SEDIMENT_SNAPSHOT = 'sediment_snapshot',
  CROSS_REFERENCE = 'cross_reference',
}

@Schema({ timestamps: true, collection: 'discussion_messages' })
export class DiscussionMessage {
  @Prop({ required: true, unique: true, default: () => uuidv4() })
  id: string;

  @Prop({ required: true })
  spaceId: string;

  @Prop({ required: true })
  threadId: string;

  @Prop({ required: true })
  participantId: string;

  @Prop({ enum: DiscussionMessageSenderType, required: true })
  senderType: DiscussionMessageSenderType;

  @Prop({ required: true })
  content: string;

  @Prop({ enum: DiscussionMessageType, default: DiscussionMessageType.TEXT })
  messageType: DiscussionMessageType;

  @Prop({ type: Number, required: true })
  sequence: number;

  @Prop({ type: [Object], default: [] })
  branchSuggestions: Array<{
    id: string;
    topic: string;
    reason: string;
    status: 'pending' | 'accepted' | 'dismissed';
  }>;

  @Prop({ type: [Object], default: [] })
  mentions: Array<{
    participantId: string;
    displayName: string;
    offset: number;
  }>;

  @Prop({ type: [Object], default: [] })
  crossReferences: Array<{
    threadId: string;
    threadTitle: string;
    messageId: string;
    summary: string;
  }>;

  @Prop({ type: [String], default: [] })
  knowledgeEntryIds: string[];

  @Prop({ type: Object })
  metadata?: {
    tokens?: number;
    cost?: number;
    model?: string;
    agentId?: string;
    searchesPerformed?: number;
    knowledgeHits?: number;
    contextCompressionApplied?: boolean;
  };
}

export const DiscussionMessageSchema = SchemaFactory.createForClass(DiscussionMessage);

DiscussionMessageSchema.index({ threadId: 1, sequence: 1 });
DiscussionMessageSchema.index({ spaceId: 1, createdAt: -1 });
DiscussionMessageSchema.index({ participantId: 1 });
DiscussionMessageSchema.index({ 'mentions.participantId': 1 });
