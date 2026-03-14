import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

export type AgentMessageSubscriptionDocument = AgentMessageSubscription & Document;

@Schema({ timestamps: true, collection: 'agent_message_subscriptions' })
export class AgentMessageSubscription {
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

export const AgentMessageSubscriptionSchema = SchemaFactory.createForClass(AgentMessageSubscription);

AgentMessageSubscriptionSchema.index({ subscriberAgentId: 1, isActive: 1, createdAt: -1 });
AgentMessageSubscriptionSchema.index({ eventType: 1, isActive: 1, createdAt: -1 });
AgentMessageSubscriptionSchema.index({ subscriberAgentId: 1, eventType: 1 }, { unique: true });
