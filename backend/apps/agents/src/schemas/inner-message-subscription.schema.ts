import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

export type InnerMessageSubscriptionDocument = InnerMessageSubscription & Document;

@Schema({ timestamps: true, collection: 'inner_message_subscriptions' })
export class InnerMessageSubscription {
  @Prop({ required: true, unique: true, default: () => uuidv4() })
  subscriptionId: string;

  @Prop({ required: true })
  subscriberAgentId: string;

  @Prop({ required: true })
  eventType: string;

  @Prop({ type: Object, default: {} })
  filters: Record<string, any>;

  @Prop({ default: true })
  isActive: boolean;

  @Prop()
  source?: string;
}

export const InnerMessageSubscriptionSchema = SchemaFactory.createForClass(InnerMessageSubscription);

InnerMessageSubscriptionSchema.index({ subscriberAgentId: 1, isActive: 1, createdAt: -1 });
InnerMessageSubscriptionSchema.index({ eventType: 1, isActive: 1, createdAt: -1 });
InnerMessageSubscriptionSchema.index({ subscriberAgentId: 1, eventType: 1 }, { unique: true });
