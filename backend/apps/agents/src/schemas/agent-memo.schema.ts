import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AgentMemoDocument = AgentMemo & Document;

export type MemoType = 'knowledge' | 'behavior' | 'todo';
export type MemoTodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';
export type MemoKind = 'identity' | 'todo' | 'topic';

@Schema({ timestamps: true })
export class AgentMemo {
  @Prop({ required: true, unique: true })
  id: string;

  @Prop({ required: true, index: true })
  agentId: string;

  @Prop({ default: 'general', index: true })
  category: string;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true, lowercase: true, trim: true })
  slug: string;

  @Prop({ required: true })
  content: string;

  @Prop({ enum: ['identity', 'todo', 'topic'], default: 'topic', index: true })
  memoKind: MemoKind;

  @Prop({ enum: ['knowledge', 'behavior', 'todo'], default: 'knowledge', index: true })
  memoType: MemoType;

  @Prop({ enum: ['pending', 'in_progress', 'completed', 'cancelled'] })
  todoStatus?: MemoTodoStatus;

  @Prop({ type: [String], default: [] })
  tags: string[];

  @Prop({ type: [String], default: [] })
  contextKeywords: string[];

  @Prop()
  taskId?: string;

  @Prop({ index: true })
  topic?: string;

  @Prop({ default: 'agent' })
  source: string;

  @Prop({ default: 0 })
  accessCount: number;

  @Prop()
  lastAccessedAt?: Date;

  @Prop()
  createdAt?: Date;

  @Prop()
  updatedAt?: Date;
}

export const AgentMemoSchema = SchemaFactory.createForClass(AgentMemo);

AgentMemoSchema.index({ agentId: 1, category: 1, updatedAt: -1 });
AgentMemoSchema.index({ agentId: 1, memoType: 1, todoStatus: 1, updatedAt: -1 });
AgentMemoSchema.index({ agentId: 1, memoKind: 1, updatedAt: -1 });
AgentMemoSchema.index({ agentId: 1, memoKind: 1, topic: 1 }, { unique: false });
AgentMemoSchema.index({ agentId: 1, taskId: 1 });
AgentMemoSchema.index({ agentId: 1, slug: 1 }, { unique: true });
AgentMemoSchema.index({ title: 'text', content: 'text', tags: 'text', category: 'text' });
