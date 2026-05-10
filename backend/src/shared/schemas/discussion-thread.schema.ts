import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

export type DiscussionThreadDocument = DiscussionThread & Document;

export enum DiscussionThreadBranchOrigin {
  USER = 'user',
  AI_SUGGESTION = 'ai_suggestion',
}

export enum DiscussionThreadStatus {
  ACTIVE = 'active',
  CONCLUDED = 'concluded',
  ARCHIVED = 'archived',
}

@Schema({ timestamps: true, collection: 'discussion_threads' })
export class DiscussionThread {
  @Prop({ required: true, unique: true, default: () => uuidv4() })
  id: string;

  @Prop({ required: true })
  spaceId: string;

  @Prop()
  parentThreadId?: string;

  @Prop()
  branchFromMessageId?: string;

  @Prop({ enum: DiscussionThreadBranchOrigin, default: DiscussionThreadBranchOrigin.USER })
  branchOrigin: DiscussionThreadBranchOrigin;

  @Prop({ required: true })
  title: string;

  @Prop()
  summary?: string;

  @Prop()
  contextSummary?: string;

  @Prop()
  outlineSectionId?: string;

  @Prop({ enum: DiscussionThreadStatus, default: DiscussionThreadStatus.ACTIVE })
  status: DiscussionThreadStatus;

  @Prop({ type: Number, default: 0 })
  depth: number;

  @Prop({ type: [String], default: [] })
  childThreadIds: string[];

  @Prop({ type: Number, default: 0 })
  messageCount: number;

  @Prop({ type: [String], default: [] })
  activeParticipantIds: string[];
}

export const DiscussionThreadSchema = SchemaFactory.createForClass(DiscussionThread);

DiscussionThreadSchema.index({ spaceId: 1, parentThreadId: 1 });
DiscussionThreadSchema.index({ spaceId: 1, depth: 1 });
DiscussionThreadSchema.index({ spaceId: 1, outlineSectionId: 1 });
DiscussionThreadSchema.index({ branchFromMessageId: 1 });
