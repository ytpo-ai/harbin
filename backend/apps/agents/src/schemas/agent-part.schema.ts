import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AgentPartDocument = AgentPart & Document;

@Schema({ timestamps: true, collection: 'agent_parts' })
export class AgentPart {
  @Prop({ required: true, unique: true })
  id: string;

  @Prop({ required: true })
  runId: string;

  @Prop({ required: true })
  messageId: string;

  @Prop({ required: true, default: 0 })
  sequence: number;

  @Prop({
    required: true,
    enum: ['text', 'reasoning', 'tool_call', 'tool_result', 'system_event', 'step_start', 'step_finish'],
  })
  type: 'text' | 'reasoning' | 'tool_call' | 'tool_result' | 'system_event' | 'step_start' | 'step_finish';

  @Prop({
    type: String,
    enum: ['pending', 'running', 'completed', 'error', 'cancelled'],
    required: true,
    default: 'completed',
  })
  status: 'pending' | 'running' | 'completed' | 'error' | 'cancelled';

  @Prop()
  toolId?: string;

  @Prop()
  toolCallId?: string;

  @Prop({ type: Object })
  input?: unknown;

  @Prop({ type: Object })
  output?: unknown;

  @Prop({ default: '' })
  content?: string;

  @Prop({ type: Object })
  metadata?: Record<string, unknown>;

  @Prop()
  error?: string;

  @Prop({ type: Date })
  startedAt?: Date;

  @Prop({ type: Date })
  endedAt?: Date;
}

export const AgentPartSchema = SchemaFactory.createForClass(AgentPart);

AgentPartSchema.index({ runId: 1, messageId: 1, sequence: 1 });
AgentPartSchema.index({ runId: 1, toolCallId: 1 });
AgentPartSchema.index({ status: 1, updatedAt: -1 });
