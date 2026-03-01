import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SkillSuggestionDocument = SkillSuggestion & Document;

export type SkillSuggestionPriority = 'low' | 'medium' | 'high' | 'critical';
export type SkillSuggestionStatus = 'pending' | 'accepted' | 'rejected' | 'applied';

@Schema({ timestamps: true })
export class SkillSuggestion {
  @Prop({ required: true, unique: true })
  id: string;

  @Prop({ required: true, index: true })
  agentId: string;

  @Prop({ required: true, index: true })
  skillId: string;

  @Prop({ required: true })
  reason: string;

  @Prop({ enum: ['low', 'medium', 'high', 'critical'], default: 'medium' })
  priority: SkillSuggestionPriority;

  @Prop({ enum: ['pending', 'accepted', 'rejected', 'applied'], default: 'pending' })
  status: SkillSuggestionStatus;

  @Prop({ default: 50 })
  score: number;

  @Prop({ default: 'AgentSkillManager' })
  suggestedBy: string;

  @Prop({ type: Object })
  context?: Record<string, any>;

  @Prop()
  reviewedAt?: Date;

  @Prop()
  appliedAt?: Date;
}

export const SkillSuggestionSchema = SchemaFactory.createForClass(SkillSuggestion);

SkillSuggestionSchema.index({ agentId: 1, status: 1, createdAt: -1 });
