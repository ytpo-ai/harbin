import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AgentMessageDocument = AgentMessage & Document;

@Schema({ timestamps: true, collection: 'agent_messages' })
export class AgentMessage {
  @Prop({ required: true, unique: true })
  id: string;

  @Prop({ required: true })
  runId: string;

  @Prop({ required: true })
  agentId: string;

  @Prop()
  sessionId?: string;

  @Prop()
  taskId?: string;

  @Prop()
  parentMessageId?: string;

  @Prop({ required: true, enum: ['system', 'user', 'assistant', 'tool'] })
  role: 'system' | 'user' | 'assistant' | 'tool';

  @Prop({ required: true, default: 0 })
  sequence: number;

  @Prop({
    default: '',
    set: (value: unknown) => {
      if (value === null || value === undefined) {
        return '';
      }
      return typeof value === 'string' ? value : String(value);
    },
  })
  content: string;

  @Prop({
    required: true,
    enum: ['pending', 'streaming', 'completed', 'error'],
    default: 'completed',
  })
  status: 'pending' | 'streaming' | 'completed' | 'error';

  @Prop({ type: Object })
  metadata?: Record<string, unknown>;

  @Prop()
  modelID?: string;

  @Prop()
  providerID?: string;

  @Prop({
    enum: ['stop', 'tool-calls', 'error', 'cancelled', 'paused', 'max-rounds'],
  })
  finish?: 'stop' | 'tool-calls' | 'error' | 'cancelled' | 'paused' | 'max-rounds';

  @Prop({
    type: {
      input: { type: Number },
      output: { type: Number },
      reasoning: { type: Number },
      cacheRead: { type: Number },
      cacheWrite: { type: Number },
      total: { type: Number },
    },
    _id: false,
  })
  tokens?: {
    input?: number;
    output?: number;
    reasoning?: number;
    cacheRead?: number;
    cacheWrite?: number;
    total?: number;
  };

  @Prop({ type: Number })
  cost?: number;

  @Prop({ type: Number })
  stepIndex?: number;
}

export const AgentMessageSchema = SchemaFactory.createForClass(AgentMessage);

AgentMessageSchema.pre('validate', function ensureContent(this: AgentMessageDocument, next) {
  if (this.content === null || this.content === undefined) {
    this.content = '';
  }
  next();
});

AgentMessageSchema.index({ runId: 1, sequence: 1 });
AgentMessageSchema.index({ sessionId: 1, sequence: 1 });
AgentMessageSchema.index({ taskId: 1, sequence: 1 });
AgentMessageSchema.index({ runId: 1, stepIndex: 1 });
AgentMessageSchema.index({ parentMessageId: 1 });
