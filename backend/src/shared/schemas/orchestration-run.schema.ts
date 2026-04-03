import { Prop, Schema, SchemaFactory, raw } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type OrchestrationRunDocument = OrchestrationRun & Document;

export type OrchestrationRunTriggerType = 'manual' | 'schedule' | 'autorun';
export type OrchestrationRunStatus = 'running' | 'completed' | 'failed' | 'cancelled';

@Schema({ timestamps: true, collection: 'orchestration_runs' })
export class OrchestrationRun {
  @Prop()
  id?: string;

  @Prop({ required: true })
  planId: string;

  @Prop({ index: true })
  projectId?: string; // 所属项目ID，创建时从 Plan 继承

  @Prop({ enum: ['manual', 'schedule', 'autorun'], required: true })
  triggerType: OrchestrationRunTriggerType;

  @Prop()
  scheduleId?: string;

  @Prop({ enum: ['running', 'completed', 'failed', 'cancelled'], default: 'running' })
  status: OrchestrationRunStatus;

  @Prop({ required: true })
  startedAt: Date;

  @Prop()
  completedAt?: Date;

  @Prop()
  durationMs?: number;

  @Prop()
  summary?: string;

  @Prop()
  error?: string;

  @Prop(raw({
    totalTasks: { type: Number, default: 0 },
    completedTasks: { type: Number, default: 0 },
    failedTasks: { type: Number, default: 0 },
    waitingHumanTasks: { type: Number, default: 0 },
  }))
  stats: {
    totalTasks: number;
    completedTasks: number;
    failedTasks: number;
    waitingHumanTasks: number;
  };

  @Prop({ type: Object })
  metadata?: Record<string, unknown>;
}

export const OrchestrationRunSchema = SchemaFactory.createForClass(OrchestrationRun);

OrchestrationRunSchema.index({ planId: 1, startedAt: -1 });
OrchestrationRunSchema.index({ scheduleId: 1, startedAt: -1 });
OrchestrationRunSchema.index({ status: 1 });
OrchestrationRunSchema.index({ projectId: 1, startedAt: -1 });
