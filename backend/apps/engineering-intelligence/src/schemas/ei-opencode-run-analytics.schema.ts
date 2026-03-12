import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type EiOpenCodeRunAnalyticsDocument = EiOpenCodeRunAnalytics & Document;

@Schema({ timestamps: true, collection: 'ei_opencode_run_analytics' })
export class EiOpenCodeRunAnalytics {
  @Prop({ required: true, unique: true })
  runId: string;

  @Prop({ required: true })
  agentId: string;

  @Prop()
  roleCode?: string;

  @Prop()
  runStatus?: string;

  @Prop({ required: true })
  envId: string;

  @Prop({ required: true })
  nodeId: string;

  @Prop({ type: Date })
  startedAt?: Date;

  @Prop({ type: Date })
  completedAt?: Date;

  @Prop({ required: true, default: 0 })
  durationMs: number;

  @Prop({ required: true, default: 0 })
  eventCount: number;

  @Prop({ required: true, default: 0 })
  firstSequence: number;

  @Prop({ required: true, default: 0 })
  lastSequence: number;

  @Prop({ required: true, default: 0 })
  uniqueEventTypeCount: number;

  @Prop({ type: Object, default: {} })
  eventTypeBreakdown: Record<string, number>;

  @Prop({ required: true })
  lastSyncBatchId: string;

  @Prop({ type: Date, required: true })
  lastSyncedAt: Date;

  createdAt?: Date;
  updatedAt?: Date;
}

export const EiOpenCodeRunAnalyticsSchema = SchemaFactory.createForClass(EiOpenCodeRunAnalytics);

EiOpenCodeRunAnalyticsSchema.index({ agentId: 1, updatedAt: -1 });
EiOpenCodeRunAnalyticsSchema.index({ envId: 1, nodeId: 1, updatedAt: -1 });
