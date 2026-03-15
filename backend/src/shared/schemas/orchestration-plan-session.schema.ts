import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type PlanSessionDocument = PlanSession & Document;

@Schema({ _id: false })
export class PlanTaskSnapshot {
  @Prop({ required: true })
  taskId: string;

  @Prop({ required: true })
  order: number;

  @Prop({ required: true })
  title: string;

  @Prop({ enum: ['pending', 'assigned', 'in_progress', 'blocked', 'waiting_human', 'completed', 'failed', 'cancelled'], default: 'pending' })
  status: 'pending' | 'assigned' | 'in_progress' | 'blocked' | 'waiting_human' | 'completed' | 'failed' | 'cancelled';

  @Prop()
  input?: string;

  @Prop()
  output?: string;

  @Prop()
  error?: string;

  @Prop()
  executorType?: 'agent' | 'employee' | 'unassigned';

  @Prop()
  executorId?: string;

  @Prop()
  agentSessionId?: string;

  @Prop()
  agentRunId?: string;

  @Prop({ default: Date.now })
  updatedAt: Date;
}

const PlanTaskSnapshotSchema = SchemaFactory.createForClass(PlanTaskSnapshot);

@Schema({ timestamps: true, collection: 'orchestration_plan_sessions' })
export class PlanSession {
  @Prop({ required: true, unique: true })
  planId: string;

  @Prop({ required: true })
  title: string;

  @Prop({ enum: ['active', 'completed', 'failed', 'cancelled'], default: 'active' })
  status: 'active' | 'completed' | 'failed' | 'cancelled';

  @Prop({ type: [PlanTaskSnapshotSchema], default: [] })
  tasks: PlanTaskSnapshot[];

  @Prop({ type: Object })
  metadata?: Record<string, any>;
}

export const PlanSessionSchema = SchemaFactory.createForClass(PlanSession);

PlanSessionSchema.index({ createdAt: -1 });
PlanSessionSchema.index({ planId: 1 }, { unique: true });
