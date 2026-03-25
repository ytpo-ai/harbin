import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type EiProjectStatisticsSnapshotDocument = EiProjectStatisticsSnapshot & Document;

export type EiStatisticsSnapshotStatus = 'running' | 'success' | 'failed';
export type EiStatisticsTokenMode = 'estimate' | 'exact';

export type EiStatisticsTopLineFile = {
  filePath: string;
  lines: number;
  bytes: number;
};

export type EiStatisticsProjectRow = {
  projectId: string;
  projectName: string;
  source: 'workspace' | 'ei_project';
  metricType: 'docs' | 'frontend' | 'backend';
  rootPath: string;
  fileCount: number;
  bytes: number;
  lines: number;
  tokens?: number;
  tsCount?: number;
  tsxCount?: number;
  testFileCount?: number;
  topLineFiles?: EiStatisticsTopLineFile[];
  error?: string;
};

export type EiStatisticsSummary = {
  totalDocsBytes: number;
  totalDocsTokens: number;
  totalDocsLines: number;
  totalDocsFileCount: number;
  totalFrontendBytes: number;
  totalFrontendLines: number;
  totalFrontendFileCount: number;
  totalBackendBytes: number;
  totalBackendLines: number;
  totalBackendFileCount: number;
  grandTotalBytes: number;
  projectCount: number;
  successCount: number;
  failureCount: number;
};

@Schema({ timestamps: true, collection: 'ei_project_statistics_snapshots' })
export class EiProjectStatisticsSnapshot {
  @Prop({ required: true, unique: true })
  snapshotId: string;

  @Prop({ required: true, enum: ['running', 'success', 'failed'], default: 'running' })
  status: EiStatisticsSnapshotStatus;

  @Prop({ required: true, enum: ['all', 'docs', 'frontend', 'backend'], default: 'all' })
  scope: 'all' | 'docs' | 'frontend' | 'backend';

  @Prop({ required: true, enum: ['estimate', 'exact'], default: 'estimate' })
  tokenMode: EiStatisticsTokenMode;

  @Prop({ type: [String], default: [] })
  requestedProjectIds: string[];

  @Prop()
  triggeredBy?: string;

  @Prop({ type: Date, required: true })
  startedAt: Date;

  @Prop({ type: Date })
  completedAt?: Date;

  @Prop({ type: [Object], default: [] })
  projects: EiStatisticsProjectRow[];

  @Prop({ type: Object, default: {} })
  summary: EiStatisticsSummary;

  @Prop({ type: [String], default: [] })
  errors: string[];

  createdAt?: Date;
  updatedAt?: Date;
}

export const EiProjectStatisticsSnapshotSchema = SchemaFactory.createForClass(EiProjectStatisticsSnapshot);

EiProjectStatisticsSnapshotSchema.index({ snapshotId: 1 }, { unique: true });
EiProjectStatisticsSnapshotSchema.index({ status: 1, createdAt: -1 });
EiProjectStatisticsSnapshotSchema.index({ completedAt: -1 });
