import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

export type DiscussionSpaceDocument = DiscussionSpace & Document;

export enum DiscussionSpaceStatus {
  ACTIVE = 'active',
  PAUSED = 'paused',
  ARCHIVED = 'archived',
}

export enum DiscussionSedimentMode {
  MANUAL = 'manual',
  REALTIME = 'realtime',
}

@Schema({ timestamps: true, collection: 'discussion_spaces' })
export class DiscussionSpace {
  @Prop({ required: true, unique: true, default: () => uuidv4() })
  id: string;

  @Prop({ required: true })
  title: string;

  @Prop()
  description?: string;

  @Prop({ required: true })
  creatorId: string;

  @Prop({ enum: DiscussionSpaceStatus, default: DiscussionSpaceStatus.ACTIVE })
  status: DiscussionSpaceStatus;

  @Prop({ enum: DiscussionSedimentMode, default: DiscussionSedimentMode.MANUAL })
  sedimentMode: DiscussionSedimentMode;

  @Prop({ type: [String], default: [] })
  tags: string[];

  @Prop()
  rootThreadId?: string;

  @Prop({ type: Object })
  documentOutline?: Record<string, any>;

  @Prop({ type: [Object], default: [] })
  sedimentHistory: Array<{
    version: number;
    content: string;
    threadScope: string[];
    createdAt: Date;
  }>;

  @Prop()
  latestSedimentedDocument?: string;

  @Prop()
  projectId?: string;

  @Prop({ type: Object })
  settings?: {
    maxBranchDepth?: number;
    knowledgeAutoAccumulate?: boolean;
    branchSuggestionEnabled?: boolean;
  };

  @Prop({ type: Object, default: { totalThreads: 1, totalMessages: 0, totalKnowledgeEntries: 0, totalTokensConsumed: 0, totalCost: 0 } })
  statistics: {
    totalThreads: number;
    totalMessages: number;
    totalKnowledgeEntries: number;
    totalTokensConsumed: number;
    totalCost: number;
  };
}

export const DiscussionSpaceSchema = SchemaFactory.createForClass(DiscussionSpace);

DiscussionSpaceSchema.index({ creatorId: 1, status: 1 });
DiscussionSpaceSchema.index({ projectId: 1 });
DiscussionSpaceSchema.index({ tags: 1 });
