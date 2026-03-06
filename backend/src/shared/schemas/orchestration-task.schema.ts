import { Prop, Schema, SchemaFactory, raw } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type OrchestrationTaskDocument = OrchestrationTask & Document;

export type OrchestrationTaskStatus =
  | 'pending'
  | 'assigned'
  | 'in_progress'
  | 'blocked'
  | 'waiting_human'
  | 'completed'
  | 'failed'
  | 'cancelled';

@Schema({ timestamps: true })
export class OrchestrationTask {
  @Prop()
  id?: string;

  @Prop({ required: true })
  planId: string;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  description: string;

  @Prop({ enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' })
  priority: 'low' | 'medium' | 'high' | 'urgent';

  @Prop({ enum: ['pending', 'assigned', 'in_progress', 'blocked', 'waiting_human', 'completed', 'failed', 'cancelled'], default: 'pending' })
  status: OrchestrationTaskStatus;

  @Prop({ default: 0 })
  order: number;

  @Prop({ type: [String], default: [] })
  dependencyTaskIds: string[];

  @Prop(raw({
    executorType: { type: String, enum: ['agent', 'employee', 'unassigned'], default: 'unassigned' },
    executorId: { type: String },
    reason: { type: String },
  }))
  assignment: {
    executorType: 'agent' | 'employee' | 'unassigned';
    executorId?: string;
    reason?: string;
  };

  @Prop(raw({
    summary: { type: String },
    output: { type: String },
    error: { type: String },
  }))
  result?: {
    summary?: string;
    output?: string;
    error?: string;
  };

  @Prop()
  sessionId?: string;

  @Prop({ type: [{
    timestamp: { type: Date, default: Date.now },
    level: { type: String, enum: ['info', 'warn', 'error'], default: 'info' },
    message: { type: String, required: true },
    metadata: { type: Object },
  }], default: [] })
  runLogs: {
    timestamp: Date;
    level: 'info' | 'warn' | 'error';
    message: string;
    metadata?: Record<string, any>;
  }[];

  @Prop()
  startedAt?: Date;

  @Prop()
  completedAt?: Date;
}

export const OrchestrationTaskSchema = SchemaFactory.createForClass(OrchestrationTask);

OrchestrationTaskSchema.index({ planId: 1, order: 1 });
OrchestrationTaskSchema.index({ status: 1 });
