import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ChannelSessionDocument = ChannelSession & Document;

@Schema({ timestamps: true, collection: 'channel_sessions' })
export class ChannelSession {
  @Prop({ required: true, enum: ['feishu-app'] })
  providerType: 'feishu-app';

  @Prop({ required: true })
  externalChatId: string;

  @Prop({ required: true })
  externalUserId: string;

  @Prop({ required: true })
  employeeId: string;

  @Prop({ required: true })
  agentId: string;

  @Prop()
  agentSessionId?: string;

  @Prop({ default: Date.now })
  lastMessageAt: Date;

  @Prop({ default: 0 })
  messageCount: number;

  @Prop({ default: true })
  isActive: boolean;

  @Prop()
  createdAt?: Date;

  @Prop()
  updatedAt?: Date;
}

export const ChannelSessionSchema = SchemaFactory.createForClass(ChannelSession);

ChannelSessionSchema.index(
  {
    providerType: 1,
    externalChatId: 1,
    externalUserId: 1,
  },
  { unique: true },
);
