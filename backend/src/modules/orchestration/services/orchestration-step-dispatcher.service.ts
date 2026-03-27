import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Model } from 'mongoose';
import {
  OrchestrationPlan,
  OrchestrationPlanDocument,
  OrchestrationGenerationState,
} from '../../../shared/schemas/orchestration-plan.schema';
import {
  OrchestrationTask,
  OrchestrationTaskDocument,
} from '../../../shared/schemas/orchestration-task.schema';
import { PlannerService, PostExecutionDecision } from '../planner.service';
import { PlanEventStreamService } from './plan-event-stream.service';
import { IncrementalPlanningService } from './incremental-planning.service';
import { OrchestrationContextService } from './orchestration-context.service';
import { AgentClientService } from '../../agents-client/agent-client.service';
import { ORCH_EVENTS, OrchestrationSource } from '../orchestration-events';

type Phase = 'idle' | 'generating' | 'pre_execute' | 'executing' | 'post_execute';

const AUTO_RETRY_DISABLED_TASK_TYPES = new Set([
  'development.plan',
  'development.exec',
  'development.review',
]);

@Injectable()
export class OrchestrationStepDispatcherService {
  private readonly logger = new Logger(OrchestrationStepDispatcherService.name);
  private readonly activePlannings = new Set<string>();

  constructor(
    @InjectModel(OrchestrationPlan.name)
    private readonly planModel: Model<OrchestrationPlanDocument>,
    @InjectModel(OrchestrationTask.name)
    private readonly taskModel: Model<OrchestrationTaskDocument>,
    private readonly plannerService: PlannerService,
    private readonly incrementalPlanningService: IncrementalPlanningService,
    private readonly eventStream: PlanEventStreamService,
    private readonly contextService: OrchestrationContextService,
    private readonly eventEmitter: EventEmitter2,
    private readonly agentClientService: AgentClientService,
  ) {}

  async advanceOnce(
    planId: string,
    options?: { source?: OrchestrationSource; targetPhase?: Phase },
  ): Promise<{ advanced: boolean; phase?: Phase }> {
    const normalizedPlanId = String(planId || '').trim();
    if (!normalizedPlanId) {
      throw new NotFoundException('Plan not found');
    }
    if (this.activePlannings.has(normalizedPlanId)) {
      return { advanced: false };
    }

    this.activePlannings.add(normalizedPlanId);
    try {
      const plan = await this.planModel.findById(normalizedPlanId).exec();
      if (!plan) {
        throw new NotFoundException('Plan not found');
      }

      const state = this.resolveGenerationState(plan.generationState);
      const phase = state.currentPhase || 'idle';
      if (options?.targetPhase && options.targetPhase !== phase) {
        return { advanced: false, phase };
      }

      if (state.isComplete) {
        await this.archivePlannerSessionIfNeeded(state);
        return { advanced: false, phase };
      }

      if (await this.checkTerminalConditions(normalizedPlanId, plan, state)) {
        return { advanced: false, phase };
      }

      const plannerSessionId = await this.ensurePlannerSession(normalizedPlanId, plan, state);

      if (phase === 'idle' || phase === 'generating') {
        let effectiveState = state;
        if (phase === 'idle') {
          const claimedState: OrchestrationGenerationState = {
            ...state,
            currentPhase: 'generating',
            plannerSessionId,
          };
          const claimed = await this.updateGenerationStateIfExpected(
            normalizedPlanId,
            state,
            claimedState,
          );
          if (!claimed) {
            return { advanced: false, phase };
          }
          effectiveState = claimedState;
        }
        await this.phaseGenerate(normalizedPlanId, plan.sourcePrompt || '', effectiveState, plannerSessionId);
        return { advanced: true, phase: 'generating' };
      }
      if (phase === 'pre_execute') {
        await this.phasePreExecute(normalizedPlanId, state, plannerSessionId);
        return { advanced: true, phase };
      }
      if (phase === 'executing') {
        await this.phaseExecute(normalizedPlanId, state);
        return { advanced: true, phase };
      }
      if (phase === 'post_execute') {
        await this.phasePostExecute(normalizedPlanId, state, plannerSessionId);
        return { advanced: true, phase };
      }

      throw new ConflictException(`Unsupported phase: ${phase}`);
    } finally {
      this.activePlannings.delete(normalizedPlanId);
    }
  }

  async retryCurrentTask(planId: string): Promise<{ accepted: boolean }> {
    const plan = await this.planModel.findById(planId).lean().exec();
    const state = this.resolveGenerationState(plan?.generationState as OrchestrationGenerationState | undefined);
    if (!state.currentTaskId) {
      return { accepted: false };
    }
    const currentTask = await this.taskModel
      .findOne({ _id: state.currentTaskId, planId })
      .select({ runtimeTaskType: 1 })
      .lean()
      .exec();
    if (this.isAutoRetryDisabledTaskType((currentTask as { runtimeTaskType?: string } | null)?.runtimeTaskType)) {
      return { accepted: false };
    }
    const config = this.incrementalPlanningService.resolveGenerationConfig(
      plan?.generationConfig as OrchestrationPlanDocument['generationConfig'],
    );
    if (state.consecutiveFailures >= config.maxRetries || state.totalFailures >= config.maxTotalFailures) {
      return { accepted: false };
    }
    await this.updateGenerationState(planId, {
      ...state,
      currentPhase: 'pre_execute',
      lastDecision: 'retry',
    });
    setImmediate(() => {
      this.advanceOnce(planId, { source: 'internal' }).catch((error) => {
        this.logger.warn(`retryCurrentTask failed for plan ${planId}: ${error instanceof Error ? error.message : String(error)}`);
      });
    });
    return { accepted: true };
  }

  private async phaseGenerate(
    planId: string,
    sourcePrompt: string,
    state: OrchestrationGenerationState,
    plannerSessionId: string,
  ): Promise<void> {
    await this.emitStepStarted(planId, state.currentStep + 1);
    const plannerContext = await this.incrementalPlanningService.buildPlannerContext(planId, sourcePrompt);
    const nextTaskResult = await this.plannerService.generateNextTask(planId, plannerContext, {
      sessionId: plannerSessionId,
    });

    const mergedState: OrchestrationGenerationState = {
      ...state,
      totalCost: Number(state.totalCost || 0) + Number(nextTaskResult.costTokens || 0),
      plannerSessionId,
    };

    if (nextTaskResult.isGoalReached) {
      await this.completeAndArchive(planId, mergedState);
      return;
    }

    if (!nextTaskResult.task?.title || !nextTaskResult.task?.description) {
      const nextFailures = this.bumpFailureCounters(mergedState, 'Planner returned empty task definition');
      await this.updateGenerationStateIfExpected(planId, mergedState, {
        ...nextFailures,
        currentPhase: 'idle',
      });
      await this.autoAdvance(planId);
      return;
    }

    const isRedesign = nextTaskResult.action === 'redesign' && Boolean(nextTaskResult.redesignTaskId);
    const createdTask = isRedesign
      ? await this.incrementalPlanningService.redesignFailedTask(
        planId,
        String(nextTaskResult.redesignTaskId),
        nextTaskResult.task,
      )
      : await this.incrementalPlanningService.createTaskFromPlannerOutput(
        planId,
        nextTaskResult.task,
        mergedState.currentStep,
      );

    const nextState: OrchestrationGenerationState = {
      ...mergedState,
      currentStep: isRedesign ? mergedState.currentStep : mergedState.currentStep + 1,
      totalGenerated: isRedesign ? mergedState.totalGenerated : mergedState.totalGenerated + 1,
      currentPhase: 'pre_execute',
      currentTaskId: String(createdTask._id),
      lastError: undefined,
    };

    const advanced = await this.updateGenerationStateIfExpected(planId, mergedState, nextState);
    if (!advanced) {
      return;
    }

    const step = nextState.currentStep;
    this.eventStream.emitPlanStreamEvent(planId, 'planning.task.generated', {
      planId,
      step,
      taskId: String(createdTask._id),
      title: createdTask.title,
      agentId: createdTask.assignment?.executorId,
      mode: isRedesign ? 'redesign' : 'new',
    });
    this.eventEmitter.emit(ORCH_EVENTS.TASK_GENERATED, {
      planId,
      taskId: String(createdTask._id),
      step,
      phase: 'generating',
      result: {
        title: createdTask.title,
      },
    });

    await this.autoAdvance(planId);
  }

  private async phasePreExecute(
    planId: string,
    state: OrchestrationGenerationState,
    plannerSessionId: string,
  ): Promise<void> {
    const task = await this.getCurrentTaskOrThrow(planId, state.currentTaskId);
    const planSnapshot = await this.planModel
      .findById(planId)
      .exec();
    const inferredRuntimeTaskType =
      typeof (this.contextService as any).inferRuntimeTaskTypeFromPlanContext === 'function'
        ? this.contextService.inferRuntimeTaskTypeFromPlanContext({
          planDomainType: String((planSnapshot as { domainType?: string } | null)?.domainType || 'general'),
          planGoal: String((planSnapshot as { sourcePrompt?: string } | null)?.sourcePrompt || ''),
          step: state.currentStep,
          taskTitle: task.title,
          taskDescription: task.description,
          existingRuntimeTaskType: task.runtimeTaskType,
        })
        : (task.runtimeTaskType || 'general');

    if (task.runtimeTaskType !== inferredRuntimeTaskType) {
      await this.taskModel
        .updateOne(
          { _id: task._id },
          {
            $set: {
              runtimeTaskType: inferredRuntimeTaskType,
            },
            $push: {
              runLogs: {
                timestamp: new Date(),
                level: 'info',
                message: 'Runtime task type inferred at pre-execute phase',
                metadata: {
                  inferredRuntimeTaskType,
                  previousRuntimeTaskType: task.runtimeTaskType,
                },
              },
            },
          },
        )
        .exec();
      task.runtimeTaskType = inferredRuntimeTaskType;
    }

    const prompt = this.contextService.buildPreTaskContext({
      step: state.currentStep,
      taskId: String(task._id),
      taskTitle: task.title,
      taskDescription: task.description,
      runtimeTaskType: task.runtimeTaskType,
      planDomainType: String((planSnapshot as { domainType?: string } | null)?.domainType || 'general'),
      planGoal: String((planSnapshot as { sourcePrompt?: string } | null)?.sourcePrompt || ''),
    });

    const decision = await this.plannerService.executePreTask(planId, prompt, plannerSessionId);
    const nextPhase: Phase = decision.allowExecute ? 'executing' : 'post_execute';

    if (!decision.allowExecute) {
      await this.taskModel
        .updateOne(
          { _id: task._id },
          {
            $set: {
              status: 'failed',
              result: {
                summary: 'Blocked by pre-execution planner decision',
                error: decision.notes || 'Planner returned allowExecute=false',
              },
              completedAt: new Date(),
            },
            $push: {
              runLogs: {
                timestamp: new Date(),
                level: 'warn',
                message: 'Task blocked by pre-execution planner decision',
                metadata: { decision },
              },
            },
          },
        )
        .exec();
    }

    const advanced = await this.updateGenerationStateIfExpected(planId, state, {
      ...state,
      currentPhase: nextPhase,
    });
    if (!advanced) {
      return;
    }

    this.eventStream.emitPlanStreamEvent(planId, 'planning.task.pre_executed', {
      planId,
      step: state.currentStep,
      taskId: String(task._id),
      allowExecute: decision.allowExecute,
      riskFlags: decision.riskFlags,
    });
    this.eventEmitter.emit(ORCH_EVENTS.TASK_PRE_EXECUTED, {
      planId,
      taskId: String(task._id),
      step: state.currentStep,
      phase: 'pre_execute',
      result: { allowExecute: decision.allowExecute, riskFlags: decision.riskFlags },
    });

    await this.autoAdvance(planId);
  }

  private async phaseExecute(planId: string, state: OrchestrationGenerationState): Promise<void> {
    const task = await this.getCurrentTaskOrThrow(planId, state.currentTaskId);
    this.eventStream.emitPlanStreamEvent(planId, 'planning.task.executing', {
      planId,
      step: state.currentStep,
      taskId: String(task._id),
    });

    const executionResult = await this.incrementalPlanningService.executeIncrementalTaskWithRunRecord(
      planId,
      task,
      state.currentStep,
      false,
    ) as { status: string; result?: string; error?: string };

    const advanced = await this.updateGenerationStateIfExpected(planId, state, {
      ...state,
      currentPhase: 'post_execute',
    });
    if (!advanced) {
      return;
    }

    const eventType = executionResult.status === 'completed' ? 'planning.task.completed' : 'planning.task.failed';
    this.eventStream.emitPlanStreamEvent(planId, eventType, {
      planId,
      step: state.currentStep,
      taskId: String(task._id),
      error: executionResult.error,
    });
    this.eventEmitter.emit(ORCH_EVENTS.TASK_EXECUTED, {
      planId,
      taskId: String(task._id),
      step: state.currentStep,
      phase: 'executing',
      result: executionResult,
    });

    await this.autoAdvance(planId);
  }

  private async phasePostExecute(
    planId: string,
    state: OrchestrationGenerationState,
    plannerSessionId: string,
  ): Promise<void> {
    const task = await this.getCurrentTaskOrThrow(planId, state.currentTaskId);
    const postPrompt = this.contextService.buildPostTaskContext({
      step: state.currentStep,
      taskId: String(task._id),
      taskTitle: task.title,
      executionStatus: task.status,
      executionOutput: task.result?.output || task.result?.summary,
      executionError: task.result?.error,
    });
    let decision: PostExecutionDecision;
    try {
      decision = await this.plannerService.executePostTask(planId, postPrompt, plannerSessionId);
    } catch (error) {
      decision = {
        nextAction: 'stop',
        reason: error instanceof Error ? error.message : 'post-task planner failed',
      };
    }

    if (decision.nextAction === 'retry' && this.isAutoRetryDisabledTaskType(task.runtimeTaskType)) {
      decision = {
        ...decision,
        nextAction: 'redesign',
        reason: `${decision.reason} (auto retry disabled for ${task.runtimeTaskType})`,
      };
    }

    this.eventStream.emitPlanStreamEvent(planId, 'planning.task.post_processed', {
      planId,
      step: state.currentStep,
      taskId: String(task._id),
      nextAction: decision.nextAction,
      reason: decision.reason,
    });
    this.eventEmitter.emit(ORCH_EVENTS.TASK_POST_PROCESSED, {
      planId,
      taskId: String(task._id),
      step: state.currentStep,
      phase: 'post_execute',
      result: decision,
    });

    if (decision.nextAction === 'stop') {
      await this.completeAndArchive(planId, {
        ...state,
        currentPhase: 'idle',
        currentTaskId: undefined,
        lastDecision: 'stop',
      });
      return;
    }

    if (decision.nextAction === 'retry') {
      await this.updateGenerationStateIfExpected(planId, state, {
        ...state,
        currentPhase: 'pre_execute',
        lastDecision: 'retry',
      });
      await this.autoAdvance(planId);
      return;
    }

    const nextState: OrchestrationGenerationState = {
      ...state,
      currentPhase: 'idle',
      currentTaskId: undefined,
      lastDecision: decision.nextAction,
    };

    await this.updateGenerationStateIfExpected(planId, state, nextState);
    await this.autoAdvance(planId);
  }

  private async ensurePlannerSession(
    planId: string,
    plan: OrchestrationPlanDocument,
    state: OrchestrationGenerationState,
  ): Promise<string> {
    const existingSessionId = String(state.plannerSessionId || '').trim();
    if (existingSessionId) {
      return existingSessionId;
    }

    const plannerAgentId = String(plan.strategy?.plannerAgentId || '').trim();
    if (!plannerAgentId) {
      throw new ConflictException('Plan has no planner agent configured');
    }

    const session = await this.agentClientService.getOrCreatePlanSession(
      planId,
      plannerAgentId,
      `Planner Session: ${plan.title}`,
      {
        collaborationContext: {
          mode: 'planning',
          roleInPlan: 'planner',
          planId,
        },
      },
    );

    const sessionId = String(session?.id || session?.sessionId || '').trim();
    if (!sessionId) {
      throw new ConflictException('Failed to initialize planner session');
    }

    await this.updateGenerationState(planId, {
      ...state,
      plannerSessionId: sessionId,
    });

    return sessionId;
  }

  private async checkTerminalConditions(
    planId: string,
    plan: OrchestrationPlanDocument,
    state: OrchestrationGenerationState,
  ): Promise<boolean> {
    const config = this.incrementalPlanningService.resolveGenerationConfig(plan.generationConfig);

    if (state.totalGenerated >= config.maxTasks) {
      await this.failAndArchive(planId, `Exceeded max tasks limit (${config.maxTasks})`);
      return true;
    }
    if (state.totalCost > config.maxCostTokens) {
      await this.failAndArchive(planId, `Exceeded cost limit (${config.maxCostTokens} tokens)`);
      return true;
    }
    if (state.consecutiveFailures >= config.maxRetries || state.totalFailures >= config.maxTotalFailures) {
      await this.failAndArchive(
        planId,
        `Planning failed: consecutive=${state.consecutiveFailures}/${config.maxRetries}, total=${state.totalFailures}/${config.maxTotalFailures}`,
      );
      return true;
    }
    return false;
  }

  private bumpFailureCounters(state: OrchestrationGenerationState, error: string): OrchestrationGenerationState {
    return {
      ...state,
      totalRetries: Number(state.totalRetries || 0) + 1,
      consecutiveFailures: Number(state.consecutiveFailures || 0) + 1,
      totalFailures: Number(state.totalFailures || 0) + 1,
      lastError: error,
    };
  }

  private async autoAdvance(planId: string): Promise<void> {
    setImmediate(() => {
      this.advanceOnce(planId, { source: 'internal' }).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`autoAdvance failed for plan ${planId}: ${message}`);
      });
    });
  }

  private async completeAndArchive(planId: string, state: OrchestrationGenerationState): Promise<void> {
    await this.incrementalPlanningService.completePlanning(planId, {
      ...state,
      isComplete: true,
      currentPhase: 'idle',
      currentTaskId: undefined,
    });
    await this.archivePlannerSessionIfNeeded(state);
    this.eventEmitter.emit(ORCH_EVENTS.PLAN_COMPLETED, {
      planId,
      step: state.currentStep,
      totalGenerated: state.totalGenerated,
    });
  }

  private async failAndArchive(planId: string, error: string): Promise<void> {
    await this.incrementalPlanningService.failPlanning(planId, error);
    const plan = await this.planModel.findById(planId).lean().exec();
    const state = this.resolveGenerationState(plan?.generationState as OrchestrationGenerationState | undefined);
    await this.archivePlannerSessionIfNeeded(state);
    this.eventEmitter.emit(ORCH_EVENTS.PLAN_FAILED, {
      planId,
      error,
    });
  }

  private async archivePlannerSessionIfNeeded(state: OrchestrationGenerationState): Promise<void> {
    const sessionId = String(state.plannerSessionId || '').trim();
    if (!sessionId) {
      return;
    }
    await this.agentClientService.archiveSession(sessionId);
  }

  private async getCurrentTaskOrThrow(planId: string, taskId?: string): Promise<OrchestrationTaskDocument> {
    const normalizedTaskId = String(taskId || '').trim();
    if (!normalizedTaskId) {
      throw new NotFoundException('Current task not found');
    }
    const task = await this.taskModel.findOne({ _id: normalizedTaskId, planId }).exec();
    if (!task) {
      throw new NotFoundException('Current task not found');
    }
    return task;
  }

  private async emitStepStarted(planId: string, step: number): Promise<void> {
    this.eventStream.emitPlanStreamEvent(planId, 'planning.step.started', {
      planId,
      step,
    });
  }

  private async updateGenerationState(planId: string, state: OrchestrationGenerationState): Promise<void> {
    await this.planModel.updateOne({ _id: planId }, { $set: { generationState: state } }).exec();
  }

  private async updateGenerationStateIfExpected(
    planId: string,
    expected: OrchestrationGenerationState,
    next: OrchestrationGenerationState,
  ): Promise<boolean> {
    const expectedPhase = expected.currentPhase || 'idle';
    const expectedTaskId = String(expected.currentTaskId || '').trim();
    const filter: Record<string, unknown> = {
      _id: planId,
      'generationState.currentPhase': expectedPhase,
      'generationState.isComplete': false,
    };
    if (expectedTaskId) {
      filter['generationState.currentTaskId'] = expectedTaskId;
    }
    const updated = await this.planModel
      .findOneAndUpdate(filter, { $set: { generationState: next } }, { new: false })
      .lean()
      .exec();
    return Boolean(updated);
  }

  private resolveGenerationState(state?: OrchestrationGenerationState): OrchestrationGenerationState {
    return {
      currentStep: Number(state?.currentStep || 0),
      totalGenerated: Number(state?.totalGenerated || 0),
      totalRetries: Number(state?.totalRetries || 0),
      consecutiveFailures: Number(state?.consecutiveFailures || 0),
      totalFailures: Number(state?.totalFailures || 0),
      totalCost: Number(state?.totalCost || 0),
      isComplete: Boolean(state?.isComplete),
      lastError: state?.lastError,
      currentPhase: state?.currentPhase || 'idle',
      lastDecision: state?.lastDecision,
      plannerSessionId: state?.plannerSessionId,
      currentTaskId: state?.currentTaskId,
    };
  }

  private isAutoRetryDisabledTaskType(runtimeTaskType?: string): boolean {
    const normalized = String(runtimeTaskType || '').trim().toLowerCase();
    if (!normalized) {
      return false;
    }
    return AUTO_RETRY_DISABLED_TASK_TYPES.has(normalized);
  }
}
