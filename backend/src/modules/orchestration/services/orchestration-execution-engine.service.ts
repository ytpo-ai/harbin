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
  OrchestrationRunTask,
  OrchestrationRunTaskDocument,
} from '../../../shared/schemas/orchestration-run-task.schema';
import {
  OrchestrationRun,
  OrchestrationRunDocument,
} from '../../../shared/schemas/orchestration-run.schema';
import { TaskClassificationService } from './task-classification.service';
import { TaskOutputValidationService } from './task-output-validation.service';
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
  private readonly codeValidationMode: 'warn' | 'strict' =
    String(process.env.CODE_VALIDATION_MODE || 'warn').trim().toLowerCase() === 'strict' ? 'strict' : 'warn';

  constructor(
    @InjectModel(OrchestrationTask.name)
    private readonly orchestrationTaskModel: Model<OrchestrationTaskDocument>,
    @InjectModel(OrchestrationRunTask.name)
    private readonly orchestrationRunTaskModel: Model<OrchestrationRunTaskDocument>,
    @InjectModel(OrchestrationRun.name)
    private readonly orchestrationRunModel: Model<OrchestrationRunDocument>,
    private readonly agentClientService: AgentClientService,
    private readonly taskClassificationService: TaskClassificationService,
    private readonly taskOutputValidationService: TaskOutputValidationService,
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
    const isResearchTask = Boolean(false);
    const isReviewTask = this.taskClassificationService.isReviewTask(task.title, task.description);
    const runtimeTaskTypeOverride = this.contextService.normalizeRuntimeTaskTypeOverride(options?.runtimeTaskTypeOverride);
    const persistedRuntimeTaskType = this.contextService.normalizeRuntimeTaskTypeOverride((task as any).runtimeTaskType);
    const runtimeTaskType =
      runtimeTaskTypeOverride
      || persistedRuntimeTaskType
      || this.contextService.resolveAgentRuntimeTaskType(task.title, task.description, {
        isResearchTask,
        isReviewTask,
      });
    const effectiveIsResearchTask = runtimeTaskType === 'research';
    const effectiveIsReviewTask = runtimeTaskType === 'development.review';
    const effectiveResearchTaskKind = effectiveIsResearchTask ? 'generic_research' : null;
    const dependencyContext = await this.contextService.buildDependencyContext(planId, task.dependencyTaskIds || []);
    const retryHint = this.contextService.getRetryFailureHint(task);
    const collaborationContext = this.contextService.buildOrchestrationCollaborationContext(task, {
      dependencyContext,
      executorAgentId: assignment.executorType === 'agent' ? assignment.executorId : undefined,
    });

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

      const generalValidation = this.taskOutputValidationService.validateGeneralOutput(output);
      if (!generalValidation.valid) {
        const detail = generalValidation.missing?.length
          ? `; missing=${generalValidation.missing.join(',')}`
          : '';
        await this.markTaskFailed(taskId, `General output validation failed: ${generalValidation.reason}${detail}`);
        await this.planStatsService.updatePlanSessionTask(planId, taskId, {
          status: 'failed',
          error: `General output validation failed: ${generalValidation.reason}${detail}`,
        });
        this.planEventStreamService.emitTaskLifecycleEvent(taskId, 'task.failed', {
          planId,
          status: 'failed',
          taskTitle: task.title,
          senderAgentId: assignment.executorId,
          reason: 'general_output_validation_failed',
          error: generalValidation.reason,
          missing: generalValidation.missing,
        });
        return { status: 'failed', error: generalValidation.reason };
      }

      if (effectiveIsResearchTask && effectiveResearchTaskKind) {
        const validation = this.taskOutputValidationService.validateResearchOutput(output, effectiveResearchTaskKind);
        if (!validation.valid) {
          const detail = validation.missing?.length
            ? `; missing=${validation.missing.join(',')}`
            : '';
          await this.markTaskFailed(taskId, `Research output validation failed: ${validation.reason}${detail}`);
          await this.planStatsService.updatePlanSessionTask(planId, taskId, {
            status: 'failed',
            error: `Research output validation failed: ${validation.reason}${detail}`,
          });
          this.planEventStreamService.emitTaskLifecycleEvent(taskId, 'task.failed', {
            planId,
            status: 'failed',
            taskTitle: task.title,
            senderAgentId: assignment.executorId,
            reason: 'research_output_validation_failed',
            error: validation.reason,
            missing: validation.missing,
          });
          return { status: 'failed', error: validation.reason };
        }
      }

      if (effectiveIsReviewTask) {
        const validation = this.taskOutputValidationService.validateReviewOutput(output);
        if (!validation.valid) {
          const detail = validation.missing?.length
            ? `; missing=${validation.missing.join(',')}`
            : '';
          await this.markTaskFailed(taskId, `Review output validation failed: ${validation.reason}${detail}`);
          await this.planStatsService.updatePlanSessionTask(planId, taskId, {
            status: 'failed',
            error: `Review output validation failed: ${validation.reason}${detail}`,
          });
          this.planEventStreamService.emitTaskLifecycleEvent(taskId, 'task.failed', {
            planId,
            status: 'failed',
            taskTitle: task.title,
            senderAgentId: assignment.executorId,
            reason: 'review_output_validation_failed',
            error: validation.reason,
            missing: validation.missing,
          });
          return { status: 'failed', error: validation.reason };
        }
      }

      const codeValidation = this.taskOutputValidationService.validateCodeExecutionProof(task.title, task.description, output);
      if (!codeValidation.valid) {
        if (this.codeValidationMode === 'strict') {
          const detail = codeValidation.missing?.length
            ? `; missing=${codeValidation.missing.join(',')}`
            : '';
          await this.markTaskFailed(taskId, `Code output validation failed: ${codeValidation.reason}${detail}`);
          await this.planStatsService.updatePlanSessionTask(planId, taskId, {
            status: 'failed',
            error: `Code output validation failed: ${codeValidation.reason}${detail}`,
          });
          this.planEventStreamService.emitTaskLifecycleEvent(taskId, 'task.failed', {
            planId,
            status: 'failed',
            taskTitle: task.title,
            senderAgentId: assignment.executorId,
            reason: 'development_output_validation_failed',
            error: codeValidation.reason,
            missing: codeValidation.missing,
          });
          return { status: 'failed', error: codeValidation.reason };
        }

        await this.orchestrationTaskModel
          .updateOne(
            { _id: taskId },
            {
              $push: {
                runLogs: {
                  timestamp: new Date(),
                  level: 'warn',
                  message: `CODE_EXECUTION_PROOF warning: ${codeValidation.reason}`,
                  metadata: {
                    missing: codeValidation.missing,
                  },
                },
              },
            },
          )
          .exec();
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
    const isResearchTask = Boolean(false);
    const isReviewTask = this.taskClassificationService.isReviewTask(runTask.title, runTask.description);
    const persistedRuntimeTaskType = this.contextService.normalizeRuntimeTaskTypeOverride((runTask as any).runtimeTaskType);
    const runtimeTaskType =
      persistedRuntimeTaskType
      || this.contextService.resolveAgentRuntimeTaskType(runTask.title, runTask.description, {
        isResearchTask,
        isReviewTask,
      });
    const effectiveIsResearchTask = runtimeTaskType === 'research';
    const effectiveIsReviewTask = runtimeTaskType === 'development.review';
    const effectiveResearchTaskKind = effectiveIsResearchTask ? 'generic_research' : null;
    const dependencyContext = await this.contextService.buildRunDependencyContext(runId, runTask.dependencyTaskIds || []);
    const retryHint = this.contextService.getRetryFailureHint(runTask as any as OrchestrationTask);
    const collaborationContext = this.contextService.buildOrchestrationCollaborationContext(runTask as any as OrchestrationTask, {
      dependencyContext,
      executorAgentId: assignment.executorType === 'agent' ? assignment.executorId : undefined,
    });

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

      const generalValidation = this.taskOutputValidationService.validateGeneralOutput(output);
      if (!generalValidation.valid) {
        const detail = generalValidation.missing?.length
          ? `; missing=${generalValidation.missing.join(',')}`
          : '';
        await this.markRunTaskFailed(runTaskId, `General output validation failed: ${generalValidation.reason}${detail}`);
        return { status: 'failed', error: generalValidation.reason };
      }

      if (effectiveIsResearchTask && effectiveResearchTaskKind) {
        const validation = this.taskOutputValidationService.validateResearchOutput(output, effectiveResearchTaskKind);
        if (!validation.valid) {
          const detail = validation.missing?.length
            ? `; missing=${validation.missing.join(',')}`
            : '';
          await this.markRunTaskFailed(runTaskId, `Research output validation failed: ${validation.reason}${detail}`);
          return { status: 'failed', error: validation.reason };
        }
      }

      if (effectiveIsReviewTask) {
        const validation = this.taskOutputValidationService.validateReviewOutput(output);
        if (!validation.valid) {
          const detail = validation.missing?.length
            ? `; missing=${validation.missing.join(',')}`
            : '';
          await this.markRunTaskFailed(runTaskId, `Review output validation failed: ${validation.reason}${detail}`);
          return { status: 'failed', error: validation.reason };
        }
      }

      const codeValidation = this.taskOutputValidationService.validateCodeExecutionProof(
        runTask.title,
        runTask.description,
        output,
      );
      if (!codeValidation.valid) {
        if (this.codeValidationMode === 'strict') {
          const detail = codeValidation.missing?.length
            ? `; missing=${codeValidation.missing.join(',')}`
            : '';
          await this.markRunTaskFailed(runTaskId, `Code output validation failed: ${codeValidation.reason}${detail}`);
          return { status: 'failed', error: codeValidation.reason };
        }

        await this.orchestrationRunTaskModel
          .updateOne(
            { _id: runTaskId },
            {
              $push: {
                runLogs: {
                  timestamp: new Date(),
                  level: 'warn',
                  message: `CODE_EXECUTION_PROOF warning: ${codeValidation.reason}`,
                  metadata: {
                    missing: codeValidation.missing,
                  },
                },
              },
            },
          )
          .exec();
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
