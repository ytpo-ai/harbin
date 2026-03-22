import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { AgentRun, AgentRunDocument } from '../../schemas/agent-run.schema';
import { AgentMessage, AgentMessageDocument } from '../../schemas/agent-message.schema';
import { AgentPart, AgentPartDocument } from '../../schemas/agent-part.schema';
import { AgentEventOutbox, AgentEventOutboxDocument } from '../../schemas/agent-event-outbox.schema';
import {
  AgentRuntimeMaintenanceAudit,
  AgentRuntimeMaintenanceAuditDocument,
} from '../../schemas/agent-runtime-maintenance-audit.schema';
import { RuntimeEvent, RuntimeEventSchema } from './contracts/runtime-event.contract';
import { AgentSession, AgentSessionDocument } from '../../schemas/agent-session.schema';
import { buildSystemContextKey, normalizeSystemContent } from '../agents/context/context-fingerprint.util';

type SessionPartView = Pick<
  AgentPart,
  'id' | 'runId' | 'messageId' | 'sequence' | 'type' | 'status' | 'toolId' | 'toolCallId' | 'input' | 'output' | 'content' | 'error' | 'startedAt' | 'endedAt'
> & {
  taskId?: string;
  timestamp: Date;
};

type SessionMessageView = Pick<
  AgentMessage,
  | 'id'
  | 'runId'
  | 'taskId'
  | 'parentMessageId'
  | 'role'
  | 'sequence'
  | 'content'
  | 'status'
  | 'metadata'
  | 'modelID'
  | 'providerID'
  | 'finish'
  | 'tokens'
  | 'cost'
  | 'stepIndex'
> & {
  timestamp: Date;
};

export type AgentSessionDetailView = AgentSession & {
  messages: SessionMessageView[];
  parts: SessionPartView[];
};

type InitialSystemMessageRecord = {
  content: string;
  metadata?: Record<string, unknown>;
};

@Injectable()
export class RuntimePersistenceService {
  private readonly maxSessionMessages = Number(process.env.AGENT_SESSION_MAX_MESSAGES || 1200);

  private normalizeInitialSystemMessages(input: unknown): InitialSystemMessageRecord[] {
    if (!Array.isArray(input)) {
      return [];
    }
    const seen = new Set<string>();
    const normalized: InitialSystemMessageRecord[] = [];
    for (const item of input) {
      if (typeof item === 'string') {
        const content = item.trim();
        if (!content || seen.has(content)) {
          continue;
        }
        seen.add(content);
        normalized.push({ content });
        continue;
      }
      if (!item || typeof item !== 'object') {
        continue;
      }
      const content = String((item as { content?: unknown }).content || '').trim();
      if (!content || seen.has(content)) {
        continue;
      }
      const metadata = (item as { metadata?: unknown }).metadata;
      const normalizedMetadata = metadata && typeof metadata === 'object'
        ? ({ ...(metadata as Record<string, unknown>) } as Record<string, unknown>)
        : undefined;
      seen.add(content);
      normalized.push({
        content,
        ...(normalizedMetadata ? { metadata: normalizedMetadata } : {}),
      });
    }
    return normalized;
  }

  private normalizeMessageContent(content: unknown): string {
    if (content === null || content === undefined) {
      return '';
    }
    return typeof content === 'string' ? content : String(content);
  }

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(AgentRun.name) private readonly runModel: Model<AgentRunDocument>,
    @InjectModel(AgentMessage.name) private readonly messageModel: Model<AgentMessageDocument>,
    @InjectModel(AgentPart.name) private readonly partModel: Model<AgentPartDocument>,
    @InjectModel(AgentEventOutbox.name) private readonly outboxModel: Model<AgentEventOutboxDocument>,
    @InjectModel(AgentRuntimeMaintenanceAudit.name)
    private readonly maintenanceAuditModel: Model<AgentRuntimeMaintenanceAuditDocument>,
    @InjectModel(AgentSession.name)
    private readonly sessionModel: Model<AgentSessionDocument>,
  ) {}

  private normalizeTokenValue(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  }

  async ensureSession(input: {
    sessionId?: string;
    sessionType?: 'meeting' | 'task' | 'plan' | 'chat';
    ownerId: string;
    ownerType?: 'agent' | 'employee' | 'system';
    title: string;
    planContext?: {
      linkedPlanId?: string;
      currentTaskId?: string;
      completedTaskIds?: string[];
      linkedTaskId?: string;
      latestTaskInput?: string;
      latestTaskOutput?: string;
      lastRunId?: string;
    };
    meetingContext?: {
      meetingId?: string;
      agendaId?: string;
      meetingType?: string;
      latestSummary?: string;
    };
    domainContext?: AgentSession['domainContext'];
    collaborationContext?: AgentSession['collaborationContext'];
    metadata?: Record<string, unknown>;
  }): Promise<AgentSession> {
    const sessionId = input.sessionId?.trim() || `session-${uuidv4()}`;
    const now = new Date();
    const sessionType = input.sessionType || 'task';
    const updated = await this.sessionModel
      .findOneAndUpdate(
        { id: sessionId },
        {
          $setOnInsert: {
            id: sessionId,
            sessionType,
            ownerType: input.ownerType || 'agent',
            ownerId: input.ownerId,
            title: input.title,
            status: 'active',
            runIds: [],
            memoIds: [],
            messageIds: [],
            metadata: input.metadata || {},
          },
          $set: {
            lastActiveAt: now,
            planContext: input.planContext,
            meetingContext: input.meetingContext,
            domainContext: input.domainContext,
            collaborationContext: input.collaborationContext,
          },
        },
        { upsert: true, new: true },
      )
      .exec();

    return updated as AgentSession;
  }

  async appendRunToSession(sessionId: string, runId: string, options?: { latestTaskOutput?: string; taskId?: string }): Promise<void> {
    const now = new Date();
    const taskId = options?.taskId;
    const addToSet: Record<string, unknown> = { runIds: runId };
    if (taskId) {
      addToSet['planContext.completedTaskIds'] = taskId;
    }
    await this.sessionModel
      .updateOne(
        { id: sessionId },
        {
          $addToSet: addToSet,
          $set: {
            lastActiveAt: now,
            'planContext.lastRunId': runId,
            ...(options?.latestTaskOutput ? { 'planContext.latestTaskOutput': options.latestTaskOutput } : {}),
            ...(taskId ? { 'planContext.currentTaskId': taskId } : {}),
          },
        },
      )
      .exec();
  }

  async getOrCreateMeetingSession(
    meetingId: string,
    agentId: string,
    title: string,
    meetingContext?: {
      meetingId: string;
      agendaId?: string;
      meetingType?: string;
      latestSummary?: string;
    },
  ): Promise<AgentSession> {
    const existing = await this.sessionModel
      .findOne({
        'meetingContext.meetingId': meetingId,
        ownerId: agentId,
        sessionType: 'meeting',
      })
      .sort({ createdAt: -1 })
      .exec();

    if (existing) {
      await this.sessionModel.updateOne(
        { _id: existing._id },
        { $set: { lastActiveAt: new Date(), title, meetingContext } },
      );
      return this.sessionModel.findById(existing._id).exec() as Promise<AgentSession>;
    }

    const sessionId = `meeting-${meetingId}-${agentId}`;
    return this.ensureSession({
      sessionId,
      sessionType: 'meeting',
      ownerId: agentId,
      title,
      meetingContext,
    });
  }

  async getOrCreateTaskSession(
    taskId: string,
    agentId: string,
    title: string,
    planContext?: {
      linkedPlanId?: string;
      currentTaskId?: string;
      completedTaskIds?: string[];
      linkedTaskId?: string;
      latestTaskInput?: string;
      latestTaskOutput?: string;
      lastRunId?: string;
    },
  ): Promise<AgentSession> {
    const existing = await this.sessionModel
      .findOne({
        'planContext.linkedTaskId': taskId,
        ownerId: agentId,
        sessionType: 'task',
      })
      .sort({ createdAt: -1 })
      .exec();

    if (existing) {
      await this.sessionModel.updateOne(
        { _id: existing._id },
        { $set: { lastActiveAt: new Date(), title, planContext } },
      );
      return this.sessionModel.findById(existing._id).exec() as Promise<AgentSession>;
    }

    const sessionId = `task-${taskId}`;
    return this.ensureSession({
      sessionId,
      sessionType: 'task',
      ownerId: agentId,
      title,
      planContext,
    });
  }

  async getOrCreatePlanSession(
    planId: string,
    agentId: string,
    title: string,
    options?: {
      currentTaskId?: string;
      orchestrationRunId?: string;
      domainContext?: AgentSession['domainContext'];
      collaborationContext?: AgentSession['collaborationContext'];
    },
  ): Promise<AgentSession> {
    const orchRunId = options?.orchestrationRunId;

    // Build lookup filter: isolate by orchestrationRunId when present
    const lookupFilter: Record<string, unknown> = {
      'planContext.linkedPlanId': planId,
      ownerId: agentId,
      sessionType: 'plan',
    };
    if (orchRunId) {
      lookupFilter['planContext.orchestrationRunId'] = orchRunId;
    }

    const existing = await this.sessionModel
      .findOne(lookupFilter)
      .sort({ createdAt: -1 })
      .exec();

    const planContext: Record<string, unknown> = {
      linkedPlanId: planId,
      currentTaskId: options?.currentTaskId,
      ...(orchRunId ? { orchestrationRunId: orchRunId } : {}),
    };

    if (existing) {
      await this.sessionModel.updateOne(
        { _id: existing._id },
        {
          $set: {
            lastActiveAt: new Date(),
            title,
            planContext,
            ...(options?.domainContext ? { domainContext: options.domainContext } : {}),
            ...(options?.collaborationContext ? { collaborationContext: options.collaborationContext } : {}),
          },
        },
      );
      return this.sessionModel.findById(existing._id).exec() as Promise<AgentSession>;
    }

    const sessionId = orchRunId
      ? `plan-${planId}-${agentId}-run-${orchRunId}`
      : `plan-${planId}-${agentId}`;
    return this.ensureSession({
      sessionId,
      sessionType: 'plan',
      ownerId: agentId,
      title,
      planContext,
      domainContext: options?.domainContext,
      collaborationContext: options?.collaborationContext,
    });
  }

  async appendRunSummary(
    sessionId: string,
    summary: {
      runId: string;
      taskId?: string;
      taskTitle?: string;
      objective?: string;
      outcome?: string;
      keyOutputs?: string[];
      openIssues?: string[];
      completedAt?: Date;
    },
  ): Promise<void> {
    await this.sessionModel
      .updateOne(
        { id: sessionId },
        {
          $push: {
            runSummaries: {
              runId: summary.runId,
              taskId: summary.taskId,
              taskTitle: summary.taskTitle,
              objective: summary.objective,
              outcome: summary.outcome,
              keyOutputs: summary.keyOutputs || [],
              openIssues: summary.openIssues || [],
              completedAt: summary.completedAt || new Date(),
            },
          },
          $set: { lastActiveAt: new Date() },
        },
      )
      .exec();
  }

  async createRun(input: {
    agentId: string;
    agentName: string;
    roleCode?: string;
    executionChannel?: 'native' | 'opencode';
    executionData?: Record<string, unknown>;
    sessionId?: string;
    taskId?: string;
    taskTitle: string;
    taskDescription: string;
    metadata?: Record<string, unknown>;
  }): Promise<AgentRun> {
    const metadata = input.metadata || {};
    const roleCodeFromMetadata = typeof metadata.roleCode === 'string' ? metadata.roleCode.trim() : undefined;
    const executionChannelFromMetadata =
      metadata.executionChannel === 'opencode' || metadata.executionChannel === 'native'
        ? (metadata.executionChannel as 'native' | 'opencode')
        : undefined;
    const executionDataFromMetadata =
      metadata.executionData && typeof metadata.executionData === 'object' && !Array.isArray(metadata.executionData)
        ? (metadata.executionData as Record<string, unknown>)
        : undefined;

    const run = new this.runModel({
      id: `run-${uuidv4()}`,
      ...input,
      roleCode: input.roleCode || roleCodeFromMetadata,
      executionChannel: input.executionChannel || executionChannelFromMetadata || 'native',
      executionData: input.executionData || executionDataFromMetadata,
      sync: {
        state: 'pending',
        retryCount: 0,
      },
      status: 'running',
      currentStep: 0,
      startedAt: new Date(),
    });
    return run.save();
  }

  async updateRun(runId: string, updates: Partial<AgentRun>): Promise<void> {
    await this.runModel.updateOne({ id: runId }, { $set: updates }).exec();
  }

  async getRun(runId: string): Promise<AgentRun | null> {
    return this.runModel.findOne({ id: runId }).exec();
  }

  async findLatestActiveRun(agentId: string, sessionId?: string, taskId?: string): Promise<AgentRun | null> {
    const filter: Record<string, unknown> = {
      agentId,
      status: { $in: ['pending', 'running', 'paused'] },
    };
    if (sessionId) {
      filter.sessionId = sessionId;
    }
    if (taskId) {
      filter.taskId = taskId;
    }
    return this.runModel.findOne(filter).sort({ createdAt: -1 }).exec();
  }

  async incrementRunStep(runId: string): Promise<number> {
    const updated = await this.runModel
      .findOneAndUpdate({ id: runId }, { $inc: { currentStep: 1 } }, { new: true })
      .exec();
    return updated?.currentStep ?? 0;
  }

  async createMessage(input: {
    runId: string;
    agentId: string;
    sessionId?: string;
    taskId?: string;
    role: 'system' | 'user' | 'assistant' | 'tool';
    sequence: number;
    content?: unknown;
    status?: 'pending' | 'streaming' | 'completed' | 'error';
    metadata?: Record<string, unknown>;
    parentMessageId?: string;
    modelID?: string;
    providerID?: string;
    finish?: 'stop' | 'tool-calls' | 'error' | 'cancelled' | 'paused' | 'max-rounds';
    tokens?: {
      input?: number;
      output?: number;
      reasoning?: number;
      cacheRead?: number;
      cacheWrite?: number;
      total?: number;
    };
    cost?: number;
    stepIndex?: number;
  }): Promise<AgentMessage> {
    const messageContent = this.normalizeMessageContent(input.content);
    const message = new this.messageModel({
      id: `msg-${uuidv4()}`,
      ...input,
      content: messageContent,
      status: input.status || 'completed',
    });
    const saved = await message.save();
    if (input.sessionId) {
      await this.appendMessageIdToSession(input.sessionId, saved.id);
    }
    return saved;
  }

  async bulkCreateMessageWithParts(
    message: {
      runId: string;
      agentId: string;
      sessionId?: string;
      taskId?: string;
      role: 'system' | 'user' | 'assistant' | 'tool';
      sequence: number;
      content?: unknown;
      status?: 'pending' | 'streaming' | 'completed' | 'error';
      metadata?: Record<string, unknown>;
      parentMessageId?: string;
      modelID?: string;
      providerID?: string;
      finish?: 'stop' | 'tool-calls' | 'error' | 'cancelled' | 'paused' | 'max-rounds';
      tokens?: {
        input?: number;
        output?: number;
        reasoning?: number;
        cacheRead?: number;
        cacheWrite?: number;
        total?: number;
      };
      cost?: number;
      stepIndex?: number;
    },
    parts: Array<{
      sequence: number;
      type: 'text' | 'reasoning' | 'tool_call' | 'tool_result' | 'system_event' | 'step_start' | 'step_finish';
      status: 'pending' | 'running' | 'completed' | 'error' | 'cancelled';
      toolId?: string;
      toolCallId?: string;
      input?: unknown;
      output?: unknown;
      content?: string;
      metadata?: Record<string, unknown>;
      error?: string;
      startedAt?: Date;
      endedAt?: Date;
    }>,
  ): Promise<{ message: AgentMessage; parts: AgentPart[] }> {
    const createdMessage = await this.createMessage(message);
    const createdParts = await Promise.all(
      parts.map((part) =>
        this.createPart({
          runId: message.runId,
          messageId: createdMessage.id,
          sequence: part.sequence,
          type: part.type,
          status: part.status,
          toolId: part.toolId,
          toolCallId: part.toolCallId,
          input: part.input,
          output: part.output,
          content: part.content,
          metadata: part.metadata,
          error: part.error,
          startedAt: part.startedAt,
          endedAt: part.endedAt,
        }),
      ),
    );

    return {
      message: createdMessage,
      parts: createdParts,
    };
  }

  async appendMessageIdToSession(sessionId: string, messageId: string): Promise<void> {
    const normalizedMessageId = String(messageId || '').trim();
    if (!normalizedMessageId) {
      return;
    }
    const now = new Date();
    await this.sessionModel
      .updateOne(
        { id: sessionId },
        {
          $push: {
            messageIds:
              this.maxSessionMessages > 0
                ? {
                    $each: [normalizedMessageId],
                    $slice: -this.maxSessionMessages,
                  }
                : normalizedMessageId,
          },
          $set: {
            lastActiveAt: now,
          },
        },
      )
      .exec();
  }

  async appendSystemMessagesToSession(
    sessionId: string,
    messages: Array<{
      role: 'system';
      content: string;
      metadata?: Record<string, unknown>;
    }>,
  ): Promise<void> {
    if (!messages.length) return;
    const normalized = messages
      .map((msg) => ({
        role: msg.role,
        content: normalizeSystemContent(msg.content),
        metadata: msg.metadata,
      }))
      .filter((msg) => msg.content.length > 0)
      .slice(0, 10);

    if (!normalized.length) return;

    const runId = `system-run-${sessionId}`;
    await Promise.all(
      normalized.map((msg, index) =>
        this.createMessage({
          runId,
          agentId: 'system',
          sessionId,
          role: 'system',
          sequence: index + 1,
          content: msg.content,
          status: 'completed',
          metadata: {
            ...(msg.metadata || {}),
            source: 'runtime.appendSystemMessagesToSession',
            contextKey: buildSystemContextKey(msg.content),
          },
        }),
      ),
    );
  }

  async getSessionMemoSnapshot(sessionId: string): Promise<{
    agentId: string;
    refreshedAt: string;
    identity: Array<{ id: string; memoKind: string; title: string; slug?: string; content: string; updatedAt?: string }>;
    todo: Array<{ id: string; memoKind: string; title: string; slug?: string; content: string; updatedAt?: string }>;
    topic: Array<{ id: string; memoKind: string; title: string; slug?: string; content: string; updatedAt?: string }>;
  } | null> {
    if (!sessionId) return null;
    const session = await this.sessionModel.findOne({ id: sessionId }).select('memoSnapshot').exec();
    return (session as any)?.memoSnapshot || null;
  }

  async updateSessionMemoSnapshot(
    sessionId: string,
    snapshot: {
      agentId: string;
      refreshedAt: string;
      identity: Array<{ id: string; memoKind: string; title: string; slug?: string; content: string; updatedAt?: string }>;
      todo: Array<{ id: string; memoKind: string; title: string; slug?: string; content: string; updatedAt?: string }>;
      topic: Array<{ id: string; memoKind: string; title: string; slug?: string; content: string; updatedAt?: string }>;
    },
  ): Promise<void> {
    if (!sessionId) return;
    await this.sessionModel.updateOne({ id: sessionId }, { $set: { memoSnapshot: snapshot } }).exec();
  }

  async getSessionById(sessionId: string): Promise<AgentSession | null> {
    return this.sessionModel.findOne({ id: sessionId }).exec();
  }

  async getSessionDetailById(sessionId: string): Promise<AgentSessionDetailView | null> {
    const session = await this.sessionModel.findOne({ id: sessionId }).lean<AgentSession>().exec();
    if (!session) return null;

    const runTaskMap = new Map<string, string | undefined>();
    const runStartedAtMap = new Map<string, Date | undefined>();
    const runInitialSystemMessagesMap = new Map<string, InitialSystemMessageRecord[]>();
    const runIds = Array.isArray(session.runIds)
      ? session.runIds.filter((runId): runId is string => typeof runId === 'string' && runId.trim().length > 0)
      : [];
    if (runIds.length > 0) {
      const runs = await this.runModel
        .find({ id: { $in: runIds } })
        .select({ id: 1, taskId: 1, metadata: 1, startedAt: 1, createdAt: 1 })
        .lean<Array<{ id: string; taskId?: string; metadata?: Record<string, unknown>; startedAt?: Date; createdAt?: Date }>>()
        .exec();
      for (const run of runs) {
        runTaskMap.set(run.id, run.taskId);
        runStartedAtMap.set(run.id, run.startedAt || run.createdAt);
        const initialSystemMessages = this.normalizeInitialSystemMessages(run.metadata?.initialSystemMessages);
        runInitialSystemMessagesMap.set(run.id, initialSystemMessages);
      }
    }

    const messageIds = (Array.isArray(session.messageIds) ? session.messageIds : [])
      .filter((messageId): messageId is string => typeof messageId === 'string' && messageId.trim().length > 0);

    const messages = messageIds.length
      ? await this.messageModel
          .find({ id: { $in: messageIds } })
          .sort({ createdAt: 1, sequence: 1 })
          .lean<Array<AgentMessage & { createdAt?: Date; updatedAt?: Date }>>()
          .exec()
      : [];

    const supplementalMessages = runIds.length
      ? await this.messageModel
          .find({
            runId: { $in: runIds },
            id: { $nin: messageIds },
            role: { $in: ['system', 'user'] },
          })
          .sort({ createdAt: 1, sequence: 1 })
          .lean<Array<AgentMessage & { createdAt?: Date; updatedAt?: Date }>>()
          .exec()
      : [];

    const mergedMessageMap = new Map<string, AgentMessage & { createdAt?: Date; updatedAt?: Date }>();
    for (const message of messages) {
      mergedMessageMap.set(message.id, message);
    }
    for (const message of supplementalMessages) {
      mergedMessageMap.set(message.id, message);
    }
    const mergedMessages = Array.from(mergedMessageMap.values()).sort((a, b) => {
      const at = (a.updatedAt || a.createdAt || new Date(0)).getTime();
      const bt = (b.updatedAt || b.createdAt || new Date(0)).getTime();
      if (at !== bt) return at - bt;
      return (a.sequence ?? 0) - (b.sequence ?? 0);
    });

    const projectedMessages: SessionMessageView[] = mergedMessages.map((message) => ({
      id: message.id,
      runId: message.runId,
      taskId: message.taskId,
      parentMessageId: message.parentMessageId,
      role: message.role,
      sequence: message.sequence,
      content: message.content,
      status: message.status,
      metadata: message.metadata,
      modelID: message.modelID,
      providerID: message.providerID,
      finish: message.finish,
      tokens: message.tokens
        ? {
            input: this.normalizeTokenValue(message.tokens.input),
            output: this.normalizeTokenValue(message.tokens.output),
            reasoning: this.normalizeTokenValue(message.tokens.reasoning),
            cacheRead: this.normalizeTokenValue(message.tokens.cacheRead),
            cacheWrite: this.normalizeTokenValue(message.tokens.cacheWrite),
            total: this.normalizeTokenValue(message.tokens.total),
          }
        : undefined,
      cost: this.normalizeTokenValue(message.cost),
      stepIndex: this.normalizeTokenValue(message.stepIndex),
      timestamp: message.updatedAt || message.createdAt || new Date(),
    }));

    const existingSystemFingerprint = new Set(
      projectedMessages
        .filter((message) => message.role === 'system')
        .map((message) => `${message.runId || 'run:unknown'}::${message.content}`),
    );

    for (const runId of runIds) {
      const initialSystemMessages = runInitialSystemMessagesMap.get(runId) || [];
      if (!initialSystemMessages.length) {
        continue;
      }
      initialSystemMessages.forEach((message, index) => {
        const fingerprint = `${runId}::${message.content}`;
        if (existingSystemFingerprint.has(fingerprint)) {
          return;
        }
        existingSystemFingerprint.add(fingerprint);
        projectedMessages.push({
          id: `virtual-system-${runId}-${index + 1}`,
          runId,
          taskId: runTaskMap.get(runId),
          role: 'system',
          sequence: index + 1,
          content: message.content,
          status: 'completed',
          metadata: {
            ...(message.metadata || {}),
            source: 'runtime.run.metadata.initialSystemMessages',
          },
          timestamp: runStartedAtMap.get(runId) || new Date(),
        });
      });
    }

    projectedMessages.sort((a, b) => {
      const at = (a.timestamp || new Date(0)).getTime();
      const bt = (b.timestamp || new Date(0)).getTime();
      if (at !== bt) return at - bt;
      return (a.sequence ?? 0) - (b.sequence ?? 0);
    });

    const partMessageIds = mergedMessages.map((message) => message.id);

    const parts = partMessageIds.length
      ? await this.partModel
          .find({ messageId: { $in: partMessageIds } })
          .sort({ createdAt: 1, sequence: 1 })
          .lean<Array<AgentPart & { createdAt?: Date; updatedAt?: Date }>>()
          .exec()
      : [];

    const projectedParts: SessionPartView[] = parts.map((part) => ({
      id: part.id,
      runId: part.runId,
      taskId: runTaskMap.get(part.runId),
      messageId: part.messageId,
      sequence: part.sequence,
      type: part.type,
      status: part.status,
      toolId: part.toolId,
      toolCallId: part.toolCallId,
      input: part.input,
      output: part.output,
      content: part.content,
      error: part.error,
      startedAt: part.startedAt,
      endedAt: part.endedAt,
      timestamp: part.updatedAt || part.endedAt || part.startedAt || part.createdAt || new Date(),
    }));

    return {
      ...(session as AgentSession),
      messages: projectedMessages,
      parts: projectedParts,
    };
  }

  async listSessionMessagesById(sessionId: string): Promise<SessionMessageView[]> {
    const session = await this.sessionModel.findOne({ id: sessionId }).lean<AgentSession>().exec();
    if (!session) {
      return [];
    }
    const messageIds = Array.isArray(session.messageIds)
      ? session.messageIds.filter((messageId): messageId is string => typeof messageId === 'string' && messageId.trim().length > 0)
      : [];
    if (!messageIds.length) {
      return [];
    }
    const messages = await this.messageModel
      .find({ id: { $in: messageIds } })
      .sort({ createdAt: 1, sequence: 1 })
      .lean<Array<AgentMessage & { createdAt?: Date; updatedAt?: Date }>>()
      .exec();
    return messages.map((message) => ({
      id: message.id,
      runId: message.runId,
      taskId: message.taskId,
      parentMessageId: message.parentMessageId,
      role: message.role,
      sequence: message.sequence,
      content: message.content,
      status: message.status,
      metadata: message.metadata,
      modelID: message.modelID,
      providerID: message.providerID,
      finish: message.finish,
      tokens: message.tokens,
      cost: message.cost,
      stepIndex: message.stepIndex,
      timestamp: message.updatedAt || message.createdAt || new Date(),
    }));
  }

  async listMessageParts(messageId: string): Promise<AgentPart[]> {
    return this.partModel.find({ messageId }).sort({ createdAt: 1, sequence: 1 }).exec();
  }

  async listRunMessagesWithParts(runId: string): Promise<Array<SessionMessageView & { parts: AgentPart[] }>> {
    const messages = await this.messageModel
      .find({ runId })
      .sort({ createdAt: 1, sequence: 1 })
      .lean<Array<AgentMessage & { createdAt?: Date; updatedAt?: Date }>>()
      .exec();
    if (!messages.length) {
      return [];
    }
    const messageIds = messages.map((message) => message.id);
    const parts = await this.partModel
      .find({ messageId: { $in: messageIds } })
      .sort({ createdAt: 1, sequence: 1 })
      .lean<AgentPart[]>()
      .exec();

    const partMap = new Map<string, AgentPart[]>();
    for (const part of parts) {
      const list = partMap.get(part.messageId) || [];
      list.push(part);
      partMap.set(part.messageId, list);
    }

    return messages.map((message) => ({
      id: message.id,
      runId: message.runId,
      taskId: message.taskId,
      parentMessageId: message.parentMessageId,
      role: message.role,
      sequence: message.sequence,
      content: message.content,
      status: message.status,
      metadata: message.metadata,
      modelID: message.modelID,
      providerID: message.providerID,
      finish: message.finish,
      tokens: message.tokens,
      cost: message.cost,
      stepIndex: message.stepIndex,
      timestamp: message.updatedAt || message.createdAt || new Date(),
      parts: partMap.get(message.id) || [],
    }));
  }

  async listSessions(options?: {
    ownerType?: 'agent' | 'employee' | 'system';
    ownerId?: string;
    status?: 'active' | 'archived' | 'closed';
    sessionType?: 'meeting' | 'task' | 'plan' | 'chat';
    keyword?: string;
    page?: number;
    pageSize?: number;
  }): Promise<AgentSession[]> {
    const page = Math.max(1, Number(options?.page || 1));
    const pageSize = Math.max(1, Math.min(100, Number(options?.pageSize || 20)));
    const filter: Record<string, unknown> = {};

    if (options?.ownerType) {
      filter.ownerType = options.ownerType;
    }
    if (options?.ownerId) {
      filter.ownerId = options.ownerId;
    }
    if (options?.status) {
      filter.status = options.status;
    }
    if (options?.sessionType) {
      filter.sessionType = options.sessionType;
    }
    if (options?.keyword) {
      const keyword = options.keyword.trim();
      if (keyword) {
        filter.$or = [
          { id: { $regex: keyword, $options: 'i' } },
          { title: { $regex: keyword, $options: 'i' } },
          { 'planContext.linkedPlanId': { $regex: keyword, $options: 'i' } },
          { 'planContext.linkedTaskId': { $regex: keyword, $options: 'i' } },
          { 'meetingContext.meetingId': { $regex: keyword, $options: 'i' } },
        ];
      }
    }

    return this.sessionModel
      .find(filter)
      .sort({ lastActiveAt: -1, createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .exec();
  }

  async countSessions(options?: {
    ownerType?: 'agent' | 'employee' | 'system';
    ownerId?: string;
    status?: 'active' | 'archived' | 'closed';
    sessionType?: 'meeting' | 'task' | 'plan' | 'chat';
    keyword?: string;
  }): Promise<number> {
    const filter: Record<string, unknown> = {};
    if (options?.ownerType) {
      filter.ownerType = options.ownerType;
    }
    if (options?.ownerId) {
      filter.ownerId = options.ownerId;
    }
    if (options?.status) {
      filter.status = options.status;
    }
    if (options?.sessionType) {
      filter.sessionType = options.sessionType;
    }
    if (options?.keyword) {
      const keyword = options.keyword.trim();
      if (keyword) {
        filter.$or = [
          { id: { $regex: keyword, $options: 'i' } },
          { title: { $regex: keyword, $options: 'i' } },
          { 'planContext.linkedPlanId': { $regex: keyword, $options: 'i' } },
          { 'planContext.linkedTaskId': { $regex: keyword, $options: 'i' } },
          { 'meetingContext.meetingId': { $regex: keyword, $options: 'i' } },
        ];
      }
    }
    return this.sessionModel.countDocuments(filter).exec();
  }

  async archiveSession(sessionId: string, summary?: string): Promise<void> {
    await this.sessionModel.updateOne(
      { id: sessionId },
      {
        $set: {
          status: 'archived',
          contextSummary: summary,
          lastActiveAt: new Date(),
        },
      },
    ).exec();
  }

  async resumeSession(sessionId: string): Promise<void> {
    await this.sessionModel.updateOne(
      { id: sessionId },
      {
        $set: {
          status: 'active',
          lastActiveAt: new Date(),
        },
      },
    ).exec();
  }

  async findLatestMessageByRunAndRole(
    runId: string,
    role: 'system' | 'user' | 'assistant' | 'tool',
  ): Promise<AgentMessage | null> {
    return this.messageModel.findOne({ runId, role }).sort({ createdAt: -1 }).exec();
  }

  async createPart(input: {
    runId: string;
    messageId: string;
    sequence: number;
    type: 'text' | 'reasoning' | 'tool_call' | 'tool_result' | 'system_event' | 'step_start' | 'step_finish';
    status: 'pending' | 'running' | 'completed' | 'error' | 'cancelled';
    toolId?: string;
    toolCallId?: string;
    input?: unknown;
    output?: unknown;
    content?: string;
    metadata?: Record<string, unknown>;
    error?: string;
    startedAt?: Date;
    endedAt?: Date;
  }): Promise<AgentPart> {
    const part = new this.partModel({
      id: `part-${uuidv4()}`,
      ...input,
    });
    return part.save();
  }

  async updatePart(partId: string, updates: Partial<AgentPart>): Promise<void> {
    await this.partModel.updateOne({ id: partId }, { $set: updates }).exec();
  }

  async transitionPartStatus(
    partId: string,
    fromStatus: AgentPart['status'],
    toStatus: AgentPart['status'],
    updates?: Partial<AgentPart>,
  ): Promise<boolean> {
    const result = await this.partModel
      .updateOne(
        { id: partId, status: fromStatus },
        {
          $set: {
            status: toStatus,
            ...(updates || {}),
          },
        },
      )
      .exec();
    return (result.modifiedCount || 0) > 0;
  }

  async getPart(partId: string): Promise<AgentPart | null> {
    return this.partModel.findOne({ id: partId }).exec();
  }

  async enqueueEvent(event: RuntimeEvent): Promise<void> {
    const parsed = RuntimeEventSchema.parse(event);
    const outbox = new this.outboxModel({
      id: `outbox-${uuidv4()}`,
      eventId: parsed.eventId,
      eventType: parsed.eventType,
      runId: parsed.runId,
      agentId: parsed.agentId,
      sessionId: parsed.sessionId,
      taskId: parsed.taskId,
      messageId: parsed.messageId,
      partId: parsed.partId,
      toolCallId: parsed.toolCallId,
      sequence: parsed.sequence,
      payload: parsed.payload,
      status: 'pending',
      attempts: 0,
      timestamp: new Date(parsed.timestamp),
    });
    await outbox.save();
  }

  async markEventDispatched(eventId: string): Promise<void> {
    await this.outboxModel
      .updateOne(
        { eventId },
        {
          $set: {
            status: 'dispatched',
            dispatchedAt: new Date(),
            lastError: undefined,
          },
          $inc: { attempts: 1 },
        },
      )
      .exec();
  }

  async markEventFailed(eventId: string, error: string): Promise<void> {
    const current = await this.outboxModel.findOne({ eventId }).exec();
    const attempts = (current?.attempts || 0) + 1;
    const delayMs = Math.min(60_000, Math.max(2_000, 2_000 * Math.pow(2, Math.min(attempts, 5))));
    await this.outboxModel
      .updateOne(
        { eventId },
        {
          $set: {
            status: 'failed',
            lastError: error,
            nextRetryAt: new Date(Date.now() + delayMs),
          },
          $inc: { attempts: 1 },
        },
      )
      .exec();
  }

  async findDispatchableEvents(limit = 100): Promise<AgentEventOutbox[]> {
    return this.outboxModel
      .find({
        $or: [
          { status: 'pending' },
          {
            status: 'failed',
            nextRetryAt: { $lte: new Date() },
          },
        ],
      })
      .sort({ createdAt: 1 })
      .limit(limit)
      .exec();
  }

  async countOutboxByStatus(): Promise<{ pending: number; failed: number; dispatched: number }> {
    const [pending, failed, dispatched] = await Promise.all([
      this.outboxModel.countDocuments({ status: 'pending' }).exec(),
      this.outboxModel.countDocuments({ status: 'failed' }).exec(),
      this.outboxModel.countDocuments({ status: 'dispatched' }).exec(),
    ]);
    return { pending, failed, dispatched };
  }

  async getDeadLetterSummary(): Promise<{ totalFailed: number; oldestFailedAt?: Date }> {
    const totalFailed = await this.outboxModel.countDocuments({ status: 'failed' }).exec();
    const oldest = await this.outboxModel
      .findOne({ status: 'failed' })
      .sort({ createdAt: 1 })
      .select({ createdAt: 1 })
      .exec();
    return {
      totalFailed,
      oldestFailedAt: (oldest as any)?.createdAt,
    };
  }

  async findEventsByRun(
    runId: string,
    options?: {
      limit?: number;
      eventTypes?: string[];
      fromSequence?: number;
      toSequence?: number;
    },
  ): Promise<AgentEventOutbox[]> {
    const limit = options?.limit || 200;
    const filter: Record<string, unknown> = { runId };
    if (options?.eventTypes?.length) {
      filter.eventType = { $in: options.eventTypes };
    }
    if (typeof options?.fromSequence === 'number' || typeof options?.toSequence === 'number') {
      const range: Record<string, number> = {};
      if (typeof options?.fromSequence === 'number') {
        range.$gte = options.fromSequence;
      }
      if (typeof options?.toSequence === 'number') {
        range.$lte = options.toSequence;
      }
      filter.sequence = range;
    }

    return this.outboxModel
      .find(filter)
      .sort({ sequence: 1, createdAt: 1 })
      .limit(limit)
      .exec();
  }

  async findDeadLetterEvents(options?: {
    limit?: number;
    runId?: string;
    eventType?: string;
  }): Promise<AgentEventOutbox[]> {
    const limit = options?.limit || 200;
    const filter: Record<string, unknown> = { status: 'failed' };
    if (options?.runId) {
      filter.runId = options.runId;
    }
    if (options?.eventType) {
      filter.eventType = options.eventType;
    }

    return this.outboxModel
      .find(filter)
      .sort({ updatedAt: -1 })
      .limit(limit)
      .exec();
  }

  async countDeadLetterEvents(options?: {
    runId?: string;
    eventType?: string;
  }): Promise<number> {
    const filter: Record<string, unknown> = { status: 'failed' };
    if (options?.runId) {
      filter.runId = options.runId;
    }
    if (options?.eventType) {
      filter.eventType = options.eventType;
    }
    return this.outboxModel.countDocuments(filter).exec();
  }

  async findDeadLetterEventsByEventIds(eventIds: string[]): Promise<AgentEventOutbox[]> {
    if (!eventIds.length) return [];
    const filter: Record<string, unknown> = {
      status: 'failed',
      eventId: { $in: eventIds },
    };
    return this.outboxModel.find(filter).exec();
  }

  async findEventByEventId(eventId: string): Promise<AgentEventOutbox | null> {
    if (!eventId) return null;
    return this.outboxModel.findOne({ eventId }).exec();
  }

  async requeueDeadLetterByEventIds(eventIds: string[]): Promise<number> {
    if (!eventIds.length) return 0;
    const result = await this.outboxModel
      .updateMany(
        { eventId: { $in: eventIds }, status: 'failed' },
        {
          $set: {
            status: 'pending',
            nextRetryAt: new Date(),
            lastError: undefined,
          },
        },
      )
      .exec();
    return result.modifiedCount || 0;
  }

  async requeueDeadLetterByFilter(options?: {
    limit?: number;
    runId?: string;
    eventType?: string;
  }): Promise<number> {
    const rows = await this.findDeadLetterEvents(options);
    const eventIds = rows.map((row) => row.eventId);
    return this.requeueDeadLetterByEventIds(eventIds);
  }

  async purgeCollections(collectionNames: string[]): Promise<Array<{ collection: string; deletedCount: number }>> {
    const existing = await this.connection.db.listCollections({}, { nameOnly: true }).toArray();
    const existingNames = new Set(existing.map((item) => item.name));
    const results: Array<{ collection: string; deletedCount: number }> = [];

    for (const name of collectionNames) {
      if (!existingNames.has(name)) {
        results.push({ collection: name, deletedCount: 0 });
        continue;
      }
      const deleteResult = await this.connection.db.collection(name).deleteMany({});
      results.push({
        collection: name,
        deletedCount: deleteResult.deletedCount || 0,
      });
    }
    return results;
  }

  async createMaintenanceAudit(input: {
    action: 'dead_letter_requeue' | 'purge_legacy';
    batchId: string;
    actorId: string;
    actorRole: string;
    dryRun: boolean;
    matched: number;
    affected: number;
    summary?: string;
    scope?: Record<string, unknown>;
    result?: Record<string, unknown>;
  }): Promise<AgentRuntimeMaintenanceAudit> {
    const audit = new this.maintenanceAuditModel({
      id: `maint-${uuidv4()}`,
      ...input,
    });
    return audit.save();
  }

  async listMaintenanceAudits(options?: {
    limit?: number;
    action?: 'dead_letter_requeue' | 'purge_legacy';
    batchId?: string;
  }): Promise<AgentRuntimeMaintenanceAudit[]> {
    const limit = options?.limit || 50;
    const filter: Record<string, unknown> = {};
    if (options?.action) {
      filter.action = options.action;
    }
    if (options?.batchId) {
      filter.batchId = options.batchId;
    }

    return this.maintenanceAuditModel.find(filter).sort({ createdAt: -1 }).limit(limit).exec();
  }
}
