import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { RedisService } from '@libs/infra';
import { GatewayUserContext } from '@libs/contracts';
import { AgentTask, AgentTaskDocument, AgentTaskStatus } from '../../schemas/agent-task.schema';
import { RuntimePersistenceService } from '../runtime/runtime-persistence.service';
import { RuntimeOrchestratorService } from '../runtime/runtime-orchestrator.service';
import { AgentTaskEvent, AgentTaskEventSchema, CreateAgentTaskBody } from './contracts/agent-task.contract';
import { RuntimeSseStreamService } from './runtime-sse-stream.service';

@Injectable()
export class AgentTaskService {
  private readonly logger = new Logger(AgentTaskService.name);
  private readonly queueKey = String(process.env.AGENT_TASK_QUEUE_KEY || 'agent-task:queue').trim();
  readonly cancelEmitter = new EventEmitter();
  private readonly defaultMaxAttempts = Math.max(1, Number(process.env.AGENT_TASK_MAX_ATTEMPTS || 3));
  private readonly defaultStepTimeoutMs = Math.max(1000, Number(process.env.AGENT_TASK_STEP_TIMEOUT_MS || 120000));
  private readonly defaultTaskTimeoutMs = Math.max(1000, Number(process.env.AGENT_TASK_TIMEOUT_MS || 1200000));
  private readonly defaultRetryBaseDelayMs = Math.max(100, Number(process.env.AGENT_TASK_RETRY_BASE_DELAY_MS || 1000));
  private readonly defaultRetryMaxDelayMs = Math.max(this.defaultRetryBaseDelayMs, Number(process.env.AGENT_TASK_RETRY_MAX_DELAY_MS || 5000));

  constructor(
    @InjectModel(AgentTask.name) private readonly taskModel: Model<AgentTaskDocument>,
    private readonly runtimePersistence: RuntimePersistenceService,
    private readonly runtimeOrchestrator: RuntimeOrchestratorService,
    private readonly redisService: RedisService,
    private readonly sseStreamService: RuntimeSseStreamService,
  ) {}

  async createTask(body: CreateAgentTaskBody, userContext: GatewayUserContext): Promise<{
    taskId: string;
    runId?: string;
    status: AgentTaskStatus;
  }> {
    const userId = String(userContext.employeeId || '').trim();
    if (!userId) {
      throw new NotFoundException('Missing employeeId in user context');
    }

    const idempotencyKey = body.idempotencyKey?.trim();
    if (idempotencyKey) {
      const existing = await this.taskModel.findOne({ userId, idempotencyKey }).exec();
      if (existing) {
        return {
          taskId: existing.id,
          runId: existing.runId,
          status: existing.status,
        };
      }
    }

    const taskId = `task-${uuidv4()}`;
    const created = await this.taskModel.create({
      id: taskId,
      userId,
      agentId: body.agentId,
      prompt: body.task,
      sessionContext: body.sessionContext || {},
      status: 'queued',
      progress: 0,
      attempt: 0,
      maxAttempts: this.defaultMaxAttempts,
      stepTimeoutMs: this.defaultStepTimeoutMs,
      taskTimeoutMs: this.defaultTaskTimeoutMs,
      retryBaseDelayMs: this.defaultRetryBaseDelayMs,
      retryMaxDelayMs: this.defaultRetryMaxDelayMs,
      retryEnqueued: true,
      cancelRequested: false,
      idempotencyKey,
      eventCursor: 0,
      lastEventAt: new Date(),
    });

    await this.publishTaskEvent({
      id: `evt-${uuidv4()}`,
      type: 'status',
      taskId,
      sequence: 1,
      timestamp: new Date().toISOString(),
      payload: {
        status: 'queued',
      },
    });

    await this.redisService.lpush(this.queueKey, JSON.stringify({ taskId: created.id }));

    return {
      taskId: created.id,
      status: created.status,
    };
  }

  async getTask(taskId: string, userContext: GatewayUserContext): Promise<AgentTaskDocument> {
    const task = await this.taskModel.findOne({ id: taskId }).exec();
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    this.assertTaskPermission(task, userContext);
    return task;
  }

  async cancelTask(taskId: string, userContext: GatewayUserContext, reason?: string): Promise<{ success: true; taskId: string; cancelRequested: boolean }> {
    const task = await this.getTask(taskId, userContext);
    if (task.status === 'succeeded' || task.status === 'failed' || task.status === 'cancelled') {
      return {
        success: true,
        taskId: task.id,
        cancelRequested: Boolean(task.cancelRequested),
      };
    }

    task.cancelRequested = true;
    task.errorMessage = reason || task.errorMessage;
    await task.save();

    // Emit cancel event so the worker can react immediately instead of waiting for the next poll cycle
    this.cancelEmitter.emit(`cancel:${task.id}`);

    if (task.runId) {
      await this.runtimeOrchestrator.cancelRunWithActor(task.runId, {
        actorId: String(userContext.employeeId || 'unknown'),
        actorType: 'employee',
        reason: reason || 'task_cancel_requested',
      });
    }

    await this.publishTaskEvent({
      id: `evt-${uuidv4()}`,
      type: 'status',
      taskId: task.id,
      runId: task.runId,
      sequence: (task.eventCursor || 0) + 1,
      timestamp: new Date().toISOString(),
      payload: {
        status: 'cancelling',
        cancelRequested: true,
      },
    });

    return {
      success: true,
      taskId: task.id,
      cancelRequested: true,
    };
  }

  async getReplayEvents(
    task: AgentTaskDocument,
    options?: {
      lastSequence?: number;
      lastEventId?: string;
    },
  ): Promise<AgentTaskEvent[]> {
    const lastSequence = await this.resolveLastSequence(task.id, options?.lastSequence, options?.lastEventId);
    if (!task.runId) {
      return [];
    }

    const runtimeEvents = await this.runtimePersistence.findEventsByRun(task.runId, {
      fromSequence: lastSequence + 1,
      limit: 500,
    });

    return runtimeEvents.map((event) => this.mapRuntimeEventToTaskEvent(task.id, event));
  }

  async updateTaskState(input: {
    taskId: string;
    status?: AgentTaskStatus;
    runId?: string;
    sessionId?: string;
    serveId?: string;
    progress?: number;
    attempt?: number;
    maxAttempts?: number;
    stepTimeoutMs?: number;
    taskTimeoutMs?: number;
    retryBaseDelayMs?: number;
    retryMaxDelayMs?: number;
    nextRetryAt?: Date;
    lastAttemptAt?: Date;
    retryEnqueued?: boolean;
    currentStep?: string;
    errorCode?: string;
    errorMessage?: string;
    resultSummary?: Record<string, unknown>;
    startedAt?: Date;
    finishedAt?: Date;
  }): Promise<AgentTaskDocument> {
    const task = await this.taskModel.findOne({ id: input.taskId }).exec();
    if (!task) {
      throw new NotFoundException('Task not found');
    }

    if (input.status) task.status = input.status;
    if (input.runId) task.runId = input.runId;
    if (input.sessionId) task.sessionId = input.sessionId;
    if (input.serveId) task.serveId = input.serveId;
    if (input.progress !== undefined) task.progress = input.progress;
    if (input.attempt !== undefined) task.attempt = input.attempt;
    if (input.maxAttempts !== undefined) task.maxAttempts = input.maxAttempts;
    if (input.stepTimeoutMs !== undefined) task.stepTimeoutMs = input.stepTimeoutMs;
    if (input.taskTimeoutMs !== undefined) task.taskTimeoutMs = input.taskTimeoutMs;
    if (input.retryBaseDelayMs !== undefined) task.retryBaseDelayMs = input.retryBaseDelayMs;
    if (input.retryMaxDelayMs !== undefined) task.retryMaxDelayMs = input.retryMaxDelayMs;
    if (input.nextRetryAt !== undefined) task.nextRetryAt = input.nextRetryAt;
    if (input.lastAttemptAt !== undefined) task.lastAttemptAt = input.lastAttemptAt;
    if (input.retryEnqueued !== undefined) task.retryEnqueued = input.retryEnqueued;
    if (input.currentStep !== undefined) task.currentStep = input.currentStep;
    if (input.errorCode !== undefined) task.errorCode = input.errorCode;
    if (input.errorMessage !== undefined) task.errorMessage = input.errorMessage;
    if (input.resultSummary !== undefined) task.resultSummary = input.resultSummary;
    if (input.startedAt) task.startedAt = input.startedAt;
    if (input.finishedAt) task.finishedAt = input.finishedAt;
    task.lastEventAt = new Date();
    await task.save();
    return task;
  }

  async popQueuedTaskId(timeoutSeconds = 2): Promise<string | null> {
    const payload = await this.redisService.brpop(this.queueKey, timeoutSeconds);
    if (!payload) {
      return null;
    }

    try {
      const parsed = JSON.parse(payload);
      const taskId = String(parsed?.taskId || '').trim();
      return taskId || null;
    } catch {
      return null;
    }
  }

  async getTaskById(taskId: string): Promise<AgentTaskDocument | null> {
    return this.taskModel.findOne({ id: taskId }).exec();
  }

  async scheduleRetry(taskId: string): Promise<{ scheduled: boolean; delayMs?: number; nextRetryAt?: Date; attempt?: number }> {
    const task = await this.getTaskById(taskId);
    if (!task) {
      return { scheduled: false };
    }

    const attempt = Number(task.attempt || 0);
    const maxAttempts = Math.max(1, Number(task.maxAttempts || this.defaultMaxAttempts));
    if (attempt >= maxAttempts) {
      return { scheduled: false, attempt };
    }

    const base = Math.max(100, Number(task.retryBaseDelayMs || this.defaultRetryBaseDelayMs));
    const max = Math.max(base, Number(task.retryMaxDelayMs || this.defaultRetryMaxDelayMs));
    const expDelay = Math.min(max, Math.floor(base * Math.pow(2, Math.max(0, attempt - 1))));
    const jitter = Math.floor(Math.random() * Math.max(100, Math.floor(expDelay * 0.3)));
    const delayMs = expDelay + jitter;
    const nextRetryAt = new Date(Date.now() + delayMs);

    await this.updateTaskState({
      taskId,
      status: 'queued',
      nextRetryAt,
      retryEnqueued: false,
      currentStep: 'retry_scheduled',
    });

    return {
      scheduled: true,
      delayMs,
      nextRetryAt,
      attempt,
    };
  }

  async enqueueRetry(taskId: string): Promise<boolean> {
    const task = await this.getTaskById(taskId);
    if (!task) {
      return false;
    }
    if (task.status !== 'queued' || task.retryEnqueued) {
      return false;
    }

    await this.redisService.lpush(this.queueKey, JSON.stringify({ taskId: task.id }));
    await this.updateTaskState({
      taskId: task.id,
      retryEnqueued: true,
      nextRetryAt: undefined,
    });
    return true;
  }

  async listDueRetries(limit = 20): Promise<AgentTaskDocument[]> {
    return this.taskModel
      .find({
        status: 'queued',
        retryEnqueued: false,
        nextRetryAt: { $lte: new Date() },
      })
      .sort({ nextRetryAt: 1 })
      .limit(limit)
      .exec();
  }

  async publishTaskEvent(event: AgentTaskEvent): Promise<void> {
    const parsed = AgentTaskEventSchema.parse(event);
    const task = await this.taskModel.findOne({ id: parsed.taskId }).exec();
    if (!task) {
      return;
    }

    const nextSequence = parsed.sequence > 0 ? parsed.sequence : (task.eventCursor || 0) + 1;
    task.eventCursor = nextSequence;
    task.lastEventAt = new Date(parsed.timestamp);
    await task.save();

    const normalized: AgentTaskEvent = {
      ...parsed,
      sequence: nextSequence,
    };

    const channel = this.sseStreamService.buildTaskChannel(parsed.taskId);
    await this.redisService.publish(channel, JSON.stringify(normalized));
  }

  private mapRuntimeEventToTaskEvent(taskId: string, event: any): AgentTaskEvent {
    const eventType = String(event?.eventType || '').toLowerCase();
    const mappedType = eventType.includes('llm.delta')
      ? 'token'
      : eventType.includes('tool.')
        ? 'tool'
        : eventType.includes('failed')
          ? 'error'
          : eventType.includes('completed')
            ? 'result'
            : eventType.includes('step')
              ? 'progress'
              : 'status';

    return {
      id: String(event.eventId || `evt-${uuidv4()}`),
      type: mappedType,
      taskId,
      runId: event.runId,
      sequence: Number(event.sequence || 0),
      timestamp: event.timestamp instanceof Date ? event.timestamp.toISOString() : new Date(event.timestamp || Date.now()).toISOString(),
      payload: event.payload || {},
    };
  }

  private async resolveLastSequenceFromEventId(taskId: string, lastEventId?: string): Promise<number> {
    if (!lastEventId) {
      return 0;
    }

    const task = await this.taskModel.findOne({ id: taskId }).exec();
    if (!task?.runId) {
      return 0;
    }

    const exact = await this.runtimePersistence.findEventByEventId(lastEventId);
    if (!exact || exact.runId !== task.runId) {
      return 0;
    }
    return Number(exact.sequence || 0);
  }

  async resolveLastSequence(taskId: string, lastSequence?: number, lastEventId?: string): Promise<number> {
    if (typeof lastSequence === 'number' && Number.isFinite(lastSequence) && lastSequence >= 0) {
      return Math.floor(lastSequence);
    }
    return this.resolveLastSequenceFromEventId(taskId, lastEventId);
  }

  private assertTaskPermission(task: AgentTaskDocument, userContext: GatewayUserContext): void {
    const actorId = String(userContext.employeeId || '').trim();
    const role = String(userContext.role || '').trim().toLowerCase();
    if (role === 'system' || role === 'admin' || role === 'owner') {
      return;
    }
    if (!actorId || task.userId !== actorId) {
      throw new NotFoundException('Task not found');
    }
  }
}
