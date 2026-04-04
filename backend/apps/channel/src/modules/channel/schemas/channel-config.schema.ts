import { Prop, Schema, SchemaFactory, raw } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ChannelConfigDocument = ChannelConfig & Document;

@Schema({ timestamps: true, collection: 'channel_configs' })
export class ChannelConfig {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true, enum: ['feishu', 'feishu-app'] })
  providerType: 'feishu' | 'feishu-app';

  @Prop({ required: true, enum: ['group', 'user'] })
  targetType: 'group' | 'user';

  @Prop(
    raw({
      webhookUrlEncrypted: { type: String },
      webhookSecretEncrypted: { type: String },
      appIdEncrypted: { type: String },
      appSecretEncrypted: { type: String },
      encryptKeyEncrypted: { type: String },
      receiveId: { type: String },
      receiveIdType: { type: String, enum: ['chat_id', 'open_id'] },
    }),
  )
  providerConfig: {
    webhookUrlEncrypted?: string;
    webhookSecretEncrypted?: string;
    appIdEncrypted?: string;
    appSecretEncrypted?: string;
    encryptKeyEncrypted?: string;
    receiveId?: string;
    receiveIdType?: 'chat_id' | 'open_id';
  };

  @Prop({ type: [String], default: [] })
  eventFilters: string[];

  @Prop({ default: true })
  isActive: boolean;

  @Prop()
  createdBy?: string;

  @Prop()
  createdAt?: Date;

  @Prop()
  updatedAt?: Date;
}

export const ChannelConfigSchema = SchemaFactory.createForClass(ChannelConfig);

ChannelConfigSchema.index({ providerType: 1, isActive: 1 });
ChannelConfigSchema.index({ eventFilters: 1, isActive: 1 });
