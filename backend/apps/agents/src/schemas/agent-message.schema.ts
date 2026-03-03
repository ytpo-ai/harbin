import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AgentMessageDocument = AgentMessage & Document;

@Schema({ timestamps: true, collection: 'agent_messages' })
export class AgentMessage {
  @Prop({ required: true, unique: true })
  id: string;

  @Prop({ required: true })
  runId: string;

  @Prop({ required: true })
  agentId: string;

  @Prop()
  sessionId?: string;

  @Prop()
  taskId?: string;

  @Prop({ required: true, enum: ['system', 'user', 'assistant', 'tool'] })
  role: 'system' | 'user' | 'assistant' | 'tool';

  @Prop({ required: true, default: 0 })
  sequence: number;

  @Prop({ required: true, default: '' })
  content: string;

  @Prop({
    required: true,
    enum: ['pending', 'streaming', 'completed', 'error'],
    default: 'completed',
  })
  status: 'pending' | 'streaming' | 'completed' | 'error';

  @Prop({ type: Object })
  metadata?: Record<string, unknown>;
}

export const AgentMessageSchema = SchemaFactory.createForClass(AgentMessage);

AgentMessageSchema.index({ runId: 1, sequence: 1 });
AgentMessageSchema.index({ sessionId: 1, sequence: 1 });
AgentMessageSchema.index({ taskId: 1, sequence: 1 });
