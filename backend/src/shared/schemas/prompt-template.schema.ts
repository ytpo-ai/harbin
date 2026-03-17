import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type PromptTemplateDocument = PromptTemplate & Document;

export type PromptTemplateStatus = 'draft' | 'published' | 'archived';

@Schema({ collection: 'prompt_templates', timestamps: false })
export class PromptTemplate {
  @Prop({ required: true, trim: true })
  scene: string;

  @Prop({ required: true, trim: true })
  role: string;

  @Prop({ required: true, min: 1 })
  version: number;

  @Prop({ required: true, enum: ['draft', 'published', 'archived'], default: 'draft' })
  status: PromptTemplateStatus;

  @Prop({ required: true })
  content: string;

  @Prop({ trim: true })
  updatedBy?: string;

  @Prop({ required: true, default: () => new Date() })
  updatedAt: Date;
}

export const PromptTemplateSchema = SchemaFactory.createForClass(PromptTemplate);

PromptTemplateSchema.index({ scene: 1, role: 1, status: 1, version: -1 });
PromptTemplateSchema.index({ scene: 1, role: 1, version: 1 }, { unique: true });
