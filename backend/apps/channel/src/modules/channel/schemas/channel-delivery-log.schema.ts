import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ChannelDeliveryLogDocument = ChannelDeliveryLog & Document;

@Schema({ timestamps: true, collection: 'channel_delivery_logs' })
export class ChannelDeliveryLog {
  @Prop({ required: true })
  configId: string;

  @Prop({ required: true })
  eventId: string;

  @Prop({ required: true })
  eventType: string;

  @Prop({ required: true })
  providerType: string;

  @Prop({ required: true, enum: ['success', 'failed', 'retrying'] })
  status: 'success' | 'failed' | 'retrying';

  @Prop({ required: true, default: 1 })
  attempt: number;

  @Prop()
  errorMessage?: string;

  @Prop({ type: Object })
  requestPayload?: Record<string, unknown>;

  @Prop({ type: Object })
  responsePayload?: Record<string, unknown>;

  @Prop()
  deliveredAt?: Date;

  @Prop()
  createdAt?: Date;
}

export const ChannelDeliveryLogSchema = SchemaFactory.createForClass(ChannelDeliveryLog);

ChannelDeliveryLogSchema.index({ eventId: 1, configId: 1, attempt: -1 });
ChannelDeliveryLogSchema.index({ createdAt: -1 });
