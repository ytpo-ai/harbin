import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

export type DiscussionKnowledgeEntryDocument = DiscussionKnowledgeEntry & Document;

export enum DiscussionKnowledgeSourceType {
  WEB_SEARCH = 'web_search',
  API = 'api',
  DOCUMENT = 'document',
  USER_INPUT = 'user_input',
  DISCUSSION_DERIVED = 'discussion_derived',
}

export enum DiscussionKnowledgeCredibility {
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low',
  UNVERIFIED = 'unverified',
}

export enum DiscussionKnowledgeEntryType {
  FACT = 'fact',
  DATA_POINT = 'data_point',
  OPINION = 'opinion',
  SOURCE_REFERENCE = 'source_reference',
  ANALYSIS = 'analysis',
  ACTION_ITEM = 'action_item',
}

@Schema({ timestamps: true, collection: 'discussion_knowledge_entries' })
export class DiscussionKnowledgeEntry {
  @Prop({ required: true, unique: true, default: () => uuidv4() })
  id: string;

  @Prop({ required: true })
  spaceId: string;

  @Prop({ required: true })
  participantId: string;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  content: string;

  @Prop({ required: true })
  summary: string;

  @Prop()
  outlineSectionId?: string;

  @Prop({ enum: DiscussionKnowledgeEntryType, default: DiscussionKnowledgeEntryType.FACT })
  entryType: DiscussionKnowledgeEntryType;

  @Prop({ type: Object })
  structuredData?: {
    value?: string | number;
    unit?: string;
    measureDate?: Date;
    compareTo?: {
      value: string | number;
      period: string;
      changePercent?: number;
    };
  };

  @Prop()
  sourceUrl?: string;

  @Prop({ enum: DiscussionKnowledgeSourceType, required: true })
  sourceType: DiscussionKnowledgeSourceType;

  @Prop()
  sourceName?: string;

  @Prop({ type: [String], default: [] })
  domainTags: string[];

  @Prop({ type: [String], default: [] })
  topicTags: string[];

  @Prop({ type: [String], default: [] })
  keywordTags: string[];

  @Prop({ enum: DiscussionKnowledgeCredibility, default: DiscussionKnowledgeCredibility.UNVERIFIED })
  credibility: DiscussionKnowledgeCredibility;

  @Prop({ type: Object })
  credibilityDetail?: {
    sourceAuthority: 'high' | 'medium' | 'low' | 'unknown';
    contentFreshness: 'current' | 'recent' | 'dated';
    crossValidated: boolean;
    userOverride: boolean;
    lastAssessedAt: Date;
  };

  @Prop()
  threadId?: string;

  @Prop()
  messageId?: string;

  @Prop({ type: Number, default: 0 })
  referenceCount: number;

  @Prop({ type: Date })
  contentDate?: Date;

  @Prop({ type: Boolean, default: true })
  isActive: boolean;
}

export const DiscussionKnowledgeEntrySchema = SchemaFactory.createForClass(DiscussionKnowledgeEntry);

DiscussionKnowledgeEntrySchema.index({ spaceId: 1, isActive: 1 });
DiscussionKnowledgeEntrySchema.index({ participantId: 1 });
DiscussionKnowledgeEntrySchema.index({ spaceId: 1, outlineSectionId: 1 });
DiscussionKnowledgeEntrySchema.index({ domainTags: 1 });
DiscussionKnowledgeEntrySchema.index({ topicTags: 1 });
DiscussionKnowledgeEntrySchema.index({ keywordTags: 1 });
DiscussionKnowledgeEntrySchema.index({ credibility: 1, referenceCount: -1 });
DiscussionKnowledgeEntrySchema.index({ spaceId: 1, '$**': 'text' }, { name: 'knowledge_text_search' });
