import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UsageDailySnapshotDocument = UsageDailySnapshot & Document;

@Schema({ collection: 'agent_usage_daily_snapshots', timestamps: true })
export class UsageDailySnapshot {
  @Prop({ required: true, index: true })
  date: string;

  @Prop({ default: null, index: true })
  agentId?: string | null;

  @Prop({ default: null, index: true })
  modelId?: string | null;

  @Prop({
    type: {
      input: { type: Number, default: 0 },
      output: { type: Number, default: 0 },
      reasoning: { type: Number, default: 0 },
      cacheRead: { type: Number, default: 0 },
      cacheWrite: { type: Number, default: 0 },
      total: { type: Number, default: 0 },
    },
    _id: false,
    default: {},
  })
  tokens: {
    input: number;
    output: number;
    reasoning: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };

  @Prop({ type: Number, default: 0 })
  totalCost: number;

  @Prop({ type: Number, default: 0 })
  requestCount: number;

  @Prop({ type: Date })
  createdAt?: Date;

  @Prop({ type: Date })
  updatedAt?: Date;
}

export const UsageDailySnapshotSchema = SchemaFactory.createForClass(UsageDailySnapshot);

UsageDailySnapshotSchema.index({ date: 1, agentId: 1, modelId: 1 }, { unique: true });
