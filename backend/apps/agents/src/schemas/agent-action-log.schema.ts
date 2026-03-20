import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

export type AgentActionLogDocument = AgentActionLog & Document;

export type AgentActionContextType = 'chat' | 'orchestration';
export type AgentActionStatus =
  | 'started'
  | 'completed'
  | 'failed'
  | 'paused'
  | 'resumed'
  | 'cancelled'
  | 'pending'
  | 'running'
  | 'asked'
  | 'replied'
  | 'denied'
  | 'step_started'
  | 'unknown';

@Schema({ timestamps: { createdAt: true, updatedAt: false }, collection: 'agent_action_logs' })
export class AgentActionLog {
  @Prop({ required: true, unique: true, default: uuidv4 })
  id: string;

  @Prop({ required: true })
  agentId: string;

  @Prop({ required: true, enum: ['chat', 'orchestration'] })
  contextType: AgentActionContextType;

  @Prop()
  contextId?: string;

  @Prop({ required: true })
  action: string;

  @Prop({ sparse: true })
  sourceEventId?: string;

  @Prop({ type: Object })
  details?: Record<string, unknown>;

  @Prop({ default: Date.now })
  timestamp: Date;
}

export const AgentActionLogSchema = SchemaFactory.createForClass(AgentActionLog);

AgentActionLogSchema.index({ agentId: 1, timestamp: -1 });
AgentActionLogSchema.index({ contextType: 1, contextId: 1, timestamp: -1 });
AgentActionLogSchema.index({ action: 1, timestamp: -1 });
AgentActionLogSchema.index({ 'details.status': 1, timestamp: -1 });
AgentActionLogSchema.index({ sourceEventId: 1 }, { unique: true, sparse: true });
