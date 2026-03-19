import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type PromptTemplateAuditDocument = PromptTemplateAudit & Document;

export type PromptTemplateAuditAction = 'create_draft' | 'publish' | 'unpublish' | 'rollback';

@Schema({ collection: 'prompt_template_audits', timestamps: false })
export class PromptTemplateAudit {
  @Prop({ required: true, trim: true })
  scene: string;

  @Prop({ required: true, trim: true })
  role: string;

  @Prop({ required: true, enum: ['create_draft', 'publish', 'unpublish', 'rollback'] })
  action: PromptTemplateAuditAction;

  @Prop({ required: true, min: 1 })
  version: number;

  @Prop({ min: 1 })
  fromVersion?: number;

  @Prop({ trim: true })
  operatorId?: string;

  @Prop({ trim: true })
  summary?: string;

  @Prop({ required: true, default: () => new Date() })
  createdAt: Date;
}

export const PromptTemplateAuditSchema = SchemaFactory.createForClass(PromptTemplateAudit);

PromptTemplateAuditSchema.index({ scene: 1, role: 1, createdAt: -1 });
