import { Prop, Schema, SchemaFactory, raw } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AgentSessionDocument = AgentSession & Document;

@Schema({ timestamps: true, collection: 'agent_sessions' })
export class AgentSession {
  @Prop({ required: true, unique: true })
  id: string;

  @Prop({ enum: ['meeting', 'task', 'plan', 'chat'], required: true })
  sessionType: 'meeting' | 'task' | 'plan' | 'chat';

  @Prop({ enum: ['agent', 'employee', 'system'], default: 'agent' })
  ownerType: 'agent' | 'employee' | 'system';

  @Prop({ required: true })
  ownerId: string;

  @Prop({ required: true })
  title: string;

  @Prop({ enum: ['active', 'archived', 'closed'], default: 'active' })
  status: 'active' | 'archived' | 'closed';

  @Prop({ type: [String], default: [] })
  runIds: string[];

  @Prop({ type: [String], default: [] })
  memoIds: string[];

  @Prop({ type: [String], default: [] })
  messageIds: string[];

  @Prop(raw({
    linkedPlanId: { type: String },
    orchestrationRunId: { type: String },
    currentTaskId: { type: String },
    completedTaskIds: [{ type: String }],
    linkedTaskId: { type: String },
    latestTaskInput: { type: String },
    latestTaskOutput: { type: String },
    lastRunId: { type: String },
  }))
  planContext?: {
    linkedPlanId?: string;
    orchestrationRunId?: string;
    currentTaskId?: string;
    completedTaskIds?: string[];
    linkedTaskId?: string;
    latestTaskInput?: string;
    latestTaskOutput?: string;
    lastRunId?: string;
  };

  @Prop(raw({
    meetingId: { type: String },
    agendaId: { type: String },
    meetingType: { type: String },
    latestSummary: { type: String },
  }))
  meetingContext?: {
    meetingId?: string;
    agendaId?: string;
    meetingType?: string;
    latestSummary?: string;
  };

  @Prop(raw({
    domainType: { type: String },
    description: { type: String },
    constraints: [{ type: String }],
    knowledgeRefs: [{ type: String }],
    metadata: { type: Object },
  }))
  domainContext?: {
    domainType?: string;
    description?: string;
    constraints?: string[];
    knowledgeRefs?: string[];
    metadata?: Record<string, unknown>;
  };

  @Prop({ type: Object })
  collaborationContext?: Record<string, unknown>;

  @Prop({
    type: [{
      runId: { type: String, required: true },
      taskId: { type: String },
      taskTitle: { type: String },
      objective: { type: String },
      outcome: { type: String },
      keyOutputs: [{ type: String }],
      openIssues: [{ type: String }],
      completedAt: { type: Date },
    }],
    default: [],
  })
  runSummaries: {
    runId: string;
    taskId?: string;
    taskTitle?: string;
    objective?: string;
    outcome?: string;
    keyOutputs?: string[];
    openIssues?: string[];
    completedAt?: Date;
  }[];

  @Prop({ type: Object })
  metadata?: Record<string, unknown>;

  @Prop({ default: Date.now })
  lastActiveAt: Date;

  @Prop({ type: Object })
  memoSnapshot?: {
    agentId: string;
    refreshedAt: string;
    identity: Array<{
      id: string;
      memoKind: 'identity' | 'todo' | 'topic';
      title: string;
      slug?: string;
      content: string;
      updatedAt?: string;
    }>;
    todo: Array<{
      id: string;
      memoKind: 'identity' | 'todo' | 'topic';
      title: string;
      slug?: string;
      content: string;
      updatedAt?: string;
    }>;
    topic: Array<{
      id: string;
      memoKind: 'identity' | 'todo' | 'topic';
      title: string;
      slug?: string;
      content: string;
      updatedAt?: string;
    }>;
  };
}

export const AgentSessionSchema = SchemaFactory.createForClass(AgentSession);

AgentSessionSchema.index({ ownerType: 1, ownerId: 1, createdAt: -1 });
AgentSessionSchema.index({ status: 1, lastActiveAt: -1 });
AgentSessionSchema.index({ 'planContext.linkedPlanId': 1, 'planContext.linkedTaskId': 1 });
AgentSessionSchema.index({ 'planContext.linkedPlanId': 1, ownerId: 1, sessionType: 1 });
AgentSessionSchema.index({ 'planContext.linkedPlanId': 1, 'planContext.orchestrationRunId': 1, ownerId: 1, sessionType: 1 });
