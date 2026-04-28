import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

export type DiscussionParticipantDocument = DiscussionParticipant & Document;

export enum DiscussionParticipantType {
  HUMAN = 'human',
  AI_AGENT = 'ai_agent',
}

export enum DiscussionParticipantRole {
  PRIMARY = 'primary',
  ON_DEMAND = 'on_demand',
}

export enum DiscussionParticipantPresence {
  ONLINE = 'online',
  OFFLINE = 'offline',
  IDLE = 'idle',
}

@Schema({ timestamps: true, collection: 'discussion_participants' })
export class DiscussionParticipant {
  @Prop({ required: true, unique: true, default: () => uuidv4() })
  id: string;

  @Prop({ required: true })
  spaceId: string;

  @Prop({ enum: DiscussionParticipantType, required: true })
  type: DiscussionParticipantType;

  @Prop()
  userId?: string;

  @Prop()
  agentId?: string;

  @Prop({ required: true })
  displayName: string;

  @Prop()
  avatar?: string;

  @Prop({ enum: DiscussionParticipantRole, required: true })
  role: DiscussionParticipantRole;

  @Prop()
  expertise?: string;

  @Prop({ type: [String], default: [] })
  expertiseTags: string[];

  @Prop({ enum: DiscussionParticipantPresence, default: DiscussionParticipantPresence.OFFLINE })
  presence: DiscussionParticipantPresence;

  @Prop({ type: Date })
  lastActiveAt?: Date;

  @Prop({ type: Number, default: 0 })
  messageCount: number;

  @Prop({ type: Number, default: 0 })
  knowledgeContribution: number;
}

export const DiscussionParticipantSchema = SchemaFactory.createForClass(DiscussionParticipant);

DiscussionParticipantSchema.index({ spaceId: 1, role: 1 });
DiscussionParticipantSchema.index({ userId: 1 });
DiscussionParticipantSchema.index({ agentId: 1 });
DiscussionParticipantSchema.index({ spaceId: 1, displayName: 1 }, { unique: true });
