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
import { DiscussionSedimentMode, DiscussionSpaceStatus } from '../../shared/schemas/discussion-space.schema';
import {
  DiscussionThreadBranchOrigin,
  DiscussionThreadStatus,
} from '../../shared/schemas/discussion-thread.schema';

export interface CreateDiscussionSpaceDto {
  title: string;
  description?: string;
  creatorId: string;
  tags?: string[];
  projectId?: string;
  settings?: {
    maxBranchDepth?: number;
    knowledgeAutoAccumulate?: boolean;
    branchSuggestionEnabled?: boolean;
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
  };
}

export interface ListDiscussionSpacesQuery {
  status?: DiscussionSpaceStatus;
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

export interface SendDiscussionMessageDto {
  participantId: string;
  senderType: DiscussionMessageSenderType;
  content: string;
  messageType?: DiscussionMessageType;
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
  participantId?: string;
  keyword?: string;
  credibility?: DiscussionKnowledgeCredibility;
  limit?: number;
}

export interface UpdateDiscussionSedimentModeDto {
  mode: DiscussionSedimentMode;
}

export interface GenerateDiscussionSedimentDto {
  threadScope?: string[];
}
