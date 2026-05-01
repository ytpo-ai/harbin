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

export enum DiscussionSpaceCategory {
  GENERAL = 'general',
  INDUSTRY_OBSERVATION = 'industry_observation',
  PRODUCT_DISCUSSION = 'product_discussion',
  TECHNICAL_DESIGN = 'technical_design',
}

export type OutlineSectionStatus = 'draft' | 'enriching' | 'sufficient' | 'review';

export interface OutlineSection {
  id: string;
  title: string;
  description?: string;
  parentSectionId?: string;
  order: number;
  depth: number;
  status: OutlineSectionStatus;
  knowledgeCount: number;
  childSectionIds: string[];
  metadata?: {
    suggestedDataSources?: string[];
    collectFrequency?: string;
    isStructuredData?: boolean;
  };
}

export interface DocumentOutline {
  version: number;
  title: string;
  sections: OutlineSection[];
  createdAt: Date;
  updatedAt: Date;
  generatedBy: 'agent' | 'human' | 'hybrid';
  agentId?: string;
  runId?: string;
  sessionId?: string;
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

  @Prop()
  archivedAt?: Date;

  @Prop()
  archivedBy?: string;

  @Prop({ enum: DiscussionSedimentMode, default: DiscussionSedimentMode.MANUAL })
  sedimentMode: DiscussionSedimentMode;

  @Prop({ enum: DiscussionSpaceCategory, default: DiscussionSpaceCategory.GENERAL })
  category: DiscussionSpaceCategory;

  @Prop({ type: [String], default: [] })
  tags: string[];

  @Prop()
  rootThreadId?: string;

  @Prop({ type: Object })
  documentOutline?: DocumentOutline;

  @Prop({ type: [Object], default: [] })
  sedimentHistory: Array<{
    id?: string;
    version: number;
    title?: string;
    content: string;
    threadScope: string[];
    createdAt: Date;
    isDeleted?: boolean;
    deletedAt?: Date;
    deletedBy?: string;
  }>;

  @Prop()
  latestSedimentedDocument?: string;

  @Prop()
  latestSedimentTitle?: string;

  @Prop()
  projectId?: string;

  @Prop({ type: Object })
  settings?: {
    maxBranchDepth?: number;
    knowledgeAutoAccumulate?: boolean;
    branchSuggestionEnabled?: boolean;
    defaultReplyAgentId?: string;
    autoAnalysisOnDataUpdate?: boolean;
  };

  @Prop({ type: Object })
  metadata?: {
    industryContext?: string;
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
DiscussionSpaceSchema.index({ category: 1, status: 1 });
