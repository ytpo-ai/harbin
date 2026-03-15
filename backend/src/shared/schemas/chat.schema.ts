import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

export type MessageDocument = Message & Document;

export type MessageSceneType = 'meeting' | 'orchestration_session' | 'task';
export type MessageSenderType = 'employee' | 'agent' | 'system';

@Schema({ timestamps: true, collection: 'chats' })
export class Message {
  @Prop({ required: true, unique: true, default: () => uuidv4() })
  id: string;

  @Prop({ required: true, enum: ['meeting', 'orchestration_session', 'task'] })
  sceneType: MessageSceneType;

  @Prop({ required: true })
  sceneId: string;

  @Prop()
  threadId?: string;

  @Prop({ required: true, enum: ['employee', 'agent', 'system'] })
  senderType: MessageSenderType;

  @Prop({ required: true })
  senderId: string;

  @Prop({ enum: ['user', 'assistant', 'system'] })
  senderRole?: 'user' | 'assistant' | 'system';

  @Prop({ required: true })
  content: string;

  @Prop({ required: true, default: 'opinion' })
  messageType: string;

  @Prop({ type: Object })
  metadata?: Record<string, any>;

  @Prop({ default: Date.now })
  occurredAt: Date;

  @Prop()
  model?: string;

  @Prop()
  provider?: string;

  @Prop({ default: 0 })
  inputTokens?: number;

  @Prop({ default: 0 })
  outputTokens?: number;

  @Prop({ default: 0 })
  latencyMs?: number;

  @Prop({ default: 0 })
  costUsd?: number;

  @Prop({ type: [String], default: [] })
  toolCalls?: string[];

  @Prop()
  traceId?: string;

  @Prop({ type: [String], default: [] })
  evalTags?: string[];
}

export const MessageSchema = SchemaFactory.createForClass(Message);

MessageSchema.index({ sceneType: 1, sceneId: 1, occurredAt: 1 });
MessageSchema.index({ senderId: 1, occurredAt: -1 });
MessageSchema.index({ traceId: 1 });
