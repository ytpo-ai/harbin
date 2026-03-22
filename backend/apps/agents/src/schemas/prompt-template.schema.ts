import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type PromptTemplateDocument = PromptTemplate & Document;

export type PromptTemplateStatus = 'draft' | 'published' | 'archived';
export type PromptTemplateSourceType = 'github' | 'manual' | 'internal';

@Schema({ _id: false })
export class PromptTemplateSource {
  @Prop({ required: true, enum: ['github', 'manual', 'internal'] })
  type: PromptTemplateSourceType;

  @Prop({ trim: true })
  repo?: string;

  @Prop({ trim: true })
  path?: string;

  @Prop()
  importedAt?: Date;
}

export const PromptTemplateSourceSchema = SchemaFactory.createForClass(PromptTemplateSource);

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
  description?: string;

  @Prop({ trim: true })
  category?: string;

  @Prop({ type: [String], default: undefined })
  tags?: string[];

  @Prop({ type: PromptTemplateSourceSchema, required: false })
  source?: PromptTemplateSource;

  @Prop({ trim: true })
  updatedBy?: string;

  @Prop({ required: true, default: () => new Date() })
  updatedAt: Date;
}

export const PromptTemplateSchema = SchemaFactory.createForClass(PromptTemplate);

PromptTemplateSchema.index({ scene: 1, role: 1, status: 1, version: -1 });
PromptTemplateSchema.index({ scene: 1, role: 1, version: 1 }, { unique: true });
