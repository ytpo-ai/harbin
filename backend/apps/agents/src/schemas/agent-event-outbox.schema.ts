import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AgentEventOutboxDocument = AgentEventOutbox & Document;

@Schema({ timestamps: true, collection: 'agent_events_outbox' })
export class AgentEventOutbox {
  @Prop({ required: true, unique: true })
  id: string;

  @Prop({ required: true, unique: true })
  eventId: string;

  @Prop({ required: true })
  eventType: string;

  @Prop({ required: true })
  runId: string;

  @Prop({ required: true })
  agentId: string;

  @Prop()
  organizationId?: string;

  @Prop()
  sessionId?: string;

  @Prop()
  taskId?: string;

  @Prop()
  messageId?: string;

  @Prop()
  partId?: string;

  @Prop()
  toolCallId?: string;

  @Prop({ required: true, default: 0 })
  sequence: number;

  @Prop({ type: Object, required: true })
  payload: Record<string, unknown>;

  @Prop({
    required: true,
    enum: ['pending', 'dispatched', 'failed'],
    default: 'pending',
  })
  status: 'pending' | 'dispatched' | 'failed';

  @Prop({ required: true, default: 0 })
  attempts: number;

  @Prop({ type: Date })
  nextRetryAt?: Date;

  @Prop({ type: Date })
  dispatchedAt?: Date;

  @Prop()
  lastError?: string;

  @Prop({ required: true, default: Date.now })
  timestamp: Date;
}

export const AgentEventOutboxSchema = SchemaFactory.createForClass(AgentEventOutbox);

AgentEventOutboxSchema.index({ status: 1, nextRetryAt: 1, createdAt: 1 });
AgentEventOutboxSchema.index({ runId: 1, sequence: 1 });
AgentEventOutboxSchema.index({ sessionId: 1, sequence: 1 });
