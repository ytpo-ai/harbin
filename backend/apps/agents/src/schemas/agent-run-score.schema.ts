import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AgentRunScoreDocument = AgentRunScore & Document;

@Schema({ _id: false })
export class AgentRunScoreDeduction {
  @Prop({ required: true })
  ruleId: string;

  @Prop({ required: true })
  points: number;

  @Prop({ required: true })
  round: number;

  @Prop()
  toolId?: string;

  @Prop()
  detail?: string;

  @Prop({ required: true, default: Date.now })
  timestamp: Date;
}

@Schema({ timestamps: true, collection: 'agent_run_scores' })
export class AgentRunScore {
  @Prop({ required: true, unique: true })
  id: string;

  @Prop({ required: true, unique: true })
  runId: string;

  @Prop({ required: true })
  agentId: string;

  @Prop()
  taskId?: string;

  @Prop()
  sessionId?: string;

  @Prop({ required: true })
  score: number;

  @Prop({ required: true, default: 100 })
  baseScore: number;

  @Prop({ required: true, default: 0 })
  totalDeductions: number;

  @Prop({
    type: {
      totalRounds: { type: Number, default: 0 },
      totalToolCalls: { type: Number, default: 0 },
      successfulToolCalls: { type: Number, default: 0 },
      failedToolCalls: { type: Number, default: 0 },
    },
    required: true,
  })
  stats: {
    totalRounds: number;
    totalToolCalls: number;
    successfulToolCalls: number;
    failedToolCalls: number;
  };

  @Prop({ type: Object, default: {} })
  deductionsByRule: Record<string, { count: number; totalPoints: number }>;

  @Prop({ type: [AgentRunScoreDeduction], default: [] })
  deductions: AgentRunScoreDeduction[];

  @Prop({ required: true, default: '1.0' })
  ruleVersion: string;
}

export const AgentRunScoreSchema = SchemaFactory.createForClass(AgentRunScore);

AgentRunScoreSchema.index({ runId: 1 }, { unique: true, name: 'uk_runId' });
AgentRunScoreSchema.index({ id: 1 }, { unique: true, name: 'uk_id' });
AgentRunScoreSchema.index({ agentId: 1, createdAt: -1 }, { name: 'idx_agent_created' });
AgentRunScoreSchema.index({ score: 1, createdAt: -1 }, { name: 'idx_score' });
