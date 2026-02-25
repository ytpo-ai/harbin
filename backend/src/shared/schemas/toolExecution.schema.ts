import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ToolExecutionDocument = ToolExecution & Document;

@Schema({ timestamps: true })
export class ToolExecution {
  @Prop({ required: true, unique: true })
  id: string;

  @Prop({ required: true })
  toolId: string;

  @Prop({ required: true })
  agentId: string;

  @Prop()
  taskId?: string;

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

  @Prop()
  error?: string;

  @Prop({ default: Date.now })
  timestamp: Date;
}

export const ToolExecutionSchema = SchemaFactory.createForClass(ToolExecution);