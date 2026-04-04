import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ChannelUserMappingDocument = ChannelUserMapping & Document;

@Schema({ timestamps: true, collection: 'channel_user_mappings' })
export class ChannelUserMapping {
  @Prop({ required: true, enum: ['feishu-app'] })
  providerType: 'feishu-app';

  @Prop({ required: true })
  externalUserId: string;

  @Prop({ required: true })
  employeeId: string;

  @Prop()
  displayName?: string;

  @Prop({ default: Date.now })
  boundAt: Date;

  @Prop({ default: Date.now })
  lastActiveAt: Date;

  @Prop({ default: true })
  isActive: boolean;

  @Prop()
  createdAt?: Date;

  @Prop()
  updatedAt?: Date;
}

export const ChannelUserMappingSchema = SchemaFactory.createForClass(ChannelUserMapping);

ChannelUserMappingSchema.index({ providerType: 1, externalUserId: 1 }, { unique: true });
ChannelUserMappingSchema.index({ employeeId: 1 });
