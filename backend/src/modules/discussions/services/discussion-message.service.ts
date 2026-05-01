import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  DiscussionMessage,
  DiscussionMessageDocument,
  DiscussionMessageSenderType,
  DiscussionMessageType,
} from '../../../shared/schemas/discussion-message.schema';
import { DiscussionParticipant, DiscussionParticipantType } from '../../../shared/schemas/discussion-participant.schema';
import { DiscussionSedimentMode } from '../../../shared/schemas/discussion-space.schema';
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

  async createDataUpdateAnalysisMessage(
    spaceId: string,
    dto: TriggerDiscussionDataAnalysisDto,
  ): Promise<{ created: true; messageId: string; threadId: string }> {
    const space = await this.discussionSpaceService.getSpaceById(spaceId);
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
      '输出要求：聚焦当前问题，优先给出下一步建议；如信息不足，明确指出缺失项。',
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
    });

    const agentSessionId = buildDiscussionAgentTaskId(input.spaceId, input.threadId, participant.id);
    const executionContext = {
      executionMode: 'chat',
      source: 'discussion_mention_runtime',
      agentSessionId,
      collaborationContext: {
        scene: 'discussion',
        spaceId: input.spaceId,
        threadId: input.threadId,
        participantId: participant.id,
        participantName: participant.displayName,
        agentSessionId,
        sessionId: agentSessionId,
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
    spaceTitle: string;
    threadTitle: string;
    userPrompt: string;
    aiParticipants: DiscussionParticipant[];
    realtimeSedimentMode: DiscussionSedimentMode;
  }): Promise<void> {
    for (const aiParticipant of input.aiParticipants) {
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
          },
        });

        if (reusableKnowledge.length) {
          await this.discussionKnowledgeService.linkKnowledgeToMessage(
            input.spaceId,
            aiMessage.id,
            reusableKnowledge.map((item) => item.id),
          );
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
      } catch (error) {
        this.logger.error(
          `Async AI mention message generation failed: spaceId=${input.spaceId} threadId=${input.threadId} participantId=${aiParticipant.id} reason=${error instanceof Error ? error.message : 'unknown'}`,
        );
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
