import { Prop, Schema, SchemaFactory, raw } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type OrchestrationPlanDocument = OrchestrationPlan & Document;

export type OrchestrationMode = 'sequential' | 'parallel' | 'hybrid';
export type OrchestrationPlanStatus = 'draft' | 'planned' | 'running' | 'paused' | 'completed' | 'failed';

@Schema({ timestamps: true, collection: 'orchestration_plans' })
export class OrchestrationPlan {
  @Prop()
  id?: string;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  sourcePrompt: string;

  @Prop({ enum: ['draft', 'planned', 'running', 'paused', 'completed', 'failed'], default: 'planned' })
  status: OrchestrationPlanStatus;

  @Prop(raw({
    plannerAgentId: { type: String },
    mode: { type: String, enum: ['sequential', 'parallel', 'hybrid'], default: 'sequential' },
  }))
  strategy: {
    plannerAgentId?: string;
    mode: OrchestrationMode;
  };

  @Prop({ type: [String], default: [] })
  taskIds: string[];

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

  @Prop()
  createdBy?: string;

  @Prop({ type: Object })
  metadata?: Record<string, any>;
}

export const OrchestrationPlanSchema = SchemaFactory.createForClass(OrchestrationPlan);

OrchestrationPlanSchema.index({ createdAt: -1 });
OrchestrationPlanSchema.index({ status: 1 });
