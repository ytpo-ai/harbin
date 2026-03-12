import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type EiOpenCodeRunSyncBatchDocument = EiOpenCodeRunSyncBatch & Document;

@Schema({ timestamps: true, collection: 'ei_opencode_run_sync_batches' })
export class EiOpenCodeRunSyncBatch {
  @Prop({ required: true })
  syncBatchId: string;

  @Prop({ required: true })
  runId: string;

  @Prop({ required: true })
  envId: string;

  @Prop({ required: true })
  nodeId: string;

  @Prop({ required: true })
  agentId: string;

  @Prop()
  roleCode?: string;

  @Prop()
  runStatus?: string;

  @Prop({ type: Date })
  runStartedAt?: Date;

  @Prop({ type: Date })
  runCompletedAt?: Date;

  @Prop({ required: true, default: 0 })
  eventCount: number;

  @Prop()
  minSequence?: number;

  @Prop()
  maxSequence?: number;

  @Prop({ type: Date })
  firstEventAt?: Date;

  @Prop({ type: Date })
  lastEventAt?: Date;

  @Prop({ required: true, enum: ['received', 'duplicate'], default: 'received' })
  status: 'received' | 'duplicate';

  @Prop({ type: Object, required: true })
  payload: Record<string, unknown>;

  createdAt?: Date;
  updatedAt?: Date;
}

export const EiOpenCodeRunSyncBatchSchema = SchemaFactory.createForClass(EiOpenCodeRunSyncBatch);

EiOpenCodeRunSyncBatchSchema.index({ runId: 1, syncBatchId: 1 }, { unique: true });
EiOpenCodeRunSyncBatchSchema.index({ status: 1, updatedAt: -1 });
EiOpenCodeRunSyncBatchSchema.index({ envId: 1, nodeId: 1, createdAt: -1 });
