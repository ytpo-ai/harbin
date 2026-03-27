import { Prop, Schema, SchemaFactory, raw } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { OrchestrationTaskRuntimeType, OrchestrationTaskStatus } from './orchestration-task.schema';

export type OrchestrationRunTaskDocument = OrchestrationRunTask & Document;

@Schema({ timestamps: true, collection: 'orchestration_run_tasks' })
export class OrchestrationRunTask {
  @Prop()
  id?: string;

  @Prop({ required: true })
  runId: string;

  @Prop({ required: true })
  planId: string;

  @Prop({ required: true })
  sourceTaskId: string;

  @Prop({ required: true })
  order: number;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  description: string;

  @Prop({ enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' })
  priority: 'low' | 'medium' | 'high' | 'urgent';

  @Prop({ enum: ['pending', 'assigned', 'in_progress', 'blocked', 'waiting_human', 'completed', 'failed', 'cancelled'], default: 'pending' })
  status: OrchestrationTaskStatus;

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

  @Prop({ type: [String], default: [] })
  dependencyTaskIds: string[];

  @Prop({
    enum: [
      'research',
      'development.plan',
      'development.exec',
      'development.review',
      'general',
    ],
    required: false,
  })
  runtimeTaskType?: OrchestrationTaskRuntimeType;

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

export const OrchestrationRunTaskSchema = SchemaFactory.createForClass(OrchestrationRunTask);

OrchestrationRunTaskSchema.index({ runId: 1, order: 1 });
OrchestrationRunTaskSchema.index({ planId: 1, runId: 1 });
OrchestrationRunTaskSchema.index({ sourceTaskId: 1 });
