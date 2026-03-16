import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AgentTaskDocument = AgentTask & Document;

export type AgentTaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

@Schema({ timestamps: true, collection: 'agent_tasks' })
export class AgentTask {
  @Prop({ required: true, unique: true })
  id: string;

  @Prop({ required: true })
  userId: string;

  @Prop({ required: true })
  agentId: string;

  @Prop({ required: true })
  prompt: string;

  @Prop({ type: Object })
  sessionContext?: Record<string, unknown>;

  @Prop({ required: true, enum: ['queued', 'running', 'succeeded', 'failed', 'cancelled'], default: 'queued' })
  status: AgentTaskStatus;

  @Prop()
  runId?: string;

  @Prop()
  sessionId?: string;

  @Prop()
  serveId?: string;

  @Prop({ type: Number, default: 0 })
  progress?: number;

  @Prop({ type: String })
  currentStep?: string;

  @Prop({ type: Number, default: 0 })
  attempt?: number;

  @Prop({ type: Number, default: 3 })
  maxAttempts?: number;

  @Prop({ type: Number, default: 120000 })
  stepTimeoutMs?: number;

  @Prop({ type: Number, default: 1200000 })
  taskTimeoutMs?: number;

  @Prop({ type: Number, default: 1000 })
  retryBaseDelayMs?: number;

  @Prop({ type: Number, default: 5000 })
  retryMaxDelayMs?: number;

  @Prop({ type: Date })
  lastAttemptAt?: Date;

  @Prop({ type: Date })
  nextRetryAt?: Date;

  @Prop({ type: Boolean, default: true })
  retryEnqueued?: boolean;

  @Prop({ type: Boolean, default: false })
  cancelRequested?: boolean;

  @Prop()
  idempotencyKey?: string;

  @Prop({ type: String })
  errorCode?: string;

  @Prop({ type: String })
  errorMessage?: string;

  @Prop({ type: Object })
  resultSummary?: Record<string, unknown>;

  @Prop({ type: Number, default: 0 })
  eventCursor: number;

  @Prop({ type: Date })
  startedAt?: Date;

  @Prop({ type: Date })
  finishedAt?: Date;

  @Prop({ type: Date })
  lastEventAt?: Date;
}

export const AgentTaskSchema = SchemaFactory.createForClass(AgentTask);

AgentTaskSchema.index({ userId: 1, createdAt: -1 });
AgentTaskSchema.index({ status: 1, updatedAt: -1 });
AgentTaskSchema.index({ idempotencyKey: 1, userId: 1 }, { unique: true, sparse: true });
AgentTaskSchema.index({ status: 1, nextRetryAt: 1, retryEnqueued: 1 });
