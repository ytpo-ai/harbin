import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AgentProfileDocument = AgentProfile & Document;

@Schema({ timestamps: true })
export class AgentProfile {
  @Prop({ required: true, unique: true })
  roleCode: string;

  @Prop({ required: true })
  role: string;

  @Prop({ type: [String], default: [] })
  tools: string[];

  @Prop({ type: [String], default: [] })
  capabilities: string[];

  @Prop({ default: false })
  exposed: boolean;

  @Prop({ default: '' })
  description?: string;
}

export const AgentProfileSchema = SchemaFactory.createForClass(AgentProfile);
