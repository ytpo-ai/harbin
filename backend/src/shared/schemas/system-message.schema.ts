import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

export type SystemMessageDocument = SystemMessage & Document;

export type SystemMessageType = 'engineering_statistics' | 'orchestration' | 'system_alert';

@Schema({ timestamps: true, collection: 'system_messages' })
export class SystemMessage {
  @Prop({ required: true, unique: true, default: () => uuidv4() })
  messageId: string;

  @Prop({ required: true })
  receiverId: string;

  @Prop({ required: true, enum: ['engineering_statistics', 'orchestration', 'system_alert'] })
  type: SystemMessageType;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  content: string;

  @Prop({ type: Object, default: {} })
  payload: Record<string, any>;

  @Prop({ default: false })
  isRead: boolean;

  @Prop()
  readAt?: Date;

  @Prop({ default: 'system' })
  source: string;

  @Prop({ default: 'active' })
  status: string;
}

export const SystemMessageSchema = SchemaFactory.createForClass(SystemMessage);

SystemMessageSchema.index({ receiverId: 1, isRead: 1, createdAt: -1 });
SystemMessageSchema.index({ type: 1, createdAt: -1 });
SystemMessageSchema.index({ messageId: 1 }, { unique: true });
