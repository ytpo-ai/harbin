import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  DiscussionMessage,
  DiscussionMessageDocument,
  DiscussionMessageSenderType,
  DiscussionMessageType,
} from '../../../shared/schemas/discussion-message.schema';
import { DiscussionParticipant, DiscussionParticipantType } from '../../../shared/schemas/discussion-participant.schema';
import { DiscussionSedimentMode, DiscussionSpaceStatus } from '../../../shared/schemas/discussion-space.schema';
import {
  DiscussionKnowledgeCredibility,
  DiscussionKnowledgeEntryType,
  DiscussionKnowledgeSourceType,
} from '../../../shared/schemas/discussion-knowledge-entry.schema';
import { AgentExecutionTask, ChatMessage } from '../../../shared/types';
import {
  SendDiscussionMessageDto,
  SendDiscussionMessageResult,
  TriggerDiscussionDataAnalysisDto,
} from '../discussion.types';
import { AgentClientService } from '../../agents-client/agent-client.service';
import { DiscussionParticipantService } from './discussion-participant.service';
import { DiscussionMentionDispatchService } from './discussion-mention-dispatch.service';
import { DiscussionKnowledgeService } from './discussion-knowledge.service';
import { DiscussionSedimentService } from './discussion-sediment.service';
import { DiscussionMessageStreamService } from './discussion-message-stream.service';
import { DiscussionSpaceService } from './discussion-space.service';
import { DiscussionThreadService } from './discussion-thread.service';

const VALID_RUNTIME_ENTRY_TYPES = new Set<string>([
  DiscussionKnowledgeEntryType.FACT,
  DiscussionKnowledgeEntryType.DATA_POINT,
  DiscussionKnowledgeEntryType.OPINION,
  DiscussionKnowledgeEntryType.SOURCE_REFERENCE,
  DiscussionKnowledgeEntryType.ANALYSIS,
  DiscussionKnowledgeEntryType.ACTION_ITEM,
]);
const VALID_RUNTIME_CREDIBILITY = new Set<string>([
  DiscussionKnowledgeCredibility.HIGH,
  DiscussionKnowledgeCredibility.MEDIUM,
  DiscussionKnowledgeCredibility.LOW,
  DiscussionKnowledgeCredibility.UNVERIFIED,
]);

export const looksLikeClarificationResponse = (value: string): boolean => {
  const text = String(value || '').trim();
  if (!text) {
    return false;
  }
  const lower = text.toLowerCase();
  return (
    /\?|？/.test(text) ||
    lower.includes('请告诉我') ||
    lower.includes('你希望') ||
    lower.includes('你可以按') ||
    lower.includes('选一条') ||
    lower.includes('如果你愿意')
  );
};

const extractBalancedJson = (input: string): string | null => {
  const text = String(input || '');
  const start = text.search(/[\[{]/);
  if (start < 0) {
    return null;
  }

  const opening = text[start];
  const closing = opening === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let index = start; index < text.length; index += 1) {
    const ch = text[index];
    if (inString) {
      if (escaping) {
        escaping = false;
        continue;
      }
      if (ch === '\\') {
        escaping = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === opening) {
      depth += 1;
      continue;
    }
    if (ch === closing) {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1).trim();
      }
    }
  }

  return null;
};

const parseFirstJsonPayloadFromReply = (raw: string): unknown => {
  const text = String(raw || '').trim();
  if (!text) {
    return null;
  }

  const candidates: string[] = [text];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    candidates.unshift(fenced[1].trim());
  }
  const firstJsonStart = text.search(/[\[{]/);
  if (firstJsonStart >= 0) {
    candidates.push(text.slice(firstJsonStart).trim());
    const balanced = extractBalancedJson(text.slice(firstJsonStart));
    if (balanced) {
      candidates.unshift(balanced);
    }
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch (_error) {
      continue;
    }
  }

  return null;
};

type DiscussionSearchEvidence = {
  sourceName?: string;
  sourceUrl: string;
  snippet?: string;
  query?: string;
  fetchedAt?: string;
  publishedAt?: string;
};

export const parseSearchEvidenceFromReply = (raw: string): DiscussionSearchEvidence[] => {
  const payload = parseFirstJsonPayloadFromReply(raw);
  const evidenceList: DiscussionSearchEvidence[] = [];
  const dedupe = new Set<string>();

  const pushEvidence = (item: Record<string, unknown>) => {
    const sourceUrl = String(item.sourceUrl || item.url || item.link || '').trim();
    if (!sourceUrl) {
      return;
    }
    const sourceName = String(item.sourceName || item.title || item.domain || '').trim() || undefined;
    const snippet = String(item.snippet || item.summary || item.excerpt || '').trim() || undefined;
    const query = String(item.query || item.keyword || item.searchQuery || '').trim() || undefined;
    const fetchedAt = String(item.fetchedAt || item.crawledAt || '').trim() || undefined;
    const publishedAt = String(item.publishedAt || item.contentDate || '').trim() || undefined;
    const key = `${sourceUrl}::${sourceName || ''}`;
    if (dedupe.has(key)) {
      return;
    }
    dedupe.add(key);
    evidenceList.push({ sourceName, sourceUrl, snippet, query, fetchedAt, publishedAt });
  };

  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const objectPayload = payload as Record<string, unknown>;
    const candidates = [
      objectPayload.searchEvidence,
      objectPayload.sources,
      objectPayload.references,
      objectPayload.evidence,
    ].find((item) => Array.isArray(item));
    if (Array.isArray(candidates)) {
      for (const item of candidates) {
        if (item && typeof item === 'object') {
          pushEvidence(item as Record<string, unknown>);
        }
      }
    }
  }

  if (evidenceList.length === 0) {
    const rawEntries = parseEnrichmentPayloadFromReply(raw);
    for (const item of rawEntries) {
      const sourceUrl = String(item.sourceUrl || '').trim();
      if (!sourceUrl) {
        continue;
      }
      pushEvidence({
        sourceUrl,
        sourceName: item.sourceName,
        snippet: item.summary || item.content,
      });
    }
  }

  return evidenceList.slice(0, 8);
};

export const parseEnrichmentPayloadFromReply = (raw: string): Array<Record<string, unknown>> => {
  const text = String(raw || '').trim();
  if (!text) {
    return [];
  }

  const candidates: string[] = [text];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    candidates.unshift(fenced[1].trim());
  }
  const firstJsonStart = text.search(/[\[{]/);
  if (firstJsonStart >= 0) {
    candidates.push(text.slice(firstJsonStart).trim());
    const balanced = extractBalancedJson(text.slice(firstJsonStart));
    if (balanced) {
      candidates.unshift(balanced);
    }
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter((item) => item && typeof item === 'object') as Array<Record<string, unknown>>;
      }
      if (parsed && typeof parsed === 'object') {
        const payload = parsed as Record<string, unknown>;
        const maybeEntries = [payload.entries, payload.knowledgeEntries, payload.items, payload.data].find((item) => Array.isArray(item));
        if (Array.isArray(maybeEntries)) {
          return maybeEntries.filter((item) => item && typeof item === 'object') as Array<Record<string, unknown>>;
        }
      }
    } catch (_error) {
      continue;
    }
  }

  return [];
};

const normalizeRuntimeKnowledgeEntries = (input: {
  rawEntries: Array<Record<string, unknown>>;
  sectionTitle: string;
  isStructuredData?: boolean;
}): Array<{
  title: string;
  content: string;
  summary?: string;
  entryType: DiscussionKnowledgeEntryType;
  sourceUrl?: string;
  sourceName?: string;
  credibility?: DiscussionKnowledgeCredibility;
  topicTags?: string[];
  domainTags?: string[];
  keywordTags?: string[];
  contentDate?: string;
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
}> => {
  const normalizeStringList = (value: unknown): string[] | undefined => {
    if (!Array.isArray(value)) {
      return undefined;
    }
    const list = value.map((item) => String(item || '').trim()).filter(Boolean);
    return list.length ? list : undefined;
  };

  return input.rawEntries
    .map((item) => {
      const title = String(item.title || item.name || '').trim();
      const content = String(item.content || item.detail || item.summary || '').trim();
      if (!title || !content) {
        return null;
      }

      const rawEntryType = String(item.entryType || '').trim();
      const entryType = VALID_RUNTIME_ENTRY_TYPES.has(rawEntryType)
        ? (rawEntryType as DiscussionKnowledgeEntryType)
        : (input.isStructuredData ? DiscussionKnowledgeEntryType.DATA_POINT : DiscussionKnowledgeEntryType.ANALYSIS);

      const rawCredibility = String(item.credibility || '').trim();
      const credibility = VALID_RUNTIME_CREDIBILITY.has(rawCredibility)
        ? (rawCredibility as DiscussionKnowledgeCredibility)
        : undefined;

      const sourceUrl = String(item.sourceUrl || '').trim() || undefined;
      const sourceName = String(item.sourceName || '').trim() || undefined;
      const contentDateRaw = String(item.contentDate || '').trim();
      const contentDate = contentDateRaw && !Number.isNaN(new Date(contentDateRaw).getTime()) ? contentDateRaw : undefined;

      const rawStructuredData = item.structuredData && typeof item.structuredData === 'object'
        ? (item.structuredData as Record<string, unknown>)
        : undefined;
      const compareTo = rawStructuredData?.compareTo && typeof rawStructuredData.compareTo === 'object'
        ? (rawStructuredData.compareTo as Record<string, unknown>)
        : undefined;
      const compareToValue = compareTo?.value;
      const compareToPeriod = String(compareTo?.period || '').trim();
      const compareToChangePercent = Number(compareTo?.changePercent);
      const structuredData = rawStructuredData
        ? {
            value:
              typeof rawStructuredData.value === 'string' || typeof rawStructuredData.value === 'number'
                ? (rawStructuredData.value as string | number)
                : undefined,
            unit: typeof rawStructuredData.unit === 'string' ? rawStructuredData.unit : undefined,
            measureDate: typeof rawStructuredData.measureDate === 'string' ? rawStructuredData.measureDate : undefined,
            compareTo:
              (typeof compareToValue === 'string' || typeof compareToValue === 'number') && compareToPeriod
                ? {
                    value: compareToValue as string | number,
                    period: compareToPeriod,
                    changePercent: Number.isFinite(compareToChangePercent) ? compareToChangePercent : undefined,
                  }
                : undefined,
          }
        : undefined;

      return {
        title,
        content,
        summary: String(item.summary || '').trim() || undefined,
        entryType,
        sourceUrl,
        sourceName,
        credibility,
        topicTags: normalizeStringList(item.topicTags) || [input.sectionTitle],
        domainTags: normalizeStringList(item.domainTags),
        keywordTags: normalizeStringList(item.keywordTags),
        contentDate,
        structuredData,
      };
    })
    .filter(Boolean) as Array<{
    title: string;
    content: string;
    summary?: string;
    entryType: DiscussionKnowledgeEntryType;
    sourceUrl?: string;
    sourceName?: string;
    credibility?: DiscussionKnowledgeCredibility;
    topicTags?: string[];
    domainTags?: string[];
    keywordTags?: string[];
    contentDate?: string;
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
  }>;
};

export const shouldUseDefaultReplyAgent = (content: string, defaultReplyAgentId?: string): boolean => {
  if (!defaultReplyAgentId) {
    return false;
  }

  const hasExplicitMention = /@([^\s@]+)/.test(content || '');
  return !hasExplicitMention;
};

export const buildDiscussionAgentTaskId = (spaceId: string, threadId: string, participantId: string): string => {
  return `discussion-${spaceId}-${threadId}-${participantId}`;
};

export const resolveDiscussionMessageRole = (senderType: DiscussionMessageSenderType): ChatMessage['role'] => {
  if (senderType === DiscussionMessageSenderType.AI) {
    return 'assistant';
  }
  if (senderType === DiscussionMessageSenderType.SYSTEM) {
    return 'system';
  }
  return 'user';
};

export const buildBranchContextMessageContent = (input: {
  parentThreadTitle?: string;
  sourceSequence?: number;
  sourceContent: string;
}): string => {
  const sourceThreadLabel = input.parentThreadTitle?.trim() || '原讨论线';
  const sourceMessageLabel = typeof input.sourceSequence === 'number' && Number.isFinite(input.sourceSequence)
    ? `#${input.sourceSequence}`
    : '该消息';
  const sourceContent = String(input.sourceContent || '').trim();

  return [
    `此分支由「${sourceThreadLabel}」的消息 ${sourceMessageLabel} 创建。`,
    '以下为分叉来源消息：',
    sourceContent || '（分叉来源消息为空）',
  ].join('\n\n');
};

export const buildDataUpdateAnalysisFallbackContent = (input: {
  sourceName: string;
  dataCategory?: string;
  collectedAt?: string;
  changePercent?: number;
  currentData?: Record<string, unknown>;
  previousData?: Record<string, unknown>;
}): string => {
  const sourceName = String(input.sourceName || '').trim() || '数据源';
  const dataCategory = String(input.dataCategory || '').trim() || 'general';
  const collectedAtText = input.collectedAt ? new Date(input.collectedAt).toISOString() : new Date().toISOString();
  const changePercent = Number(input.changePercent);
  const changeText = Number.isFinite(changePercent) ? `${changePercent.toFixed(2)}%` : '未知';
  const currentJson = JSON.stringify(input.currentData || {}, null, 2);
  const previousJson = JSON.stringify(input.previousData || {}, null, 2);

  return [
    `数据更新提醒：${sourceName} (${dataCategory})`,
    `采集时间：${collectedAtText}`,
    `变化幅度：${changeText}`,
    '',
    '当前数据：',
    '```json',
    currentJson,
    '```',
    '',
    '历史基线：',
    '```json',
    previousJson,
    '```',
    '',
    '建议关注：',
    '- 确认该变化是一次性波动还是持续趋势。',
    '- 与同周期其它指标交叉验证，排除单一来源噪音。',
    '- 若变化持续，建议补充背景事件并更新章节结论。',
  ].join('\n');
};

@Injectable()
export class DiscussionMessageService {
  private readonly logger = new Logger(DiscussionMessageService.name);

  constructor(
    @InjectModel(DiscussionMessage.name)
    private readonly discussionMessageModel: Model<DiscussionMessageDocument>,
    private readonly agentClientService: AgentClientService,
    private readonly discussionThreadService: DiscussionThreadService,
    private readonly discussionParticipantService: DiscussionParticipantService,
    private readonly discussionMentionDispatchService: DiscussionMentionDispatchService,
    private readonly discussionKnowledgeService: DiscussionKnowledgeService,
    private readonly discussionSedimentService: DiscussionSedimentService,
    private readonly discussionSpaceService: DiscussionSpaceService,
    private readonly discussionMessageStreamService: DiscussionMessageStreamService,
  ) {}

  private sanitizeDataReferences(
    dataReferences?: Array<{
      dataRecordId: string;
      dataSourceName: string;
      dataPreview: string;
      collectedAt: string;
    }>,
  ): DiscussionMessage['dataReferences'] {
    if (!Array.isArray(dataReferences) || dataReferences.length === 0) {
      return [];
    }

    return dataReferences
      .map((item) => {
        const dataRecordId = String(item?.dataRecordId || '').trim();
        const dataSourceName = String(item?.dataSourceName || '').trim();
        const dataPreview = String(item?.dataPreview || '').trim();
        const collectedAt = new Date(item?.collectedAt || '');
        if (!dataRecordId || !dataSourceName || !dataPreview || Number.isNaN(collectedAt.getTime())) {
          return null;
        }

        return {
          dataRecordId,
          dataSourceName,
          dataPreview: dataPreview.slice(0, 300),
          collectedAt,
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
  }

  private async createSystemMessage(input: {
    spaceId: string;
    threadId: string;
    content: string;
    messageType?: DiscussionMessageType;
    metadata?: Record<string, unknown>;
  }): Promise<DiscussionMessage> {
    const latest = await this.discussionMessageModel
      .findOne({ spaceId: input.spaceId, threadId: input.threadId })
      .sort({ sequence: -1 })
      .lean()
      .exec();
    const nextSequence = (latest?.sequence || 0) + 1;

    const created = await this.discussionMessageModel.create({
      spaceId: input.spaceId,
      threadId: input.threadId,
      participantId: 'system',
      senderType: DiscussionMessageSenderType.SYSTEM,
      content: input.content,
      messageType: input.messageType || DiscussionMessageType.TEXT,
      sequence: nextSequence,
      mentions: [],
      branchSuggestions: [],
      crossReferences: [],
      dataReferences: [],
      knowledgeEntryIds: [],
      metadata: input.metadata,
    });

    await Promise.all([
      this.discussionThreadService.incrementSystemMessageCount(input.spaceId, input.threadId),
      this.discussionSpaceService.incrementStatistics(input.spaceId, { totalMessages: 1 }),
    ]);

    this.discussionMessageStreamService.emitMessageCreated(
      input.spaceId,
      input.threadId,
      created as unknown as DiscussionMessage,
    );

    return created as unknown as DiscussionMessage;
  }

  private buildKnowledgeFingerprint(input: { title?: string; summary?: string; content?: string }): string {
    const title = String(input.title || '').trim().toLowerCase();
    const summary = String(input.summary || '').trim().toLowerCase();
    const content = String(input.content || '').trim().toLowerCase();
    return `${title}|${summary.slice(0, 80)}|${content.slice(0, 80)}`;
  }

  private async resolveSectionRuntimeContext(input: {
    spaceId: string;
    outlineSectionId?: string;
  }): Promise<{
    sectionId: string;
    sectionTitle: string;
    sectionDescription?: string;
    isStructuredData?: boolean;
    sectionKnowledgeSummary: string;
    outlineSummary: string;
  } | null> {
    const sectionId = String(input.outlineSectionId || '').trim();
    if (!sectionId) {
      return null;
    }

    const space = await this.discussionSpaceService.getSpaceById(input.spaceId);
    const outlineSections = Array.isArray(space.documentOutline?.sections) ? space.documentOutline.sections : [];
    const sortedSections = [...outlineSections].sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
    const section = sortedSections.find((item) => String(item.id || '').trim() === sectionId);
    if (!section) {
      return null;
    }

    const sectionEntries = await this.discussionKnowledgeService.listKnowledgeEntries(input.spaceId, {
      outlineSectionId: sectionId,
      limit: 8,
    });
    const sectionKnowledgeSummary = sectionEntries.length
      ? sectionEntries
          .slice(0, 8)
          .map((item, index) => `${index + 1}. ${item.title}${item.summary ? ` - ${item.summary}` : ''}`)
          .join('\n')
      : '（暂无已沉淀条目）';
    const outlineSummary = sortedSections.length
      ? sortedSections
          .slice(0, 30)
          .map((item) => `${'  '.repeat(Math.max(0, Number(item.depth || 0)))}- ${item.title}`)
          .join('\n')
      : '（暂无大纲）';

    return {
      sectionId,
      sectionTitle: section.title,
      sectionDescription: section.description,
      isStructuredData: section.metadata?.isStructuredData,
      sectionKnowledgeSummary,
      outlineSummary,
    };
  }

  async createDataUpdateAnalysisMessage(
    spaceId: string,
    dto: TriggerDiscussionDataAnalysisDto,
  ): Promise<{ created: true; messageId: string; threadId: string }> {
    const space = await this.discussionSpaceService.getSpaceById(spaceId);
    if (space.status === DiscussionSpaceStatus.ARCHIVED) {
      throw new ConflictException('讨论空间已归档，当前为只读状态，无法写入系统分析消息');
    }
    const threadId = String(dto.threadId || space.rootThreadId || '').trim();
    if (!threadId) {
      throw new NotFoundException('讨论空间缺少可用讨论线，无法写入数据分析消息');
    }

    await this.discussionThreadService.getThreadById(spaceId, threadId);

    const content = buildDataUpdateAnalysisFallbackContent({
      sourceName: dto.sourceName,
      dataCategory: dto.dataCategory,
      collectedAt: dto.collectedAt,
      changePercent: dto.changePercent,
      currentData: dto.currentData,
      previousData: dto.previousData,
    });

    const created = await this.createSystemMessage({
      spaceId,
      threadId,
      content,
      metadata: {
        autoAnalysisOnDataUpdate: true,
        dataSourceName: dto.sourceName,
        outlineSectionId: dto.outlineSectionId,
        changePercent: dto.changePercent,
      },
    });

    return {
      created: true,
      messageId: created.id,
      threadId,
    };
  }

  private async buildMentionRuntimeTask(input: {
    spaceId: string;
    threadId: string;
    participant: DiscussionParticipant;
    spaceTitle: string;
    threadTitle: string;
    userPrompt: string;
    recentMessages: DiscussionMessage[];
    knowledgeHints: string;
    sectionContext?: {
      sectionId: string;
      sectionTitle: string;
      sectionDescription?: string;
      sectionKnowledgeSummary: string;
      outlineSummary: string;
    };
  }): Promise<AgentExecutionTask> {
    const compactUserPrompt = String(input.userPrompt || '').trim();
    const taskTitle = `Discussion mention reply | ${input.spaceTitle} / ${input.threadTitle}`;
    const taskDescription = [
      `你是讨论空间中的角色「${input.participant.displayName}」。`,
      `当前你被用户@提及，请基于对话上下文给出直接、可执行的回复。`,
      input.participant.expertise ? `角色领域：${input.participant.expertise}` : '',
      `讨论空间：${input.spaceTitle}`,
      `讨论线：${input.threadTitle}`,
      `用户最新消息：${compactUserPrompt || '（空）'}`,
      input.knowledgeHints ? `可复用知识：\n${input.knowledgeHints}` : '',
      input.sectionContext
        ? [
            `当前是章节协作模式，请围绕章节「${input.sectionContext.sectionTitle}」持续推进。`,
            input.sectionContext.sectionDescription ? `章节说明：${input.sectionContext.sectionDescription}` : '',
            '章节已有知识摘要：',
            input.sectionContext.sectionKnowledgeSummary,
            '当前大纲框架：',
            input.sectionContext.outlineSummary,
            '请优先调用可用搜索工具（如 web.search/web.fetch）检索至少 2 个独立来源，再给出结论。',
            '如果产出结构化知识条目，请使用 JSON code block 返回，格式优先为 {"searchEvidence":[...],"entries":[...]}。',
            'searchEvidence 每条建议包含：sourceName/sourceUrl/snippet/query/fetchedAt。',
            '若关键信息不足，可先提出 1-2 个澄清问题。',
          ]
            .filter(Boolean)
            .join('\n')
        : '',
      '输出要求：聚焦当前问题，优先给出下一步建议；信息不足时可先澄清，再给出可执行结论。',
    ]
      .filter(Boolean)
      .join('\n\n');

    const messages: ChatMessage[] = input.recentMessages.map((item) => ({
      role: resolveDiscussionMessageRole(item.senderType),
      content: String(item.content || ''),
      timestamp: (item as any)?.createdAt ? new Date((item as any).createdAt) : new Date(),
      metadata: {
        discussionMessageId: item.id,
        discussionParticipantId: item.participantId,
      },
    }));

    return {
      id: buildDiscussionAgentTaskId(input.spaceId, input.threadId, input.participant.id),
      title: taskTitle,
      description: taskDescription,
      type: 'discussion_reply',
      priority: 'medium',
      status: 'pending',
      assignedAgents: input.participant.agentId ? [input.participant.agentId] : [],
      teamId: input.spaceId,
      messages,
    };
  }

  private async generateAiMentionReply(input: {
    spaceId: string;
    threadId: string;
    participant: DiscussionParticipant;
    spaceTitle: string;
    threadTitle: string;
    userPrompt: string;
    recentMessages: DiscussionMessage[];
    knowledgeHints: string;
    sectionContext?: {
      sectionId: string;
      sectionTitle: string;
      sectionDescription?: string;
      sectionKnowledgeSummary: string;
      outlineSummary: string;
    };
  }): Promise<{ content: string; runId?: string; sessionId?: string }> {
    const participant = input.participant;
    const agentId = String(participant.agentId || '').trim();
    if (!agentId) {
      const fallback = [
        `@${participant.displayName} 已收到召唤。`,
        participant.expertise ? `结合我的领域 (${participant.expertise})，建议先明确目标和时间窗口。` : '建议先明确目标和时间窗口，再拆解执行步骤。',
        input.knowledgeHints ? `可复用知识:\n${input.knowledgeHints}` : '当前知识库暂无高相关条目，建议先发起一次针对性检索。',
      ].join('\n\n');
      return { content: fallback };
    }

    const task = await this.buildMentionRuntimeTask({
      spaceId: input.spaceId,
      threadId: input.threadId,
      participant,
      spaceTitle: input.spaceTitle,
      threadTitle: input.threadTitle,
      userPrompt: input.userPrompt,
      recentMessages: input.recentMessages,
      knowledgeHints: input.knowledgeHints,
      sectionContext: input.sectionContext,
    });

    const agentSessionId = buildDiscussionAgentTaskId(input.spaceId, input.threadId, participant.id);
    const executionContext = {
      executionMode: 'chat',
      source: 'discussion_mention_runtime',
      agentSessionId,
      collaborationContext: {
        scenarioMode: 'discussion' as const,
        responseDirective: 'text' as const,
        collaborationMode: 'discussion',
        discussionSpaceId: input.spaceId,
        discussionThreadId: input.threadId,
        participantId: participant.id,
        participantName: participant.displayName,
        agentSessionId,
        sessionId: agentSessionId,
        outlineSectionId: input.sectionContext?.sectionId,
      },
      requestMeta: {
        source: 'discussion-message-service',
      },
    };

    const result = await this.agentClientService.executeTaskDetailed(agentId, task, executionContext);
    const reply = String(result.response || '').trim();
    return {
      content: reply ? `@${participant.displayName}\n\n${reply}` : `@${participant.displayName}\n\n（已执行 runtime，但未返回可展示内容）`,
      runId: result.runId,
      sessionId: result.sessionId,
    };
  }

  async sendMessage(spaceId: string, threadId: string, dto: SendDiscussionMessageDto): Promise<SendDiscussionMessageResult> {
    const senderType = dto.senderType || DiscussionMessageSenderType.USER;
    const thread = await this.discussionThreadService.getThreadById(spaceId, threadId);
    await this.discussionParticipantService.getParticipantById(spaceId, dto.participantId);
    const space = await this.discussionSpaceService.getSpaceById(spaceId);
    if (space.status === DiscussionSpaceStatus.ARCHIVED) {
      throw new ConflictException('讨论空间已归档，当前为只读状态，无法发送消息');
    }

    const latest = await this.discussionMessageModel.findOne({ spaceId, threadId }).sort({ sequence: -1 }).lean().exec();
    const nextSequence = (latest?.sequence || 0) + 1;
    let mentions = await this.discussionParticipantService.resolveMentions(spaceId, dto.content);

    if (senderType === DiscussionMessageSenderType.USER && shouldUseDefaultReplyAgent(dto.content, space.settings?.defaultReplyAgentId)) {
      const fallbackAgentId = space.settings?.defaultReplyAgentId || '';
      const [defaultReplyParticipant] = await this.discussionParticipantService.getParticipantsByIds(spaceId, [fallbackAgentId]);

      if (defaultReplyParticipant?.type === DiscussionParticipantType.AI_AGENT) {
        const mentionExists = mentions.some((mention) => mention.participantId === defaultReplyParticipant.id);
        if (!mentionExists) {
          mentions = [
            ...mentions,
            {
              participantId: defaultReplyParticipant.id,
              displayName: defaultReplyParticipant.displayName,
              offset: -1,
            },
          ];
        }
      }
    }

    const userMessage = await this.discussionMessageModel.create({
      spaceId,
      threadId,
      participantId: dto.participantId,
      senderType,
      content: dto.content,
      messageType: dto.messageType || DiscussionMessageType.TEXT,
      sequence: nextSequence,
      mentions,
      branchSuggestions: [],
      crossReferences: [],
      dataReferences: this.sanitizeDataReferences(dto.dataReferences),
      knowledgeEntryIds: [],
      metadata: dto.metadata,
    });
    this.discussionMessageStreamService.emitMessageCreated(spaceId, threadId, userMessage as unknown as DiscussionMessage);

    const aiMessages: DiscussionMessage[] = [];
    let notifiedHumanParticipantIds: string[] = [];

    if (mentions.length && senderType === DiscussionMessageSenderType.USER) {
      const mentionTargets = await this.discussionParticipantService.getParticipantsByIds(
        spaceId,
        mentions.map((mention) => mention.participantId),
      );

      const dispatch = await this.discussionMentionDispatchService.dispatchMentions({
        spaceId,
        threadId,
        messageId: userMessage.id,
        mentionTargets,
        senderParticipantId: dto.participantId,
      });
      notifiedHumanParticipantIds = dispatch.notifiedHumanParticipantIds;

      const aiParticipants = dispatch.aiParticipants.filter((item) => item.type === DiscussionParticipantType.AI_AGENT);
      if (aiParticipants.length) {
        void this.generateAiMessagesAsync({
          spaceId,
          threadId,
          outlineSectionId: thread.outlineSectionId,
          threadTitle: thread.title,
          spaceTitle: space.title,
          userPrompt: dto.content,
          aiParticipants,
          realtimeSedimentMode: space.sedimentMode,
        });
      }
    }

    await Promise.all([
      this.discussionThreadService.incrementMessageCount(spaceId, threadId, dto.participantId),
      this.discussionParticipantService.incrementMessageCount(spaceId, dto.participantId),
      this.discussionSpaceService.incrementStatistics(spaceId, { totalMessages: 1 }),
    ]);

    let realtimeSedimentUpdated = false;
    if (space.sedimentMode === DiscussionSedimentMode.REALTIME) {
      realtimeSedimentUpdated = true;
      void this.generateRealtimeSedimentAsync(spaceId);
    }

    return {
      userMessage,
      aiMessages,
      notifiedHumanParticipantIds,
      generatedKnowledgeEntryIds: [],
      realtimeSedimentUpdated,
    };
  }

  private async generateAiMessagesAsync(input: {
    spaceId: string;
    threadId: string;
    outlineSectionId?: string;
    spaceTitle: string;
    threadTitle: string;
    userPrompt: string;
    aiParticipants: DiscussionParticipant[];
    realtimeSedimentMode: DiscussionSedimentMode;
  }): Promise<void> {
    const sectionContext = await this.resolveSectionRuntimeContext({
      spaceId: input.spaceId,
      outlineSectionId: input.outlineSectionId,
    });

    for (const aiParticipant of input.aiParticipants) {
      this.discussionMessageStreamService.emitAgentExecutionStatus(input.spaceId, input.threadId, {
        participantId: aiParticipant.id,
        agentId: aiParticipant.agentId,
        status: 'running',
      });

      try {
        const runtimeContextMessages = await this.discussionMessageModel
          .find({ spaceId: input.spaceId, threadId: input.threadId })
          .sort({ sequence: -1 })
          .limit(30)
          .lean()
          .exec() as unknown as DiscussionMessage[];
        const recentMessages = [...runtimeContextMessages].sort((a, b) => (a.sequence || 0) - (b.sequence || 0));

        const reusableKnowledge = await this.discussionKnowledgeService.getReusableKnowledge(input.spaceId, {
          topicTags: aiParticipant.expertiseTags,
          limit: 3,
        });
        const knowledgeHints = reusableKnowledge.map((item) => `- ${item.title}: ${item.summary}`).join('\n');

        let responseContent = '';
        let runtimeRunId: string | undefined;
        let runtimeSessionId: string | undefined;

        try {
          const runtimeReply = await this.generateAiMentionReply({
            spaceId: input.spaceId,
            threadId: input.threadId,
            participant: aiParticipant,
            spaceTitle: input.spaceTitle,
            threadTitle: input.threadTitle,
            userPrompt: input.userPrompt,
            recentMessages,
            knowledgeHints,
            sectionContext: sectionContext
              ? {
                  sectionId: sectionContext.sectionId,
                  sectionTitle: sectionContext.sectionTitle,
                  sectionDescription: sectionContext.sectionDescription,
                  sectionKnowledgeSummary: sectionContext.sectionKnowledgeSummary,
                  outlineSummary: sectionContext.outlineSummary,
                }
              : undefined,
          });
          responseContent = runtimeReply.content;
          runtimeRunId = runtimeReply.runId;
          runtimeSessionId = runtimeReply.sessionId;
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error || 'unknown');
          this.logger.error(
            `Runtime mention execution failed: spaceId=${input.spaceId} threadId=${input.threadId} participantId=${aiParticipant.id} reason=${reason}`,
          );
          responseContent = [
            `@${aiParticipant.displayName} runtime 执行失败。`,
            `错误信息：${reason}`,
            '请稍后重试，或检查该 Agent 的可用状态与模型配置。',
          ].join('\n\n');
        }

        const searchEvidence = parseSearchEvidenceFromReply(responseContent);

        const generatedEntries = sectionContext
          ? normalizeRuntimeKnowledgeEntries({
              rawEntries: parseEnrichmentPayloadFromReply(responseContent),
              sectionTitle: sectionContext.sectionTitle,
              isStructuredData: sectionContext.isStructuredData,
            })
          : [];
        const existingSectionEntries = sectionContext
          ? await this.discussionKnowledgeService.listKnowledgeEntries(input.spaceId, {
              outlineSectionId: sectionContext.sectionId,
              limit: 50,
            })
          : [];
        const selectedGeneratedEntries: typeof generatedEntries = [];
        if (sectionContext && generatedEntries.length > 0) {
          const fingerprintSet = new Set(
            existingSectionEntries
              .map((item) =>
                this.buildKnowledgeFingerprint({
                  title: item.title,
                  summary: item.summary,
                  content: item.content,
                }),
              )
              .filter(Boolean),
          );

          for (const entry of generatedEntries) {
            if (looksLikeClarificationResponse(entry.content)) {
              continue;
            }
            const fingerprint = this.buildKnowledgeFingerprint(entry);
            if (!fingerprint || fingerprintSet.has(fingerprint)) {
              continue;
            }
            fingerprintSet.add(fingerprint);
            selectedGeneratedEntries.push(entry);
            if (selectedGeneratedEntries.length >= 8) {
              break;
            }
          }
        }

        const latest = await this.discussionMessageModel
          .findOne({ spaceId: input.spaceId, threadId: input.threadId })
          .sort({ sequence: -1 })
          .lean()
          .exec();
        const aiSequence = (latest?.sequence || 0) + 1;

        const aiMessage = await this.discussionMessageModel.create({
          spaceId: input.spaceId,
          threadId: input.threadId,
          participantId: aiParticipant.id,
          senderType: DiscussionMessageSenderType.AI,
          content: responseContent,
          messageType: DiscussionMessageType.TEXT,
          sequence: aiSequence,
          mentions: [],
          branchSuggestions: [],
          crossReferences: [],
          dataReferences: [],
          knowledgeEntryIds: reusableKnowledge.map((item) => item.id),
          metadata: {
            agentId: aiParticipant.agentId,
            knowledgeHits: reusableKnowledge.length,
            mentionTriggered: true,
            runtimeTriggered: true,
            runtimeRunId,
            runtimeSessionId,
            outlineSectionId: sectionContext?.sectionId,
            searchEvidenceCount: searchEvidence.length,
            searchEvidence,
          },
        });

        const generatedKnowledgeEntryIds: string[] = [];
        for (const generatedEntry of selectedGeneratedEntries) {
          const created = await this.discussionKnowledgeService.createKnowledgeEntry(input.spaceId, {
            participantId: aiParticipant.id,
            threadId: input.threadId,
            messageId: aiMessage.id,
            title: generatedEntry.title,
            content: generatedEntry.content,
            summary: generatedEntry.summary,
            outlineSectionId: sectionContext?.sectionId,
            entryType: generatedEntry.entryType,
            structuredData: generatedEntry.structuredData,
            metadata: {
              isStructuredData: generatedEntry.entryType === DiscussionKnowledgeEntryType.DATA_POINT || Boolean(sectionContext?.isStructuredData),
            },
            sourceUrl: generatedEntry.sourceUrl,
            sourceType: generatedEntry.sourceUrl ? DiscussionKnowledgeSourceType.WEB_SEARCH : DiscussionKnowledgeSourceType.DISCUSSION_DERIVED,
            sourceName: generatedEntry.sourceName || 'outline-section-chat-runtime',
            domainTags: generatedEntry.domainTags,
            topicTags: generatedEntry.topicTags || (sectionContext ? [sectionContext.sectionTitle] : []),
            keywordTags: generatedEntry.keywordTags,
            credibility: generatedEntry.credibility,
            contentDate: generatedEntry.contentDate,
          });
          generatedKnowledgeEntryIds.push(created.id);
        }

        if (reusableKnowledge.length || generatedKnowledgeEntryIds.length) {
          await this.discussionKnowledgeService.linkKnowledgeToMessage(
            input.spaceId,
            aiMessage.id,
            [
              ...reusableKnowledge.map((item) => item.id),
              ...generatedKnowledgeEntryIds,
            ],
          );
        }

        if (generatedKnowledgeEntryIds.length || sectionContext?.sectionId || searchEvidence.length) {
          const mergedMetadata = {
            ...((aiMessage as unknown as DiscussionMessage).metadata || {}),
            generatedKnowledgeEntryIds,
            outlineSectionId: sectionContext?.sectionId,
            searchEvidenceCount: searchEvidence.length,
            searchEvidence,
          };
          await this.discussionMessageModel
            .updateOne(
              { id: aiMessage.id, spaceId: input.spaceId },
              {
                $set: {
                  metadata: mergedMetadata,
                },
              },
            )
            .exec();
          (aiMessage as unknown as DiscussionMessage).metadata = mergedMetadata as DiscussionMessage['metadata'];
        }
        if (generatedKnowledgeEntryIds.length) {
          (aiMessage as unknown as DiscussionMessage).knowledgeEntryIds = [
            ...((aiMessage as unknown as DiscussionMessage).knowledgeEntryIds || []),
            ...generatedKnowledgeEntryIds,
          ];
        }

        await Promise.all([
          this.discussionThreadService.incrementMessageCount(input.spaceId, input.threadId, aiParticipant.id),
          this.discussionParticipantService.incrementMessageCount(input.spaceId, aiParticipant.id),
          this.discussionSpaceService.incrementStatistics(input.spaceId, { totalMessages: 1 }),
        ]);

        this.discussionMessageStreamService.emitMessageCreated(
          input.spaceId,
          input.threadId,
          aiMessage as unknown as DiscussionMessage,
        );
        this.discussionMessageStreamService.emitAgentExecutionStatus(input.spaceId, input.threadId, {
          participantId: aiParticipant.id,
          agentId: aiParticipant.agentId,
          status: 'completed',
        });
      } catch (error) {
        this.logger.error(
          `Async AI mention message generation failed: spaceId=${input.spaceId} threadId=${input.threadId} participantId=${aiParticipant.id} reason=${error instanceof Error ? error.message : 'unknown'}`,
        );
        this.discussionMessageStreamService.emitAgentExecutionStatus(input.spaceId, input.threadId, {
          participantId: aiParticipant.id,
          agentId: aiParticipant.agentId,
          status: 'failed',
          reason: error instanceof Error ? error.message : 'unknown',
        });
      }
    }

    if (input.realtimeSedimentMode === DiscussionSedimentMode.REALTIME) {
      await this.generateRealtimeSedimentAsync(input.spaceId);
    }
  }

  private async generateRealtimeSedimentAsync(spaceId: string): Promise<void> {
    try {
      await this.discussionSedimentService.generateSediment({
        spaceId,
        mode: DiscussionSedimentMode.REALTIME,
        trigger: 'realtime_auto',
      });
    } catch (error) {
      this.logger.warn(
        `Realtime sediment generation failed: spaceId=${spaceId} reason=${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }

  async listMessages(spaceId: string, threadId: string, limit = 100): Promise<DiscussionMessage[]> {
    await this.discussionThreadService.getThreadById(spaceId, threadId);

    return this.discussionMessageModel
      .find({ spaceId, threadId })
      .sort({ sequence: 1 })
      .limit(Math.max(1, Math.min(limit, 500)))
      .lean()
      .exec() as unknown as DiscussionMessage[];
  }

  async getMessageById(spaceId: string, threadId: string, messageId: string): Promise<DiscussionMessage> {
    const message = await this.discussionMessageModel.findOne({ id: messageId, spaceId, threadId }).lean().exec();
    if (!message) {
      throw new NotFoundException(`消息不存在: ${messageId}`);
    }
    return message as unknown as DiscussionMessage;
  }

  async createBranchContextMessage(input: {
    spaceId: string;
    threadId: string;
    parentThreadTitle?: string;
    sourceMessage: DiscussionMessage;
  }): Promise<DiscussionMessage> {
    const latest = await this.discussionMessageModel.findOne({ spaceId: input.spaceId, threadId: input.threadId }).sort({ sequence: -1 }).lean().exec();
    const nextSequence = (latest?.sequence || 0) + 1;

    const content = buildBranchContextMessageContent({
      parentThreadTitle: input.parentThreadTitle,
      sourceSequence: input.sourceMessage.sequence,
      sourceContent: input.sourceMessage.content,
    });

    const created = await this.discussionMessageModel.create({
      spaceId: input.spaceId,
      threadId: input.threadId,
      participantId: 'system',
      senderType: DiscussionMessageSenderType.SYSTEM,
      content,
      messageType: DiscussionMessageType.BRANCH_CONTEXT,
      sequence: nextSequence,
      mentions: [],
      branchSuggestions: [],
      crossReferences: [],
      dataReferences: [],
      knowledgeEntryIds: [],
    });

    await Promise.all([
      this.discussionThreadService.incrementSystemMessageCount(input.spaceId, input.threadId),
      this.discussionSpaceService.incrementStatistics(input.spaceId, { totalMessages: 1 }),
    ]);

    return created as unknown as DiscussionMessage;
  }
}
