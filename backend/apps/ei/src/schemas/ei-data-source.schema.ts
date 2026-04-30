import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type EiDataSourceDocument = EiDataSource & Document;

export type EiDataSourceType = 'api' | 'rss' | 'web_scrape' | 'manual';
export type EiDataCollectFrequency = 'hourly' | 'daily' | 'weekly' | 'monthly';
export type EiDataSourceStatus = 'active' | 'paused' | 'error' | 'archived';

export type EiDataSourceConfig = {
  url?: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  params?: Record<string, string>;
  body?: unknown;
  selector?: string;
  dataMapping?: Record<string, string>;
};

export type EiDataSourceStatistics = {
  totalCollections: number;
  successCount: number;
  errorCount: number;
  lastSuccessAt?: Date;
};

@Schema({ timestamps: true, collection: 'ei_data_sources' })
export class EiDataSource {
  @Prop({ required: true })
  name: string;

  @Prop({ default: '' })
  description: string;

  @Prop({ required: true, index: true })
  projectId: string;

  @Prop({ type: String, enum: ['api', 'rss', 'web_scrape', 'manual'], required: true })
  sourceType: EiDataSourceType;

  @Prop({ type: Object, required: true })
  config: EiDataSourceConfig;

  @Prop({ type: String, enum: ['hourly', 'daily', 'weekly', 'monthly'], default: 'daily' })
  collectFrequency: EiDataCollectFrequency;

  @Prop()
  cronExpression?: string;

  @Prop({ index: true })
  scheduleId?: string;

  @Prop()
  executorAgentId?: string;

  @Prop()
  executorAgentName?: string;

  @Prop({ type: String, enum: ['active', 'paused', 'error', 'archived'], default: 'active' })
  status: EiDataSourceStatus;

  @Prop()
  lastCollectedAt?: Date;

  @Prop()
  lastError?: string;

  @Prop()
  requirementId?: string;

  @Prop()
  outlineSectionId?: string;

  @Prop()
  discussionSpaceId?: string;

  @Prop({ type: Object, default: { totalCollections: 0, successCount: 0, errorCount: 0 } })
  statistics: EiDataSourceStatistics;

  @Prop({ default: true })
  notifyDiscussion?: boolean;

  @Prop({ default: 1 })
  notifyThreshold?: number;

  createdAt?: Date;
  updatedAt?: Date;
}

export const EiDataSourceSchema = SchemaFactory.createForClass(EiDataSource);

EiDataSourceSchema.index({ projectId: 1, status: 1 });
EiDataSourceSchema.index({ scheduleId: 1 });
EiDataSourceSchema.index({ collectFrequency: 1, status: 1 });
