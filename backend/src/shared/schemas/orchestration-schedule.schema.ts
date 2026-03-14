import { Prop, Schema, SchemaFactory, raw } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type OrchestrationScheduleDocument = OrchestrationSchedule & Document;

export type OrchestrationScheduleStatus = 'idle' | 'running' | 'paused' | 'error';
export type OrchestrationScheduleType = 'cron' | 'interval';

@Schema({ timestamps: true })
export class OrchestrationSchedule {
  @Prop()
  id?: string;

  @Prop({ required: true })
  name: string;

  @Prop()
  description?: string;

  @Prop()
  planId?: string;

  @Prop(raw({
    type: { type: String, enum: ['cron', 'interval'], required: true },
    expression: { type: String },
    intervalMs: { type: Number },
    timezone: { type: String, default: 'Asia/Shanghai' },
  }))
  schedule: {
    type: OrchestrationScheduleType;
    expression?: string;
    intervalMs?: number;
    timezone?: string;
  };

  @Prop(raw({
    executorType: { type: String, enum: ['agent'], default: 'agent' },
    executorId: { type: String, required: true },
    executorName: { type: String },
  }))
  target: {
    executorType: 'agent';
    executorId: string;
    executorName?: string;
  };

  @Prop(raw({
    prompt: { type: String },
    payload: { type: Object },
  }))
  input: {
    prompt?: string;
    payload?: Record<string, unknown>;
  };

  @Prop({ default: true })
  enabled: boolean;

  @Prop({ enum: ['idle', 'running', 'paused', 'error'], default: 'idle' })
  status: OrchestrationScheduleStatus;

  @Prop()
  nextRunAt?: Date;

  @Prop(raw({
    startedAt: { type: Date },
    completedAt: { type: Date },
    success: { type: Boolean },
    result: { type: String },
    error: { type: String },
    taskId: { type: String },
    sessionId: { type: String },
    attempts: { type: Number },
  }))
  lastRun?: {
    startedAt?: Date;
    completedAt?: Date;
    success?: boolean;
    result?: string;
    error?: string;
    taskId?: string;
    sessionId?: string;
    attempts?: number;
  };

  @Prop({ type: [{
    failedAt: { type: Date, default: Date.now },
    taskId: { type: String },
    triggerType: { type: String, enum: ['auto', 'manual'], required: true },
    reason: { type: String, required: true },
    attempts: { type: Number, default: 1 },
  }], default: [] })
  deadLetters: {
    failedAt: Date;
    taskId?: string;
    triggerType: 'auto' | 'manual';
    reason: string;
    attempts: number;
  }[];

  @Prop(raw({
    totalRuns: { type: Number, default: 0 },
    successRuns: { type: Number, default: 0 },
    failedRuns: { type: Number, default: 0 },
    skippedRuns: { type: Number, default: 0 },
  }))
  stats: {
    totalRuns: number;
    successRuns: number;
    failedRuns: number;
    skippedRuns: number;
  };

  @Prop()
  createdBy?: string;
}

export const OrchestrationScheduleSchema = SchemaFactory.createForClass(OrchestrationSchedule);

OrchestrationScheduleSchema.index({ enabled: 1, updatedAt: -1 });
OrchestrationScheduleSchema.index({ nextRunAt: 1 });
OrchestrationScheduleSchema.index({ 'target.executorId': 1, enabled: 1 });
OrchestrationScheduleSchema.index({ planId: 1, updatedAt: -1 });
