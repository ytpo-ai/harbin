import api from './api';

export type DiscussionSpaceStatus = 'active' | 'paused' | 'archived';
export type DiscussionSpaceCategory = 'general' | 'industry_observation' | 'product_discussion' | 'technical_design';
export type OutlineSectionStatus = 'draft' | 'enriching' | 'sufficient' | 'review';
export type DiscussionKnowledgeEntryType = 'fact' | 'data_point' | 'opinion' | 'source_reference' | 'analysis' | 'action_item';
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
  archivedAt?: string;
  archivedBy?: string;
  category: DiscussionSpaceCategory;
  sedimentMode: DiscussionSedimentMode;
  tags: string[];
  rootThreadId?: string;
  projectId?: string;
  metadata?: {
    industryContext?: string;
  };
  latestSedimentedDocument?: string;
  latestSedimentTitle?: string;
  settings?: {
    maxBranchDepth?: number;
    knowledgeAutoAccumulate?: boolean;
    branchSuggestionEnabled?: boolean;
    defaultReplyAgentId?: string;
    autoAnalysisOnDataUpdate?: boolean;
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
  outlineSectionId?: string;
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
  dataReferences: Array<{
    dataRecordId: string;
    dataSourceName: string;
    dataPreview: string;
    collectedAt: string;
  }>;
  knowledgeEntryIds: string[];
  metadata?: {
    tokens?: number;
    cost?: number;
    model?: string;
    agentId?: string;
    searchesPerformed?: number;
    knowledgeHits?: number;
    contextCompressionApplied?: boolean;
    generatedKnowledgeEntryIds?: string[];
    outlineSectionId?: string;
    searchEvidenceCount?: number;
    searchEvidence?: Array<{
      sourceName?: string;
      sourceUrl: string;
      snippet?: string;
      query?: string;
      fetchedAt?: string;
      publishedAt?: string;
    }>;
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
  outlineSectionId?: string;
  entryType?: DiscussionKnowledgeEntryType;
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

export interface DiscussionDocumentOutline {
  version: number;
  title: string;
  sections: OutlineSection[];
  createdAt: string;
  updatedAt: string;
  generatedBy: 'agent' | 'human' | 'hybrid';
  agentId?: string;
  runId?: string;
  sessionId?: string;
}

export interface DiscussionKnowledgeCoverage {
  totalSections: number;
  coveredSections: number;
  sufficientSections: number;
  coverage: number;
  sectionDetails: Array<{
    sectionId: string;
    sectionTitle: string;
    knowledgeCount: number;
    status: OutlineSectionStatus;
    latestEntryDate?: string;
  }>;
}

export interface DiscussionSpaceDetail extends DiscussionSpace {
  threadTree: DiscussionThread[];
  participants: DiscussionParticipant[];
}

export interface DeleteDiscussionThreadResult {
  deleted: true;
  threadId: string;
  deletedThreadIds: string[];
}

export interface CreateDiscussionSpacePayload {
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
    autoAnalysisOnDataUpdate?: boolean;
  };
  initialParticipants?: AddDiscussionParticipantPayload[];
}

export interface AddDiscussionParticipantPayload {
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

export interface SendDiscussionMessagePayload {
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
  metadata?: Record<string, unknown>;
}

export interface SendDiscussionMessageResult {
  userMessage: DiscussionMessage;
  aiMessages: DiscussionMessage[];
  notifiedHumanParticipantIds: string[];
  generatedKnowledgeEntryIds: string[];
  realtimeSedimentUpdated: boolean;
}

export interface LinkDiscussionMessageKnowledgeResult {
  linked: true;
  messageId: string;
  knowledgeEntryIds: string[];
}

export interface DeleteDiscussionKnowledgeEntryResult {
  removed: true;
  knowledgeEntryId: string;
}

export interface DiscussionMessageToRequirementPayload {
  title: string;
  description?: string;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  projectId?: string;
  createdById?: string;
  createdByName?: string;
}

export interface DiscussionMessageToRequirementResult {
  requirementId: string;
  title: string;
}

export type DiscussionAgentExecutionStatus = 'running' | 'completed' | 'failed';

export type DiscussionMessageStreamEvent =
  | {
      type: 'discussion.message.snapshot';
      data: { spaceId: string; threadId: string };
    }
  | {
      type: 'discussion.message.created';
      data: { spaceId: string; threadId: string; message: DiscussionMessage };
    }
  | {
      type: 'discussion.agent.execution.status';
      data: {
        spaceId: string;
        threadId: string;
        participantId: string;
        agentId?: string;
        status: DiscussionAgentExecutionStatus;
        reason?: string;
      };
    };

export interface DiscussionLatestSediment {
  mode: DiscussionSedimentMode;
  latest?: {
    version: number;
    title: string;
    content: string;
    threadScope: string[];
    createdAt: string;
  };
}

export interface DiscussionSedimentHistory {
  mode: DiscussionSedimentMode;
  items: Array<{
    id: string;
    version: number;
    title: string;
    content: string;
    threadScope: string[];
    createdAt: string;
  }>;
}

export type DiscussionSedimentTaskStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface DiscussionSedimentTask {
  taskId: string;
  spaceId: string;
  title: string;
  status: DiscussionSedimentTaskStatus;
  mode: DiscussionSedimentMode;
  threadScope: string[];
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
}

export type DiscussionSedimentTaskStreamEvent = {
  type:
    | 'discussion.sediment.task.snapshot'
    | 'discussion.sediment.task.running'
    | 'discussion.sediment.task.succeeded'
    | 'discussion.sediment.task.failed';
  data: {
    task: DiscussionSedimentTask;
  };
};

export type DiscussionOutlineTaskStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface DiscussionOutlineTask {
  taskId: string;
  spaceId: string;
  taskType: 'generate' | 'enrich_section' | 'enrich_all';
  status: DiscussionOutlineTaskStatus;
  sectionId?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  result?: {
    outline: DiscussionDocumentOutline;
    enrichedCount?: number;
    processedSectionIds?: string[];
    enrichmentMeta?: OutlineEnrichmentMeta;
  };
}

export interface OutlineEnrichmentMeta {
  mode: 'agent' | 'fallback';
  agentId?: string;
  acceptedAgentEntries: number;
  createdFallbackEntries: number;
  fallbackReason?:
    | 'no_agent_available'
    | 'agent_execution_failed'
    | 'agent_response_empty'
    | 'agent_response_non_json'
    | 'agent_entries_invalid'
    | 'agent_entries_duplicated';
}

export type DiscussionOutlineTaskStreamEvent = {
  type:
    | 'discussion.outline.task.snapshot'
    | 'discussion.outline.task.running'
    | 'discussion.outline.task.succeeded'
    | 'discussion.outline.task.failed';
  data: {
    task: DiscussionOutlineTask;
  };
};

export interface UpdateDiscussionParticipantPayload {
  displayName?: string;
  avatar?: string;
  role?: DiscussionParticipantRole;
  expertise?: string;
  expertiseTags?: string[];
  presence?: DiscussionParticipantPresence;
}

export interface UpdateDiscussionSpacePayload {
  title?: string;
  description?: string;
  tags?: string[];
  settings?: {
    maxBranchDepth?: number;
    knowledgeAutoAccumulate?: boolean;
    branchSuggestionEnabled?: boolean;
    defaultReplyAgentId?: string;
    autoAnalysisOnDataUpdate?: boolean;
  };
}

export interface CreateOutlineSectionPayload {
  title: string;
  description?: string;
  parentSectionId?: string;
  order?: number;
  status?: OutlineSectionStatus;
  metadata?: OutlineSection['metadata'];
}

export interface UpdateOutlineSectionPayload {
  title?: string;
  description?: string;
  parentSectionId?: string;
  order?: number;
  status?: OutlineSectionStatus;
  metadata?: OutlineSection['metadata'];
}

export interface EnrichOutlineSectionResult {
  sectionId: string;
  enrichedCount: number;
  outline: DiscussionDocumentOutline;
  enrichmentMeta?: OutlineEnrichmentMeta;
}

export interface EnrichAllOutlineSectionsResult {
  processedSectionIds: string[];
  enrichedCount: number;
  outline: DiscussionDocumentOutline;
}

export interface DeleteOutlineSectionResult {
  sectionId: string;
  deletedSectionIds: string[];
  deletedKnowledgeCount: number;
  outline: DiscussionDocumentOutline;
}

export interface ClearOutlineSectionEnrichmentResult {
  sectionId: string;
  clearedKnowledgeCount: number;
  outline: DiscussionDocumentOutline;
}

const normalizeWithId = <T extends { id?: string | number | { toString: () => string }; _id?: string | number | { toString: () => string } }>(
  item: T,
): T & { id: string } => {
  const id = item.id || item._id;
  return {
    ...item,
    id: typeof id === 'string' ? id : id ? String(id) : '',
  };
};

const normalizeThreadTree = (threadTree: unknown): DiscussionThread[] => {
  if (!Array.isArray(threadTree)) {
    return [];
  }

  const flattened: DiscussionThread[] = [];

  const visit = (thread: unknown, parentThreadId?: string) => {
    if (!thread || typeof thread !== 'object' || Array.isArray(thread)) {
      return;
    }

    const raw = thread as DiscussionThread & {
      id?: string;
      _id?: string;
      children?: unknown[];
      parentThreadId?: string | { toString: () => string };
    };
    const normalized = normalizeWithId(raw);
    const normalizedParentThreadId =
      typeof normalized.parentThreadId === 'string'
        ? normalized.parentThreadId
        : normalized.parentThreadId
          ? String(normalized.parentThreadId)
          : parentThreadId;

    flattened.push({
      ...normalized,
      parentThreadId: normalizedParentThreadId,
      childThreadIds: Array.isArray(normalized.childThreadIds)
        ? normalized.childThreadIds.map((id) => (typeof id === 'string' ? id : String(id)))
        : [],
      activeParticipantIds: Array.isArray(normalized.activeParticipantIds)
        ? normalized.activeParticipantIds.map((id) => (typeof id === 'string' ? id : String(id)))
        : [],
    });

    if (!Array.isArray(raw.children)) {
      return;
    }

    for (const child of raw.children) {
      visit(child, normalized.id);
    }
  };

  for (const thread of threadTree) {
    visit(thread);
  }

  return flattened;
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
    includeArchived?: boolean;
    category?: DiscussionSpaceCategory;
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
      threadTree: normalizeThreadTree(detail.threadTree),
      participants: (detail.participants || []).map((participant) => normalizeWithId(participant)),
    };
  }

  async updateSpace(spaceId: string, payload: UpdateDiscussionSpacePayload): Promise<DiscussionSpace> {
    const response = await api.put(`/discussions/${spaceId}`, payload);
    return normalizeWithId(unwrapPayload<DiscussionSpace>(response.data));
  }

  async archiveSpace(spaceId: string, operatorId?: string): Promise<DiscussionSpace> {
    const response = await api.post(`/discussions/${spaceId}/archive`, {
      operatorId,
    });
    return normalizeWithId(unwrapPayload<DiscussionSpace>(response.data));
  }

  async unarchiveSpace(spaceId: string): Promise<DiscussionSpace> {
    const response = await api.post(`/discussions/${spaceId}/unarchive`);
    return normalizeWithId(unwrapPayload<DiscussionSpace>(response.data));
  }

  async updateSedimentMode(spaceId: string, mode: DiscussionSedimentMode): Promise<DiscussionSpace> {
    const response = await api.put(`/discussions/${spaceId}/sediment/mode`, { mode });
    return normalizeWithId(unwrapPayload<DiscussionSpace>(response.data));
  }

  async deleteThread(spaceId: string, threadId: string): Promise<DeleteDiscussionThreadResult> {
    const response = await api.delete(`/discussions/${spaceId}/threads/${threadId}`);
    return unwrapPayload<DeleteDiscussionThreadResult>(response.data);
  }

  async listMessages(spaceId: string, threadId: string, limit = 100): Promise<DiscussionMessage[]> {
    const response = await api.get(`/discussions/${spaceId}/threads/${threadId}/messages`, {
      params: { limit },
    });
    const list = unwrapPayload<DiscussionMessage[]>(response.data) || [];
    return list.map((item) => normalizeWithId(item));
  }

  subscribeThreadMessageEvents(
    spaceId: string,
    threadId: string,
    handlers: {
      onEvent: (event: DiscussionMessageStreamEvent) => void;
      onError?: () => void;
    },
  ): () => void {
    const token = localStorage.getItem('auth_token') || localStorage.getItem('token') || '';
    const baseURL = (api.defaults.baseURL || '').replace(/\/$/, '');
    const streamUrl = `${baseURL}/discussions/${encodeURIComponent(spaceId)}/threads/${encodeURIComponent(threadId)}/messages/events${token ? `?access_token=${encodeURIComponent(token)}` : ''}`;
    const controller = new AbortController();
    let stopped = false;
    let retryTimer: number | null = null;

    const clearRetryTimer = () => {
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
        retryTimer = null;
      }
    };

    const scheduleReconnect = () => {
      if (stopped) {
        return;
      }
      clearRetryTimer();
      retryTimer = window.setTimeout(() => {
        void connect();
      }, 1200);
    };

    const connect = async () => {
      if (stopped) {
        return;
      }

      try {
        const response = await fetch(streamUrl, {
          method: 'GET',
          headers: {
            Accept: 'text/event-stream',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          throw new Error(`discussion sse failed: ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';
        let currentData: string[] = [];

        const flushEvent = () => {
          if (!currentData.length) {
            return;
          }
          const raw = currentData.join('\n').trim();
          currentData = [];
          if (!raw) {
            return;
          }
          try {
            const payload = JSON.parse(raw) as DiscussionMessageStreamEvent;
            handlers.onEvent(payload);
          } catch {
            // ignore invalid payload
          }
        };

        while (!stopped) {
          const { value, done } = await reader.read();
          if (done) {
            flushEvent();
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (!line) {
              flushEvent();
              continue;
            }
            if (line.startsWith('data:')) {
              currentData.push(line.slice(5).trimStart());
            }
          }
        }

        if (!stopped) {
          handlers.onError?.();
          scheduleReconnect();
        }
      } catch {
        if (stopped || controller.signal.aborted) {
          return;
        }
        handlers.onError?.();
        scheduleReconnect();
      }
    };

    void connect();

    return () => {
      stopped = true;
      clearRetryTimer();
      controller.abort();
    };
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

  async linkMessageKnowledge(
    spaceId: string,
    threadId: string,
    messageId: string,
    knowledgeEntryIds: string[],
  ): Promise<LinkDiscussionMessageKnowledgeResult> {
    const response = await api.post(`/discussions/${spaceId}/threads/${threadId}/messages/${messageId}/knowledge/link`, {
      knowledgeEntryIds,
    });
    return unwrapPayload<LinkDiscussionMessageKnowledgeResult>(response.data);
  }

  async createRequirementFromMessage(
    spaceId: string,
    threadId: string,
    messageId: string,
    payload: DiscussionMessageToRequirementPayload,
  ): Promise<DiscussionMessageToRequirementResult> {
    const response = await api.post(
      `/discussions/${spaceId}/threads/${threadId}/messages/${messageId}/to-requirement`,
      payload,
    );
    return unwrapPayload<DiscussionMessageToRequirementResult>(response.data);
  }

  async listKnowledge(
    spaceId: string,
    filters?: {
      threadId?: string;
      outlineSectionId?: string;
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

  async getKnowledgeCoverage(spaceId: string): Promise<DiscussionKnowledgeCoverage> {
    const response = await api.get(`/discussions/${spaceId}/knowledge/coverage`);
    return unwrapPayload<DiscussionKnowledgeCoverage>(response.data);
  }

  async getOutline(spaceId: string): Promise<DiscussionDocumentOutline> {
    const response = await api.get(`/discussions/${spaceId}/outline`);
    return unwrapPayload<DiscussionDocumentOutline>(response.data);
  }

  async generateOutline(spaceId: string, payload?: { industryContext?: string }): Promise<DiscussionDocumentOutline> {
    const response = await api.post(`/discussions/${spaceId}/outline/generate`, payload || {});
    return unwrapPayload<DiscussionDocumentOutline>(response.data);
  }

  async generateOutlineTask(spaceId: string, payload?: { industryContext?: string }): Promise<DiscussionOutlineTask> {
    const response = await api.post(`/discussions/${spaceId}/outline/generate-task`, payload || {});
    return unwrapPayload<DiscussionOutlineTask>(response.data);
  }

  async updateOutline(
    spaceId: string,
    payload: { title?: string; sections: OutlineSection[]; generatedBy?: 'agent' | 'human' | 'hybrid' },
  ): Promise<DiscussionDocumentOutline> {
    const response = await api.put(`/discussions/${spaceId}/outline`, payload);
    return unwrapPayload<DiscussionDocumentOutline>(response.data);
  }

  async addOutlineSection(spaceId: string, payload: CreateOutlineSectionPayload): Promise<DiscussionDocumentOutline> {
    const response = await api.post(`/discussions/${spaceId}/outline/sections`, payload);
    return unwrapPayload<DiscussionDocumentOutline>(response.data);
  }

  async updateOutlineSection(
    spaceId: string,
    sectionId: string,
    payload: UpdateOutlineSectionPayload,
  ): Promise<DiscussionDocumentOutline> {
    const response = await api.put(`/discussions/${spaceId}/outline/sections/${sectionId}`, payload);
    return unwrapPayload<DiscussionDocumentOutline>(response.data);
  }

  async deleteOutlineSection(spaceId: string, sectionId: string): Promise<DeleteOutlineSectionResult> {
    const response = await api.delete(`/discussions/${spaceId}/outline/sections/${sectionId}`);
    return unwrapPayload<DeleteOutlineSectionResult>(response.data);
  }

  async clearOutlineSectionEnrichments(spaceId: string, sectionId: string): Promise<ClearOutlineSectionEnrichmentResult> {
    const response = await api.delete(`/discussions/${spaceId}/outline/sections/${sectionId}/enrichments`);
    return unwrapPayload<ClearOutlineSectionEnrichmentResult>(response.data);
  }

  async getOrCreateSectionThread(spaceId: string, sectionId: string, sectionTitle?: string): Promise<DiscussionThread> {
    const response = await api.post(`/discussions/${spaceId}/outline/sections/${sectionId}/thread`, {
      sectionTitle,
    });
    return normalizeWithId(unwrapPayload<DiscussionThread>(response.data));
  }

  async enrichOutlineSection(spaceId: string, sectionId: string): Promise<EnrichOutlineSectionResult> {
    const response = await api.post(`/discussions/${spaceId}/outline/sections/${sectionId}/enrich`);
    return unwrapPayload<EnrichOutlineSectionResult>(response.data);
  }

  async enrichOutlineSectionTask(spaceId: string, sectionId: string): Promise<DiscussionOutlineTask> {
    const response = await api.post(`/discussions/${spaceId}/outline/sections/${sectionId}/enrich-task`);
    return unwrapPayload<DiscussionOutlineTask>(response.data);
  }

  async enrichAllOutlineSections(spaceId: string): Promise<EnrichAllOutlineSectionsResult> {
    const response = await api.post(`/discussions/${spaceId}/outline/enrich-all`);
    return unwrapPayload<EnrichAllOutlineSectionsResult>(response.data);
  }

  async createKnowledge(
    spaceId: string,
    payload: {
      participantId: string;
      title: string;
      content: string;
      summary?: string;
      outlineSectionId?: string;
      entryType?: DiscussionKnowledgeEntryType;
      structuredData?: DiscussionKnowledgeEntry['structuredData'];
      metadata?: DiscussionKnowledgeEntry['metadata'];
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

  async deleteKnowledge(spaceId: string, knowledgeEntryId: string): Promise<DeleteDiscussionKnowledgeEntryResult> {
    const response = await api.delete(`/discussions/${spaceId}/knowledge/${knowledgeEntryId}`);
    return unwrapPayload<DeleteDiscussionKnowledgeEntryResult>(response.data);
  }

  async generateSediment(spaceId: string, payload?: { title?: string; threadScope?: string[] }): Promise<DiscussionSedimentTask> {
    const response = await api.post(`/discussions/${spaceId}/sediment/generate`, {
      title: payload?.title,
      threadScope: payload?.threadScope,
    });
    return unwrapPayload<DiscussionSedimentTask>(response.data);
  }

  subscribeSedimentTaskEvents(
    spaceId: string,
    taskId: string,
    handlers: {
      onEvent: (event: DiscussionSedimentTaskStreamEvent) => void;
      onError?: () => void;
    },
  ): () => void {
    const token = localStorage.getItem('auth_token') || localStorage.getItem('token') || '';
    const baseURL = (api.defaults.baseURL || '').replace(/\/$/, '');
    const streamUrl = `${baseURL}/discussions/${encodeURIComponent(spaceId)}/sediment/tasks/${encodeURIComponent(taskId)}/events${token ? `?access_token=${encodeURIComponent(token)}` : ''}`;
    const controller = new AbortController();
    let stopped = false;

    const connect = async () => {
      try {
        const response = await fetch(streamUrl, {
          method: 'GET',
          headers: {
            Accept: 'text/event-stream',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          throw new Error(`discussion sediment sse failed: ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';
        let currentData: string[] = [];

        const flushEvent = () => {
          if (!currentData.length) {
            return;
          }
          const raw = currentData.join('\n').trim();
          currentData = [];
          if (!raw) {
            return;
          }
          try {
            const payload = JSON.parse(raw) as DiscussionSedimentTaskStreamEvent;
            handlers.onEvent(payload);
          } catch {
            // ignore invalid payload
          }
        };

        while (!stopped) {
          const { value, done } = await reader.read();
          if (done) {
            flushEvent();
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (!line) {
              flushEvent();
              continue;
            }
            if (line.startsWith('data:')) {
              currentData.push(line.slice(5).trimStart());
            }
          }
        }

        if (!stopped) {
          handlers.onError?.();
        }
      } catch {
        if (stopped || controller.signal.aborted) {
          return;
        }
        handlers.onError?.();
      }
    };

    void connect();

    return () => {
      stopped = true;
      controller.abort();
    };
  }

  subscribeOutlineTaskEvents(
    spaceId: string,
    taskId: string,
    handlers: {
      onEvent: (event: DiscussionOutlineTaskStreamEvent) => void;
      onError?: () => void;
    },
  ): () => void {
    const token = localStorage.getItem('auth_token') || localStorage.getItem('token') || '';
    const baseURL = (api.defaults.baseURL || '').replace(/\/$/, '');
    const streamUrl = `${baseURL}/discussions/${encodeURIComponent(spaceId)}/outline/tasks/${encodeURIComponent(taskId)}/events${token ? `?access_token=${encodeURIComponent(token)}` : ''}`;
    const controller = new AbortController();
    let stopped = false;

    const connect = async () => {
      try {
        const response = await fetch(streamUrl, {
          method: 'GET',
          headers: {
            Accept: 'text/event-stream',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          throw new Error(`discussion outline sse failed: ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';
        let currentData: string[] = [];

        const flushEvent = () => {
          if (!currentData.length) {
            return;
          }
          const raw = currentData.join('\n').trim();
          currentData = [];
          if (!raw) {
            return;
          }
          try {
            const payload = JSON.parse(raw) as DiscussionOutlineTaskStreamEvent;
            handlers.onEvent(payload);
          } catch {
            // ignore invalid payload
          }
        };

        while (!stopped) {
          const { value, done } = await reader.read();
          if (done) {
            flushEvent();
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (!line) {
              flushEvent();
              continue;
            }
            if (line.startsWith('data:')) {
              currentData.push(line.slice(5).trimStart());
            }
          }
        }

        if (!stopped) {
          handlers.onError?.();
        }
      } catch {
        if (stopped || controller.signal.aborted) {
          return;
        }
        handlers.onError?.();
      }
    };

    void connect();

    return () => {
      stopped = true;
      controller.abort();
    };
  }

  async getLatestSediment(spaceId: string): Promise<DiscussionLatestSediment> {
    const response = await api.get(`/discussions/${spaceId}/sediment/latest`);
    return unwrapPayload<DiscussionLatestSediment>(response.data);
  }

  async getSedimentHistory(spaceId: string, limit = 20): Promise<DiscussionSedimentHistory> {
    const response = await api.get(`/discussions/${spaceId}/sediment/history`, {
      params: { limit },
    });
    return unwrapPayload<DiscussionSedimentHistory>(response.data);
  }

  async deleteSedimentHistory(spaceId: string, historyId: string, operatorId: string): Promise<{ deleted: true; historyId: string }> {
    const response = await api.delete(`/discussions/${spaceId}/sediment/history/${historyId}`, {
      params: { operatorId },
    });
    return unwrapPayload<{ deleted: true; historyId: string }>(response.data);
  }

  async addParticipant(spaceId: string, payload: AddDiscussionParticipantPayload): Promise<DiscussionParticipant> {
    const response = await api.post(`/discussions/${spaceId}/participants`, payload);
    return normalizeWithId(unwrapPayload<DiscussionParticipant>(response.data));
  }

  async updateParticipant(
    spaceId: string,
    participantId: string,
    payload: UpdateDiscussionParticipantPayload,
  ): Promise<DiscussionParticipant> {
    const response = await api.put(`/discussions/${spaceId}/participants/${participantId}`, payload);
    return normalizeWithId(unwrapPayload<DiscussionParticipant>(response.data));
  }

  async removeParticipant(spaceId: string, participantId: string): Promise<{ removed: boolean }> {
    const response = await api.delete(`/discussions/${spaceId}/participants/${participantId}`);
    return unwrapPayload<{ removed: boolean }>(response.data);
  }
}

export const discussionService = new DiscussionService();
