import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Agent, AgentDocument } from '@agent/schemas/agent.schema';
import { Tool, ToolDocument } from '../../../../apps/agents/src/schemas/tool.schema';
import {
  OrchestrationPlan,
  OrchestrationPlanDocument,
  OrchestrationGenerationConfig,
  OrchestrationGenerationState,
} from '../../../shared/schemas/orchestration-plan.schema';
import {
  OrchestrationTask,
  OrchestrationTaskDocument,
} from '../../../shared/schemas/orchestration-task.schema';
import {
  OrchestrationRun,
  OrchestrationRunDocument,
} from '../../../shared/schemas/orchestration-run.schema';
import {
  OrchestrationRunTask,
  OrchestrationRunTaskDocument,
} from '../../../shared/schemas/orchestration-run-task.schema';
import {
  GenerateNextTaskResult,
  IncrementalPlannerContext,
  PlannerService,
} from '../planner.service';
import { OrchestrationExecutionEngineService } from './orchestration-execution-engine.service';
import { PlanStatsService } from './plan-stats.service';
import { PlanEventStreamService } from './plan-event-stream.service';
import { OrchestrationContextService } from './orchestration-context.service';
import { ExecutorSelectionService } from './executor-selection.service';

const DEFAULT_GENERATION_CONFIG: OrchestrationGenerationConfig = {
  maxRetries: 3,
  maxTotalFailures: 6,
  maxCostTokens: 500000,
  maxTasks: 15,
};

type PlannerAgentSelectionMode = 'trust' | 'verify' | 'override';

@Injectable()
export class IncrementalPlanningService {
  private readonly logger = new Logger(IncrementalPlanningService.name);
  private readonly activePlannings = new Set<string>();

  constructor(
    @InjectModel(OrchestrationPlan.name)
    private readonly planModel: Model<OrchestrationPlanDocument>,
    @InjectModel(OrchestrationTask.name)
    private readonly taskModel: Model<OrchestrationTaskDocument>,
    @InjectModel(OrchestrationRun.name)
    private readonly runModel: Model<OrchestrationRunDocument>,
    @InjectModel(OrchestrationRunTask.name)
    private readonly runTaskModel: Model<OrchestrationRunTaskDocument>,
    @InjectModel(Agent.name)
    private readonly agentModel: Model<AgentDocument>,
    @InjectModel(Tool.name)
    private readonly toolModel: Model<ToolDocument>,
    private readonly plannerService: PlannerService,
    private readonly executionEngine: OrchestrationExecutionEngineService,
    private readonly planStatsService: PlanStatsService,
    private readonly eventStream: PlanEventStreamService,
    private readonly contextService: OrchestrationContextService,
    private readonly executorSelectionService: ExecutorSelectionService,
  ) {}

  async executeIncrementalPlanning(planId: string): Promise<void> {
    const normalizedPlanId = String(planId || '').trim();
    if (!normalizedPlanId) {
      throw new NotFoundException('Plan not found');
    }
    if (this.activePlannings.has(normalizedPlanId)) {
      throw new ConflictException('Incremental planning already running');
    }

    this.activePlannings.add(normalizedPlanId);

    try {
      const plan = await this.planModel.findById(normalizedPlanId).exec();
      if (!plan) {
        throw new NotFoundException('Plan not found');
      }

      await this.prepareDraftingState(normalizedPlanId, this.resolveGenerationState(plan.generationState));
      await this.executePlanningUntilDone(normalizedPlanId, plan.sourcePrompt || '');
    } finally {
      this.activePlannings.delete(normalizedPlanId);
    }
  }

  private async executePlanningUntilDone(planId: string, sourcePrompt: string): Promise<void> {
    const stepResult = await this.executePlanningStep(planId, sourcePrompt);
    if (stepResult.done) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      setImmediate(() => {
        this.executePlanningUntilDone(planId, sourcePrompt)
          .then(resolve)
          .catch(reject);
      });
    });
  }

  async executeSinglePlanningStep(planId: string): Promise<void> {
    const normalizedPlanId = String(planId || '').trim();
    if (!normalizedPlanId) {
      throw new NotFoundException('Plan not found');
    }
    if (this.activePlannings.has(normalizedPlanId)) {
      throw new ConflictException('Incremental planning already running');
    }

    this.activePlannings.add(normalizedPlanId);
    try {
      const plan = await this.planModel.findById(normalizedPlanId).exec();
      if (!plan) {
        throw new NotFoundException('Plan not found');
      }
      await this.prepareDraftingState(normalizedPlanId, this.resolveGenerationState(plan.generationState));
      await this.executePlanningStep(normalizedPlanId, plan.sourcePrompt || '');
    } finally {
      this.activePlannings.delete(normalizedPlanId);
    }
  }

  private async prepareDraftingState(planId: string, existingState: OrchestrationGenerationState): Promise<void> {
    await this.planStatsService.setPlanStatus(planId, 'drafting');
    await this.updateGenerationState(planId, {
      ...existingState,
      isComplete: false,
      lastError: undefined,
      currentPhase: existingState.currentPhase || 'idle',
    });

    this.eventStream.emitPlanStreamEvent(planId, 'plan.status.changed', {
      planId,
      status: 'drafting',
      phase: 'incremental_planning',
    });
  }

  private async executePlanningStep(planId: string, sourcePrompt: string): Promise<{ done: boolean }> {
    const plan = await this.planModel.findById(planId).exec();
    if (!plan) {
      throw new NotFoundException('Plan not found');
    }

    const config = this.resolveGenerationConfig(plan.generationConfig);
    const state = this.resolveGenerationState(plan.generationState);
    let {
      currentStep,
      totalGenerated,
      totalRetries,
      consecutiveFailures,
      totalFailures,
      totalCost,
    } = state;

    if (state.isComplete) {
      return { done: true };
    }
    if (totalGenerated >= config.maxTasks) {
      await this.failPlanning(planId, `Exceeded max tasks limit (${config.maxTasks})`);
      return { done: true };
    }
    if (totalCost > config.maxCostTokens) {
      await this.failPlanning(planId, `Exceeded cost limit (${config.maxCostTokens} tokens)`);
      return { done: true };
    }

    const plannerContext = await this.buildPlannerContext(planId, sourcePrompt);
    this.eventStream.emitPlanStreamEvent(planId, 'planning.step.started', {
      planId,
      step: currentStep + 1,
    });

    const nextTaskResult = await this.plannerService.generateNextTask(planId, plannerContext);
    totalCost += nextTaskResult.costTokens || 0;

    if (nextTaskResult.isGoalReached) {
      await this.completePlanning(planId, {
        currentStep,
        totalGenerated,
        totalRetries,
        consecutiveFailures,
        totalFailures,
        totalCost,
        isComplete: true,
      });
      return { done: true };
    }

    const isRedesign = nextTaskResult.action === 'redesign' && Boolean(nextTaskResult.redesignTaskId);

    if (!nextTaskResult.task?.title || !nextTaskResult.task?.description) {
      totalRetries += 1;
      consecutiveFailures += 1;
      totalFailures += 1;
      const lastError = 'Planner returned empty task definition';
      await this.updateGenerationState(planId, {
        currentStep,
        totalGenerated,
        totalRetries,
        consecutiveFailures,
        totalFailures,
        totalCost,
        isComplete: false,
        lastError,
      });
      if (consecutiveFailures >= config.maxRetries || totalFailures >= config.maxTotalFailures) {
        await this.failPlanning(planId, lastError);
        return { done: true };
      }
      return { done: false };
    }

    const createdTask = isRedesign
      ? await this.redesignFailedTask(planId, String(nextTaskResult.redesignTaskId), nextTaskResult.task)
      : await this.createTaskFromPlannerOutput(planId, nextTaskResult.task, currentStep);

    this.eventStream.emitPlanStreamEvent(planId, 'planning.task.generated', {
      planId,
      step: currentStep + 1,
      taskId: createdTask._id.toString(),
      title: createdTask.title,
      agentId: createdTask.assignment?.executorId,
      mode: isRedesign ? 'redesign' : 'new',
    });

    this.eventStream.emitPlanStreamEvent(planId, 'planning.task.executing', {
      planId,
      step: currentStep + 1,
      taskId: createdTask._id.toString(),
    });

    const executionResult = await this.executeIncrementalTaskWithRunRecord(
      planId,
      createdTask,
      currentStep + 1,
      isRedesign,
    );

    if (executionResult.status === 'completed') {
      const merged = await this.tryMergeWithPreviousTask(planId, createdTask);
      if (!isRedesign) {
        currentStep += 1;
        totalGenerated += 1;
      }
      consecutiveFailures = 0;
      await this.updateGenerationState(planId, {
        currentStep,
        totalGenerated,
        totalRetries,
        consecutiveFailures,
        totalFailures,
        totalCost,
        isComplete: false,
        lastError: undefined,
      });

      this.eventStream.emitPlanStreamEvent(planId, 'planning.task.completed', {
        planId,
        step: currentStep,
        taskId: createdTask._id.toString(),
        merged,
      });
      return { done: false };
    }

    totalRetries += 1;
    consecutiveFailures += 1;
    totalFailures += 1;
    if (!isRedesign) {
      totalGenerated += 1;
      currentStep += 1;
    }

    const error = executionResult.error || `Task execution ended with status=${executionResult.status}`;
    await this.updateGenerationState(planId, {
      currentStep,
      totalGenerated,
      totalRetries,
      consecutiveFailures,
      totalFailures,
      totalCost,
      isComplete: false,
      lastError: error,
    });

    this.eventStream.emitPlanStreamEvent(planId, 'planning.task.failed', {
      planId,
      step: currentStep,
      taskId: createdTask._id.toString(),
      error,
      retriesLeft: Math.max(config.maxRetries - consecutiveFailures, 0),
    });

    if (consecutiveFailures >= config.maxRetries || totalFailures >= config.maxTotalFailures) {
      await this.failPlanning(
        planId,
        `Task "${createdTask.title}" failed: consecutive=${consecutiveFailures}/${config.maxRetries}, total=${totalFailures}/${config.maxTotalFailures}, error=${error}`,
      );
      return { done: true };
    }

    return { done: false };
  }

  async executeIncrementalTaskWithRunRecord(
    planId: string,
    task: OrchestrationTaskDocument,
    step: number,
    isRedesign: boolean,
  ): Promise<{ status: string; result?: string; error?: string }> {
    const startedAt = new Date();
    const run = await new this.runModel({
      planId,
      triggerType: 'autorun',
      status: 'running',
      startedAt,
      stats: {
        totalTasks: 1,
        completedTasks: 0,
        failedTasks: 0,
        waitingHumanTasks: 0,
      },
      metadata: {
        source: 'incremental_generation',
        step,
        isRedesign,
      },
    }).save();

    const runId = String((run as any).id || (run as any)._id);
    const taskId = String(task.id || task._id);

    await new this.runTaskModel({
      runId,
      planId,
      sourceTaskId: taskId,
      order: task.order,
      title: task.title,
      description: task.description,
      priority: task.priority,
      status: task.status,
      assignment: task.assignment,
      dependencyTaskIds: task.dependencyTaskIds || [],
      runtimeTaskType: task.runtimeTaskType,
      runLogs: [
        {
          timestamp: new Date(),
          level: 'info',
          message: 'Incremental task execution run created',
          metadata: {
            source: 'incremental_generation',
            step,
            isRedesign,
          },
        },
      ],
    }).save();

    let executionResult: { status: string; result?: string; error?: string };
    try {
      executionResult = await this.executionEngine.executeTaskNode(planId, task as unknown as OrchestrationTask, {
        orchestrationRunId: runId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Incremental task execution failed';
      executionResult = { status: 'failed', error: message };
    }

    const latestTask = await this.taskModel.findById(task._id).lean().exec();
    const finalTaskStatus = String(latestTask?.status || executionResult.status || 'failed') as
      | 'pending'
      | 'assigned'
      | 'in_progress'
      | 'blocked'
      | 'waiting_human'
      | 'completed'
      | 'failed'
      | 'cancelled';

    const completedAt = new Date();
    const runStatus =
      finalTaskStatus === 'completed'
        ? 'completed'
        : finalTaskStatus === 'cancelled'
          ? 'cancelled'
          : 'failed';
    const stats = {
      totalTasks: 1,
      completedTasks: runStatus === 'completed' ? 1 : 0,
      failedTasks: runStatus === 'failed' ? 1 : 0,
      waitingHumanTasks: finalTaskStatus === 'waiting_human' ? 1 : 0,
    };

    await this.runTaskModel
      .updateOne(
        { runId, sourceTaskId: taskId },
        {
          $set: {
            status: finalTaskStatus,
            result: {
              summary: latestTask?.result?.summary,
              output: latestTask?.result?.output,
              error: latestTask?.result?.error || executionResult.error,
            },
            sessionId: latestTask?.sessionId,
            startedAt: latestTask?.startedAt || startedAt,
            completedAt: latestTask?.completedAt || completedAt,
          },
          $push: {
            runLogs: {
              timestamp: completedAt,
              level: runStatus === 'completed' ? 'info' : 'error',
              message:
                runStatus === 'completed'
                  ? 'Incremental task execution completed'
                  : `Incremental task execution ended with status=${finalTaskStatus}`,
              metadata: {
                executionStatus: executionResult.status,
                executionError: executionResult.error,
              },
            },
          },
        },
      )
      .exec();

    await this.runModel
      .updateOne(
        { _id: runId },
        {
          $set: {
            status: runStatus,
            completedAt,
            durationMs: completedAt.getTime() - startedAt.getTime(),
            stats,
            error: runStatus === 'failed' ? executionResult.error || latestTask?.result?.error : undefined,
          },
        },
      )
      .exec();

    await this.planModel
      .updateOne(
        { _id: planId },
        {
          $set: {
            lastRunId: runId,
          },
        },
      )
      .exec();

    return executionResult;
  }

  async buildPlannerContext(planId: string, sourcePrompt: string): Promise<IncrementalPlannerContext> {
    const [tasks, plan] = await Promise.all([
      this.taskModel
        .find({ planId, status: { $ne: 'cancelled' } })
        .sort({ order: 1 })
        .exec(),
      this.planModel.findById(planId).exec(),
    ]);

    const completedTasks = tasks
      .filter((item) => item.status === 'completed')
      .map((item) => ({
        title: item.title,
        agentId: String(item.assignment?.executorId || '').trim() || undefined,
        outputSummary: String(item.result?.output || '').slice(0, 2000),
      }));

    const failedAgentIds = Array.from(
      new Set(
        tasks
          .filter((item) => item.status === 'failed')
          .map((item) => String(item.assignment?.executorId || '').trim())
          .filter(Boolean),
      ),
    );
    const failedAgentToolMap = await this.loadAgentToolMap(failedAgentIds);

    const failedTasks = tasks
      .filter((item) => item.status === 'failed')
      .map((item) => ({
        taskId: String((item as any).id || item._id?.toString() || '').trim(),
        title: item.title,
        agentId: String(item.assignment?.executorId || '').trim() || undefined,
        agentTools: failedAgentToolMap.get(String(item.assignment?.executorId || '').trim()) || [],
        error: String(item.result?.error || 'Unknown error'),
      }));

    return {
      planGoal: sourcePrompt,
      completedTasks,
      failedTasks,
      totalSteps: tasks.length,
      lastError: plan?.generationState?.lastError,
    };
  }

  async createTaskFromPlannerOutput(
    planId: string,
    taskResult: NonNullable<GenerateNextTaskResult['task']>,
    order: number,
  ): Promise<OrchestrationTaskDocument> {
    const normalizedAgentId = String(taskResult.agentId || '').trim();
    const assignment = await this.resolveAssignmentForPlannerTask(taskResult, normalizedAgentId);

    const requirementId = await this.resolveRequirementObjectId(planId);

    // 增量规划：自动将前序已完成任务设为依赖，确保执行层能注入前序输出上下文。
    const completedPredecessors = await this.taskModel
      .find({ planId, status: 'completed' })
      .sort({ order: 1 })
      .select({ _id: 1 })
      .lean()
      .exec();
    const dependencyTaskIds = completedPredecessors.map((t) => String(t._id));

    const task = await new this.taskModel({
      planId,
      ...(requirementId ? { requirementId } : {}),
      title: taskResult.title,
      description: taskResult.description,
      priority: taskResult.priority,
      status: assignment.executorType === 'unassigned' ? 'pending' : 'assigned',
      order,
      dependencyTaskIds,
      mergedFromTaskIds: [],
      assignment,
      runLogs: [
        {
          timestamp: new Date(),
          level: 'info',
          message: 'Task generated by incremental planner',
          metadata: {
            plannerAssignedAgentId: normalizedAgentId || undefined,
            fallbackUsed: assignment.reason !== 'Assigned by planner incremental output',
            plannerRequiredTools: taskResult.requiredTools || undefined,
          },
        },
      ],
    }).save();

    await this.planModel
      .updateOne(
        { _id: planId },
        {
          $push: { taskIds: task._id.toString() },
        },
      )
      .exec();

    await this.planStatsService.refreshPlanStats(planId);
    await this.planStatsService.syncPlanSessionTasks(planId);
    return task;
  }

  async redesignFailedTask(
    planId: string,
    redesignTaskId: string,
    taskResult: NonNullable<GenerateNextTaskResult['task']>,
  ): Promise<OrchestrationTaskDocument> {
    const normalizedTaskId = String(redesignTaskId || '').trim();
    if (!normalizedTaskId) {
      throw new NotFoundException('Failed task not found for redesign');
    }

    const taskFilters: Record<string, any>[] = [{ id: normalizedTaskId }];
    if (Types.ObjectId.isValid(normalizedTaskId)) {
      taskFilters.push({ _id: new Types.ObjectId(normalizedTaskId) });
    }

    const targetTask = await this.taskModel
      .findOne({ planId, status: 'failed', $or: taskFilters })
      .exec();
    if (!targetTask) {
      throw new NotFoundException(`Failed task ${normalizedTaskId} not found for redesign`);
    }

    const normalizedAgentId = String(taskResult.agentId || '').trim();
    const assignment = await this.resolveAssignmentForPlannerTask(taskResult, normalizedAgentId);
    const status = assignment.executorType === 'unassigned' ? 'pending' : 'assigned';
    await this.taskModel
      .updateOne(
        { _id: targetTask._id, planId, status: 'failed' },
        {
          $set: {
            title: taskResult.title,
            description: taskResult.description,
            priority: taskResult.priority,
            status,
            assignment,
            startedAt: null,
            completedAt: null,
          },
          $unset: {
            result: 1,
            runtimeTaskType: 1,
          },
          $push: {
            runLogs: {
              timestamp: new Date(),
              level: 'info',
              message: 'Task redesigned by incremental planner',
              metadata: {
                redesignTaskId: normalizedTaskId,
                previousAgentId: targetTask.assignment?.executorId,
                plannerAssignedAgentId: normalizedAgentId || undefined,
                reassignedAgentId: assignment.executorId,
                plannerAction: 'redesign',
              },
            },
          },
        },
      )
      .exec();

    const redesignedTask = await this.taskModel.findById(targetTask._id).exec();
    if (!redesignedTask) {
      throw new NotFoundException(`Redesigned task ${normalizedTaskId} not found`);
    }

    await this.planStatsService.refreshPlanStats(planId);
    await this.planStatsService.syncPlanSessionTasks(planId);
    return redesignedTask;
  }

  private async tryMergeWithPreviousTask(
    planId: string,
    currentTask: OrchestrationTaskDocument,
  ): Promise<boolean> {
    const previousTask = await this.taskModel
      .findOne({
        planId,
        order: currentTask.order - 1,
        status: 'completed',
      })
      .exec();

    if (!previousTask) {
      return false;
    }

    const sameAgent =
      previousTask.assignment?.executorType === 'agent'
      && currentTask.assignment?.executorType === 'agent'
      && previousTask.assignment?.executorId
      && previousTask.assignment?.executorId === currentTask.assignment?.executorId;

    if (!sameAgent) {
      return false;
    }

    const previousKeywords = this.extractKeywords(`${previousTask.title} ${previousTask.description}`);
    const currentKeywords = this.extractKeywords(`${currentTask.title} ${currentTask.description}`);
    const overlap = previousKeywords.filter((item) => currentKeywords.includes(item)).length;
    const denominator = Math.max(previousKeywords.length, currentKeywords.length, 1);
    const similarity = overlap / denominator;

    if (similarity < 0.4) {
      return false;
    }

    const mergedDescription = [
      previousTask.description,
      '---',
      `[Merged from step ${currentTask.order + 1}] ${currentTask.title}`,
      currentTask.description,
    ].join('\n');

    const mergedOutput = [
      String(previousTask.result?.output || ''),
      '---',
      `[Step ${currentTask.order + 1} output]`,
      String(currentTask.result?.output || ''),
    ].join('\n');

    await this.taskModel
      .updateOne(
        { _id: previousTask._id },
        {
          $set: {
            description: mergedDescription,
            'result.output': mergedOutput,
          },
          $push: {
            mergedFromTaskIds: currentTask._id.toString(),
          },
        },
      )
      .exec();

    await this.taskModel
      .updateOne(
        { _id: currentTask._id },
        {
          $set: { status: 'cancelled' },
        },
      )
      .exec();

    await this.planStatsService.refreshPlanStats(planId);
    await this.planStatsService.syncPlanSessionTasks(planId);

    this.eventStream.emitPlanStreamEvent(planId, 'planning.task.merged', {
      planId,
      sourceTaskId: currentTask._id.toString(),
      targetTaskId: previousTask._id.toString(),
    });

    this.logger.log(
      `Merged task "${currentTask.title}" into "${previousTask.title}" (similarity=${similarity.toFixed(2)})`,
    );

    return true;
  }

  private resolvePlannerAgentSelectionMode(): PlannerAgentSelectionMode {
    const value = String(process.env.PLANNER_AGENT_SELECTION_MODE || 'verify').trim().toLowerCase();
    if (value === 'trust' || value === 'verify' || value === 'override') {
      return value;
    }
    return 'verify';
  }

  private async resolveFallbackAssignment(
    taskResult: NonNullable<GenerateNextTaskResult['task']>,
    reasonPrefix: string,
  ): Promise<{ executorType: 'agent' | 'employee' | 'unassigned'; executorId?: string; reason: string }> {
    const fallback = await this.executorSelectionService.selectExecutor({
      title: taskResult.title,
      description: taskResult.description,
      taskType: 'general',
      requiredTools: taskResult.requiredTools,
    });

    return {
      executorType: fallback.executorType || 'unassigned',
      executorId: fallback.executorId,
      reason: `${reasonPrefix}; fallback=${fallback.reason}`,
    };
  }

  private async resolveAssignmentForPlannerTask(
    taskResult: NonNullable<GenerateNextTaskResult['task']>,
    plannerAgentId: string,
  ): Promise<{ executorType: 'agent' | 'employee' | 'unassigned'; executorId?: string; reason: string }> {
    const mode = this.resolvePlannerAgentSelectionMode();
    const validAgentId = await this.resolveValidAgentId(plannerAgentId);

    if (mode === 'override') {
      this.logger.log(
        `[planner_override_mode] mode=override plannerAgent=${plannerAgentId || 'empty'} title="${taskResult.title.slice(0, 60)}"`,
      );
      return this.resolveFallbackAssignment(taskResult, 'Planner assignment overridden by policy');
    }

    if (!validAgentId) {
      return this.resolveFallbackAssignment(taskResult, 'Planner did not provide valid agentId');
    }

    if (mode === 'trust') {
      return {
        executorType: 'agent',
        executorId: validAgentId,
        reason: 'Assigned by planner incremental output',
      };
    }

    const fitCheck = await this.executorSelectionService.validateAgentToolFit({
      agentId: validAgentId,
      taskTitle: taskResult.title,
      taskDescription: taskResult.description,
      taskType: 'general',
      requiredTools: taskResult.requiredTools,
    });

    if (fitCheck.fit) {
      return {
        executorType: 'agent',
        executorId: validAgentId,
        reason: 'Assigned by planner incremental output',
      };
    }

    this.logger.warn(
      `[planner_verify_fallback] plannerAgent=${validAgentId} missingTools=${fitCheck.missingTools.join(',') || 'none'} title="${taskResult.title.slice(0, 60)}"`,
    );

    if (fitCheck.suggestion) {
      return {
        executorType: fitCheck.suggestion.executorType,
        executorId: fitCheck.suggestion.executorId,
        reason: `Planner assignment tool mismatch: ${fitCheck.missingTools.join(', ') || 'unknown'}; fallback=${fitCheck.suggestion.reason}`,
      };
    }

    return this.resolveFallbackAssignment(
      taskResult,
      `Planner assignment tool mismatch: ${fitCheck.missingTools.join(', ') || 'unknown'}`,
    );
  }

  private async loadAgentToolMap(agentIds: string[]): Promise<Map<string, string[]>> {
    const normalizedIds = agentIds
      .map((item) => String(item || '').trim())
      .filter(Boolean);
    if (normalizedIds.length === 0) {
      return new Map<string, string[]>();
    }

    const objectIds = normalizedIds.filter((item) => Types.ObjectId.isValid(item)).map((item) => new Types.ObjectId(item));
    const query: Record<string, unknown> = {
      $or: [
        { id: { $in: normalizedIds } },
        ...(objectIds.length > 0 ? [{ _id: { $in: objectIds } }] : []),
      ],
    };

    const agents = await this.agentModel
      .find(query)
      .select({ id: 1, tools: 1 })
      .lean()
      .exec();

    const toolIds = Array.from(
      new Set(
        (agents as Array<{ tools?: string[] }>)
          .flatMap((agent) => agent.tools || [])
          .map((item) => String(item || '').trim())
          .filter(Boolean),
      ),
    );
    const tools = toolIds.length > 0
      ? await this.toolModel
        .find({ id: { $in: toolIds }, enabled: true })
        .select({ id: 1, name: 1 })
        .lean()
        .exec()
      : [];
    const toolNameMap = new Map(
      (tools as Array<{ id?: string; name?: string }>).map((tool) => [
        String(tool.id || '').trim(),
        String(tool.name || '').trim(),
      ]),
    );

    const map = new Map<string, string[]>();
    for (const agent of agents as Array<{ _id?: Types.ObjectId; id?: string; tools?: string[] }>) {
      const keyCandidates = [String(agent.id || '').trim(), String(agent._id || '').trim()].filter(Boolean);
      const tools = (agent.tools || [])
        .map((toolId) => String(toolId || '').trim())
        .filter(Boolean)
        .map((toolId) => {
          const toolName = toolNameMap.get(toolId);
          return toolName ? `${toolName}(${toolId})` : toolId;
        });
      for (const key of keyCandidates) {
        map.set(key, tools);
      }
    }

    return map;
  }

  async completePlanning(planId: string, state: OrchestrationGenerationState): Promise<void> {
    await this.planModel
      .updateOne(
        { _id: planId },
        {
          $set: {
            status: 'planned',
            generationState: {
              ...state,
              isComplete: true,
              lastError: undefined,
              currentPhase: 'idle',
              currentTaskId: undefined,
            },
            'metadata.planningCompletedAt': new Date().toISOString(),
          },
          $unset: {
            'metadata.planningFailedAt': 1,
          },
        },
      )
      .exec();

    await this.planStatsService.refreshPlanStats(planId);
    await this.planStatsService.syncPlanSessionTasks(planId);

    this.eventStream.emitPlanStreamEvent(planId, 'planning.completed', {
      planId,
      totalTasks: state.totalGenerated,
      totalSteps: state.currentStep,
    });
  }

  async failPlanning(planId: string, error: string): Promise<void> {
    await this.planModel
      .updateOne(
        { _id: planId },
        {
          $set: {
            status: 'draft',
            'generationState.lastError': error,
            'generationState.isComplete': false,
            'generationState.currentPhase': 'idle',
            'metadata.planningFailedAt': new Date().toISOString(),
          },
        },
      )
      .exec();

    this.eventStream.emitPlanStreamEvent(planId, 'planning.failed', {
      planId,
      error,
    });
  }

  private async updateGenerationState(planId: string, state: OrchestrationGenerationState): Promise<void> {
    await this.planModel
      .updateOne(
        { _id: planId },
        {
          $set: {
            generationState: state,
          },
        },
      )
      .exec();
  }

  resolveGenerationConfig(config?: OrchestrationGenerationConfig): OrchestrationGenerationConfig {
    return {
      maxRetries: Number(config?.maxRetries || DEFAULT_GENERATION_CONFIG.maxRetries),
      maxTotalFailures: Number(config?.maxTotalFailures || DEFAULT_GENERATION_CONFIG.maxTotalFailures),
      maxCostTokens: Number(config?.maxCostTokens || DEFAULT_GENERATION_CONFIG.maxCostTokens),
      maxTasks: Number(config?.maxTasks || DEFAULT_GENERATION_CONFIG.maxTasks),
    };
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

  private async resolveValidAgentId(agentId: string): Promise<string | null> {
    const normalized = String(agentId || '').trim();
    if (!normalized) {
      return null;
    }

    const query: Record<string, any> = { id: normalized, isActive: true };
    if (Types.ObjectId.isValid(normalized)) {
      query.$or = [{ id: normalized }, { _id: new Types.ObjectId(normalized) }];
      delete query.id;
    }

    const agent = await this.agentModel
      .findOne(query)
      .select({ _id: 1, id: 1 })
      .lean()
      .exec();

    if (!agent) {
      return null;
    }

    return String((agent as any).id || (agent as any)._id?.toString() || '').trim() || null;
  }

  private async resolveRequirementObjectId(planId: string): Promise<Types.ObjectId | undefined> {
    const plan = await this.planModel.findById(planId).select({ metadata: 1 }).lean().exec();
    const requirementId = this.contextService.resolveRequirementIdFromPlan(plan as any);
    return this.contextService.parseRequirementObjectId(requirementId);
  }

  private extractKeywords(text: string): string[] {
    return String(text || '')
      .toLowerCase()
      .split(/[^a-zA-Z0-9\u4e00-\u9fa5]+/)
      .filter((item) => item.length >= 2)
      .slice(0, 30);
  }

}
