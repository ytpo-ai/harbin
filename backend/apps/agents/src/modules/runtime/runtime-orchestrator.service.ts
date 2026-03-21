import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import {
  RuntimeCompleteRunInput,
  RuntimeCompleteRunInputSchema,
  RuntimeFailRunInput,
  RuntimeFailRunInputSchema,
  RuntimeStartRunInput,
  RuntimeStartRunInputSchema,
  RuntimeToolEventInput,
  RuntimeToolEventInputSchema,
} from './contracts/runtime-run.contract';
import { RuntimeEvent, RuntimeEventType } from './contracts/runtime-event.contract';
import { RuntimePersistenceService } from './runtime-persistence.service';
import { HookDispatcherService } from './hook-dispatcher.service';
import { HookPipelineService } from './hooks/hook-pipeline.service';
import { LifecycleHookContext } from './hooks/lifecycle-hook.types';
import { MemoService } from '../memos/memo.service';
import { RuntimeMemoSnapshotQueueService } from './runtime-memo-snapshot-queue.service';
import { DebugTimingProvider } from '@libs/common';

export interface RuntimeRunContext {
  runId: string;
  sessionId?: string;
  userMessageId: string;
  traceId: string;
  lockKey: string;
  release: () => void;
  resumed: boolean;
}

@Injectable()
export class RuntimeOrchestratorService {
  private readonly logger = new Logger(RuntimeOrchestratorService.name);
  private readonly lockTails = new Map<string, Promise<void>>();
  private readonly memoSnapshotRefreshMs = Number(process.env.AGENT_SESSION_MEMO_REFRESH_MS || 60_000);

  private debugTiming(runOrTaskId: string, stage: string, startedAt: number, extras?: Record<string, unknown>): void {
    this.debugTimingProvider.log({
      traceId: runOrTaskId,
      stage,
      startedAt,
      extras,
      traceFieldName: 'runOrTaskId',
    });
  }

  private extractInitialSystemMessages(metadata: Record<string, unknown>): string[] {
    const raw = metadata?.initialSystemMessages;
    if (!Array.isArray(raw)) {
      return [];
    }
    const seen = new Set<string>();
    return raw
      .map((item) => String(item || '').trim())
      .filter((item) => item.length > 0)
      .filter((item) => {
        if (seen.has(item)) {
          return false;
        }
        seen.add(item);
        return true;
      });
  }

  constructor(
    private readonly persistence: RuntimePersistenceService,
    private readonly hookDispatcher: HookDispatcherService,
    private readonly hookPipeline: HookPipelineService,
    private readonly memoService: MemoService,
    private readonly memoSnapshotQueue: RuntimeMemoSnapshotQueueService,
    private readonly debugTimingProvider: DebugTimingProvider,
  ) {}

  async startRun(rawInput: RuntimeStartRunInput): Promise<RuntimeRunContext> {
    const startRunAt = Date.now();
    const input = RuntimeStartRunInputSchema.parse(rawInput);
    const runOrTaskId = input.taskId || input.sessionId || `ephemeral-${input.agentId}`;
    const metadataRecord = { ...(input.metadata || {}) } as Record<string, unknown>;
    const initialSystemMessages = this.extractInitialSystemMessages(metadataRecord);

    let ensuredSession;
    const meetingContext = metadataRecord?.meetingContext as
      | { meetingId?: string; agendaId?: string; meetingType?: string; latestSummary?: string }
      | undefined;
    const planId = typeof metadataRecord?.planId === 'string' ? metadataRecord.planId : undefined;
    const domainContext = (metadataRecord?.domainContext && typeof metadataRecord.domainContext === 'object')
      ? (metadataRecord.domainContext as Record<string, unknown>)
      : undefined;
    const collaborationContext = (metadataRecord?.collaborationContext && typeof metadataRecord.collaborationContext === 'object')
      ? (metadataRecord.collaborationContext as Record<string, unknown>)
      : undefined;
    const ensureSessionAt = Date.now();

    if (meetingContext?.meetingId) {
      ensuredSession = await this.persistence.getOrCreateMeetingSession(
        meetingContext.meetingId,
        input.agentId,
        input.taskTitle,
        {
          meetingId: meetingContext.meetingId,
          agendaId: meetingContext.agendaId,
          meetingType: meetingContext.meetingType,
          latestSummary: meetingContext.latestSummary,
        },
      );
    } else if (planId) {
      ensuredSession = await this.persistence.getOrCreatePlanSession(
        planId,
        input.agentId,
        input.taskTitle,
        {
          currentTaskId: input.taskId,
          domainContext: domainContext as any,
          collaborationContext,
        },
      );
    } else if (input.taskId) {
      ensuredSession = await this.persistence.getOrCreateTaskSession(
        input.taskId,
        input.agentId,
        input.taskTitle,
        {
          linkedPlanId: planId,
          linkedTaskId: input.taskId,
          currentTaskId: input.taskId,
          latestTaskInput: input.taskDescription,
        },
      );
    } else {
      ensuredSession = await this.persistence.ensureSession({
        sessionId: input.sessionId,
        sessionType: 'chat',
        ownerType: 'agent',
        ownerId: input.agentId,
        title: input.taskTitle,
        planContext: {
          linkedPlanId: planId,
          linkedTaskId: input.taskId,
          currentTaskId: input.taskId,
          latestTaskInput: input.taskDescription,
        },
        domainContext: domainContext as any,
        collaborationContext,
      });
    }
    this.debugTiming(runOrTaskId, 'start_run.ensure_session', ensureSessionAt, { sessionId: ensuredSession.id });

    const sessionId = ensuredSession.id;

    const refreshMemoSnapshotAt = Date.now();
    await this.refreshSessionMemoSnapshot(ensuredSession, input.agentId);
    this.debugTiming(runOrTaskId, 'start_run.refresh_session_memo_snapshot', refreshMemoSnapshotAt, { sessionId });

    const traceId = `trace-${uuidv4()}`;
    const lockKey = this.getLockKey(input.agentId, sessionId, input.taskId);
    const acquireLockAt = Date.now();
    const release = await this.acquireLock(lockKey);
    this.debugTiming(runOrTaskId, 'start_run.acquire_lock', acquireLockAt, { lockKey });

    let resumed = false;
    const loadOrCreateRunAt = Date.now();
    let run = await this.persistence.findLatestActiveRun(input.agentId, sessionId, input.taskId);
    if (!run) {
      run = await this.persistence.createRun({
        agentId: input.agentId,
        agentName: input.agentName,
        sessionId,
        taskId: input.taskId,
        
        taskTitle: input.taskTitle,
        taskDescription: input.taskDescription,
        metadata: metadataRecord,
      });
    } else {
      resumed = true;
      this.logger.log(`Resuming active run runId=${run.id} lockKey=${lockKey}`);
    }
    this.debugTiming(runOrTaskId, 'start_run.load_or_create_run', loadOrCreateRunAt, {
      runId: run.id,
      resumed,
    });

    const seedMessageAt = Date.now();
    let userMessage = await this.persistence.findLatestMessageByRunAndRole(run.id, 'user');
    if (!userMessage) {
      userMessage = await this.persistence.createMessage({
        runId: run.id,
        agentId: input.agentId,
        sessionId,
        taskId: input.taskId,
        role: 'user',
        sequence: 1,
        content: input.userContent || input.taskDescription,
        status: 'completed',
        metadata: { source: 'runtime.startRun' },
      });

      await this.persistence.createPart({
        runId: run.id,
        messageId: userMessage.id,
        sequence: 1,
        type: 'text',
        status: 'completed',
        content: input.userContent || input.taskDescription,
        startedAt: new Date(),
        endedAt: new Date(),
      });
    }
    this.debugTiming(runOrTaskId, 'start_run.seed_initial_messages', seedMessageAt, {
      runId: run.id,
      hasUserMessage: Boolean(userMessage),
      initialSystemMessageCount: initialSystemMessages.length,
    });

    const emitLifecycleEventsAt = Date.now();
    if (resumed) {
      await this.emitEvent({
        eventType: 'run.resumed',
        agentId: input.agentId,
        
        sessionId,
        runId: run.id,
        taskId: input.taskId,
        traceId,
        sequence: run.currentStep,
        payload: {
          taskTitle: input.taskTitle,
          resumed: true,
        },
      });
    } else {
      await this.emitEvent({
        eventType: 'run.started',
        agentId: input.agentId,
        
        sessionId,
        runId: run.id,
        taskId: input.taskId,
        traceId,
        sequence: 0,
        payload: {
          taskTitle: input.taskTitle,
        },
      });
    }
    this.debugTiming(runOrTaskId, 'start_run.emit_lifecycle_events', emitLifecycleEventsAt, {
      runId: run.id,
      resumed,
    });

    const stepStartedEventAt = Date.now();
    const currentStep = await this.persistence.incrementRunStep(run.id);
    await this.emitEvent({
      eventType: 'run.step.started',
      agentId: input.agentId,
      
      sessionId,
      runId: run.id,
      taskId: input.taskId,
      traceId,
      sequence: currentStep,
      payload: {
        step: currentStep,
      },
    });
    this.debugTiming(runOrTaskId, 'start_run.emit_step_started', stepStartedEventAt, {
      runId: run.id,
      step: currentStep,
    });

    const appendRunToSessionAt = Date.now();
    await this.persistence.appendRunToSession(sessionId, run.id, { taskId: input.taskId });
    this.debugTiming(runOrTaskId, 'start_run.append_run_to_session', appendRunToSessionAt, {
      runId: run.id,
      sessionId,
    });
    this.debugTiming(runOrTaskId, 'start_run.total', startRunAt, {
      runId: run.id,
      sessionId,
    });

    return {
      runId: run.id,
      sessionId,
      userMessageId: userMessage.id,
      traceId,
      lockKey,
      release,
      resumed,
    };
  }

  async releaseRun(context: RuntimeRunContext): Promise<void> {
    context.release();
  }

  async getRun(runId: string): Promise<{
    id: string;
    status: string;
    currentStep: number;
    taskId?: string;
    sessionId?: string;
    roleCode?: string;
    executionChannel?: 'native' | 'opencode';
    executionData?: Record<string, unknown>;
    sync?: {
      state: 'pending' | 'synced' | 'failed';
      lastSyncAt?: Date;
      retryCount: number;
    };
    
    agentId: string;
    startedAt: Date;
    finishedAt?: Date;
    error?: string;
  } | null> {
    const run = await this.persistence.getRun(runId);
    if (!run) return null;
    return {
      id: run.id,
      status: run.status,
      currentStep: run.currentStep,
      taskId: run.taskId,
      sessionId: run.sessionId,
      roleCode: run.roleCode,
      executionChannel: run.executionChannel,
      executionData: run.executionData,
      sync: run.sync,
      
      agentId: run.agentId,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      error: run.error,
    };
  }

  async assertRunnable(runId: string): Promise<void> {
    const run = await this.persistence.getRun(runId);
    if (!run) {
      throw new Error(`Runtime run not found: ${runId}`);
    }
    if (run.status === 'cancelled') {
      throw new Error(`Runtime run is cancelled: ${runId}`);
    }
    if (run.status === 'failed') {
      throw new Error(`Runtime run is failed: ${runId}`);
    }
    if (run.status === 'completed') {
      throw new Error(`Runtime run already completed: ${runId}`);
    }
    if (run.status === 'paused') {
      throw new Error(`Runtime run is paused: ${runId}`);
    }
  }

  async pauseRun(runId: string, reason?: string): Promise<void> {
    await this.pauseRunWithActor(runId, { reason });
  }

  async pauseRunWithActor(
    runId: string,
    actor?: { actorId?: string; actorType?: 'employee' | 'system' | 'agent'; reason?: string },
  ): Promise<void> {
    const run = await this.persistence.getRun(runId);
    if (!run) {
      throw new Error(`Runtime run not found: ${runId}`);
    }
    if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
      throw new Error(`Runtime run cannot be paused in status ${run.status}`);
    }
    if (run.status === 'paused') return;

    await this.persistence.updateRun(runId, { status: 'paused' });
    const sequence = await this.persistence.incrementRunStep(runId);
    await this.emitEvent({
      eventType: 'run.paused',
      
      agentId: run.agentId,
      sessionId: run.sessionId,
      runId: run.id,
      taskId: run.taskId,
      sequence,
      traceId: `trace-${uuidv4()}`,
      payload: {
        reason: actor?.reason || 'paused_by_api',
        actorId: actor?.actorId || 'system',
        actorType: actor?.actorType || 'system',
      },
    });
  }

  async resumeRun(runId: string, reason?: string): Promise<void> {
    await this.resumeRunWithActor(runId, { reason });
  }

  async resumeRunWithActor(
    runId: string,
    actor?: { actorId?: string; actorType?: 'employee' | 'system' | 'agent'; reason?: string },
  ): Promise<void> {
    const run = await this.persistence.getRun(runId);
    if (!run) {
      throw new Error(`Runtime run not found: ${runId}`);
    }
    if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
      throw new Error(`Runtime run cannot be resumed in status ${run.status}`);
    }
    if (run.status !== 'paused') return;

    await this.persistence.updateRun(runId, { status: 'running' });
    const sequence = await this.persistence.incrementRunStep(runId);
    await this.emitEvent({
      eventType: 'run.resumed',
      
      agentId: run.agentId,
      sessionId: run.sessionId,
      runId: run.id,
      taskId: run.taskId,
      sequence,
      traceId: `trace-${uuidv4()}`,
      payload: {
        reason: actor?.reason || 'resumed_by_api',
        actorId: actor?.actorId || 'system',
        actorType: actor?.actorType || 'system',
      },
    });
  }

  async cancelRun(runId: string, reason?: string): Promise<void> {
    await this.cancelRunWithActor(runId, { reason });
  }

  async cancelRunWithActor(
    runId: string,
    actor?: { actorId?: string; actorType?: 'employee' | 'system' | 'agent'; reason?: string },
  ): Promise<void> {
    const run = await this.persistence.getRun(runId);
    if (!run) {
      throw new Error(`Runtime run not found: ${runId}`);
    }
    if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
      return;
    }

    await this.persistence.updateRun(runId, {
      status: 'cancelled',
      finishedAt: new Date(),
      error: actor?.reason || 'cancelled_by_api',
    });

    const sequence = await this.persistence.incrementRunStep(runId);
    await this.emitEvent({
      eventType: 'run.cancelled',
      
      agentId: run.agentId,
      sessionId: run.sessionId,
      runId: run.id,
      taskId: run.taskId,
      sequence,
      traceId: `trace-${uuidv4()}`,
      payload: {
        reason: actor?.reason || 'cancelled_by_api',
        actorId: actor?.actorId || 'system',
        actorType: actor?.actorType || 'system',
      },
    });
  }

  async recordPermissionAsked(input: {
    runId: string;
    agentId: string;
    sessionId?: string;
    taskId?: string;
    traceId: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    const run = await this.persistence.getRun(input.runId);
    if (!run) {
      throw new Error(`Runtime run not found: ${input.runId}`);
    }

    // 触发 permission.asked lifecycle hooks
    await this.runPermissionPipeline('permission.asked', input);

    const sequence = await this.persistence.incrementRunStep(input.runId);
    await this.emitEvent({
      eventType: 'permission.asked',
      agentId: input.agentId,
      sessionId: input.sessionId,
      runId: input.runId,
      taskId: input.taskId,
      sequence,
      traceId: input.traceId,
      payload: input.payload,
    });
  }

  async recordPermissionDecision(input: {
    runId: string;
    agentId: string;
    sessionId?: string;
    taskId?: string;
    traceId: string;
    approved: boolean;
    payload: Record<string, unknown>;
  }): Promise<void> {
    const run = await this.persistence.getRun(input.runId);
    if (!run) {
      throw new Error(`Runtime run not found: ${input.runId}`);
    }

    // 触发 permission.replied / permission.denied lifecycle hooks
    const phase = input.approved ? 'permission.replied' : 'permission.denied';
    await this.runPermissionPipeline(phase, input);

    const sequence = await this.persistence.incrementRunStep(input.runId);
    await this.emitEvent({
      eventType: input.approved ? 'permission.replied' : 'permission.denied',
      agentId: input.agentId,
      sessionId: input.sessionId,
      runId: input.runId,
      taskId: input.taskId,
      sequence,
      traceId: input.traceId,
      payload: input.payload,
    });
  }

  async replayRun(
    runId: string,
    options?: {
      eventTypes?: string[];
      fromSequence?: number;
      toSequence?: number;
      channel?: string;
      limit?: number;
    },
  ): Promise<number> {
    const records = await this.persistence.findEventsByRun(runId, {
      limit: options?.limit || 500,
      eventTypes: options?.eventTypes,
      fromSequence: options?.fromSequence,
      toSequence: options?.toSequence,
    });
    let dispatched = 0;
    for (const record of records) {
      const event: RuntimeEvent = {
        eventId: record.eventId,
        eventType: record.eventType as RuntimeEvent['eventType'],
        
        agentId: record.agentId,
        sessionId: record.sessionId,
        runId: record.runId,
        taskId: record.taskId,
        messageId: record.messageId,
        partId: record.partId,
        toolCallId: record.toolCallId,
        sequence: record.sequence,
        timestamp: record.timestamp.getTime(),
        traceId: (record.payload?.traceId as string) || `trace-replay-${record.eventId}`,
        payload: record.payload || {},
      };
      await this.hookDispatcher.dispatch(event, {
        channel: options?.channel,
        updateOutboxStatus: false,
        replay: true,
      });
      dispatched += 1;
    }
    return dispatched;
  }

  async completeRun(rawInput: RuntimeCompleteRunInput & { traceId: string }): Promise<void> {
    const input = RuntimeCompleteRunInputSchema.parse(rawInput);
    const assistantMessage = await this.persistence.createMessage({
      runId: input.runId,
      agentId: input.agentId,
      sessionId: input.sessionId,
      taskId: input.taskId,
      role: 'assistant',
      sequence: 2,
      content: input.assistantContent,
      status: 'completed',
      metadata: input.metadata,
    });

    const part = await this.persistence.createPart({
      runId: input.runId,
      messageId: assistantMessage.id,
      sequence: 1,
      type: 'text',
      status: 'completed',
      content: input.assistantContent,
      startedAt: new Date(),
      endedAt: new Date(),
      metadata: input.metadata,
    });

    await this.persistence.updateRun(input.runId, {
      status: 'completed',
      finishedAt: new Date(),
    });

    if (input.sessionId) {
      await this.persistence.appendRunToSession(input.sessionId, input.runId, {
        latestTaskOutput: input.assistantContent,
        taskId: input.taskId,
      });
      await this.persistence.appendRunSummary(input.sessionId, {
        runId: input.runId,
        taskId: input.taskId,
        taskTitle: input.metadata?.taskTitle ? String(input.metadata.taskTitle) : undefined,
        objective: input.metadata?.taskObjective ? String(input.metadata.taskObjective) : undefined,
        outcome: this.buildOutcomeSummary(input.assistantContent),
        keyOutputs: this.buildKeyOutputs(input.assistantContent),
        openIssues: this.extractOpenIssues(input.assistantContent),
        completedAt: new Date(),
      });
    }

    await this.emitEvent({
      eventType: 'run.completed',
      agentId: input.agentId,
      sessionId: input.sessionId,
      runId: input.runId,
      taskId: input.taskId,
      messageId: assistantMessage.id,
      partId: part.id,
      traceId: rawInput.traceId,
      sequence: 999999,
      payload: {
        contentLength: input.assistantContent.length,
      },
    });
  }

  async failRun(rawInput: RuntimeFailRunInput & { traceId: string }): Promise<void> {
    const input = RuntimeFailRunInputSchema.parse(rawInput);
    await this.persistence.updateRun(input.runId, {
      status: 'failed',
      error: input.error,
      finishedAt: new Date(),
    });

    if (input.sessionId) {
      await this.persistence.appendRunToSession(input.sessionId, input.runId, { taskId: input.taskId });
    }

    await this.emitEvent({
      eventType: 'run.failed',
      agentId: input.agentId,
      sessionId: input.sessionId,
      runId: input.runId,
      taskId: input.taskId,
      traceId: rawInput.traceId,
      sequence: 999999,
      payload: {
        error: input.error,
        ...(input.metadata || {}),
      },
    });
  }

  async recordLlmDelta(input: {
    runId: string;
    agentId: string;
    messageId: string;
    traceId: string;
    sequence: number;
    delta: string;
    sessionId?: string;
    taskId?: string;
  }): Promise<void> {
    await this.persistence.createPart({
      runId: input.runId,
      messageId: input.messageId,
      sequence: input.sequence,
      type: 'text',
      status: 'running',
      content: input.delta,
      startedAt: new Date(),
    });

    await this.emitEvent({
      eventType: 'llm.delta',
      agentId: input.agentId,
      sessionId: input.sessionId,
      runId: input.runId,
      taskId: input.taskId,
      messageId: input.messageId,
      traceId: input.traceId,
      sequence: input.sequence,
      payload: {
        delta: input.delta,
      },
    });
  }

  async recordToolPending(rawInput: RuntimeToolEventInput & { traceId: string; sequence: number; messageId: string }): Promise<string> {
    const input = RuntimeToolEventInputSchema.parse(rawInput);

    // 触发 toolcall.pending lifecycle hooks
    const pipelineResult = await this.runToolCallPipeline('toolcall.pending', input, rawInput);
    if (pipelineResult.aborted) {
      throw new Error(`ToolCall pending blocked by hook: ${pipelineResult.abortedBy}`);
    }
    // hook 请求取消
    if (pipelineResult.cancelRequested) {
      await this.cancelRunWithActor(input.runId, {
        actorId: 'lifecycle-hook',
        actorType: 'system',
        reason: pipelineResult.cancelReason || 'cancelled_by_toolcall_hook',
      });
      throw new Error(`Runtime run cancelled by toolcall hook: ${pipelineResult.cancelReason || pipelineResult.cancelRequestedBy}`);
    }
    // hook 请求暂停
    if (pipelineResult.pauseRequested) {
      await this.pauseRunWithActor(input.runId, {
        actorId: 'lifecycle-hook',
        actorType: 'system',
        reason: pipelineResult.pauseReason || 'paused_by_toolcall_hook',
      });
      throw new Error(`Runtime run paused by toolcall hook: ${pipelineResult.pauseReason || pipelineResult.pauseRequestedBy}`);
    }

    const part = await this.persistence.createPart({
      runId: input.runId,
      messageId: rawInput.messageId,
      sequence: rawInput.sequence,
      type: 'tool_call',
      status: 'pending',
      toolId: input.toolId,
      toolCallId: input.toolCallId,
      input: input.input,
      startedAt: new Date(),
      metadata: input.metadata,
    });

    await this.emitEvent({
      eventType: 'tool.pending',
      agentId: input.agentId,
      sessionId: input.sessionId,
      runId: input.runId,
      taskId: input.taskId,
      messageId: rawInput.messageId,
      partId: part.id,
      toolCallId: input.toolCallId,
      traceId: rawInput.traceId,
      sequence: rawInput.sequence,
      payload: this.buildToolEventPayload({
        toolId: input.toolId,
        toolName: input.toolName,
        params: input.input,
        includeInputAlias: true,
      }),
    });

    return part.id;
  }

  async recordToolRunning(rawInput: RuntimeToolEventInput & { traceId: string; sequence: number; messageId: string; partId: string }): Promise<void> {
    const input = RuntimeToolEventInputSchema.parse(rawInput);

    // 触发 toolcall.running lifecycle hooks
    await this.runToolCallPipeline('toolcall.running', input, rawInput);

    const transitioned = await this.persistence.transitionPartStatus(rawInput.partId, 'pending', 'running', {
      startedAt: new Date(),
      metadata: {
        stateNote: `Tool ${input.toolId} is running`,
      },
    });
    if (!transitioned) {
      throw new Error(`Invalid tool part transition pending->running for partId=${rawInput.partId}`);
    }

    await this.emitEvent({
      eventType: 'tool.running',
      agentId: input.agentId,
      sessionId: input.sessionId,
      runId: input.runId,
      taskId: input.taskId,
      messageId: rawInput.messageId,
      partId: rawInput.partId,
      toolCallId: input.toolCallId,
      traceId: rawInput.traceId,
      sequence: rawInput.sequence,
      payload: this.buildToolEventPayload({
        toolId: input.toolId,
        toolName: input.toolName,
        params: input.input,
        includeInputAlias: true,
      }),
    });
  }

  async recordToolCompleted(rawInput: RuntimeToolEventInput & { traceId: string; sequence: number; messageId: string; partId?: string }): Promise<void> {
    const input = RuntimeToolEventInputSchema.parse(rawInput);

    // 触发 toolcall.completed lifecycle hooks
    await this.runToolCallPipeline('toolcall.completed', input, rawInput);

    const partId = rawInput.partId;
    if (partId) {
      const transitioned = await this.persistence.transitionPartStatus(partId, 'running', 'completed', {
        output: input.output,
        endedAt: new Date(),
        metadata: input.metadata,
      });
      if (!transitioned) {
        throw new Error(`Invalid tool part transition running->completed for partId=${partId}`);
      }
    }

    await this.emitEvent({
      eventType: 'tool.completed',
      agentId: input.agentId,
      sessionId: input.sessionId,
      runId: input.runId,
      taskId: input.taskId,
      messageId: rawInput.messageId,
      partId: partId,
      toolCallId: input.toolCallId,
      traceId: rawInput.traceId,
      sequence: rawInput.sequence,
      payload: {
        ...this.buildToolEventPayload({
          toolId: input.toolId,
          toolName: input.toolName,
          params: input.input,
          includeInputAlias: true,
        }),
        output: input.output,
      },
    });
  }

  async recordToolFailed(rawInput: RuntimeToolEventInput & { traceId: string; sequence: number; messageId: string; partId?: string }): Promise<void> {
    const input = RuntimeToolEventInputSchema.parse(rawInput);

    // 触发 toolcall.failed lifecycle hooks
    await this.runToolCallPipeline('toolcall.failed', input, rawInput);

    const partId = rawInput.partId;
    if (partId) {
      const fromStatuses: Array<'pending' | 'running'> = ['running', 'pending'];
      let transitioned = false;
      for (const fromStatus of fromStatuses) {
        transitioned = await this.persistence.transitionPartStatus(partId, fromStatus, 'error', {
          error: input.error,
          endedAt: new Date(),
          metadata: input.metadata,
        });
        if (transitioned) break;
      }
      if (!transitioned) {
        throw new Error(`Invalid tool part transition to error for partId=${partId}`);
      }
    }

    await this.emitEvent({
      eventType: 'tool.failed',
      agentId: input.agentId,
      sessionId: input.sessionId,
      runId: input.runId,
      taskId: input.taskId,
      messageId: rawInput.messageId,
      partId,
      toolCallId: input.toolCallId,
      traceId: rawInput.traceId,
      sequence: rawInput.sequence,
      payload: {
        ...this.buildToolEventPayload({
          toolId: input.toolId,
          toolName: input.toolName,
          params: input.input,
          includeInputAlias: true,
        }),
        error: input.error,
      },
    });
  }

  private buildToolEventPayload(input: {
    toolId: string;
    toolName?: string;
    params?: unknown;
    includeInputAlias?: boolean;
  }): Record<string, unknown> {
    const safeParams = this.sanitizeToolParams(input.params);
    const payload: Record<string, unknown> = {
      toolId: input.toolId,
      toolName: input.toolName || input.toolId,
      params: safeParams,
    };

    if (input.includeInputAlias) {
      payload.input = safeParams;
    }

    return payload;
  }

  private sanitizeToolParams(value: unknown): unknown {
    return this.sanitizeToolParamsInner(value, 0);
  }

  private sanitizeToolParamsInner(value: unknown, depth: number): unknown {
    if (depth > 6) {
      return '[Truncated]';
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.sanitizeToolParamsInner(item, depth + 1));
    }

    if (!value || typeof value !== 'object') {
      return value;
    }

    const rawObject = value as Record<string, unknown>;
    const sanitized: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(rawObject)) {
      if (this.shouldMaskParamKey(key)) {
        sanitized[key] = '[REDACTED]';
        continue;
      }
      sanitized[key] = this.sanitizeToolParamsInner(nested, depth + 1);
    }
    return sanitized;
  }

  private shouldMaskParamKey(key: string): boolean {
    const normalized = String(key || '').toLowerCase();
    if (!normalized) return false;
    return (
      normalized.includes('password') ||
      normalized.includes('secret') ||
      normalized.includes('token') ||
      normalized.includes('apikey') ||
      normalized.includes('api_key') ||
      normalized.includes('authorization') ||
      normalized.includes('cookie') ||
      normalized.includes('credential')
    );
  }

  private getLockKey(agentId: string, sessionId?: string, taskId?: string): string {
    if (sessionId && sessionId.trim()) {
      return `agent:${agentId}:session:${sessionId.trim()}`;
    }
    if (taskId && taskId.trim()) {
      return `agent:${agentId}:task:${taskId.trim()}`;
    }
    return `agent:${agentId}:ephemeral`;
  }

  private async acquireLock(lockKey: string): Promise<() => void> {
    const previous = this.lockTails.get(lockKey) || Promise.resolve();
    let resolveCurrent!: () => void;
    const current = new Promise<void>((resolve) => {
      resolveCurrent = resolve;
    });

    const nextTail = previous
      .catch(() => undefined)
      .then(() => current);

    this.lockTails.set(
      lockKey,
      nextTail,
    );

    await previous.catch(() => undefined);

    let released = false;
    return () => {
      if (released) return;
      released = true;
      resolveCurrent();
      const tail = this.lockTails.get(lockKey);
      if (tail === nextTail) {
        this.lockTails.delete(lockKey);
      }
    };
  }

  // ---- Lifecycle Hook Pipeline 辅助方法 ----

  private async runToolCallPipeline(
    phase: 'toolcall.pending' | 'toolcall.running' | 'toolcall.completed' | 'toolcall.failed',
    input: RuntimeToolEventInput,
    rawInput: { traceId: string; messageId?: string; partId?: string },
  ) {
    const context: LifecycleHookContext = {
      phase,
      runId: input.runId,
      agentId: input.agentId,
      taskId: input.taskId,
      sessionId: input.sessionId,
      traceId: rawInput.traceId,
      timestamp: Date.now(),
      payload: {
        toolId: input.toolId,
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        input: input.input,
        output: input.output,
        error: input.error,
        partId: rawInput.partId,
        messageId: rawInput.messageId,
      },
    };
    return this.hookPipeline.run(context);
  }

  private async runPermissionPipeline(
    phase: 'permission.asked' | 'permission.replied' | 'permission.denied',
    input: { runId: string; agentId: string; sessionId?: string; taskId?: string; traceId: string; approved?: boolean; payload: Record<string, unknown> },
  ) {
    const context: LifecycleHookContext = {
      phase,
      runId: input.runId,
      agentId: input.agentId,
      taskId: input.taskId,
      sessionId: input.sessionId,
      traceId: input.traceId,
      timestamp: Date.now(),
      payload: {
        ...input.payload,
        approved: input.approved,
      },
    };
    return this.hookPipeline.run(context);
  }

  private async emitEvent(input: {
    eventType: RuntimeEventType;
    
    agentId: string;
    sessionId?: string;
    runId: string;
    taskId?: string;
    messageId?: string;
    partId?: string;
    toolCallId?: string;
    sequence: number;
    traceId: string;
    payload?: Record<string, unknown>;
  }): Promise<void> {
    const payload = {
      ...(input.payload || {}),
      traceId: input.traceId,
    };
    const event: RuntimeEvent = {
      eventId: `evt-${uuidv4()}`,
      eventType: input.eventType,
      
      agentId: input.agentId,
      sessionId: input.sessionId,
      runId: input.runId,
      taskId: input.taskId,
      messageId: input.messageId,
      partId: input.partId,
      toolCallId: input.toolCallId,
      sequence: input.sequence,
      timestamp: Date.now(),
      traceId: input.traceId,
      payload,
    };
    await this.persistence.enqueueEvent(event);
    await this.hookDispatcher.dispatch(event);
  }

  /** @deprecated Kept for compatibility; new runs do not persist system messages into session history. */
  async appendSystemMessagesToSession(
    sessionId: string,
    messages: Array<{
      role: 'system';
      content: string;
      metadata?: Record<string, unknown>;
    }>,
  ): Promise<void> {
    await this.persistence.appendSystemMessagesToSession(sessionId, messages);
  }

  private async refreshSessionMemoSnapshot(
    session: { id?: string; ownerId?: string; ownerType?: string },
    agentId: string,
  ): Promise<void> {
    const refreshStartAt = Date.now();
    const ownerId = session.ownerId || agentId;
    if (!ownerId || session.ownerType !== 'agent') return;

    const loadExistingAt = Date.now();
    const existing = await this.persistence.getSessionMemoSnapshot(session.id || '');
    this.debugTiming(session.id || ownerId, 'memo_snapshot.load_existing', loadExistingAt, {
      hasExisting: Boolean(existing),
    });
    const existingRefreshedAt = existing?.refreshedAt ? Date.parse(existing.refreshedAt) : 0;
    if (Number.isFinite(existingRefreshedAt) && Date.now() - existingRefreshedAt <= this.memoSnapshotRefreshMs) {
      this.debugTiming(session.id || ownerId, 'memo_snapshot.skip_recent', refreshStartAt, {
        refreshedAt: existing?.refreshedAt || 'unknown',
      });
      return;
    }

    try {
      const loadMemoDataAt = Date.now();
      const [identityResult, todoResult, topicResult] = await Promise.all([
        this.memoService.getIdentityMemos(ownerId),
        this.memoService.listMemos({ agentId: ownerId, memoKind: 'todo', page: 1, pageSize: 2 }),
        this.memoService.listMemos({ agentId: ownerId, memoKind: 'topic', page: 1, pageSize: 5 }),
      ]);
      this.debugTiming(session.id || ownerId, 'memo_snapshot.fetch_memo_data', loadMemoDataAt, {
        identityCount: identityResult.length,
        todoCount: todoResult.items.length,
        topicCount: topicResult.items.length,
      });

      const snapshot = {
        agentId: ownerId,
        refreshedAt: new Date().toISOString(),
        identity: identityResult.slice(0, 2).map((m) => ({
          id: String(m.id || ''),
          memoKind: 'identity' as const,
          title: String(m.title || ''),
          slug: m.slug ? String(m.slug) : undefined,
          content: String(m.content || '').slice(0, 3000),
          updatedAt: m.updatedAt ? new Date(m.updatedAt).toISOString() : undefined,
        })),
        todo: todoResult.items.slice(0, 2).map((m) => ({
          id: String(m.id || ''),
          memoKind: 'todo' as const,
          title: String(m.title || ''),
          slug: m.slug ? String(m.slug) : undefined,
          content: String(m.content || '').slice(0, 3000),
          updatedAt: m.updatedAt ? new Date(m.updatedAt).toISOString() : undefined,
        })),
        topic: topicResult.items.slice(0, 5).map((m) => ({
          id: String(m.id || ''),
          memoKind: 'topic' as const,
          title: String(m.title || ''),
          slug: m.slug ? String(m.slug) : undefined,
          content: String(m.content || '').slice(0, 3000),
          updatedAt: m.updatedAt ? new Date(m.updatedAt).toISOString() : undefined,
        })),
      };

      const enqueueSnapshotAt = Date.now();
      const queued = await this.memoSnapshotQueue.enqueueSnapshotUpdate(session.id || '', snapshot);
      this.debugTiming(session.id || ownerId, 'memo_snapshot.enqueue_update', enqueueSnapshotAt, {
        requestId: queued.requestId,
      });
      this.logger.log(`[memoSnapshot] session=${session.id} agent=${ownerId} queued requestId=${queued.requestId}`);
      this.debugTiming(session.id || ownerId, 'memo_snapshot.total', refreshStartAt, {
        ownerId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`[memoSnapshot] session=${session.id} failed: ${message}`);
      this.debugTiming(session.id || ownerId, 'memo_snapshot.failed', refreshStartAt, {
        ownerId,
      });
    }
  }

  private buildOutcomeSummary(content: string): string {
    const raw = String(content || '').trim();
    if (!raw) {
      return 'No assistant output';
    }

    const parsed = this.tryParseSummaryJson(raw);
    const structuredOutcome = String(parsed?.outcome || parsed?.summary || parsed?.result || '').trim();
    if (structuredOutcome) {
      return structuredOutcome.length > 420 ? `${structuredOutcome.slice(0, 420)}...` : structuredOutcome;
    }

    const sections = this.extractTextSections(raw);
    const preferred = sections.find((section) => section.type === 'paragraph') || sections[0];
    const normalized = String(preferred?.content || raw).replace(/\s+/g, ' ').trim();
    return normalized.length > 420 ? `${normalized.slice(0, 420)}...` : normalized;
  }

  private buildKeyOutputs(content: string): string[] {
    const raw = String(content || '').trim();
    if (!raw) return [];

    const parsed = this.tryParseSummaryJson(raw);
    if (Array.isArray(parsed?.keyOutputs) && parsed.keyOutputs.length > 0) {
      return parsed.keyOutputs.map((item: unknown) => String(item || '').trim()).filter(Boolean).slice(0, 8);
    }

    const sections = this.extractTextSections(raw);
    const candidates = sections
      .filter((section) => section.type === 'bullet' || section.type === 'numbered' || section.type === 'checklist')
      .map((section) => section.content.trim())
      .filter(Boolean);

    if (candidates.length > 0) {
      return Array.from(new Set(candidates)).slice(0, 8);
    }

    return sections
      .filter((section) => section.type === 'heading')
      .map((section) => section.content.trim())
      .filter(Boolean)
      .slice(0, 6);
  }

  private extractOpenIssues(content: string): string[] {
    const raw = String(content || '').trim();
    if (!raw) return [];

    const parsed = this.tryParseSummaryJson(raw);
    if (Array.isArray(parsed?.openIssues) && parsed.openIssues.length > 0) {
      return parsed.openIssues.map((item: unknown) => String(item || '').trim()).filter(Boolean).slice(0, 8);
    }

    const signals = ['TODO', '待办', '后续', '风险', '问题', 'blocked', 'pending', 'follow-up'];
    return this.extractTextSections(raw)
      .map((section) => section.content.trim())
      .filter((line) => {
        if (!line) return false;
        if (/^- \[ \]/.test(line)) return true;
        const lower = line.toLowerCase();
        return signals.some((signal) => lower.includes(signal.toLowerCase()));
      })
      .slice(0, 8);
  }

  private tryParseSummaryJson(content: string): Record<string, unknown> | null {
    const trimmed = String(content || '').trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
      const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i)?.[1] || trimmed.match(/```\s*([\s\S]*?)```/i)?.[1];
      if (!fenced) return null;
      try {
        const parsed = JSON.parse(fenced.trim());
        return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
      } catch {
        return null;
      }
    }
  }

  private extractTextSections(content: string): Array<{ type: 'heading' | 'bullet' | 'numbered' | 'checklist' | 'paragraph'; content: string }> {
    const lines = String(content || '').split('\n');
    const sections: Array<{ type: 'heading' | 'bullet' | 'numbered' | 'checklist' | 'paragraph'; content: string }> = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('```')) continue;
      if (/^#{1,6}\s+/.test(trimmed)) {
        sections.push({ type: 'heading', content: trimmed.replace(/^#{1,6}\s+/, '').trim() });
        continue;
      }
      if (/^- \[.?\]\s+/.test(trimmed)) {
        sections.push({ type: 'checklist', content: trimmed.replace(/^- \[.?\]\s+/, '').trim() });
        continue;
      }
      if (/^[-*]\s+/.test(trimmed)) {
        sections.push({ type: 'bullet', content: trimmed.replace(/^[-*]\s+/, '').trim() });
        continue;
      }
      if (/^\d+\.\s+/.test(trimmed)) {
        sections.push({ type: 'numbered', content: trimmed.replace(/^\d+\.\s+/, '').trim() });
        continue;
      }
      sections.push({ type: 'paragraph', content: trimmed });
    }
    return sections;
  }
}
