import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

export type InnerMessageDocument = InnerMessage & Document;

export type InnerMessageMode = 'direct' | 'subscription';
export type InnerMessageStatus = 'sent' | 'delivered' | 'processing' | 'processed' | 'failed';

@Schema({ timestamps: true, collection: 'inner_messages' })
export class InnerMessage {
  @Prop({ required: true, unique: true, default: () => uuidv4() })
  messageId: string;

  @Prop({ required: true, enum: ['direct', 'subscription'] })
  mode: InnerMessageMode;

  @Prop({ required: true })
  eventType: string;

  @Prop({ default: 'system' })
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
  status: InnerMessageStatus;

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

export const InnerMessageSchema = SchemaFactory.createForClass(InnerMessage);

InnerMessageSchema.index({ messageId: 1 }, { unique: true });
InnerMessageSchema.index({ receiverAgentId: 1, status: 1, createdAt: -1 });
InnerMessageSchema.index({ senderAgentId: 1, createdAt: -1 });
InnerMessageSchema.index({ eventType: 1, createdAt: -1 });
InnerMessageSchema.index({ dedupKey: 1 }, { unique: true, sparse: true });
