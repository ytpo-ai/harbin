import api from './api';

export type DiscussionSpaceStatus = 'active' | 'paused' | 'archived';
export type DiscussionSedimentMode = 'manual' | 'realtime';
export type DiscussionThreadBranchOrigin = 'user' | 'ai_suggestion';
export type DiscussionThreadStatus = 'active' | 'concluded' | 'archived';
export type DiscussionMessageSenderType = 'user' | 'ai' | 'system';
export type DiscussionMessageType = 'text' | 'branch_context' | 'sediment_snapshot' | 'cross_reference';
export type DiscussionParticipantType = 'human' | 'ai_agent';
export type DiscussionParticipantRole = 'primary' | 'on_demand';
export type DiscussionParticipantPresence = 'online' | 'offline' | 'idle';
export type DiscussionKnowledgeSourceType = 'web_search' | 'api' | 'document' | 'user_input' | 'discussion_derived';
export type DiscussionKnowledgeCredibility = 'high' | 'medium' | 'low' | 'unverified';

export interface DiscussionSpace {
  id: string;
  title: string;
  description?: string;
  creatorId: string;
  status: DiscussionSpaceStatus;
  sedimentMode: DiscussionSedimentMode;
  tags: string[];
  rootThreadId?: string;
  projectId?: string;
  latestSedimentedDocument?: string;
  settings?: {
    maxBranchDepth?: number;
    knowledgeAutoAccumulate?: boolean;
    branchSuggestionEnabled?: boolean;
  };
  statistics?: {
    totalThreads: number;
    totalMessages: number;
    totalKnowledgeEntries: number;
    totalTokensConsumed: number;
    totalCost: number;
  };
  createdAt?: string;
  updatedAt?: string;
}

export interface DiscussionThread {
  id: string;
  spaceId: string;
  parentThreadId?: string;
  branchFromMessageId?: string;
  branchOrigin: DiscussionThreadBranchOrigin;
  title: string;
  summary?: string;
  contextSummary?: string;
  status: DiscussionThreadStatus;
  depth: number;
  childThreadIds: string[];
  messageCount: number;
  activeParticipantIds: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface DiscussionParticipant {
  id: string;
  spaceId: string;
  type: DiscussionParticipantType;
  userId?: string;
  agentId?: string;
  displayName: string;
  avatar?: string;
  role: DiscussionParticipantRole;
  expertise?: string;
  expertiseTags: string[];
  presence: DiscussionParticipantPresence;
  lastActiveAt?: string;
  messageCount: number;
  knowledgeContribution: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface DiscussionCrossReference {
  threadId: string;
  threadTitle: string;
  messageId: string;
  summary: string;
}

export interface DiscussionMessage {
  id: string;
  spaceId: string;
  threadId: string;
  participantId: string;
  senderType: DiscussionMessageSenderType;
  content: string;
  messageType: DiscussionMessageType;
  sequence: number;
  branchSuggestions: Array<{
    id: string;
    topic: string;
    reason: string;
    status: 'pending' | 'accepted' | 'dismissed';
  }>;
  mentions: Array<{
    participantId: string;
    displayName: string;
    offset: number;
  }>;
  crossReferences: DiscussionCrossReference[];
  knowledgeEntryIds: string[];
  metadata?: {
    tokens?: number;
    cost?: number;
    model?: string;
    agentId?: string;
    searchesPerformed?: number;
    knowledgeHits?: number;
    contextCompressionApplied?: boolean;
  };
  createdAt?: string;
  updatedAt?: string;
}

export interface DiscussionKnowledgeEntry {
  id: string;
  spaceId: string;
  participantId: string;
  title: string;
  content: string;
  summary: string;
  sourceUrl?: string;
  sourceType: DiscussionKnowledgeSourceType;
  sourceName?: string;
  domainTags: string[];
  topicTags: string[];
  keywordTags: string[];
  credibility: DiscussionKnowledgeCredibility;
  threadId?: string;
  messageId?: string;
  referenceCount: number;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface DiscussionSpaceDetail extends DiscussionSpace {
  threadTree: DiscussionThread[];
  participants: DiscussionParticipant[];
}

export interface CreateDiscussionSpacePayload {
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
}

export interface SendDiscussionMessagePayload {
  participantId: string;
  senderType: DiscussionMessageSenderType;
  content: string;
  messageType?: DiscussionMessageType;
  metadata?: Record<string, unknown>;
}

export interface SendDiscussionMessageResult {
  userMessage: DiscussionMessage;
  aiMessages: DiscussionMessage[];
  notifiedHumanParticipantIds: string[];
  generatedKnowledgeEntryIds: string[];
  realtimeSedimentUpdated: boolean;
}

export interface DiscussionLatestSediment {
  mode: DiscussionSedimentMode;
  latest?: {
    version: number;
    content: string;
    threadScope: string[];
    createdAt: string;
  };
}

const normalizeWithId = <T extends { id?: string; _id?: string }>(item: T): T & { id: string } => {
  const id = item.id || item._id;
  return {
    ...item,
    id: id || '',
  };
};

const unwrapPayload = <T>(payload: unknown): T => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload as T;
  }

  const body = payload as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(body, 'data')) {
    return body.data as T;
  }

  return payload as T;
};

class DiscussionService {
  async listSpaces(filters?: {
    status?: DiscussionSpaceStatus;
    creatorId?: string;
    projectId?: string;
    tags?: string[];
  }): Promise<DiscussionSpace[]> {
    const response = await api.get('/discussions', {
      params: {
        ...filters,
        tags: filters?.tags?.length ? filters.tags.join(',') : undefined,
      },
    });

    const list = unwrapPayload<DiscussionSpace[]>(response.data) || [];
    return list.map((item) => normalizeWithId(item));
  }

  async createSpace(payload: CreateDiscussionSpacePayload): Promise<DiscussionSpace> {
    const response = await api.post('/discussions', payload);
    return normalizeWithId(unwrapPayload<DiscussionSpace>(response.data));
  }

  async getSpaceDetail(spaceId: string): Promise<DiscussionSpaceDetail> {
    const response = await api.get(`/discussions/${spaceId}`);
    const detail = unwrapPayload<DiscussionSpaceDetail>(response.data);
    return {
      ...normalizeWithId(detail),
      threadTree: (detail.threadTree || []).map((thread) => normalizeWithId(thread)),
      participants: (detail.participants || []).map((participant) => normalizeWithId(participant)),
    };
  }

  async updateSedimentMode(spaceId: string, mode: DiscussionSedimentMode): Promise<DiscussionSpace> {
    const response = await api.put(`/discussions/${spaceId}/sediment/mode`, { mode });
    return normalizeWithId(unwrapPayload<DiscussionSpace>(response.data));
  }

  async listMessages(spaceId: string, threadId: string, limit = 100): Promise<DiscussionMessage[]> {
    const response = await api.get(`/discussions/${spaceId}/threads/${threadId}/messages`, {
      params: { limit },
    });
    const list = unwrapPayload<DiscussionMessage[]>(response.data) || [];
    return list.map((item) => normalizeWithId(item));
  }

  async sendMessage(
    spaceId: string,
    threadId: string,
    payload: SendDiscussionMessagePayload,
  ): Promise<SendDiscussionMessageResult> {
    const response = await api.post(`/discussions/${spaceId}/threads/${threadId}/messages`, payload);
    const result = unwrapPayload<SendDiscussionMessageResult>(response.data);
    return {
      ...result,
      userMessage: normalizeWithId(result.userMessage),
      aiMessages: (result.aiMessages || []).map((item) => normalizeWithId(item)),
    };
  }

  async branchFromMessage(
    spaceId: string,
    threadId: string,
    messageId: string,
    payload: { title: string; contextSummary?: string; branchOrigin?: DiscussionThreadBranchOrigin },
  ): Promise<DiscussionThread> {
    const response = await api.post(`/discussions/${spaceId}/threads/${threadId}/messages/${messageId}/branch`, payload);
    return normalizeWithId(unwrapPayload<DiscussionThread>(response.data));
  }

  async listKnowledge(
    spaceId: string,
    filters?: {
      threadId?: string;
      participantId?: string;
      keyword?: string;
      credibility?: DiscussionKnowledgeCredibility;
      limit?: number;
    },
  ): Promise<DiscussionKnowledgeEntry[]> {
    const response = await api.get(`/discussions/${spaceId}/knowledge`, { params: filters });
    const list = unwrapPayload<DiscussionKnowledgeEntry[]>(response.data) || [];
    return list.map((item) => normalizeWithId(item));
  }

  async createKnowledge(
    spaceId: string,
    payload: {
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
    },
  ): Promise<DiscussionKnowledgeEntry> {
    const response = await api.post(`/discussions/${spaceId}/knowledge`, payload);
    return normalizeWithId(unwrapPayload<DiscussionKnowledgeEntry>(response.data));
  }

  async generateSediment(spaceId: string, threadScope?: string[]): Promise<DiscussionSpace> {
    const response = await api.post(`/discussions/${spaceId}/sediment/generate`, {
      threadScope,
    });
    return normalizeWithId(unwrapPayload<DiscussionSpace>(response.data));
  }

  async getLatestSediment(spaceId: string): Promise<DiscussionLatestSediment> {
    const response = await api.get(`/discussions/${spaceId}/sediment/latest`);
    return unwrapPayload<DiscussionLatestSediment>(response.data);
  }
}

export const discussionService = new DiscussionService();
