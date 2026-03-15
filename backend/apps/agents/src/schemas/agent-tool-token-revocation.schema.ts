import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AgentToolTokenRevocationDocument = AgentToolTokenRevocation & Document;

@Schema({ timestamps: true, collection: 'agent_tool_token_revocations' })
export class AgentToolTokenRevocation {
  @Prop({ required: true, unique: true, index: true })
  jti: string;

  @Prop({ required: true, index: true })
  agentId: string;

  @Prop()
  reason?: string;

  @Prop({ required: true })
  expiresAt: Date;
}

export const AgentToolTokenRevocationSchema = SchemaFactory.createForClass(AgentToolTokenRevocation);

AgentToolTokenRevocationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
