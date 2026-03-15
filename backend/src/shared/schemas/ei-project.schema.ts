import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type RdProjectDocument = RdProject & Document;

export enum RdProjectStatus {
  ACTIVE = 'active',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  ARCHIVED = 'archived',
}

export enum RdProjectSourceType {
  LOCAL = 'local',
  OPENCODE = 'opencode',
  GITHUB = 'github',
}

@Schema({ timestamps: true, collection: 'ei_projects' })
export class RdProject {
  @Prop({ required: true })
  name: string;

  @Prop()
  description: string;

  @Prop({ type: String, enum: RdProjectStatus, default: RdProjectStatus.ACTIVE })
  status: RdProjectStatus;

  @Prop({ type: String, enum: RdProjectSourceType, default: RdProjectSourceType.OPENCODE })
  sourceType: RdProjectSourceType;

  @Prop({ type: [{ type: Types.ObjectId, ref: 'Employee' }] })
  members: Types.ObjectId[];

  @Prop({ type: Types.ObjectId, ref: 'Employee' })
  manager: Types.ObjectId;

  // OpenCode 集成配置
  @Prop()
  opencodeProjectPath: string;

  @Prop()
  opencodeSessionId: string;

  @Prop()
  opencodeProjectId: string;

  @Prop()
  opencodeEndpointRef?: string;

  @Prop()
  syncedFromAgentId: string;

  @Prop({ default: true })
  createdBySync: boolean;

  @Prop()
  localPath?: string;

  @Prop({ type: Types.ObjectId, ref: 'RdProject' })
  bindingLocalProjectId?: Types.ObjectId;

  @Prop({ type: [{ type: Types.ObjectId, ref: 'RdProject' }], default: [] })
  opencodeBindingIds?: Types.ObjectId[];

  @Prop({ type: Types.ObjectId, ref: 'RdProject' })
  githubBindingId?: Types.ObjectId;

  @Prop({ type: Object })
  opencodeConfig: Record<string, any>;

  @Prop()
  repositoryUrl: string;

  @Prop()
  githubOwner?: string;

  @Prop()
  githubRepo?: string;

  @Prop()
  githubApiKeyId?: string;

  @Prop()
  branch: string;

  @Prop()
  startDate: Date;

  @Prop()
  endDate: Date;

  @Prop({ type: Object })
  metadata: Record<string, any>;
}

export const RdProjectSchema = SchemaFactory.createForClass(RdProject);

RdProjectSchema.index({ syncedFromAgentId: 1, opencodeProjectPath: 1 }, { unique: true, sparse: true });
RdProjectSchema.index({ syncedFromAgentId: 1, opencodeProjectId: 1 }, { unique: true, sparse: true });
RdProjectSchema.index(
  { bindingLocalProjectId: 1, sourceType: 1 },
  { unique: true, partialFilterExpression: { sourceType: RdProjectSourceType.GITHUB, bindingLocalProjectId: { $exists: true } } },
);
