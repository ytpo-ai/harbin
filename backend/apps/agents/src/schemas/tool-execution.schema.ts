import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ToolExecutionDocument = ToolExecution & Document;

@Schema({ timestamps: true, collection: 'agent_tool_executions' })
export class ToolExecution {
  @Prop({ required: true, unique: true })
  id: string;

  @Prop()
  traceId?: string;

  @Prop()
  requestedToolId?: string;

  @Prop()
  resolvedToolId?: string;

  @Prop()
  executionChannel?: string;

  @Prop({ required: true })
  toolId: string;

  @Prop({ required: true })
  agentId: string;

  @Prop()
  taskId?: string;

  @Prop()
  idempotencyKey?: string;

  @Prop()
  authMode?: 'jwt' | 'internal-context' | 'legacy';

  @Prop()
  tokenJti?: string;

  @Prop()
  originSessionId?: string;

  @Prop({ type: Object })
  parameters: any;

  @Prop({ type: Object })
  result?: any;

  @Prop({ 
    required: true, 
    enum: ['pending', 'executing', 'completed', 'failed'],
    default: 'pending' 
  })
  status: 'pending' | 'executing' | 'completed' | 'failed';

  @Prop({ required: true, default: 0 })
  tokenCost: number;

  @Prop({ required: true, default: 0 })
  executionTime: number;

  @Prop({ required: true, default: 0 })
  retryCount: number;

  @Prop()
  error?: string;

  @Prop()
  errorCode?: string;

  @Prop({ default: Date.now })
  timestamp: Date;
}

export const ToolExecutionSchema = SchemaFactory.createForClass(ToolExecution);
