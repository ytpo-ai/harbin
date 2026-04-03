import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type IncubationProjectDocument = IncubationProject & Document;

export enum IncubationProjectStatus {
  ACTIVE = 'active',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  ARCHIVED = 'archived',
}

@Schema({ timestamps: true, collection: 'incubation_projects' })
export class IncubationProject {
  @Prop({ required: true })
  name: string;

  @Prop({ default: '' })
  description: string;

  @Prop()
  goal?: string; // 项目目标

  @Prop({
    type: String,
    enum: IncubationProjectStatus,
    default: IncubationProjectStatus.ACTIVE,
  })
  status: IncubationProjectStatus;

  @Prop()
  createdBy?: string; // 创建者（Employee ID）

  @Prop()
  startDate?: Date;

  @Prop()
  endDate?: Date;

  @Prop({ type: Object })
  metadata?: Record<string, any>;

  createdAt?: Date;
  updatedAt?: Date;
}

export const IncubationProjectSchema = SchemaFactory.createForClass(IncubationProject);

IncubationProjectSchema.index({ status: 1, createdAt: -1 });
IncubationProjectSchema.index({ createdBy: 1 });
