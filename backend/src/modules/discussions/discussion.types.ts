import { DiscussionMessageSenderType, DiscussionMessageType } from '../../shared/schemas/discussion-message.schema';
import {
  DiscussionKnowledgeCredibility,
  DiscussionKnowledgeSourceType,
} from '../../shared/schemas/discussion-knowledge-entry.schema';
import {
  DiscussionParticipantPresence,
  DiscussionParticipantRole,
  DiscussionParticipantType,
} from '../../shared/schemas/discussion-participant.schema';
import {
  DiscussionSedimentMode,
  DocumentOutline,
  OutlineSection,
  OutlineSectionStatus,
  DiscussionSpaceCategory,
  DiscussionSpaceStatus,
} from '../../shared/schemas/discussion-space.schema';
import {
  DiscussionThreadBranchOrigin,
  DiscussionThreadStatus,
} from '../../shared/schemas/discussion-thread.schema';

export interface CreateDiscussionSpaceDto {
  title: string;
  description?: string;
  creatorId: string;
  category?: DiscussionSpaceCategory;
  industryContext?: string;
  tags?: string[];
  projectId?: string;
  settings?: {
    maxBranchDepth?: number;
    knowledgeAutoAccumulate?: boolean;
    branchSuggestionEnabled?: boolean;
    defaultReplyAgentId?: string;
  };
  initialParticipants?: AddDiscussionParticipantDto[];
}

export interface UpdateDiscussionSpaceDto {
  title?: string;
  description?: string;
  tags?: string[];
  settings?: {
    maxBranchDepth?: number;
    knowledgeAutoAccumulate?: boolean;
    branchSuggestionEnabled?: boolean;
    defaultReplyAgentId?: string;
  };
}

export interface ListDiscussionSpacesQuery {
  status?: DiscussionSpaceStatus;
  category?: DiscussionSpaceCategory;
  creatorId?: string;
  projectId?: string;
  tags?: string[];
}

export interface CreateDiscussionThreadDto {
  title: string;
  parentThreadId?: string;
  branchFromMessageId?: string;
  branchOrigin?: DiscussionThreadBranchOrigin;
  contextSummary?: string;
}

export interface UpdateDiscussionThreadDto {
  title?: string;
  summary?: string;
  status?: DiscussionThreadStatus;
}

export interface DeleteDiscussionThreadResult {
  deleted: true;
  threadId: string;
  deletedThreadIds: string[];
}

export interface LinkDiscussionMessageKnowledgeDto {
  knowledgeEntryIds: string[];
}

export interface LinkDiscussionMessageKnowledgeResult {
  linked: true;
  messageId: string;
  knowledgeEntryIds: string[];
}

export interface CreateDiscussionRequirementDto {
  title: string;
  description?: string;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  projectId?: string;
  createdById?: string;
  createdByName?: string;
}

export interface CreateDiscussionRequirementResult {
  requirementId: string;
  title: string;
}

export interface SendDiscussionMessageDto {
  participantId: string;
  senderType: DiscussionMessageSenderType;
  content: string;
  messageType?: DiscussionMessageType;
  dataReferences?: Array<{
    dataRecordId: string;
    dataSourceName: string;
    dataPreview: string;
    collectedAt: string;
  }>;
  metadata?: Record<string, any>;
}

export interface SendDiscussionMessageResult {
  userMessage: any;
  aiMessages: any[];
  notifiedHumanParticipantIds: string[];
  generatedKnowledgeEntryIds: string[];
  realtimeSedimentUpdated: boolean;
}

export interface BranchDiscussionThreadDto {
  title: string;
  contextSummary?: string;
  branchOrigin?: DiscussionThreadBranchOrigin;
}

export interface AddDiscussionParticipantDto {
  type: DiscussionParticipantType;
  userId?: string;
  agentId?: string;
  displayName: string;
  avatar?: string;
  role: DiscussionParticipantRole;
  expertise?: string;
  expertiseTags?: string[];
  presence?: DiscussionParticipantPresence;
}

export interface UpdateDiscussionParticipantDto {
  displayName?: string;
  avatar?: string;
  role?: DiscussionParticipantRole;
  expertise?: string;
  expertiseTags?: string[];
  presence?: DiscussionParticipantPresence;
}

export interface CreateDiscussionKnowledgeEntryDto {
  participantId: string;
  title: string;
  content: string;
  summary?: string;
  outlineSectionId?: string;
  entryType?: 'fact' | 'data_point' | 'opinion' | 'source_reference' | 'analysis' | 'action_item';
  structuredData?: {
    value?: string | number;
    unit?: string;
    measureDate?: string;
    compareTo?: {
      value: string | number;
      period: string;
      changePercent?: number;
    };
  };
  metadata?: {
    isStructuredData?: boolean;
  };
  sourceUrl?: string;
  sourceType: DiscussionKnowledgeSourceType;
  sourceName?: string;
  domainTags?: string[];
  topicTags?: string[];
  keywordTags?: string[];
  credibility?: DiscussionKnowledgeCredibility;
  threadId?: string;
  messageId?: string;
  contentDate?: string;
}

export interface ListDiscussionKnowledgeQuery {
  threadId?: string;
  outlineSectionId?: string;
  participantId?: string;
  keyword?: string;
  credibility?: DiscussionKnowledgeCredibility;
  limit?: number;
}

export interface GenerateDiscussionOutlineDto {
  industryContext?: string;
}

export interface CreateDiscussionOutlineSectionDto {
  title: string;
  description?: string;
  parentSectionId?: string;
  order?: number;
  status?: OutlineSectionStatus;
  metadata?: OutlineSection['metadata'];
}

export interface UpdateDiscussionOutlineSectionDto {
  title?: string;
  description?: string;
  parentSectionId?: string;
  order?: number;
  status?: OutlineSectionStatus;
  metadata?: OutlineSection['metadata'];
}

export interface UpdateDiscussionOutlineDto {
  title?: string;
  sections: OutlineSection[];
  generatedBy?: DocumentOutline['generatedBy'];
}

export interface DiscussionKnowledgeCoverageResult {
  totalSections: number;
  coveredSections: number;
  sufficientSections: number;
  coverage: number;
  sectionDetails: Array<{
    sectionId: string;
    sectionTitle: string;
    knowledgeCount: number;
    status: OutlineSectionStatus;
    latestEntryDate?: Date;
  }>;
}

export interface UpdateDiscussionSedimentModeDto {
  mode: DiscussionSedimentMode;
}

export interface GenerateDiscussionSedimentDto {
  mode?: DiscussionSedimentMode;
  title?: string;
  threadScope?: string[];
}

export interface ListDiscussionSedimentHistoryQuery {
  limit?: number;
}

export interface DeleteDiscussionSedimentHistoryDto {
  operatorId: string;
}
