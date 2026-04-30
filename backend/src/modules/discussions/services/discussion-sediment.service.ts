import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { MessageEvent } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomUUID } from 'crypto';
import { Observable, Subject } from 'rxjs';
import { AgentExecutionTask, ChatMessage } from '../../../shared/types';
import {
  DiscussionMessage,
  DiscussionMessageDocument,
  DiscussionMessageSenderType,
} from '../../../shared/schemas/discussion-message.schema';
import {
  DiscussionSedimentMode,
  DiscussionSpace,
  DiscussionSpaceDocument,
} from '../../../shared/schemas/discussion-space.schema';
import { DiscussionThread, DiscussionThreadDocument } from '../../../shared/schemas/discussion-thread.schema';
import { AgentClientService } from '../../agents-client/agent-client.service';
import { DiscussionKnowledgeService } from './discussion-knowledge.service';

export interface GeneratedSedimentResult {
  mode: DiscussionSedimentMode;
  version: number;
  title: string;
  content: string;
  threadScope: string[];
  createdAt: string;
}

export interface DiscussionSedimentHistoryItem {
  id: string;
  version: number;
  title: string;
  content: string;
  threadScope: string[];
  createdAt: string;
}

export interface DiscussionSedimentHistoryResult {
  mode: DiscussionSedimentMode;
  items: DiscussionSedimentHistoryItem[];
}

export type DiscussionSedimentTaskStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface DiscussionSedimentTaskSnapshot {
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
  result?: GeneratedSedimentResult;
}

export interface DiscussionSedimentTaskEventPayload {
  type:
    | 'discussion.sediment.task.snapshot'
    | 'discussion.sediment.task.running'
    | 'discussion.sediment.task.succeeded'
    | 'discussion.sediment.task.failed';
  data: {
    task: DiscussionSedimentTaskSnapshot;
  };
}

const SEDIMENT_CONTEXT_MESSAGE_LIMIT = 60;
const MEETING_ASSISTANT_ROLE_CODE = 'meeting-assistant';
const SEDIMENT_TASK_RETENTION_MS = 30 * 60 * 1000;
const DEFAULT_SEDIMENT_TITLE = '未命名沉淀';

const buildSedimentTaskId = (spaceId: string): string => {
  return `discussion-sediment-${spaceId}-${randomUUID()}`;
};

const resolveDiscussionMessageRole = (senderType: DiscussionMessageSenderType): ChatMessage['role'] => {
  if (senderType === DiscussionMessageSenderType.AI) {
    return 'assistant';
  }
  if (senderType === DiscussionMessageSenderType.SYSTEM) {
    return 'system';
  }
  return 'user';
};

export function buildSedimentMarkdown(input: {
  sedimentTitle: string;
  spaceTitle: string;
  threads: Array<{ id: string; title: string; depth: number }>;
  messages: DiscussionMessage[];
  knowledge: Array<{ title: string; summary: string; credibility: string }>;
}): string {
  const lines: string[] = [];
  lines.push(`# ${input.sedimentTitle}`);
  lines.push('');
  lines.push(`> 讨论主题：${input.spaceTitle}`);
  lines.push('');
  lines.push('## 讨论沉淀摘要');

  const latestMessages = input.messages.slice(-3).map((message) => message.content.trim()).filter(Boolean);
  if (latestMessages.length) {
    lines.push(`最近讨论聚焦于：${latestMessages.join('；')}`);
  } else {
    lines.push('当前暂无有效讨论内容。');
  }

  lines.push('');
  lines.push('## 讨论线梳理');

  for (const thread of input.threads) {
    lines.push(`### ${'  '.repeat(Math.max(0, thread.depth))}${thread.title}`);
    const threadMessages = input.messages
      .filter((message) => message.threadId === thread.id)
      .slice(-5)
      .map((message) => {
        const sender =
          message.senderType === DiscussionMessageSenderType.AI
            ? 'AI'
            : message.senderType === DiscussionMessageSenderType.SYSTEM
              ? '系统'
              : '用户';
        return `- [${sender}] ${message.content.replace(/\s+/g, ' ').trim()}`;
      });

    if (!threadMessages.length) {
      lines.push('- 暂无消息');
    } else {
      lines.push(...threadMessages);
    }
    lines.push('');
  }

  lines.push('## 知识积累');
  if (!input.knowledge.length) {
    lines.push('- 暂无知识条目');
  } else {
    for (const item of input.knowledge.slice(0, 10)) {
      lines.push(`- ${item.title}（可信度：${item.credibility}）: ${item.summary}`);
    }
  }

  return lines.join('\n').trim();
}

@Injectable()
export class DiscussionSedimentService {
  private readonly logger = new Logger(DiscussionSedimentService.name);
  private readonly sedimentTaskStore = new Map<string, DiscussionSedimentTaskSnapshot>();
  private readonly sedimentTaskChannels = new Map<string, Set<Subject<MessageEvent>>>();

  constructor(
    @InjectModel(DiscussionSpace.name)
    private readonly discussionSpaceModel: Model<DiscussionSpaceDocument>,
    @InjectModel(DiscussionThread.name)
    private readonly discussionThreadModel: Model<DiscussionThreadDocument>,
    @InjectModel(DiscussionMessage.name)
    private readonly discussionMessageModel: Model<DiscussionMessageDocument>,
    private readonly agentClientService: AgentClientService,
    private readonly discussionKnowledgeService: DiscussionKnowledgeService,
  ) {}

  private touchTask(task: DiscussionSedimentTaskSnapshot): DiscussionSedimentTaskSnapshot {
    const next = {
      ...task,
      updatedAt: new Date().toISOString(),
    };
    this.sedimentTaskStore.set(task.taskId, next);
    return next;
  }

  private emitTaskEvent(taskId: string, payload: DiscussionSedimentTaskEventPayload): void {
    const channels = this.sedimentTaskChannels.get(taskId);
    if (!channels?.size) {
      return;
    }

    const event: MessageEvent = {
      data: payload,
    };

    for (const channel of channels) {
      channel.next(event);
    }
  }

  private scheduleTaskCleanup(taskId: string): void {
    setTimeout(() => {
      this.sedimentTaskStore.delete(taskId);
      this.sedimentTaskChannels.delete(taskId);
    }, SEDIMENT_TASK_RETENTION_MS);
  }

  private resolveSedimentHistoryId(item: Record<string, any>): string {
    const rawId = typeof item.id === 'string' ? item.id.trim() : '';
    if (rawId) {
      return rawId;
    }
    return String(item.version || '0');
  }

  private isSedimentHistoryDeleted(item: Record<string, any>): boolean {
    return Boolean(item?.isDeleted);
  }

  private listActiveSedimentHistory(space: DiscussionSpace): Array<Record<string, any>> {
    const history = Array.isArray(space.sedimentHistory) ? space.sedimentHistory : [];
    return history.filter((item) => !this.isSedimentHistoryDeleted(item as Record<string, any>));
  }

  private extractAgentCandidateValue(candidate: Record<string, unknown>, key: string): string {
    const value = candidate[key];
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
  }

  private isMeetingAssistantAgent(candidate: Record<string, unknown>): boolean {
    const roleCode = this.extractAgentCandidateValue(candidate, 'roleCode');
    const agentType = this.extractAgentCandidateValue(candidate, 'agentType');
    const roleName = this.extractAgentCandidateValue(candidate, 'roleName');
    const name = this.extractAgentCandidateValue(candidate, 'name');
    const description = this.extractAgentCandidateValue(candidate, 'description');

    if (roleCode === MEETING_ASSISTANT_ROLE_CODE) {
      return true;
    }

    if (agentType === 'ai-meeting-assistant') {
      return true;
    }

    const labels = `${roleName} ${name} ${description}`;
    return labels.includes('会议助理') || labels.includes('会议助手') || labels.includes('meeting assistant');
  }

  private async resolveMeetingAssistantAgentId(projectId?: string): Promise<string | null> {
    const projectAgents = await this.agentClientService.getActiveAgents(projectId ? { projectId } : undefined);
    const projectMatch = projectAgents.find((item) => this.isMeetingAssistantAgent(item as unknown as Record<string, unknown>));
    if (projectMatch?.id) {
      return String(projectMatch.id);
    }

    if (projectId) {
      const globalAgents = await this.agentClientService.getActiveAgents();
      const globalMatch = globalAgents.find((item) => this.isMeetingAssistantAgent(item as unknown as Record<string, unknown>));
      if (globalMatch?.id) {
        return String(globalMatch.id);
      }
    }

    return null;
  }

  private buildSedimentRuntimeTask(input: {
    spaceId: string;
    sedimentTitle: string;
    spaceTitle: string;
    threadScope: string[];
    threads: Array<{ id: string; title: string; depth: number }>;
    messages: DiscussionMessage[];
    knowledge: Array<{ title: string; summary: string; credibility: string }>;
  }): AgentExecutionTask {
    const threadLines = input.threads
      .map((thread) => `${'  '.repeat(Math.max(0, thread.depth))}- ${thread.title} (${thread.id})`)
      .join('\n');

    const knowledgeLines = input.knowledge.length
      ? input.knowledge.map((item) => `- ${item.title}（可信度：${item.credibility}）: ${item.summary}`).join('\n')
      : '- 暂无知识条目';

    const description = [
      `请基于以下讨论上下文，输出一份可复用的结构化讨论沉淀文档（Markdown）。`,
      `沉淀标题：${input.sedimentTitle}`,
      `讨论主题：${input.spaceTitle}`,
      `讨论线范围：${input.threadScope.length ? input.threadScope.join(', ') : '全部讨论线'}`,
      `\n【讨论线结构】\n${threadLines || '- 暂无讨论线'}`,
      `\n【知识积累】\n${knowledgeLines}`,
      '输出要求：包含“讨论沉淀摘要 / 讨论线梳理 / 关键结论与下一步 / 知识积累”四个部分；内容简明、可执行。',
    ].join('\n\n');

    const messages: ChatMessage[] = input.messages.slice(-SEDIMENT_CONTEXT_MESSAGE_LIMIT).map((message) => ({
      role: resolveDiscussionMessageRole(message.senderType),
      content: String(message.content || ''),
      timestamp: (message as any)?.createdAt ? new Date((message as any).createdAt) : new Date(),
      metadata: {
        discussionMessageId: message.id,
        threadId: message.threadId,
      },
    }));

    return {
      id: buildSedimentTaskId(input.spaceId),
      title: `Discussion sediment | ${input.sedimentTitle}`,
      description,
      type: 'discussion_sediment',
      priority: 'medium',
      status: 'pending',
      assignedAgents: [],
      teamId: input.spaceId,
      messages,
    };
  }

  private async generateSedimentByMeetingAssistant(input: {
    spaceId: string;
    projectId?: string;
    sedimentTitle: string;
    mode: DiscussionSedimentMode;
    threadScope: string[];
    spaceTitle: string;
    threads: Array<{ id: string; title: string; depth: number }>;
    messages: DiscussionMessage[];
    knowledge: Array<{ title: string; summary: string; credibility: string }>;
  }): Promise<{ content: string; runId?: string; sessionId?: string; agentId?: string }> {
    const meetingAssistantAgentId = await this.resolveMeetingAssistantAgentId(input.projectId);
    if (!meetingAssistantAgentId) {
      throw new NotFoundException('未找到可用的会议助手 Agent，无法执行沉淀。');
    }

    const task = this.buildSedimentRuntimeTask({
      spaceId: input.spaceId,
      sedimentTitle: input.sedimentTitle,
      spaceTitle: input.spaceTitle,
      threadScope: input.threadScope,
      threads: input.threads,
      messages: input.messages,
      knowledge: input.knowledge,
    });
    task.assignedAgents = [meetingAssistantAgentId];

    const executionContext = {
      executionMode: 'chat',
      source: 'discussion_sediment_runtime',
      agentSessionId: buildSedimentTaskId(input.spaceId),
      collaborationContext: {
        scene: 'discussion',
        spaceId: input.spaceId,
        sedimentMode: input.mode,
        threadScope: input.threadScope,
      },
      requestMeta: {
        source: 'discussion-sediment-service',
      },
    };

    const result = await this.agentClientService.executeTaskDetailed(meetingAssistantAgentId, task, executionContext);
    const content = String(result.response || '').trim();
    if (!content) {
      throw new Error('会议助手未返回可展示的沉淀内容');
    }

    return {
      content,
      runId: result.runId,
      sessionId: result.sessionId,
      agentId: meetingAssistantAgentId,
    };
  }

  async createSedimentTask(input: {
    spaceId: string;
    mode?: DiscussionSedimentMode;
    title?: string;
    threadScope?: string[];
  }): Promise<DiscussionSedimentTaskSnapshot> {
    const taskId = buildSedimentTaskId(input.spaceId);
    const now = new Date().toISOString();
    const title = String(input.title || '').trim() || DEFAULT_SEDIMENT_TITLE;
    const task: DiscussionSedimentTaskSnapshot = {
      taskId,
      spaceId: input.spaceId,
      title,
      status: 'queued',
      mode: input.mode || DiscussionSedimentMode.MANUAL,
      threadScope: Array.isArray(input.threadScope) ? input.threadScope : [],
      createdAt: now,
      updatedAt: now,
    };

    this.sedimentTaskStore.set(taskId, task);
    this.emitTaskEvent(taskId, {
      type: 'discussion.sediment.task.snapshot',
      data: { task },
    });

    void this.runSedimentTask(taskId, {
      spaceId: input.spaceId,
      mode: input.mode,
      title,
      threadScope: input.threadScope,
    });

    return task;
  }

  async streamSedimentTaskEvents(spaceId: string, taskId: string): Promise<Observable<MessageEvent>> {
    const task = this.sedimentTaskStore.get(taskId);
    if (!task || task.spaceId !== spaceId) {
      throw new NotFoundException(`沉淀任务不存在: ${taskId}`);
    }

    return new Observable<MessageEvent>((subscriber) => {
      let channels = this.sedimentTaskChannels.get(taskId);
      if (!channels) {
        channels = new Set<Subject<MessageEvent>>();
        this.sedimentTaskChannels.set(taskId, channels);
      }

      const channel = new Subject<MessageEvent>();
      const subscription = channel.subscribe({
        next: (event) => subscriber.next(event),
        error: (error) => subscriber.error(error),
        complete: () => subscriber.complete(),
      });

      channels.add(channel);
      channel.next({
        data: {
          type: 'discussion.sediment.task.snapshot',
          data: {
            task,
          },
        },
      });

      if (task.status === 'succeeded') {
        channel.next({ data: { type: 'discussion.sediment.task.succeeded', data: { task } } });
      }
      if (task.status === 'failed') {
        channel.next({ data: { type: 'discussion.sediment.task.failed', data: { task } } });
      }

      return () => {
        subscription.unsubscribe();
        const target = this.sedimentTaskChannels.get(taskId);
        if (!target) {
          return;
        }
        target.delete(channel);
        channel.complete();
        if (!target.size) {
          this.sedimentTaskChannels.delete(taskId);
        }
      };
    });
  }

  private async runSedimentTask(
    taskId: string,
    input: {
      spaceId: string;
      mode?: DiscussionSedimentMode;
      title?: string;
      threadScope?: string[];
    },
  ): Promise<void> {
    const current = this.sedimentTaskStore.get(taskId);
    if (!current) {
      return;
    }

    const runningTask = this.touchTask({
      ...current,
      status: 'running',
      startedAt: new Date().toISOString(),
      error: undefined,
    });

    this.emitTaskEvent(taskId, {
      type: 'discussion.sediment.task.running',
      data: { task: runningTask },
    });

    try {
      const result = await this.generateSediment({
        spaceId: input.spaceId,
        mode: input.mode,
        title: input.title,
        threadScope: input.threadScope,
        trigger: 'manual',
      });

      const succeededTask = this.touchTask({
        ...runningTask,
        status: 'succeeded',
        finishedAt: new Date().toISOString(),
        result,
      });

      this.emitTaskEvent(taskId, {
        type: 'discussion.sediment.task.succeeded',
        data: { task: succeededTask },
      });
    } catch (error) {
      const failedTask = this.touchTask({
        ...runningTask,
        status: 'failed',
        finishedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : '沉淀任务执行失败',
      });

      this.emitTaskEvent(taskId, {
        type: 'discussion.sediment.task.failed',
        data: { task: failedTask },
      });
    } finally {
      this.scheduleTaskCleanup(taskId);
    }
  }

  async updateSedimentMode(spaceId: string, mode: DiscussionSedimentMode): Promise<DiscussionSpace> {
    const updated = await this.discussionSpaceModel
      .findOneAndUpdate({ id: spaceId }, { $set: { sedimentMode: mode } }, { new: true })
      .lean()
      .exec();

    if (!updated) {
      throw new NotFoundException(`讨论空间不存在: ${spaceId}`);
    }

    return updated as unknown as DiscussionSpace;
  }

  async generateSediment(input: {
    spaceId: string;
    mode?: DiscussionSedimentMode;
    title?: string;
    threadScope?: string[];
    trigger?: 'manual' | 'realtime_auto';
  }): Promise<GeneratedSedimentResult> {
    const space = await this.discussionSpaceModel.findOne({ id: input.spaceId }).lean().exec();
    if (!space) {
      throw new NotFoundException(`讨论空间不存在: ${input.spaceId}`);
    }

    const threadFilter: Record<string, any> = { spaceId: input.spaceId };
    if (input.threadScope?.length) {
      threadFilter.id = { $in: input.threadScope };
    }

    const threads = (await this.discussionThreadModel
      .find(threadFilter)
      .sort({ depth: 1, createdAt: 1 })
      .lean()
      .exec()) as unknown as DiscussionThread[];

    const threadIds = threads.map((thread) => thread.id);
    const messages = (await this.discussionMessageModel
      .find({ spaceId: input.spaceId, ...(threadIds.length ? { threadId: { $in: threadIds } } : {}) })
      .sort({ createdAt: 1 })
      .lean()
      .exec()) as unknown as DiscussionMessage[];

    const knowledgeEntries = await this.discussionKnowledgeService.listKnowledgeEntries(input.spaceId, {
      limit: 20,
    });

    const history = Array.isArray(space.sedimentHistory) ? space.sedimentHistory : [];
    const maxVersion = history.reduce((acc, item) => {
      const version = Number((item as Record<string, any>)?.version || 0);
      return Number.isFinite(version) ? Math.max(acc, version) : acc;
    }, 0);
    const nextVersion = maxVersion + 1;
    const createdAt = new Date();
    const mode = input.mode || space.sedimentMode || DiscussionSedimentMode.MANUAL;
    const trigger = input.trigger || 'manual';
    const title = String(input.title || '').trim() || `讨论沉淀 V${nextVersion}`;

    const threadSummaries = threads.map((thread) => ({ id: thread.id, title: thread.title, depth: thread.depth }));
    const knowledgeSummaries = knowledgeEntries.map((item) => ({
      title: item.title,
      summary: item.summary,
      credibility: item.credibility,
    }));

    let content = '';
    let runtimeRunId: string | undefined;
    let runtimeSessionId: string | undefined;
    let runtimeAgentId: string | undefined;

    if (trigger === 'manual') {
      try {
        const runtimeResult = await this.generateSedimentByMeetingAssistant({
          spaceId: input.spaceId,
          projectId: space.projectId,
          sedimentTitle: title,
          mode,
          threadScope: threadIds,
          spaceTitle: space.title,
          threads: threadSummaries,
          messages,
          knowledge: knowledgeSummaries,
        });
        content = runtimeResult.content;
        runtimeRunId = runtimeResult.runId;
        runtimeSessionId = runtimeResult.sessionId;
        runtimeAgentId = runtimeResult.agentId;
      } catch (error) {
        this.logger.warn(
          `Meeting assistant sediment failed, fallback to template: spaceId=${input.spaceId} reason=${error instanceof Error ? error.message : 'unknown'}`,
        );
      }
    }

    if (!content) {
      content = buildSedimentMarkdown({
        sedimentTitle: title,
        spaceTitle: space.title,
        threads: threadSummaries,
        messages,
        knowledge: knowledgeSummaries,
      });
    }

    const existingOutline = (space.documentOutline || {}) as Record<string, any>;
    const existingSections = Array.isArray(existingOutline.sections) ? existingOutline.sections : [];
    const hasStructuredSections =
      existingSections.length > 0 &&
      typeof existingSections[0] === 'object' &&
      existingSections[0] !== null &&
      typeof existingSections[0].title === 'string';
    const nextDocumentOutline = hasStructuredSections
      ? {
          ...existingOutline,
          updatedAt: createdAt,
          runId: runtimeRunId || existingOutline.runId,
          sessionId: runtimeSessionId || existingOutline.sessionId,
          agentId: runtimeAgentId || existingOutline.agentId,
        }
      : {
          version: Number(existingOutline.version || 1),
          title: existingOutline.title || `${space.title} 大纲`,
          sections: [
            {
              id: randomUUID(),
              title: '讨论沉淀摘要',
              order: 0,
              depth: 0,
              status: 'sufficient',
              knowledgeCount: 0,
              childSectionIds: [],
            },
            {
              id: randomUUID(),
              title: '讨论线梳理',
              order: 1,
              depth: 0,
              status: 'sufficient',
              knowledgeCount: 0,
              childSectionIds: [],
            },
            {
              id: randomUUID(),
              title: '知识积累',
              order: 2,
              depth: 0,
              status: 'draft',
              knowledgeCount: knowledgeEntries.length,
              childSectionIds: [],
            },
          ],
          createdAt: existingOutline.createdAt || createdAt,
          updatedAt: createdAt,
          generatedBy: runtimeAgentId ? 'agent' : trigger === 'manual' ? 'hybrid' : 'human',
          runId: runtimeRunId,
          sessionId: runtimeSessionId,
          agentId: runtimeAgentId,
        };

    await this.discussionSpaceModel
      .updateOne(
        { id: input.spaceId },
        {
          $set: {
            sedimentMode: mode,
            latestSedimentTitle: title,
            latestSedimentedDocument: content,
            documentOutline: nextDocumentOutline,
          },
          $push: {
            sedimentHistory: {
              id: randomUUID(),
              version: nextVersion,
              title,
              content,
              threadScope: threadIds,
              createdAt,
              isDeleted: false,
            },
          },
        },
      )
      .exec();

    return {
      mode,
      version: nextVersion,
      title,
      content,
      threadScope: threadIds,
      createdAt: createdAt.toISOString(),
    };
  }

  async getLatestSediment(spaceId: string): Promise<GeneratedSedimentResult | null> {
    const space = await this.discussionSpaceModel.findOne({ id: spaceId }).lean().exec();
    if (!space) {
      return null;
    }

    const activeHistory = this.listActiveSedimentHistory(space as unknown as DiscussionSpace);
    if (!activeHistory.length) {
      return null;
    }

    const latest = [...activeHistory].sort((a, b) => {
      const left = new Date(a.createdAt || 0).getTime();
      const right = new Date(b.createdAt || 0).getTime();
      return right - left;
    })[0];

    const latestContent = String(latest.content || '').trim();
    if (!latestContent) {
      return null;
    }

    return {
      mode: space.sedimentMode || DiscussionSedimentMode.MANUAL,
      version: Number(latest.version || 1),
      title: String(latest.title || space.latestSedimentTitle || DEFAULT_SEDIMENT_TITLE),
      content: latestContent,
      threadScope: Array.isArray(latest.threadScope) ? latest.threadScope : [],
      createdAt: latest.createdAt ? new Date(latest.createdAt).toISOString() : new Date().toISOString(),
    };
  }

  async listSedimentHistory(spaceId: string, limit = 20): Promise<DiscussionSedimentHistoryResult> {
    const space = await this.discussionSpaceModel.findOne({ id: spaceId }).lean().exec();
    if (!space) {
      throw new NotFoundException(`讨论空间不存在: ${spaceId}`);
    }

    const normalizedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(limit, 100)) : 20;
    const history = this.listActiveSedimentHistory(space as unknown as DiscussionSpace);

    const items = [...history]
      .sort((a, b) => {
        const left = new Date(a.createdAt || 0).getTime();
        const right = new Date(b.createdAt || 0).getTime();
        return right - left;
      })
      .slice(0, normalizedLimit)
      .map((item) => ({
        id: this.resolveSedimentHistoryId(item),
        version: item.version,
        title: String(item.title || DEFAULT_SEDIMENT_TITLE),
        content: item.content,
        threadScope: Array.isArray(item.threadScope) ? item.threadScope : [],
        createdAt: item.createdAt ? new Date(item.createdAt).toISOString() : new Date().toISOString(),
      }));

    return {
      mode: space.sedimentMode || DiscussionSedimentMode.MANUAL,
      items,
    };
  }

  async deleteSedimentHistory(
    spaceId: string,
    historyId: string,
    operatorId: string,
  ): Promise<{ deleted: true; historyId: string }> {
    const normalizedOperatorId = String(operatorId || '').trim();
    if (!normalizedOperatorId) {
      throw new BadRequestException('删除沉淀历史需要提供 operatorId');
    }

    const space = await this.discussionSpaceModel.findOne({ id: spaceId }).lean().exec();
    if (!space) {
      throw new NotFoundException(`讨论空间不存在: ${spaceId}`);
    }

    if (space.creatorId !== normalizedOperatorId) {
      throw new ForbiddenException('仅讨论空间创建者可删除沉淀历史');
    }

    const rawHistory = Array.isArray(space.sedimentHistory) ? space.sedimentHistory : [];
    const now = new Date();
    let deletedHistoryId = '';
    const nextHistory = rawHistory.map((item) => {
      const normalized = item as Record<string, any>;
      const itemHistoryId = this.resolveSedimentHistoryId(normalized);
      if (this.isSedimentHistoryDeleted(normalized)) {
        return normalized;
      }
      if (itemHistoryId !== historyId) {
        return normalized;
      }

      deletedHistoryId = itemHistoryId;
      return {
        ...normalized,
        isDeleted: true,
        deletedAt: now,
        deletedBy: normalizedOperatorId,
      };
    });

    if (!deletedHistoryId) {
      throw new NotFoundException(`沉淀历史不存在: ${historyId}`);
    }

    const activeHistory = nextHistory
      .filter((item) => !this.isSedimentHistoryDeleted(item))
      .sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
    const latest = activeHistory[activeHistory.length - 1];

    await this.discussionSpaceModel
      .updateOne(
        { id: spaceId },
        {
          $set: {
            sedimentHistory: nextHistory,
            latestSedimentedDocument: latest?.content || '',
            latestSedimentTitle: String(latest?.title || ''),
          },
        },
      )
      .exec();

    return {
      deleted: true,
      historyId: deletedHistoryId,
    };
  }
}
