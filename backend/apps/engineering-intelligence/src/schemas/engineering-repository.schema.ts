import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type EngineeringRepositoryDocument = EngineeringRepository & Document;

@Schema({ timestamps: true })
export class EngineeringRepository {
  @Prop({ required: true })
  repositoryUrl: string;

  @Prop({ required: true })
  owner: string;

  @Prop({ required: true })
  repo: string;

  @Prop({ default: 'main' })
  branch: string;

  @Prop({ type: Object })
  lastSummary?: Record<string, any>;

  @Prop()
  lastSummarizedAt?: Date;

  @Prop()
  lastError?: string;
}

export const EngineeringRepositorySchema = SchemaFactory.createForClass(EngineeringRepository);

EngineeringRepositorySchema.index({ repositoryUrl: 1 }, { unique: true });
