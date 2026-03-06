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

@Injectable()
export class RuntimePersistenceService {
  private readonly maxSessionMessages = Number(process.env.AGENT_SESSION_MAX_MESSAGES || 1200);

  private normalizeSystemContent(content: string): string {
    return String(content || '').replace(/\s+/g, ' ').trim();
  }

  private buildSystemContextKey(content: string): string | null {
    const normalized = this.normalizeSystemContent(content);
    if (!normalized) return null;

    if (normalized.startsWith('团队上下文:')) {
      const jsonPart = normalized.slice('团队上下文:'.length).trim();
      try {
        const parsed = JSON.parse(jsonPart) as { meetingId?: string; meetingTitle?: string };
        if (parsed.meetingId) {
          return `team_context:${parsed.meetingId}`;
        }
        if (parsed.meetingTitle) {
          return `team_context:title:${parsed.meetingTitle}`;
        }
      } catch {
        // fallback below
      }
      return `team_context:raw:${normalized}`;
    }

    const meetingTitleMatch = normalized.match(/^你正在参加一个会议，会议标题是"([^"]+)"。?/);
    if (meetingTitleMatch?.[1]) {
      return `meeting_brief:${meetingTitleMatch[1]}`;
    }

    return null;
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

  async ensureSession(input: {
    sessionId?: string;
    sessionType?: 'meeting' | 'task';
    organizationId?: string;
    ownerId: string;
    ownerType?: 'agent' | 'employee' | 'system';
    title: string;
    planContext?: {
      linkedPlanId?: string;
      linkedTaskId?: string;
      latestTaskInput?: string;
      latestTaskOutput?: string;
      lastRunId?: string;
    };
    meetingContext?: {
      meetingId?: string;
      agendaId?: string;
      latestSummary?: string;
    };
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
            organizationId: input.organizationId,
            ownerType: input.ownerType || 'agent',
            ownerId: input.ownerId,
            title: input.title,
            status: 'active',
            runIds: [],
            memoIds: [],
            messages: [],
            metadata: input.metadata || {},
          },
          $set: {
            lastActiveAt: now,
            organizationId: input.organizationId,
            planContext: input.planContext,
            meetingContext: input.meetingContext,
          },
        },
        { upsert: true, new: true },
      )
      .exec();

    return updated as AgentSession;
  }

  async appendRunToSession(sessionId: string, runId: string, latestTaskOutput?: string): Promise<void> {
    const now = new Date();
    await this.sessionModel
      .updateOne(
        { id: sessionId },
        {
          $addToSet: { runIds: runId },
          $set: {
            lastActiveAt: now,
            'planContext.lastRunId': runId,
            ...(latestTaskOutput ? { 'planContext.latestTaskOutput': latestTaskOutput } : {}),
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

  async createRun(input: {
    agentId: string;
    agentName: string;
    sessionId?: string;
    taskId?: string;
    organizationId?: string;
    taskTitle: string;
    taskDescription: string;
    metadata?: Record<string, unknown>;
  }): Promise<AgentRun> {
    const run = new this.runModel({
      id: `run-${uuidv4()}`,
      ...input,
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
    content: string;
    status?: 'pending' | 'streaming' | 'completed' | 'error';
    metadata?: Record<string, unknown>;
  }): Promise<AgentMessage> {
    const message = new this.messageModel({
      id: `msg-${uuidv4()}`,
      ...input,
      status: input.status || 'completed',
    });
    const saved = await message.save();
    if (input.sessionId) {
      await this.appendMessageToSession(input.sessionId, {
        id: saved.id,
        runId: input.runId,
        taskId: input.taskId,
        role: input.role,
        content: input.content,
        status: input.status || 'completed',
        metadata: input.metadata,
      });
    }
    return saved;
  }

  async appendMessageToSession(
    sessionId: string,
    message: {
      id?: string;
      runId?: string;
      taskId?: string;
      role: 'system' | 'user' | 'assistant' | 'tool';
      content: string;
      status?: 'pending' | 'streaming' | 'completed' | 'error';
      metadata?: Record<string, unknown>;
    },
  ): Promise<void> {
    const now = new Date();
    const payload = {
      id: message.id,
      runId: message.runId,
      taskId: message.taskId,
      role: message.role,
      content: message.content,
      status: message.status || 'completed',
      metadata: message.metadata,
      timestamp: now,
    };
    await this.sessionModel
      .updateOne(
        { id: sessionId },
        {
          $push: {
            messages:
              this.maxSessionMessages > 0
                ? {
                    $each: [payload],
                    $slice: -this.maxSessionMessages,
                  }
                : payload,
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

    const existingSession = await this.sessionModel
      .findOne({ id: sessionId })
      .select({ messages: { $slice: -300 } })
      .lean<{ messages?: AgentSession['messages'] }>()
      .exec();

    const existingSystemContents = new Set<string>();
    const existingContextKeys = new Set<string>();
    const existingMessages = Array.isArray(existingSession?.messages) ? existingSession.messages : [];
    for (const msg of existingMessages) {
      if (msg?.role === 'system' && typeof msg?.content === 'string' && msg.content.trim().length > 0) {
        const normalized = this.normalizeSystemContent(msg.content);
        existingSystemContents.add(normalized);
        const contextKey = this.buildSystemContextKey(msg.content);
        if (contextKey) {
          existingContextKeys.add(contextKey);
        }
      }
    }

    const dedupedMessages = messages.filter((msg) => {
      const normalized = this.normalizeSystemContent(msg.content);
      if (!normalized) return false;
      if (existingSystemContents.has(normalized)) {
        return false;
      }

      const contextKey = this.buildSystemContextKey(msg.content);
      if (contextKey && existingContextKeys.has(contextKey)) {
        return false;
      }

      existingSystemContents.add(normalized);
      if (contextKey) {
        existingContextKeys.add(contextKey);
      }
      return true;
    });

    if (!dedupedMessages.length) {
      return;
    }

    const now = new Date();
    const payloads = dedupedMessages.map((msg) => ({
      id: `sys-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role: msg.role,
      content: msg.content,
      status: 'completed' as const,
      metadata: msg.metadata,
      timestamp: now,
    }));
    await this.sessionModel
      .updateOne(
        { id: sessionId },
        {
          $push: {
            messages: {
              $each: payloads,
              $slice: -this.maxSessionMessages,
            },
          },
          $set: {
            lastActiveAt: now,
          },
        },
      )
      .exec();
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

  async listSessions(options?: {
    ownerType?: 'agent' | 'employee' | 'system';
    ownerId?: string;
    status?: 'active' | 'archived' | 'closed';
    sessionType?: 'meeting' | 'task';
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
    sessionType?: 'meeting' | 'task';
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
    type: 'text' | 'reasoning' | 'tool_call' | 'tool_result' | 'system_event';
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
      organizationId: parsed.organizationId,
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
    organizationId?: string;
    runId?: string;
    eventType?: string;
  }): Promise<AgentEventOutbox[]> {
    const limit = options?.limit || 200;
    const filter: Record<string, unknown> = { status: 'failed' };
    if (options?.organizationId) {
      filter.organizationId = options.organizationId;
    }
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
    organizationId?: string;
    runId?: string;
    eventType?: string;
  }): Promise<number> {
    const filter: Record<string, unknown> = { status: 'failed' };
    if (options?.organizationId) {
      filter.organizationId = options.organizationId;
    }
    if (options?.runId) {
      filter.runId = options.runId;
    }
    if (options?.eventType) {
      filter.eventType = options.eventType;
    }
    return this.outboxModel.countDocuments(filter).exec();
  }

  async findDeadLetterEventsByEventIds(eventIds: string[], organizationId?: string): Promise<AgentEventOutbox[]> {
    if (!eventIds.length) return [];
    const filter: Record<string, unknown> = {
      status: 'failed',
      eventId: { $in: eventIds },
    };
    if (organizationId) {
      filter.organizationId = organizationId;
    }
    return this.outboxModel.find(filter).exec();
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
    organizationId?: string;
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
    organizationId?: string;
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
    organizationId?: string;
    action?: 'dead_letter_requeue' | 'purge_legacy';
    batchId?: string;
  }): Promise<AgentRuntimeMaintenanceAudit[]> {
    const limit = options?.limit || 50;
    const filter: Record<string, unknown> = {};
    if (options?.organizationId) {
      filter.organizationId = options.organizationId;
    }
    if (options?.action) {
      filter.action = options.action;
    }
    if (options?.batchId) {
      filter.batchId = options.batchId;
    }

    return this.maintenanceAuditModel.find(filter).sort({ createdAt: -1 }).limit(limit).exec();
  }
}
