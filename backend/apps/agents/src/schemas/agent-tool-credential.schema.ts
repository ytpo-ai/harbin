import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AgentToolCredentialDocument = AgentToolCredential & Document;

@Schema({ timestamps: true, collection: 'agent_tool_credentials' })
export class AgentToolCredential {
  @Prop({ required: true, unique: true })
  id: string;

  @Prop({ required: true, index: true })
  agentId: string;

  @Prop({ required: true, unique: true, index: true })
  keyId: string;

  @Prop({ required: true })
  secretHash: string;

  @Prop({ enum: ['active', 'revoked', 'expired'], default: 'active', index: true })
  status: 'active' | 'revoked' | 'expired';

  @Prop({ type: [String], default: [] })
  scopeTemplate?: string[];

  @Prop()
  label?: string;

  @Prop()
  createdBy?: string;

  @Prop()
  rotatedAt?: Date;

  @Prop()
  lastUsedAt?: Date;

  @Prop({ index: true })
  expiresAt?: Date;
}

export const AgentToolCredentialSchema = SchemaFactory.createForClass(AgentToolCredential);

AgentToolCredentialSchema.index({ agentId: 1, status: 1 });
