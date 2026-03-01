import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

export type OperationLogDocument = OperationLog & Document;

@Schema({ timestamps: true })
export class OperationLog {
  @Prop({ required: true, unique: true, default: uuidv4 })
  id: string;

  @Prop({ required: true })
  organizationId: string;

  @Prop({ required: true })
  humanEmployeeId: string;

  @Prop()
  assistantAgentId?: string;

  @Prop({ required: true })
  action: string;

  @Prop({ required: true })
  resource: string;

  @Prop({ required: true })
  httpMethod: string;

  @Prop({ required: true })
  statusCode: number;

  @Prop({ required: true })
  success: boolean;

  @Prop()
  requestId?: string;

  @Prop()
  ip?: string;

  @Prop()
  userAgent?: string;

  @Prop({ type: Object })
  query?: Record<string, unknown>;

  @Prop({ type: Object })
  payload?: Record<string, unknown>;

  @Prop({ type: Object })
  responseSummary?: Record<string, unknown>;

  @Prop()
  sourceService?: string;

  @Prop({ default: 0 })
  durationMs: number;

  @Prop({ default: Date.now })
  timestamp: Date;

  @Prop()
  createdAt?: Date;

  @Prop()
  updatedAt?: Date;
}

export const OperationLogSchema = SchemaFactory.createForClass(OperationLog);

OperationLogSchema.index({ humanEmployeeId: 1, timestamp: -1 });
OperationLogSchema.index({ assistantAgentId: 1, timestamp: -1 });
OperationLogSchema.index({ organizationId: 1, timestamp: -1 });
OperationLogSchema.index({ action: 1, timestamp: -1 });
