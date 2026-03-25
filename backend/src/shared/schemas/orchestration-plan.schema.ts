import { Prop, Schema, SchemaFactory, raw } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type OrchestrationPlanDocument = OrchestrationPlan & Document;

export type OrchestrationMode = 'sequential' | 'parallel' | 'hybrid';
export type OrchestrationDomainType = 'general' | 'development' | 'research';
export type OrchestrationRunMode = 'once' | 'multi';
export type OrchestrationPlanStatus =
  | 'draft'
  | 'drafting'
  | 'planned'
  | 'production'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed';
export type OrchestrationGenerationMode = 'batch' | 'incremental';

export interface OrchestrationGenerationConfig {
  maxRetries: number;
  maxTotalFailures: number;
  maxCostTokens: number;
  maxTasks: number;
}

export interface OrchestrationGenerationState {
  currentStep: number;
  totalGenerated: number;
  totalRetries: number;
  consecutiveFailures: number;
  totalFailures: number;
  totalCost: number;
  isComplete: boolean;
  lastError?: string;
}

@Schema({ timestamps: true, collection: 'orchestration_plans' })
export class OrchestrationPlan {
  @Prop()
  id?: string;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  sourcePrompt: string;

  @Prop({
    enum: ['draft', 'drafting', 'planned', 'production', 'running', 'paused', 'completed', 'failed'],
    default: 'planned',
  })
  status: OrchestrationPlanStatus;

  @Prop(raw({
    plannerAgentId: { type: String },
    mode: { type: String, enum: ['sequential', 'parallel', 'hybrid'], default: 'sequential' },
    runMode: { type: String, enum: ['once', 'multi'], default: 'multi' },
  }))
  strategy: {
    plannerAgentId?: string;
    mode: OrchestrationMode;
    runMode: OrchestrationRunMode;
  };

  @Prop({ type: [String], default: [] })
  taskIds: string[];

  @Prop()
  lastRunId?: string;

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

  @Prop({ enum: ['general', 'development', 'research'], default: 'general', required: true })
  domainType: OrchestrationDomainType;

  @Prop({ enum: ['batch', 'incremental'], default: 'incremental' })
  generationMode: OrchestrationGenerationMode;

  @Prop(raw({
    maxRetries: { type: Number, default: 3 },
    maxTotalFailures: { type: Number, default: 6 },
    maxCostTokens: { type: Number, default: 500000 },
    maxTasks: { type: Number, default: 15 },
  }))
  generationConfig?: OrchestrationGenerationConfig;

  @Prop(raw({
    currentStep: { type: Number, default: 0 },
    totalGenerated: { type: Number, default: 0 },
    totalRetries: { type: Number, default: 0 },
    consecutiveFailures: { type: Number, default: 0 },
    totalFailures: { type: Number, default: 0 },
    totalCost: { type: Number, default: 0 },
    isComplete: { type: Boolean, default: false },
    lastError: { type: String },
  }))
  generationState?: OrchestrationGenerationState;
}

export const OrchestrationPlanSchema = SchemaFactory.createForClass(OrchestrationPlan);

OrchestrationPlanSchema.index({ createdAt: -1 });
OrchestrationPlanSchema.index({ status: 1 });
