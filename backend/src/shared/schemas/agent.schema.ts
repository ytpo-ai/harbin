import { Prop, Schema, SchemaFactory, raw } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AgentDocument = Agent & Document;

@Schema({ timestamps: true })
export class Agent {
  @Prop()
  id?: string;

  @Prop()
  createdAt?: Date;

  @Prop()
  updatedAt?: Date;
  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  type: string;

  @Prop({ required: true })
  description: string;

  @Prop(raw({
    id: { type: String, required: true },
    name: { type: String, required: true },
    provider: { type: String, required: true },
    model: { type: String, required: true },
    maxTokens: { type: Number, required: true },
    temperature: { type: Number },
    topP: { type: Number },
  }))
  model: {
    id: string;
    name: string;
    provider: string;
    model: string;
    maxTokens: number;
    temperature?: number;
    topP?: number;
  };

  @Prop({ type: [String], default: [] })
  capabilities: string[];

  @Prop({ required: true })
  systemPrompt: string;

  @Prop({ default: true })
  isActive: boolean;
}

export const AgentSchema = SchemaFactory.createForClass(Agent);