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

  @Prop({ required: true, trim: true })
  roleId: string;

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
    reasoning: {
      type: {
        enabled: { type: Boolean, default: false },
        effort: { type: String, enum: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] },
        verbosity: { type: String, enum: ['low', 'medium', 'high'] },
      },
    },
  }))
  model: {
    id: string;
    name: string;
    provider: string;
    model: string;
    maxTokens: number;
    temperature?: number;
    topP?: number;
    reasoning?: {
      enabled: boolean;
      effort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
      verbosity?: 'low' | 'medium' | 'high';
    };
  };

  @Prop({ type: [String], default: [] })
  capabilities: string[];

  @Prop({ required: true })
  systemPrompt: string;

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ type: Object, default: {} })
  config?: Record<string, unknown>;

  @Prop({ type: [String], default: [] })
  tools: string[]; // 可使用的工具ID列表

  @Prop({ type: [String], default: [] })
  permissions: string[]; // 权限ID列表

  @Prop(raw({
    workEthic: { type: Number, default: 80 },
    creativity: { type: Number, default: 75 },
    leadership: { type: Number, default: 70 },
    teamwork: { type: Number, default: 80 }
  }))
  personality: {
    workEthic: number; // 工作伦理 0-100
    creativity: number; // 创造力 0-100
    leadership: number; // 领导力 0-100
    teamwork: number; // 团队协作 0-100
  };

  @Prop({ default: 80 })
  learningAbility: number; // 学习能力 0-100

  @Prop()
  salary?: number;

  @Prop()
  performanceScore?: number;

  @Prop()
  apiKeyId?: string; // 关联的API密钥ID
}

export const AgentSchema = SchemaFactory.createForClass(Agent);

// Create index on apiKeyId for efficient queries
AgentSchema.index({ apiKeyId: 1 });
