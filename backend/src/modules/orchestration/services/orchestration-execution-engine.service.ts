import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AgentClientService, AsyncAgentTaskSnapshot } from '../../agents-client/agent-client.service';
import {
  OrchestrationTask,
  OrchestrationTaskDocument,
  OrchestrationTaskStatus,
} from '../../../shared/schemas/orchestration-task.schema';
import {
  OrchestrationPlan,
  OrchestrationPlanDocument,
} from '../../../shared/schemas/orchestration-plan.schema';
import {
  OrchestrationRunTask,
  OrchestrationRunTaskDocument,
} from '../../../shared/schemas/orchestration-run-task.schema';
import {
  OrchestrationRun,
  OrchestrationRunDocument,
} from '../../../shared/schemas/orchestration-run.schema';
import { PlanEventStreamService } from './plan-event-stream.service';
import { OrchestrationContextService } from './orchestration-context.service';
import { PlanStatsService } from './plan-stats.service';

@Injectable()
export class OrchestrationExecutionEngineService {
  private static readonly RUN_CANCELLED_ERROR = '__RUN_CANCELLED_BY_USER__';
  private readonly asyncAgentTaskWaitTimeoutMs = Math.max(
    10000,
    Number(process.env.ORCHESTRATION_AGENT_TASK_WAIT_TIMEOUT_MS || 1800000),
  );
  private readonly asyncAgentTaskPollIntervalMs = Math.max(
    300,
    Number(process.env.ORCHESTRATION_AGENT_TASK_POLL_INTERVAL_MS || 1500),
  );
  private readonly asyncAgentTaskSseEnabled =
    String(process.env.ORCHESTRATION_AGENT_TASK_USE_SSE || 'true').trim().toLowerCase() !== 'false';

  constructor(
    @InjectModel(OrchestrationPlan.name)
    private readonly orchestrationPlanModel: Model<OrchestrationPlanDocument>,
    @InjectModel(OrchestrationTask.name)
    private readonly orchestrationTaskModel: Model<OrchestrationTaskDocument>,
    @InjectModel(OrchestrationRunTask.name)
    private readonly orchestrationRunTaskModel: Model<OrchestrationRunTaskDocument>,
    @InjectModel(OrchestrationRun.name)
    private readonly orchestrationRunModel: Model<OrchestrationRunDocument>,
    private readonly agentClientService: AgentClientService,
    private readonly planEventStreamService: PlanEventStreamService,
    private readonly contextService: OrchestrationContextService,
    private readonly planStatsService: PlanStatsService,
  ) {}

  async executeTaskNode(
    planId: string,
    task: OrchestrationTask,
    options?: {
      orchestrationRunId?: string;
      runtimeTaskTypeOverride?: string;
    },
  ): Promise<{ status: OrchestrationTaskStatus; result?: string; error?: string }> {
    const taskId = this.getEntityId(task as Record<string, any>);
    const assignment = task.assignment || { executorType: 'unassigned' as const };
    const runtimeTaskTypeOverride = this.contextService.normalizeRuntimeTaskTypeOverride(options?.runtimeTaskTypeOverride);
    const persistedRuntimeTaskType = this.contextService.normalizeRuntimeTaskTypeOverride((task as any).runtimeTaskType);
    const runtimeTaskType = runtimeTaskTypeOverride || persistedRuntimeTaskType || 'general';
    const effectiveIsResearchTask = runtimeTaskType === 'research';
    const effectiveIsReviewTask = runtimeTaskType === 'development.review';
    const effectiveResearchTaskKind = effectiveIsResearchTask ? 'generic_research' : null;
    const dependencyContext = await this.contextService.buildDependencyContext(planId, task.dependencyTaskIds || []);
    const retryHint = this.contextService.getRetryFailureHint(task);
    const stepNumber = typeof (task as any).order === 'number' ? Number((task as any).order) + 1 : undefined;
    const collaborationContext = this.contextService.buildOrchestrationCollaborationContext(task, {
      dependencyContext,
      executorAgentId: assignment.executorType === 'agent' ? assignment.executorId : undefined,
    });
    const planTaskContext = await this.loadPlanTaskContext(planId);
    const executePrompt = await this.loadPlanStepExecutePrompt(planId, stepNumber);

    await this.orchestrationTaskModel
      .updateOne(
        { _id: taskId },
        {
          $set: {
            status: 'in_progress',
            startedAt: new Date(),
          },
          $push: {
            runLogs: {
              timestamp: new Date(),
              level: 'info',
              message: 'Task execution started',
              metadata: assignment,
            },
          },
        },
      )
      .exec();

    await this.planStatsService.updatePlanSessionTask(planId, taskId, {
      status: 'in_progress',
      input: task.description,
      executorType: assignment.executorType,
      executorId: assignment.executorId,
    });

    this.planEventStreamService.emitTaskLifecycleEvent(taskId, 'task.status.changed', {
      planId,
      status: 'in_progress',
      taskTitle: task.title,
      previousStatus: task.status,
      assignment,
    });

    if (assignment.executorType === 'employee') {
      await this.orchestrationTaskModel
        .updateOne(
          { _id: taskId },
          {
            $set: {
              status: 'waiting_human',
            },
            $push: {
              runLogs: {
                timestamp: new Date(),
                level: 'info',
                message: 'Waiting for human assignee',
              },
            },
          },
        )
        .exec();

      await this.planStatsService.updatePlanSessionTask(planId, taskId, {
        status: 'waiting_human',
      });

      this.planEventStreamService.emitTaskLifecycleEvent(taskId, 'task.status.changed', {
        planId,
        status: 'waiting_human',
        taskTitle: task.title,
        previousStatus: 'in_progress',
        reason: 'waiting_human_assignee',
      });

      return { status: 'waiting_human' };
    }

    if (assignment.executorType !== 'agent' || !assignment.executorId) {
      await this.markTaskFailed(taskId, 'No agent assigned for execution');
      await this.planStatsService.updatePlanSessionTask(planId, taskId, {
        status: 'failed',
        error: 'No agent assigned for execution',
      });
      this.planEventStreamService.emitTaskLifecycleEvent(taskId, 'task.failed', {
        planId,
        status: 'failed',
        taskTitle: task.title,
        reason: 'no_agent_assigned',
      });
      return { status: 'failed', error: 'No agent assigned for execution' };
    }

    let requestedSessionId = `plan-${planId}-${assignment.executorId || 'unassigned'}`;
    let planSessionSnapshot: any = null;
    const runtimeChannelHint = this.resolveRuntimeChannelHint(runtimeTaskType, task.description);
    const taskPrompt = this.contextService.buildTaskDescription(task.description, {
      dependencyContext,
      isResearchTask: effectiveIsResearchTask,
      isReviewTask: effectiveIsReviewTask,
      researchTaskKind: effectiveResearchTaskKind || undefined,
      retryHint,
      stepIndex: typeof (task as any).order === 'number' ? (task as any).order : undefined,
      currentTaskTitle: task.title,
      runtimeTaskType,
      planTaskContext,
      executePrompt,
    });
    const agentTaskIdempotencyKey = `orch:${planId}:${taskId}:${new Date().getTime()}`;

    try {
      if (assignment.executorType === 'agent' && assignment.executorId) {
        planSessionSnapshot = await this.agentClientService.getOrCreatePlanSession(
          planId,
          assignment.executorId,
          task.title,
          {
            currentTaskId: taskId,
            orchestrationRunId: options?.orchestrationRunId,
            collaborationContext,
          },
        );
        if (planSessionSnapshot?.id) {
          requestedSessionId = String(planSessionSnapshot.id);
        }
      }

      const accepted = await this.agentClientService.createAsyncAgentTask({
        agentId: assignment.executorId,
        prompt: taskPrompt,
        idempotencyKey: agentTaskIdempotencyKey,
        sessionContext: {
          source: 'orchestration',
          planId,
          runId: options?.orchestrationRunId,
          orchestrationTaskId: taskId,
          sessionId: requestedSessionId,
          collaborationContext,
          runSummaries: Array.isArray(planSessionSnapshot?.runSummaries) ? planSessionSnapshot.runSummaries : [],
          dependencies: task.dependencyTaskIds,
          dependencyContext,
          runtimeTaskType,
          runtimeChannelHint,
          researchTaskKind: effectiveResearchTaskKind,
          reviewValidationRequired: effectiveIsReviewTask,
        },
      });

      await this.orchestrationTaskModel
        .updateOne(
          { _id: taskId },
          {
            $set: {
              sessionId: requestedSessionId,
            },
            $push: {
              runLogs: {
                timestamp: new Date(),
                level: 'info',
                message: 'Async agent task submitted',
                metadata: {
                  asyncAgentTaskId: accepted.taskId,
                  acceptedStatus: accepted.status,
                },
              },
            },
          },
        )
        .exec();

      const execution = await this.waitForAsyncAgentTaskResult(accepted.taskId);
      const output = String(execution.output || '').trim();

      if (!output && execution.status === 'succeeded') {
        throw new Error('Async agent task succeeded but returned empty output');
      }

      await this.orchestrationTaskModel
        .updateOne(
          { _id: taskId },
          {
            $set: {
              status: 'completed',
              completedAt: new Date(),
              sessionId: execution.sessionId || requestedSessionId,
              result: {
                summary: 'Task executed by agent',
                output,
              },
            },
            $push: {
              runLogs: {
                timestamp: new Date(),
                level: 'info',
                message: 'Task execution completed',
              },
            },
          },
        )
        .exec();

      await this.planStatsService.updatePlanSessionTask(planId, taskId, {
        status: 'completed',
        output,
        error: undefined,
        agentSessionId: execution.sessionId || requestedSessionId,
        agentRunId: execution.runId,
      });

      this.planEventStreamService.emitTaskLifecycleEvent(taskId, 'task.status.changed', {
        planId,
        status: 'completed',
        taskTitle: task.title,
        senderAgentId: assignment.executorId,
        previousStatus: 'in_progress',
      });

      this.planEventStreamService.emitTaskLifecycleEvent(taskId, 'task.completed', {
        planId,
        status: 'completed',
        taskTitle: task.title,
        senderAgentId: assignment.executorId,
        output,
        agentSessionId: execution.sessionId || requestedSessionId,
        agentRunId: execution.runId,
        asyncAgentTaskId: execution.agentTaskId,
      });

      return { status: 'completed', result: output };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown execution error';
      await this.markTaskFailed(taskId, message);
      await this.planStatsService.updatePlanSessionTask(planId, taskId, {
        status: 'failed',
        error: message,
      });
      this.planEventStreamService.emitTaskLifecycleEvent(taskId, 'task.status.changed', {
        planId,
        status: 'failed',
        taskTitle: task.title,
        senderAgentId: assignment.executorId,
        previousStatus: 'in_progress',
        error: message,
      });
      this.planEventStreamService.emitTaskLifecycleEvent(taskId, 'task.exception', {
        planId,
        status: 'failed',
        taskTitle: task.title,
        senderAgentId: assignment.executorId,
        error: message,
      });
      this.planEventStreamService.emitTaskLifecycleEvent(taskId, 'task.failed', {
        planId,
        status: 'failed',
        taskTitle: task.title,
        senderAgentId: assignment.executorId,
        error: message,
      });
      return { status: 'failed', error: message };
    }
  }

  async executeRunTaskNode(
    runId: string,
    runTask: OrchestrationRunTask,
  ): Promise<{ status: OrchestrationTaskStatus; result?: string; error?: string }> {
    const runTaskId = this.getEntityId(runTask as Record<string, any>);
    if (await this.isRunCancelled(runId)) {
      await this.markRunTaskCancelled(runTaskId, 'Run cancelled by user');
      return { status: 'cancelled', error: 'Run cancelled by user' };
    }
    const assignment = runTask.assignment || { executorType: 'unassigned' as const };
    const persistedRuntimeTaskType = this.contextService.normalizeRuntimeTaskTypeOverride((runTask as any).runtimeTaskType);
    const runtimeTaskType = persistedRuntimeTaskType || 'general';
    const effectiveIsResearchTask = runtimeTaskType === 'research';
    const effectiveIsReviewTask = runtimeTaskType === 'development.review';
    const effectiveResearchTaskKind = effectiveIsResearchTask ? 'generic_research' : null;
    const dependencyContext = await this.contextService.buildRunDependencyContext(runId, runTask.dependencyTaskIds || []);
    const retryHint = this.contextService.getRetryFailureHint(runTask as any as OrchestrationTask);
    const stepNumber = typeof (runTask as any).order === 'number' ? Number((runTask as any).order) + 1 : undefined;
    const collaborationContext = this.contextService.buildOrchestrationCollaborationContext(runTask as any as OrchestrationTask, {
      dependencyContext,
      executorAgentId: assignment.executorType === 'agent' ? assignment.executorId : undefined,
    });
    const planTaskContext = await this.loadRunTaskContext(runId, runTask.planId);
    const executePrompt = await this.loadPlanStepExecutePrompt(runTask.planId, stepNumber);

    await this.orchestrationRunTaskModel
      .updateOne(
        { _id: runTaskId },
        {
          $set: {
            status: 'in_progress',
            startedAt: new Date(),
          },
          $push: {
            runLogs: {
              timestamp: new Date(),
              level: 'info',
              message: 'Run task execution started',
              metadata: assignment,
            },
          },
        },
      )
      .exec();

    this.planEventStreamService.emitPlanStreamEvent(runTask.planId, 'run.task.started', {
      runId,
      runTaskId,
      sourceTaskId: runTask.sourceTaskId,
    });

    if (assignment.executorType === 'employee') {
      await this.markRunTaskWaitingHuman(runTaskId, 'Waiting for human assignee');
      this.planEventStreamService.emitPlanStreamEvent(runTask.planId, 'run.task.updated', {
        runId,
        runTaskId,
        status: 'waiting_human',
      });
      return { status: 'waiting_human' };
    }

    if (assignment.executorType !== 'agent' || !assignment.executorId) {
      await this.markRunTaskFailed(runTaskId, 'No agent assigned for execution');
      this.planEventStreamService.emitPlanStreamEvent(runTask.planId, 'run.task.failed', {
        runId,
        runTaskId,
        error: 'No agent assigned for execution',
      });
      return { status: 'failed', error: 'No agent assigned for execution' };
    }

    let requestedSessionId = `run-${runId}-${assignment.executorId || 'unassigned'}`;
    let planSessionSnapshot: any = null;
    const runtimeChannelHint = this.resolveRuntimeChannelHint(runtimeTaskType, runTask.description);
    const taskPrompt = this.contextService.buildTaskDescription(runTask.description, {
      dependencyContext,
      isResearchTask: effectiveIsResearchTask,
      isReviewTask: effectiveIsReviewTask,
      researchTaskKind: effectiveResearchTaskKind || undefined,
      retryHint,
      stepIndex: typeof (runTask as any).order === 'number' ? (runTask as any).order : undefined,
      currentTaskTitle: runTask.title,
      runtimeTaskType,
      planTaskContext,
      executePrompt,
    });
    const agentTaskIdempotencyKey = `orch-run:${runId}:${runTaskId}:${new Date().getTime()}`;

    try {
      if (assignment.executorType === 'agent' && assignment.executorId) {
        planSessionSnapshot = await this.agentClientService.getOrCreatePlanSession(
          runTask.planId,
          assignment.executorId,
          runTask.title,
          {
            currentTaskId: runTaskId,
            orchestrationRunId: runId,
            collaborationContext,
          },
        );
        if (planSessionSnapshot?.id) {
          requestedSessionId = String(planSessionSnapshot.id);
        }
      }

      const accepted = await this.agentClientService.createAsyncAgentTask({
        agentId: assignment.executorId,
        prompt: taskPrompt,
        idempotencyKey: agentTaskIdempotencyKey,
        sessionContext: {
          source: 'orchestration',
          planId: runTask.planId,
          runId,
          orchestrationRunTaskId: runTaskId,
          sourceTaskId: runTask.sourceTaskId,
          sessionId: requestedSessionId,
          collaborationContext,
          runSummaries: Array.isArray(planSessionSnapshot?.runSummaries) ? planSessionSnapshot.runSummaries : [],
          dependencies: runTask.dependencyTaskIds,
          dependencyContext,
          runtimeTaskType,
          runtimeChannelHint,
          researchTaskKind: effectiveResearchTaskKind,
          reviewValidationRequired: effectiveIsReviewTask,
        },
      });

      await this.orchestrationRunTaskModel
        .updateOne(
          { _id: runTaskId },
          {
            $set: {
              sessionId: requestedSessionId,
            },
            $push: {
              runLogs: {
                timestamp: new Date(),
                level: 'info',
                message: 'Async agent task submitted',
                metadata: {
                  asyncAgentTaskId: accepted.taskId,
                  acceptedStatus: accepted.status,
                },
              },
            },
          },
        )
        .exec();

      const execution = await this.waitForAsyncAgentTaskResult(accepted.taskId, runId);
      const output = String(execution.output || '').trim();

      if (!output && execution.status === 'succeeded') {
        throw new Error('Async agent task succeeded but returned empty output');
      }

      await this.orchestrationRunTaskModel
        .updateOne(
          { _id: runTaskId },
          {
            $set: {
              status: 'completed',
              completedAt: new Date(),
              sessionId: execution.sessionId || requestedSessionId,
              result: {
                summary: output.slice(0, 500),
                output,
              },
            },
            $push: {
              runLogs: {
                timestamp: new Date(),
                level: 'info',
                message: 'Run task execution completed',
              },
            },
          },
        )
        .exec();

      this.planEventStreamService.emitPlanStreamEvent(runTask.planId, 'run.task.completed', {
        runId,
        runTaskId,
        sourceTaskId: runTask.sourceTaskId,
      });

      return { status: 'completed', result: output };
    } catch (error) {
      if (this.isRunCancelledError(error) || await this.isRunCancelled(runId)) {
        await this.markRunTaskCancelled(runTaskId, 'Run cancelled by user');
        this.planEventStreamService.emitPlanStreamEvent(runTask.planId, 'run.task.updated', {
          runId,
          runTaskId,
          sourceTaskId: runTask.sourceTaskId,
          status: 'cancelled',
        });
        return { status: 'cancelled', error: 'Run cancelled by user' };
      }
      const message = error instanceof Error ? error.message : 'Unknown execution failure';
      await this.markRunTaskFailed(runTaskId, message);
      this.planEventStreamService.emitPlanStreamEvent(runTask.planId, 'run.task.failed', {
        runId,
        runTaskId,
        sourceTaskId: runTask.sourceTaskId,
        error: message,
      });
      return { status: 'failed', error: message };
    }
  }

  private async markRunTaskFailed(runTaskId: string, errorMessage: string): Promise<void> {
    await this.orchestrationRunTaskModel
      .updateOne(
        { _id: runTaskId },
        {
          $set: {
            status: 'failed',
            completedAt: new Date(),
            result: {
              error: errorMessage,
            },
          },
          $push: {
            runLogs: {
              timestamp: new Date(),
              level: 'error',
              message: errorMessage,
            },
          },
        },
      )
      .exec();
  }

  private async markRunTaskCancelled(runTaskId: string, reason: string): Promise<void> {
    await this.orchestrationRunTaskModel
      .updateOne(
        { _id: runTaskId },
        {
          $set: {
            status: 'cancelled',
            completedAt: new Date(),
            result: {
              error: reason,
            },
          },
          $push: {
            runLogs: {
              timestamp: new Date(),
              level: 'warn',
              message: reason,
            },
          },
        },
      )
      .exec();
  }

  private async markTaskFailed(taskId: string, errorMessage: string): Promise<void> {
    await this.orchestrationTaskModel
      .updateOne(
        { _id: taskId },
        {
          $set: {
            status: 'failed',
            completedAt: new Date(),
            result: {
              error: errorMessage,
            },
          },
          $push: {
            runLogs: {
              timestamp: new Date(),
              level: 'error',
              message: errorMessage,
            },
          },
        },
      )
      .exec();
  }

  private async markRunTaskWaitingHuman(runTaskId: string, reason: string, output?: string): Promise<void> {
    await this.orchestrationRunTaskModel
      .updateOne(
        { _id: runTaskId },
        {
          $set: {
            status: 'waiting_human',
            result: {
              summary: 'Waiting for human confirmation',
              output,
            },
          },
          $push: {
            runLogs: {
              timestamp: new Date(),
              level: 'warn',
              message: reason,
            },
          },
        },
      )
      .exec();
  }

  private async markTaskWaitingHuman(taskId: string, reason: string, output?: string): Promise<void> {
    await this.orchestrationTaskModel
      .updateOne(
        { _id: taskId },
        {
          $set: {
            status: 'waiting_human',
            result: {
              summary: 'Waiting for human confirmation',
              output,
            },
          },
          $push: {
            runLogs: {
              timestamp: new Date(),
              level: 'warn',
              message: reason,
            },
          },
        },
      )
      .exec();
  }

  private async waitForAsyncAgentTaskResult(
    agentTaskId: string,
    runId?: string,
  ): Promise<{ status: 'succeeded'; output: string; runId?: string; sessionId?: string; agentTaskId: string }> {
    if (this.asyncAgentTaskSseEnabled && !runId) {
      try {
        const terminal = await this.agentClientService.waitForAsyncAgentTaskCompletionBySse(agentTaskId, {
          timeoutMs: this.asyncAgentTaskWaitTimeoutMs,
        });
        if (terminal.status === 'succeeded') {
          return {
            status: 'succeeded',
            output: String(terminal.output || '').trim(),
            runId: terminal.runId,
            sessionId: terminal.sessionId,
            agentTaskId: String(agentTaskId || '').trim(),
          };
        }
        throw new Error(String(terminal.error || `Async agent task ${terminal.status}`));
      } catch {
        // Fallback to polling for compatibility and resilience.
      }
    }

    const startedAt = Date.now();
    const normalizedTaskId = String(agentTaskId || '').trim();
    if (!normalizedTaskId) {
      throw new Error('Invalid async agent task id');
    }

    while (Date.now() - startedAt <= this.asyncAgentTaskWaitTimeoutMs) {
      if (runId && await this.isRunCancelled(runId)) {
        throw new Error(OrchestrationExecutionEngineService.RUN_CANCELLED_ERROR);
      }
      const snapshot = await this.agentClientService.getAsyncAgentTask(normalizedTaskId);
      const status = String(snapshot?.status || '').toLowerCase();
      if (status === 'succeeded') {
        return {
          status: 'succeeded',
          output: this.resolveAsyncTaskOutput(snapshot),
          runId: snapshot?.runId,
          sessionId: snapshot?.sessionId,
          agentTaskId: normalizedTaskId,
        };
      }
      if (status === 'failed') {
        throw new Error(String(snapshot?.error || 'Async agent task failed'));
      }
      if (status === 'cancelled') {
        throw new Error(String(snapshot?.error || 'Async agent task cancelled'));
      }

      await this.sleep(this.asyncAgentTaskPollIntervalMs);
    }

    throw new Error(`Async agent task wait timeout: ${normalizedTaskId}`);
  }

  private resolveAsyncTaskOutput(snapshot: AsyncAgentTaskSnapshot | undefined): string {
    const summary = snapshot?.resultSummary || {};
    const directResponse = summary.response;
    if (typeof directResponse === 'string' && directResponse.trim()) {
      return directResponse;
    }
    const nested = summary.result;
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      const nestedResponse = (nested as Record<string, unknown>).response;
      if (typeof nestedResponse === 'string' && nestedResponse.trim()) {
        return nestedResponse;
      }
    }
    return '';
  }

  private resolveRuntimeChannelHint(
    runtimeTaskType: string,
    description: string,
  ): 'native' | 'opencode' {
    // development.* 类型任务允许路由到 opencode；
    // 其余类型（general/research）走 native。
    const OPENCODE_ELIGIBLE_TASK_TYPES = new Set([
      'development.plan',
      'development.exec',
      'development.review',
    ]);

    if (!OPENCODE_ELIGIBLE_TASK_TYPES.has(runtimeTaskType)) {
      return 'native';
    }

    // development.review 类型不做 description 关键词排除，直接走 opencode。
    // 典型场景：技术专家在 opencode 中读代码做验收评审。
    if (runtimeTaskType === 'development.review') {
      return 'opencode';
    }

    // development 类型保留关键词排除逻辑（向后兼容）：
    // 如果 description 显式引用了系统内部工具，说明任务需要通过 native 引擎
    // 调用 MCP 内部工具，而非在 opencode 中直接操作文件。
    const normalizedDescription = String(description || '').toLowerCase();
    const requiresInternalTools =
      normalizedDescription.includes('builtin.sys-mg.')
      || normalizedDescription.includes('repo-writer')
      || normalizedDescription.includes('repo-read')
      || normalizedDescription.includes('save-template')
      || normalizedDescription.includes('save-prompt-template');

    return requiresInternalTools ? 'native' : 'opencode';
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async isRunCancelled(runId: string): Promise<boolean> {
    const run = await this.orchestrationRunModel.findOne({ _id: runId }).select({ status: 1 }).lean().exec();
    return Boolean(run && run.status === 'cancelled');
  }

  private async loadRunTaskContext(runId: string, planId: string): Promise<Record<string, unknown>> {
    const run = await this.orchestrationRunModel
      .findOne({ _id: runId })
      .select({ metadata: 1 })
      .lean<{ metadata?: Record<string, unknown> }>()
      .exec();
    const runTaskContext = this.contextService.resolvePlanTaskContextFromMetadata(run?.metadata);
    if (Object.keys(runTaskContext).length > 0) {
      return runTaskContext;
    }
    return this.loadPlanTaskContext(planId);
  }

  private async loadPlanTaskContext(planId: string): Promise<Record<string, unknown>> {
    const plan = await this.orchestrationPlanModel
      .findOne({ _id: planId })
      .select({ metadata: 1 })
      .lean<{ metadata?: Record<string, unknown> }>()
      .exec();
    return this.contextService.resolvePlanTaskContextFromMetadata(plan?.metadata);
  }

  private async loadPlanStepExecutePrompt(planId: string, stepNumber?: number): Promise<string | undefined> {
    if (!Number.isInteger(stepNumber) || Number(stepNumber) <= 0) {
      return undefined;
    }

    const plan = await this.orchestrationPlanModel
      .findOne({ _id: planId })
      .select({ metadata: 1 })
      .lean<{ metadata?: Record<string, unknown> }>()
      .exec();
    const metadata = (plan?.metadata || {}) as Record<string, unknown>;
    const outline = Array.isArray(metadata.outline) ? metadata.outline as Array<Record<string, unknown>> : [];
    const outlineStep = outline.find((item) => Number(item.step) === Number(stepNumber));
    const phasePrompts = outlineStep?.phasePrompts;
    if (!phasePrompts || typeof phasePrompts !== 'object' || Array.isArray(phasePrompts)) {
      return undefined;
    }
    const executePrompt = String((phasePrompts as Record<string, unknown>).execute || '').trim();
    return executePrompt || undefined;
  }

  private isRunCancelledError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }
    return error.message === OrchestrationExecutionEngineService.RUN_CANCELLED_ERROR;
  }

  private getEntityId(entity: Record<string, any>): string {
    if (entity.id) {
      return String(entity.id);
    }
    if (entity._id) {
      return entity._id.toString();
    }
    return '';
  }
}
