import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

export type AgentCollaborationMessageDocument = AgentCollaborationMessage & Document;

export type AgentMessageMode = 'direct' | 'subscription';
export type AgentMessageStatus = 'sent' | 'delivered' | 'processing' | 'processed' | 'failed';

@Schema({ timestamps: true, collection: 'agent_collaboration_messages' })
export class AgentCollaborationMessage {
  @Prop({ required: true, unique: true, default: () => uuidv4() })
  messageId: string;

  @Prop({ required: true, enum: ['direct', 'subscription'] })
  mode: AgentMessageMode;

  @Prop({ required: true })
  eventType: string;

  @Prop({ required: true })
  senderAgentId: string;

  @Prop({ required: true })
  receiverAgentId: string;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  content: string;

  @Prop({ type: Object, default: {} })
  payload: Record<string, any>;

  @Prop({ required: true, enum: ['sent', 'delivered', 'processing', 'processed', 'failed'], default: 'sent' })
  status: AgentMessageStatus;

  @Prop({ default: Date.now })
  sentAt: Date;

  @Prop()
  deliveredAt?: Date;

  @Prop()
  processingAt?: Date;

  @Prop()
  processedAt?: Date;

  @Prop()
  failedAt?: Date;

  @Prop()
  error?: string;

  @Prop({ default: 0 })
  attempt: number;

  @Prop({ default: 3 })
  maxAttempts: number;

  @Prop()
  dedupKey?: string;

  @Prop()
  source?: string;
}

export const AgentCollaborationMessageSchema = SchemaFactory.createForClass(AgentCollaborationMessage);

AgentCollaborationMessageSchema.index({ messageId: 1 }, { unique: true });
AgentCollaborationMessageSchema.index({ receiverAgentId: 1, status: 1, createdAt: -1 });
AgentCollaborationMessageSchema.index({ senderAgentId: 1, createdAt: -1 });
AgentCollaborationMessageSchema.index({ eventType: 1, createdAt: -1 });
AgentCollaborationMessageSchema.index({ dedupKey: 1 }, { unique: true, sparse: true });
