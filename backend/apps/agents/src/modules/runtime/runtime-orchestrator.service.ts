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

export interface RuntimeRunContext {
  runId: string;
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

  constructor(
    private readonly persistence: RuntimePersistenceService,
    private readonly hookDispatcher: HookDispatcherService,
  ) {}

  async startRun(rawInput: RuntimeStartRunInput): Promise<RuntimeRunContext> {
    const input = RuntimeStartRunInputSchema.parse(rawInput);
    const traceId = `trace-${uuidv4()}`;
    const lockKey = this.getLockKey(input.agentId, input.sessionId, input.taskId);
    const release = await this.acquireLock(lockKey);

    let resumed = false;
    let run = await this.persistence.findLatestActiveRun(input.agentId, input.sessionId, input.taskId);
    if (!run) {
      run = await this.persistence.createRun({
        agentId: input.agentId,
        agentName: input.agentName,
        sessionId: input.sessionId,
        taskId: input.taskId,
        organizationId: input.organizationId,
        taskTitle: input.taskTitle,
        taskDescription: input.taskDescription,
        metadata: input.metadata,
      });
    } else {
      resumed = true;
      this.logger.log(`Resuming active run runId=${run.id} lockKey=${lockKey}`);
    }

    let userMessage = await this.persistence.findLatestMessageByRunAndRole(run.id, 'user');
    if (!userMessage) {
      userMessage = await this.persistence.createMessage({
        runId: run.id,
        agentId: input.agentId,
        sessionId: input.sessionId,
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

    if (resumed) {
      await this.emitEvent({
        eventType: 'run.resumed',
        agentId: input.agentId,
        organizationId: input.organizationId,
        sessionId: input.sessionId,
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
        organizationId: input.organizationId,
        sessionId: input.sessionId,
        runId: run.id,
        taskId: input.taskId,
        traceId,
        sequence: 0,
        payload: {
          taskTitle: input.taskTitle,
        },
      });
    }

    const currentStep = await this.persistence.incrementRunStep(run.id);
    await this.emitEvent({
      eventType: 'run.step.started',
      agentId: input.agentId,
      organizationId: input.organizationId,
      sessionId: input.sessionId,
      runId: run.id,
      taskId: input.taskId,
      traceId,
      sequence: currentStep,
      payload: {
        step: currentStep,
      },
    });

    return {
      runId: run.id,
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
      organizationId: run.organizationId,
      agentId: run.agentId,
      sessionId: run.sessionId,
      runId: run.id,
      taskId: run.taskId,
      sequence,
      traceId: `trace-${uuidv4()}`,
      payload: {
        reason: reason || 'paused_by_api',
      },
    });
  }

  async resumeRun(runId: string, reason?: string): Promise<void> {
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
      organizationId: run.organizationId,
      agentId: run.agentId,
      sessionId: run.sessionId,
      runId: run.id,
      taskId: run.taskId,
      sequence,
      traceId: `trace-${uuidv4()}`,
      payload: {
        reason: reason || 'resumed_by_api',
      },
    });
  }

  async cancelRun(runId: string, reason?: string): Promise<void> {
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
      error: reason || 'cancelled_by_api',
    });

    const sequence = await this.persistence.incrementRunStep(runId);
    await this.emitEvent({
      eventType: 'run.cancelled',
      organizationId: run.organizationId,
      agentId: run.agentId,
      sessionId: run.sessionId,
      runId: run.id,
      taskId: run.taskId,
      sequence,
      traceId: `trace-${uuidv4()}`,
      payload: {
        reason: reason || 'cancelled_by_api',
      },
    });
  }

  async replayRun(runId: string): Promise<number> {
    const records = await this.persistence.findEventsByRun(runId, 500);
    let dispatched = 0;
    for (const record of records) {
      const event: RuntimeEvent = {
        eventId: record.eventId,
        eventType: record.eventType as RuntimeEvent['eventType'],
        organizationId: record.organizationId,
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
      await this.hookDispatcher.dispatch(event);
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
      payload: {
        toolId: input.toolId,
        input: input.input,
      },
    });

    return part.id;
  }

  async recordToolRunning(rawInput: RuntimeToolEventInput & { traceId: string; sequence: number; messageId: string; partId: string }): Promise<void> {
    const input = RuntimeToolEventInputSchema.parse(rawInput);
    await this.persistence.updatePart(rawInput.partId, {
      status: 'running',
      startedAt: new Date(),
      metadata: {
        stateNote: `Tool ${input.toolId} is running`,
      },
    });

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
      payload: {
        toolId: input.toolId,
      },
    });
  }

  async recordToolCompleted(rawInput: RuntimeToolEventInput & { traceId: string; sequence: number; messageId: string; partId?: string }): Promise<void> {
    const input = RuntimeToolEventInputSchema.parse(rawInput);
    const partId = rawInput.partId;
    if (partId) {
      await this.persistence.updatePart(partId, {
        status: 'completed',
        output: input.output,
        endedAt: new Date(),
        metadata: input.metadata,
      });
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
        toolId: input.toolId,
        output: input.output,
      },
    });
  }

  async recordToolFailed(rawInput: RuntimeToolEventInput & { traceId: string; sequence: number; messageId: string; partId?: string }): Promise<void> {
    const input = RuntimeToolEventInputSchema.parse(rawInput);
    const partId = rawInput.partId;
    if (partId) {
      await this.persistence.updatePart(partId, {
        status: 'error',
        error: input.error,
        endedAt: new Date(),
        metadata: input.metadata,
      });
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
        toolId: input.toolId,
        error: input.error,
      },
    });
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

  private async emitEvent(input: {
    eventType: RuntimeEventType;
    organizationId?: string;
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
      organizationId: input.organizationId,
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
}
