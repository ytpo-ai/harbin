import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Model } from 'mongoose';
import { CollaborationContextFactory } from '@libs/contracts';
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
import { SceneOptimizationService } from './scene-optimization.service';
import { AgentClientService } from '../../agents-client/agent-client.service';
import { ORCH_EVENTS, OrchestrationSource } from '../orchestration-events';

type Phase = 'idle' | 'initialize' | 'generating' | 'pre_execute' | 'executing' | 'post_execute';
type PlannerSessionPhase = Exclude<Phase, 'idle' | 'executing'>;

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
    private readonly sceneOptimizationService: SceneOptimizationService,
    private readonly eventEmitter: EventEmitter2,
    private readonly agentClientService: AgentClientService,
    private readonly configService: ConfigService,
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

      if (phase === 'idle') {
        const targetPhase: Phase = this.shouldRunInitialize(plan, state) ? 'initialize' : 'generating';
        const plannerSessionId = await this.ensurePlannerSession(
          normalizedPlanId,
          plan,
          state,
          targetPhase as PlannerSessionPhase,
        );
        const stateWithSession = this.withPlannerSession(state, targetPhase as PlannerSessionPhase, plannerSessionId);
        const claimedState: OrchestrationGenerationState = {
          ...stateWithSession,
          currentPhase: targetPhase,
        };
        const claimed = await this.updateGenerationStateIfExpected(
          normalizedPlanId,
          state,
          claimedState,
        );
        if (!claimed) {
          return { advanced: false, phase };
        }

        if (targetPhase === 'initialize') {
          await this.phaseInitialize(normalizedPlanId, plan, claimedState, plannerSessionId);
          return { advanced: true, phase: 'initialize' };
        }

        await this.phaseGenerate(
          normalizedPlanId,
          plan.sourcePrompt || '',
          claimedState,
          plannerSessionId,
        );
        return { advanced: true, phase: 'generating' };
      }

      if (phase === 'initialize') {
        const plannerSessionId = await this.ensurePlannerSession(normalizedPlanId, plan, state, 'initialize');
        const effectiveState = this.withPlannerSession(state, 'initialize', plannerSessionId);
        await this.phaseInitialize(normalizedPlanId, plan, effectiveState, plannerSessionId);
        return { advanced: true, phase };
      }

      if (phase === 'generating') {
        const plannerSessionId = await this.ensurePlannerSession(normalizedPlanId, plan, state, 'generating');
        const effectiveState = this.withPlannerSession(state, 'generating', plannerSessionId);
        await this.phaseGenerate(
          normalizedPlanId,
          plan.sourcePrompt || '',
          effectiveState,
          plannerSessionId,
        );
        return { advanced: true, phase: 'generating' };
      }
      if (phase === 'pre_execute') {
        const plannerSessionId = await this.ensurePlannerSession(normalizedPlanId, plan, state, 'pre_execute');
        const effectiveState = this.withPlannerSession(state, 'pre_execute', plannerSessionId);
        await this.phasePreExecute(normalizedPlanId, effectiveState, plannerSessionId);
        return { advanced: true, phase };
      }
      if (phase === 'executing') {
        await this.phaseExecute(normalizedPlanId, state);
        return { advanced: true, phase };
      }
      if (phase === 'post_execute') {
        const plannerSessionId = await this.ensurePlannerSession(normalizedPlanId, plan, state, 'post_execute');
        const effectiveState = this.withPlannerSession(state, 'post_execute', plannerSessionId);
        const metadata = ((plan as unknown as { metadata?: Record<string, unknown> }).metadata || {}) as Record<string, unknown>;
        const outlineStepCount = Array.isArray(metadata.outline) ? metadata.outline.length : undefined;
        await this.phasePostExecute(
          normalizedPlanId,
          effectiveState,
          plannerSessionId,
          String((plan as { domainType?: string } | null)?.domainType || 'general'),
          outlineStepCount,
        );
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

  async stopGeneration(planId: string): Promise<{ stopped: boolean; alreadyStopped: boolean }> {
    const normalizedPlanId = String(planId || '').trim();
    if (!normalizedPlanId) {
      throw new NotFoundException('Plan not found');
    }

    const plan = await this.planModel.findById(normalizedPlanId).lean().exec();
    if (!plan) {
      throw new NotFoundException('Plan not found');
    }

    const currentState = this.resolveGenerationState(plan.generationState as OrchestrationGenerationState | undefined);
    if (currentState.isComplete) {
      return { stopped: false, alreadyStopped: true };
    }

    const sessionIds = this.resolvePlannerSessionIds(currentState);
    await this.updateGenerationState(normalizedPlanId, {
      ...currentState,
      isComplete: true,
      currentPhase: 'idle',
      currentTaskId: undefined,
      plannerSessionId: undefined,
      plannerSessionIds: undefined,
      lastDecision: 'stop',
      lastError: undefined,
    });

    for (const sessionId of sessionIds) {
      try {
        await this.agentClientService.archiveSession(sessionId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`archive planner session failed when stopping generation: plan=${normalizedPlanId}, session=${sessionId}, error=${message}`);
      }
    }

    return { stopped: true, alreadyStopped: false };
  }

  private async phaseInitialize(
    planId: string,
    plan: OrchestrationPlanDocument,
    state: OrchestrationGenerationState,
    plannerSessionId: string,
  ): Promise<void> {
    const metadata = ((plan as unknown as { metadata?: Record<string, unknown> }).metadata || {}) as Record<string, unknown>;
    const existingTaskContext = this.contextService.resolvePlanTaskContextFromMetadata(metadata);
    await this.plannerService.initializePlan(
      planId,
      {
        sourcePrompt: plan.sourcePrompt || '',
        domainType: String((plan as { domainType?: string }).domainType || 'general'),
        existingTaskContext,
      },
      { sessionId: plannerSessionId },
    );

    const refreshedPlan = await this.planModel
      .findById(planId)
      .select({ metadata: 1 })
      .lean<{ metadata?: Record<string, unknown> }>()
      .exec();
    const refreshedMetadata = (refreshedPlan?.metadata || {}) as Record<string, unknown>;
    const outline = Array.isArray(refreshedMetadata.outline)
      ? refreshedMetadata.outline as Array<Record<string, unknown>>
      : [];
    const hasValidOutline = outline.length > 0
      && outline.every((item) => {
        const prompts = item?.phasePrompts;
        if (!prompts || typeof prompts !== 'object' || Array.isArray(prompts)) {
          return false;
        }
        const generating = String((prompts as Record<string, unknown>).generating || '').trim();
        const postExecute = String((prompts as Record<string, unknown>).post_execute || '').trim();
        return Boolean(generating && postExecute);
      });

    if (!hasValidOutline) {
      await this.agentClientService.archiveSession(plannerSessionId).catch(() => {});
      const nextState = this.bumpFailureCounters(
        state,
        'phaseInitialize missing valid metadata.outline',
      );
      const stateWithClearedSession = this.isIsolatedSessionMode
        ? {
            ...nextState,
            currentPhase: 'idle' as const,
            plannerSessionIds: {
              ...(nextState.plannerSessionIds || {}),
              initialize: undefined,
            },
          }
        : {
            ...nextState,
            currentPhase: 'idle' as const,
          };
      const advanced = await this.updateGenerationStateIfExpected(planId, state, stateWithClearedSession);
      if (!advanced) {
        return;
      }
      await this.autoAdvance(planId);
      return;
    }

    const stateWithSession = this.withPlannerSession(state, 'initialize', plannerSessionId);
    const advanced = await this.updateGenerationStateIfExpected(planId, state, {
      ...stateWithSession,
      currentPhase: 'idle',
      lastError: undefined,
    });
    if (!advanced) {
      return;
    }

    this.eventStream.emitPlanStreamEvent(planId, 'planning.initialized', {
      planId,
      requirementId: this.contextService.resolvePlanTaskContextFromMetadata(refreshedMetadata).requirementId,
      outline,
    });

    await this.autoAdvance(planId);
  }

  private async phaseGenerate(
    planId: string,
    sourcePrompt: string,
    state: OrchestrationGenerationState,
    plannerSessionId: string,
  ): Promise<void> {
    await this.planModel.updateOne({ _id: planId }, { $set: { status: 'drafting' } }).exec();
    this.eventStream.emitPlanStreamEvent(planId, 'plan.status.changed', {
      planId,
      status: 'drafting',
      phase: 'incremental_planning',
    });

    await this.emitStepStarted(planId, state.currentStep + 1);
    const plannerContext = await this.incrementalPlanningService.buildPlannerContext(planId, sourcePrompt);
    const nextTaskResult = await this.plannerService.generateNextTask(planId, plannerContext, {
      sessionId: plannerSessionId,
    });

    const stateWithSession = this.withPlannerSession(state, 'generating', plannerSessionId);
    const mergedState: OrchestrationGenerationState = {
      ...stateWithSession,
      totalCost: Number(state.totalCost || 0) + Number(nextTaskResult.costTokens || 0),
    };

    if (nextTaskResult.isGoalReached) {
      await this.completeAndArchive(planId, mergedState);
      return;
    }

    if (!nextTaskResult.task?.title || !nextTaskResult.task?.description) {
      const nextFailures = this.bumpFailureCounters(
        mergedState,
        this.buildEmptyTaskReason(nextTaskResult.reasoning),
      );
      await this.updateGenerationStateIfExpected(planId, mergedState, {
        ...nextFailures,
        currentPhase: 'idle',
      });
      await this.autoAdvance(planId);
      return;
    }

    const isRedesign = nextTaskResult.action === 'redesign';
    let createdTask: OrchestrationTaskDocument | null = nextTaskResult.createdTaskId
      ? await this.taskModel.findOne({ _id: nextTaskResult.createdTaskId, planId }).exec()
      : null;

    if (!createdTask && isRedesign && !nextTaskResult.redesignTaskId) {
      const nextFailures = this.bumpFailureCounters(mergedState, 'Planner redesign action missing redesignTaskId');
      await this.updateGenerationStateIfExpected(planId, mergedState, {
        ...nextFailures,
        currentPhase: 'idle',
      });
      await this.autoAdvance(planId);
      return;
    }

    if (!createdTask) {
      createdTask = isRedesign
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
    }

    if (!createdTask) {
      const nextFailures = this.bumpFailureCounters(mergedState, 'Planner created task is missing');
      await this.updateGenerationStateIfExpected(planId, mergedState, {
        ...nextFailures,
        currentPhase: 'idle',
      });
      await this.autoAdvance(planId);
      return;
    }

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
    const inferredRuntimeTaskType = this.contextService.inferRuntimeTaskTypeFromPlanContext({
      planDomainType: String((planSnapshot as { domainType?: string } | null)?.domainType || 'general'),
      planGoal: String((planSnapshot as { sourcePrompt?: string } | null)?.sourcePrompt || ''),
      step: state.currentStep,
      taskTitle: task.title,
      taskDescription: task.description,
      taskType: (task as any).taskType,
      existingRuntimeTaskType: task.runtimeTaskType,
    });

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

    const metadata = ((planSnapshot as unknown as { metadata?: Record<string, unknown> })?.metadata || {}) as Record<string, unknown>;
    const taskContext = this.contextService.resolvePlanTaskContextFromMetadata(metadata);
    const outline = Array.isArray(metadata.outline) ? metadata.outline as Array<Record<string, unknown>> : [];
    const outlineStep = outline.find((o) => Number(o.step) === state.currentStep) as
      | { preExecuteActions?: Array<{ tool: string; params: Record<string, unknown> }> }
      | undefined;
    const outlinePrompts = outlineStep && typeof outlineStep === 'object'
      ? (outlineStep as Record<string, unknown>).phasePrompts
      : undefined;
    const normalizedPreExecutePrompt = outlinePrompts && typeof outlinePrompts === 'object' && !Array.isArray(outlinePrompts)
      ? String((outlinePrompts as Record<string, unknown>).pre_execute || '').trim() || undefined
      : undefined;

    const prompt = this.contextService.buildPreTaskContext({
      step: state.currentStep,
      taskId: String(task._id),
      taskTitle: task.title,
      taskDescription: task.description,
      runtimeTaskType: task.runtimeTaskType,
      planDomainType: String((planSnapshot as { domainType?: string } | null)?.domainType || 'general'),
      planGoal: String((planSnapshot as { sourcePrompt?: string } | null)?.sourcePrompt || ''),
      taskContext,
      outlineStep: {
        preExecuteActions: outlineStep?.preExecuteActions,
        phasePrompts: normalizedPreExecutePrompt ? { pre_execute: normalizedPreExecutePrompt } : undefined,
      },
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
    const planSnapshot = await this.planModel
      .findById(planId)
      .select({ metadata: 1 })
      .lean<{ metadata?: Record<string, unknown> }>()
      .exec();
    const metadata = (planSnapshot?.metadata || {}) as Record<string, unknown>;
    const outline = Array.isArray(metadata.outline) ? metadata.outline as Array<Record<string, unknown>> : [];
    const outlineStep = outline.find((o) => Number(o.step) === state.currentStep) as Record<string, unknown> | undefined;
    const phasePrompts = outlineStep && typeof outlineStep.phasePrompts === 'object' && !Array.isArray(outlineStep.phasePrompts)
      ? outlineStep.phasePrompts as Record<string, unknown>
      : undefined;
    const postExecutePrompt = String(phasePrompts?.post_execute || '').trim() || undefined;
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
    planDomainType: string = 'general',
    outlineStepCount?: number,
  ): Promise<void> {
    const task = await this.getCurrentTaskOrThrow(planId, state.currentTaskId);
    await this.sceneOptimizationService.applyPostExecuteOptimizations({
      planId,
      planDomainType,
      taskId: String(task._id),
      runtimeTaskType: task.runtimeTaskType,
      taskStatus: task.status,
      taskOutput: String(task.result?.output || task.result?.summary || ''),
    });

    const postPrompt = this.contextService.buildPostTaskContext({
      step: state.currentStep,
      taskId: String(task._id),
      taskTitle: task.title,
      runtimeTaskType: task.runtimeTaskType,
      executionStatus: task.status,
      executionOutput: task.result?.output || task.result?.summary,
      executionError: task.result?.error,
      planDomainType,
      totalGeneratedSteps: state.totalGenerated,
      outlineStepCount,
      postExecutePrompt,
    });
    let decision: PostExecutionDecision;
    try {
      decision = await this.plannerService.executePostTask(planId, postPrompt, plannerSessionId);
    } catch (error) {
      decision = {
        action: 'stop',
        reason: error instanceof Error ? error.message : 'post-task planner failed',
      };
    }

    if (decision.action === 'retry' && this.isAutoRetryDisabledTaskType(task.runtimeTaskType)) {
      decision = {
        ...decision,
        action: 'redesign',
        reason: `${decision.reason} (auto retry disabled for ${task.runtimeTaskType})`,
      };
    }

    this.eventStream.emitPlanStreamEvent(planId, 'planning.task.post_processed', {
      planId,
      step: state.currentStep,
      taskId: String(task._id),
      action: decision.action,
      reason: decision.reason,
    });
    this.eventEmitter.emit(ORCH_EVENTS.TASK_POST_PROCESSED, {
      planId,
      taskId: String(task._id),
      step: state.currentStep,
      phase: 'post_execute',
      result: decision,
    });

    if (decision.action === 'stop') {
      await this.completeAndArchive(planId, {
        ...state,
        currentPhase: 'idle',
        currentTaskId: undefined,
        lastDecision: 'stop',
      });
      return;
    }

    if (decision.action === 'retry') {
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
      lastDecision: decision.action,
    };

    await this.updateGenerationStateIfExpected(planId, state, nextState);
    await this.autoAdvance(planId);
  }

  private async ensurePlannerSession(
    planId: string,
    plan: OrchestrationPlanDocument,
    state: OrchestrationGenerationState,
    phase: PlannerSessionPhase,
  ): Promise<string> {
    const existingSessionId = this.isIsolatedSessionMode
      ? String(state.plannerSessionIds?.[phase] || '').trim()
      : String(state.plannerSessionId || '').trim();
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
        orchestrationRunId: this.isIsolatedSessionMode ? `planner-${phase}` : 'planner',
        collaborationContext: CollaborationContextFactory.orchestration({
          planId,
          ...(plan.strategy?.skillActivation ? { skillActivation: plan.strategy.skillActivation } : {}),
          roleInPlan: 'planner',
          domainType: String((plan as { domainType?: string }).domainType || 'general').trim().toLowerCase() as 'general' | 'development' | 'research',
          phase,
          taskType: 'planning',
        }),
      },
    );

    const sessionId = String(session?.id || session?.sessionId || '').trim();
    if (!sessionId) {
      throw new ConflictException('Failed to initialize planner session');
    }

    await this.updateGenerationState(planId, {
      ...state,
      ...(this.isIsolatedSessionMode
        ? {
          plannerSessionIds: {
            ...(state.plannerSessionIds || {}),
            [phase]: sessionId,
          },
        }
        : { plannerSessionId: sessionId }),
    });

    return sessionId;
  }

  private shouldRunInitialize(plan: OrchestrationPlanDocument, _state: OrchestrationGenerationState): boolean {
    const metadata = ((plan as unknown as { metadata?: Record<string, unknown> }).metadata || {}) as Record<string, unknown>;
    const outline = Array.isArray(metadata.outline) ? metadata.outline as Array<Record<string, unknown>> : [];
    if (outline.length === 0) {
      return true;
    }

    const hasValidPrompts = outline.every((item) => {
      const prompts = item?.phasePrompts;
      if (!prompts || typeof prompts !== 'object' || Array.isArray(prompts)) {
        return false;
      }
      const generating = String((prompts as Record<string, unknown>).generating || '').trim();
      const postExecute = String((prompts as Record<string, unknown>).post_execute || '').trim();
      return Boolean(generating && postExecute);
    });

    return !hasValidPrompts;
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

  private buildEmptyTaskReason(reasoning?: string): string {
    const normalized = String(reasoning || '').trim();
    if (!normalized) {
      return 'Planner returned empty task definition';
    }
    return `Planner returned empty task definition: ${normalized.slice(0, 200)}`;
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
    const sessionIds = this.resolvePlannerSessionIds(state);
    for (const sessionId of sessionIds) {
      await this.agentClientService.archiveSession(sessionId);
    }
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
    const plannerSessionIds = Object.entries(state?.plannerSessionIds || {}).reduce<Record<string, string>>(
      (acc, [phase, sessionId]) => {
        const normalizedPhase = String(phase || '').trim();
        const normalizedSessionId = String(sessionId || '').trim();
        if (!normalizedPhase || !normalizedSessionId) {
          return acc;
        }
        acc[normalizedPhase] = normalizedSessionId;
        return acc;
      },
      {},
    );

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
      plannerSessionIds: Object.keys(plannerSessionIds).length ? plannerSessionIds : undefined,
      currentTaskId: state?.currentTaskId,
    };
  }

  private resolvePlannerSessionIds(state: OrchestrationGenerationState): string[] {
    if (!this.isIsolatedSessionMode) {
      const sessionId = String(state.plannerSessionId || '').trim();
      return sessionId ? [sessionId] : [];
    }

    return Array.from(
      new Set(
        Object.values(state.plannerSessionIds || {})
          .map((id) => String(id || '').trim())
          .filter((id) => Boolean(id)),
      ),
    );
  }

  private withPlannerSession(
    state: OrchestrationGenerationState,
    phase: PlannerSessionPhase,
    sessionId: string,
  ): OrchestrationGenerationState {
    if (this.isIsolatedSessionMode) {
      return {
        ...state,
        plannerSessionIds: {
          ...(state.plannerSessionIds || {}),
          [phase]: sessionId,
        },
      };
    }

    return {
      ...state,
      plannerSessionId: sessionId,
    };
  }

  private get isIsolatedSessionMode(): boolean {
    const rawMode =
      this.configService && typeof this.configService.get === 'function'
        ? this.configService.get<string>('PLANNER_SESSION_ISOLATION_MODE')
        : undefined;
    return String(rawMode || 'shared').trim().toLowerCase() === 'isolated';
  }

  private isAutoRetryDisabledTaskType(runtimeTaskType?: string): boolean {
    const normalized = String(runtimeTaskType || '').trim().toLowerCase();
    if (!normalized) {
      return false;
    }
    return AUTO_RETRY_DISABLED_TASK_TYPES.has(normalized);
  }
}
