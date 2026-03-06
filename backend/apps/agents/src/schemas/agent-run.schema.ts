import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AgentRunDocument = AgentRun & Document;

@Schema({ timestamps: true, collection: 'agent_runs' })
export class AgentRun {
  @Prop({ required: true, unique: true })
  id: string;

  @Prop({ required: true })
  agentId: string;

  @Prop({ required: true })
  agentName: string;

  @Prop()
  sessionId?: string;

  @Prop()
  taskId?: string;

  @Prop({ required: true })
  taskTitle: string;

  @Prop({ default: '' })
  taskDescription: string;

  @Prop({ required: true, default: 0 })
  currentStep: number;

  @Prop({
    required: true,
    enum: ['pending', 'running', 'completed', 'failed', 'cancelled', 'paused'],
    default: 'pending',
  })
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'paused';

  @Prop({ default: Date.now })
  startedAt: Date;

  @Prop()
  finishedAt?: Date;

  @Prop()
  error?: string;

  @Prop({ type: Object })
  metadata?: Record<string, unknown>;
}

export const AgentRunSchema = SchemaFactory.createForClass(AgentRun);

AgentRunSchema.index({ agentId: 1, createdAt: -1 });
AgentRunSchema.index({ sessionId: 1, createdAt: -1 });
AgentRunSchema.index({ taskId: 1, createdAt: -1 });
AgentRunSchema.index({ status: 1, updatedAt: -1 });
