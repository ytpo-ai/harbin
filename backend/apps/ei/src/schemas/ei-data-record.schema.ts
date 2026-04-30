import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type EiDataRecordDocument = EiDataRecord & Document;

export type EiDataRecordStatus = 'success' | 'partial' | 'error';
export type EiDataCategory =
  | 'industry_timeline'
  | 'company_profile'
  | 'person_profile'
  | 'trend_data'
  | 'market_data'
  | 'regulation'
  | 'general';

@Schema({ timestamps: true, collection: 'ei_data_records' })
export class EiDataRecord {
  @Prop({ required: true, index: true })
  dataSourceId: string;

  @Prop({ required: true, index: true })
  projectId: string;

  @Prop({ required: true, type: Object })
  data: Record<string, unknown>;

  @Prop()
  rawData?: string;

  @Prop({ required: true, index: true })
  collectedAt: Date;

  @Prop()
  periodStart?: Date;

  @Prop()
  periodEnd?: Date;

  @Prop({ type: String, enum: ['success', 'partial', 'error'], default: 'success' })
  status: EiDataRecordStatus;

  @Prop()
  error?: string;

  @Prop({ type: [String], default: [] })
  tags: string[];

  @Prop({ index: true })
  outlineSectionId?: string;

  @Prop()
  discussionSpaceId?: string;

  @Prop({
    type: String,
    enum: ['industry_timeline', 'company_profile', 'person_profile', 'trend_data', 'market_data', 'regulation', 'general'],
    default: 'general',
  })
  dataCategory: EiDataCategory;

  createdAt?: Date;
  updatedAt?: Date;
}

export const EiDataRecordSchema = SchemaFactory.createForClass(EiDataRecord);

EiDataRecordSchema.index({ dataSourceId: 1, collectedAt: -1 });
EiDataRecordSchema.index({ projectId: 1, dataCategory: 1, collectedAt: -1 });
EiDataRecordSchema.index({ projectId: 1, tags: 1 });
EiDataRecordSchema.index({ outlineSectionId: 1, collectedAt: -1 });
