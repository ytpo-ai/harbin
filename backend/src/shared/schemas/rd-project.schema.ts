import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type RdProjectDocument = RdProject & Document;

export enum RdProjectStatus {
  ACTIVE = 'active',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  ARCHIVED = 'archived',
}

@Schema({ timestamps: true })
export class RdProject {
  @Prop({ required: true })
  name: string;

  @Prop()
  description: string;

  @Prop({ type: String, enum: RdProjectStatus, default: RdProjectStatus.ACTIVE })
  status: RdProjectStatus;

  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true })
  organization: Types.ObjectId;

  @Prop({ type: [{ type: Types.ObjectId, ref: 'Employee' }] })
  members: Types.ObjectId[];

  @Prop({ type: Types.ObjectId, ref: 'Employee' })
  manager: Types.ObjectId;

  // OpenCode 集成配置
  @Prop()
  opencodeProjectPath: string;

  @Prop()
  opencodeSessionId: string;

  @Prop({ type: Object })
  opencodeConfig: Record<string, any>;

  @Prop()
  repositoryUrl: string;

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
