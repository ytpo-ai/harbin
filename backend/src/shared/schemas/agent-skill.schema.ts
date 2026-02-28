import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AgentSkillDocument = AgentSkill & Document;

export type SkillProficiency = 'beginner' | 'intermediate' | 'advanced' | 'expert';

@Schema({ timestamps: true })
export class AgentSkill {
  @Prop({ required: true, unique: true })
  id: string;

  @Prop({ required: true, index: true })
  agentId: string;

  @Prop({ required: true, index: true })
  skillId: string;

  @Prop({ enum: ['beginner', 'intermediate', 'advanced', 'expert'], default: 'beginner' })
  proficiencyLevel: SkillProficiency;

  @Prop({ default: true })
  enabled: boolean;

  @Prop({ default: 'AgentSkillManager' })
  assignedBy: string;

  @Prop()
  note?: string;
}

export const AgentSkillSchema = SchemaFactory.createForClass(AgentSkill);

AgentSkillSchema.index({ agentId: 1, skillId: 1 }, { unique: true });
