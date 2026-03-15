import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ToolkitDocument = Toolkit & Document;

@Schema({ timestamps: true, collection: 'agent_toolkits' })
export class Toolkit {
  @Prop({ required: true, unique: true, index: true })
  id: string;

  @Prop({ required: true, index: true })
  provider: string;

  @Prop({ index: true })
  executionChannel?: string;

  @Prop({ required: true, index: true })
  namespace: string;

  @Prop({ required: true })
  name: string;

  @Prop({ default: '' })
  description?: string;

  @Prop({ default: 'v1' })
  version?: string;

  @Prop({ enum: ['oauth2', 'apiKey', 'none'], default: 'none' })
  authStrategy?: 'oauth2' | 'apiKey' | 'none';

  @Prop({ enum: ['active', 'disabled', 'deprecated'], default: 'active', index: true })
  status?: 'active' | 'disabled' | 'deprecated';

  @Prop()
  rateLimitPolicyId?: string;

  @Prop()
  defaultTimeoutMs?: number;

  @Prop({ type: Object })
  metadata?: Record<string, unknown>;
}

export const ToolkitSchema = SchemaFactory.createForClass(Toolkit);
