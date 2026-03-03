import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AgentMemoDocument = AgentMemo & Document;

export type MemoType = 'knowledge' | 'standard';
export type MemoKind = 'identity' | 'todo' | 'topic' | 'history' | 'draft' | 'custom';

@Schema({ timestamps: true })
export class AgentMemo {
  @Prop({ required: true, unique: true })
  id: string;

  @Prop({ required: true, index: true })
  agentId: string;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true, lowercase: true, trim: true })
  slug: string;

  @Prop({ required: true })
  content: string;

  @Prop({ required: true, default: 1 })
  version: number;

  @Prop({ enum: ['identity', 'todo', 'topic', 'history', 'draft', 'custom'], default: 'topic', index: true })
  memoKind: MemoKind;

  @Prop({ enum: ['knowledge', 'standard'], default: 'knowledge', index: true })
  memoType: MemoType;

  @Prop({ type: Object, default: {} })
  payload?: Record<string, any>;

  @Prop({ type: [String], default: [] })
  tags: string[];

  @Prop({ type: [String], default: [] })
  contextKeywords: string[];

  @Prop({ default: 'agent' })
  source: string;

  @Prop()
  createdAt?: Date;

  @Prop()
  updatedAt?: Date;
}

export const AgentMemoSchema = SchemaFactory.createForClass(AgentMemo);

AgentMemoSchema.index({ agentId: 1, memoType: 1, updatedAt: -1 });
AgentMemoSchema.index({ agentId: 1, memoKind: 1, updatedAt: -1 });
AgentMemoSchema.index({ agentId: 1, slug: 1 }, { unique: true });
AgentMemoSchema.index({ agentId: 1, 'payload.topic': 1, updatedAt: -1 });
AgentMemoSchema.index({ title: 'text', content: 'text', tags: 'text', contextKeywords: 'text' });
