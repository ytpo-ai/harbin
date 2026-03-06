import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AgentSessionDocument = AgentSession & Document;

export interface AgentSessionMemoSnapshotItem {
  id: string;
  memoKind: 'identity' | 'todo' | 'topic';
  title: string;
  slug?: string;
  content: string;
  updatedAt?: string;
}

export interface AgentSessionMemoSnapshot {
  agentId: string;
  refreshedAt: string;
  identity: AgentSessionMemoSnapshotItem[];
  todo: AgentSessionMemoSnapshotItem[];
  topic: AgentSessionMemoSnapshotItem[];
}

@Schema({ timestamps: true })
export class AgentSession {
  @Prop()
  id?: string;

  @Prop({ enum: ['agent', 'employee', 'system'], required: true })
  ownerType: 'agent' | 'employee' | 'system';

  @Prop({ required: true })
  ownerId: string;

  @Prop({ required: true })
  title: string;

  @Prop({ enum: ['active', 'archived', 'closed'], default: 'active' })
  status: 'active' | 'archived' | 'closed';

  @Prop({ type: [{
    role: { type: String, enum: ['user', 'assistant', 'system'], required: true },
    content: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    metadata: { type: Object },
  }], default: [] })
  messages: {
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: Date;
    metadata?: Record<string, any>;
  }[];

  @Prop()
  linkedPlanId?: string;

  @Prop()
  linkedTaskId?: string;

  @Prop()
  contextSummary?: string;

  @Prop({ type: [String], default: [] })
  tags: string[];

  @Prop({ default: Date.now })
  lastActiveAt: Date;

  @Prop()
  expiresAt?: Date;

  @Prop({ type: Object })
  memoSnapshot?: AgentSessionMemoSnapshot;
}

export const AgentSessionSchema = SchemaFactory.createForClass(AgentSession);

AgentSessionSchema.index({ ownerType: 1, ownerId: 1, createdAt: -1 });
AgentSessionSchema.index({ status: 1, lastActiveAt: -1 });
