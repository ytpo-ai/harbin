import { Prop, Schema, SchemaFactory, raw } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ChannelConfigDocument = ChannelConfig & Document;

@Schema({ timestamps: true, collection: 'channel_configs' })
export class ChannelConfig {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true, enum: ['feishu'] })
  providerType: 'feishu';

  @Prop({ required: true, enum: ['group', 'user'] })
  targetType: 'group' | 'user';

  @Prop(
    raw({
      webhookUrlEncrypted: { type: String, required: true },
      webhookSecretEncrypted: { type: String },
    }),
  )
  providerConfig: {
    webhookUrlEncrypted: string;
    webhookSecretEncrypted?: string;
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
