import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AgentMemoVersionDocument = AgentMemoVersion & Document;

@Schema({ timestamps: true, collection: 'agent_memo_versions' })
export class AgentMemoVersion {
  @Prop({ required: true, unique: true })
  id: string;

  @Prop({ required: true, index: true })
  memoId: string;

  @Prop({ required: true, index: true })
  version: number;

  @Prop({ required: true })
  content: string;

  @Prop({ default: '' })
  changeNote: string;

  @Prop()
  createdAt?: Date;

  @Prop()
  updatedAt?: Date;
}

export const AgentMemoVersionSchema = SchemaFactory.createForClass(AgentMemoVersion);

AgentMemoVersionSchema.index({ memoId: 1, version: 1 }, { unique: true });
AgentMemoVersionSchema.index({ memoId: 1, createdAt: -1 });
