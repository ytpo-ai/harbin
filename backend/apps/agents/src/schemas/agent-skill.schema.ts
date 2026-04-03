import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SkillDocument = Skill & Document;

export type SkillSourceType = 'manual' | 'github' | 'web' | 'internal';
export type SkillStatus = 'active' | 'experimental' | 'deprecated' | 'disabled';

@Schema({ timestamps: true, collection: 'agent_skills' })
export class Skill {
  @Prop()
  createdAt?: Date;

  @Prop()
  updatedAt?: Date;

  @Prop({ required: true, unique: true })
  id: string;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true, lowercase: true, trim: true })
  slug: string;

  @Prop({ required: true })
  description: string;

  @Prop({ default: 'general' })
  category: string;

  @Prop({ type: [String], default: [] })
  tags: string[];

  @Prop({ enum: ['manual', 'github', 'web', 'internal'], default: 'manual' })
  sourceType: SkillSourceType;

  @Prop()
  sourceUrl?: string;

  @Prop({ default: 'system' })
  provider: string;

  @Prop({ default: '1.0.0' })
  version: string;

  @Prop({ enum: ['active', 'experimental', 'deprecated', 'disabled'], default: 'active' })
  status: SkillStatus;

  @Prop({ default: 50 })
  confidenceScore: number;

  @Prop({ default: 0 })
  usageCount: number;

  @Prop({ default: 'AgentSkillManager' })
  discoveredBy: string;

  @Prop()
  lastVerifiedAt?: Date;

  @Prop({ type: Object })
  metadata?: Record<string, any>;

  @Prop()
  content?: string;

  @Prop({ default: 'text/markdown' })
  contentType?: string;

  @Prop()
  contentHash?: string;

  @Prop({ default: 0 })
  contentSize?: number;

  @Prop()
  contentUpdatedAt?: Date;

  @Prop()
  metadataUpdatedAt?: Date;

  @Prop({
    type: {
      scene: { type: String, required: true, trim: true },
      role: { type: String, required: true, trim: true },
    },
    required: false,
  })
  promptTemplateRef?: {
    scene: string;
    role: string;
  };
}

export const SkillSchema = SchemaFactory.createForClass(Skill);

SkillSchema.index({ slug: 1, provider: 1, version: 1 }, { unique: true });
SkillSchema.index({ status: 1, category: 1 });
