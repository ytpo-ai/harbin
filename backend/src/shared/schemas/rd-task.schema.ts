import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type RdTaskDocument = RdTask & Document;

export enum RdTaskStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export enum RdTaskPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  URGENT = 'urgent',
}

@Schema({ timestamps: true })
export class RdTask {
  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  description: string;

  @Prop({ type: String, enum: RdTaskStatus, default: RdTaskStatus.PENDING })
  status: RdTaskStatus;

  @Prop({ type: String, enum: RdTaskPriority, default: RdTaskPriority.MEDIUM })
  priority: RdTaskPriority;

  @Prop({ type: Types.ObjectId, ref: 'Employee', required: true })
  assignee: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Employee' })
  createdBy: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true })
  organization: Types.ObjectId;

  // OpenCode 相关字段
  @Prop()
  opencodeSessionId: string;

  @Prop()
  opencodeProjectPath: string;

  @Prop({ type: Object })
  opencodeConfig: Record<string, any>;

  @Prop({ type: [{ type: Object }] })
  opencodeMessages: any[];

  @Prop()
  lastOpencodeResponse: string;

  // 任务结果
  @Prop({ type: Object })
  result: Record<string, any>;

  @Prop()
  completedAt: Date;

  @Prop()
  startedAt: Date;

  @Prop()
  estimatedHours: number;

  @Prop()
  actualHours: number;

  @Prop({ type: [String] })
  tags: string[];

  @Prop({ type: Object })
  metadata: Record<string, any>;
}

export const RdTaskSchema = SchemaFactory.createForClass(RdTask);
