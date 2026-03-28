import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CollaborationContextFactory } from '@libs/contracts';
import {
  CreatePlanFromPromptDto,
  ReplanPlanDto,
  UpdatePlanDto,
} from '../dto';
import {
  OrchestrationDomainType,
  OrchestrationPlan,
  OrchestrationPlanDocument,
} from '../../../shared/schemas/orchestration-plan.schema';
import {
  OrchestrationTask,
  OrchestrationTaskDocument,
} from '../../../shared/schemas/orchestration-task.schema';
import {
  PlanSession,
  PlanSessionDocument,
} from '../../../shared/schemas/orchestration-plan-session.schema';
import {
  OrchestrationRun,
  OrchestrationRunDocument,
} from '../../../shared/schemas/orchestration-run.schema';
import { PlanStatsService } from './plan-stats.service';
import { OrchestrationContextService } from './orchestration-context.service';
import { PlanEventStreamService } from './plan-event-stream.service';
import { IncrementalPlanningService } from './incremental-planning.service';
import { OrchestrationStepDispatcherService } from './orchestration-step-dispatcher.service';
import { AgentClientService } from '../../agents-client/agent-client.service';

@Injectable()
export class PlanManagementService {
  private readonly logger = new Logger(PlanManagementService.name);
  private readonly runningPlans = new Set<string>();

  constructor(
    @InjectModel(OrchestrationPlan.name)
    private readonly orchestrationPlanModel: Model<OrchestrationPlanDocument>,
    @InjectModel(OrchestrationTask.name)
    private readonly orchestrationTaskModel: Model<OrchestrationTaskDocument>,
    @InjectModel(PlanSession.name)
    private readonly planSessionModel: Model<PlanSessionDocument>,
    @InjectModel(OrchestrationRun.name)
    private readonly orchestrationRunModel: Model<OrchestrationRunDocument>,
    private readonly planStatsService: PlanStatsService,
    private readonly contextService: OrchestrationContextService,
    private readonly planEventStreamService: PlanEventStreamService,
    private readonly incrementalPlanningService: IncrementalPlanningService,
    private readonly stepDispatcher: OrchestrationStepDispatcherService,
    private readonly agentClientService: AgentClientService,
  ) {}

  async createPlanFromPrompt(createdBy: string, dto: CreatePlanFromPromptDto): Promise<any> {
    const prompt = String(dto.prompt || '').trim();
    if (!prompt) {
      throw new BadRequestException('prompt is required');
    }

    const domainType = this.normalizeDomainType(dto.domainType);
    const requirementId = String(dto.requirementId || '').trim() || undefined;
    const plan = await new this.orchestrationPlanModel({
      title: dto.title || this.derivePlanTitle(prompt),
      sourcePrompt: prompt,
      domainType,
      status: 'draft',
      strategy: {
        plannerAgentId: dto.plannerAgentId,
        mode: dto.mode || 'hybrid',
        runMode: dto.runMode || 'multi',
      },
      generationMode: 'incremental',
      generationConfig: {
        maxRetries: 3,
        maxTotalFailures: 6,
        maxCostTokens: 500000,
        maxTasks: 15,
      },
      generationState: {
        currentStep: 0,
        totalGenerated: 0,
        totalRetries: 0,
        consecutiveFailures: 0,
        totalFailures: 0,
        totalCost: 0,
        isComplete: false,
        currentPhase: 'idle',
      },
      stats: {
        totalTasks: 0,
        completedTasks: 0,
        failedTasks: 0,
        waitingHumanTasks: 0,
      },
      taskIds: [],
      metadata: {
        ...(dto.plannerAgentId ? { requestedPlannerAgentId: dto.plannerAgentId } : {}),
        ...(requirementId ? { requirementId } : {}),
      },
      createdBy,
    }).save();

    const planId = plan._id.toString();
    await this.planSessionModel
      .updateOne(
        { planId },
        {
          $set: {
            planId,
            title: plan.title,
            status: 'active',
            tasks: [],
          },
        },
        { upsert: true },
      )
      .exec();

    this.planEventStreamService.emitPlanStreamEvent(planId, 'plan.status.changed', {
      status: 'draft',
      phase: 'created',
      planId,
      title: plan.title,
    });

    if (dto.autoGenerate || dto.autoRun) {
      this.startGeneration(planId).catch((err) => {
        this.logger.error(`Incremental planning start failed: ${err.message}`);
      });
    }

    return this.getPlanById(planId);
  }

  async listPlans(): Promise<OrchestrationPlan[]> {
    const plans = await this.orchestrationPlanModel.find({}).sort({ createdAt: -1 }).exec();
    return plans.map((plan) => {
      const normalizedStatus = this.planStatsService.normalizePlanStatus(plan.status, plan.taskIds?.length);
      if (normalizedStatus === plan.status) {
        return plan;
      }
      return {
        ...plan.toObject(),
        status: normalizedStatus,
      } as OrchestrationPlan;
    });
  }

  async getPlanById(planId: string): Promise<any> {
    const plan = await this.orchestrationPlanModel.findOne({ _id: planId }).exec();
    if (!plan) {
      throw new NotFoundException('Plan not found');
    }

    const tasks = await this.orchestrationTaskModel
      .find({ planId: plan._id.toString() })
      .sort({ order: 1 })
      .exec();

    const planSession = await this.planSessionModel
      .findOne({ planId: plan._id.toString() })
      .exec();

    const lastRunId = String(plan.lastRunId || '').trim();
    const lastRun = lastRunId
      ? await this.orchestrationRunModel.findOne({ _id: lastRunId }).exec()
      : await this.orchestrationRunModel
        .findOne({ planId: plan._id.toString() })
        .sort({ startedAt: -1 })
        .exec();

    const normalizedStatus = this.planStatsService.normalizePlanStatus(plan.status, tasks.length);

    return {
      ...plan.toObject(),
      status: normalizedStatus,
      tasks,
      planSession,
      lastRun,
    };
  }

  async updatePlan(planId: string, dto: UpdatePlanDto): Promise<any> {
    const plan = await this.orchestrationPlanModel.findOne({ _id: planId }).exec();
    if (!plan) {
      throw new NotFoundException('Plan not found');
    }
    if (await this.isPlanRunActive(planId)) {
      throw new BadRequestException('Plan is running and cannot be edited');
    }
    this.assertPlanUnlocked(plan);

    const title = dto.title?.trim();
    const sourcePrompt = dto.sourcePrompt?.trim();
    const plannerAgentId = dto.plannerAgentId?.trim();
    const updatePayload: Record<string, any> = {};
    const unsetPayload: Record<string, any> = {};

    if (title) {
      updatePayload.title = title;
    }
    if (sourcePrompt) {
      updatePayload.sourcePrompt = sourcePrompt;
    }
    if (dto.domainType) {
      updatePayload.domainType = this.normalizeDomainType(dto.domainType);
    }
    if (dto.mode) {
      updatePayload['strategy.mode'] = dto.mode;
    }
    if (dto.runMode) {
      updatePayload['strategy.runMode'] = dto.runMode;
    }
    if (dto.plannerAgentId !== undefined) {
      if (plannerAgentId) {
        updatePayload['strategy.plannerAgentId'] = plannerAgentId;
      } else {
        unsetPayload['strategy.plannerAgentId'] = 1;
      }
    }
    if (dto.metadata && typeof dto.metadata === 'object' && !Array.isArray(dto.metadata)) {
      updatePayload.metadata = {
        ...(plan.metadata || {}),
        ...dto.metadata,
      };
    }
    if (!Object.keys(updatePayload).length && !Object.keys(unsetPayload).length) {
      throw new BadRequestException('At least one updatable field is required');
    }

    await this.orchestrationPlanModel
      .updateOne(
        { _id: planId },
        {
          ...(Object.keys(updatePayload).length ? { $set: updatePayload } : {}),
          ...(Object.keys(unsetPayload).length ? { $unset: unsetPayload } : {}),
        },
      )
      .exec();

    if (updatePayload.title) {
      await this.planSessionModel
        .updateOne(
          { planId },
          {
            $set: {
              title: updatePayload.title,
            },
          },
        )
        .exec();
    }

    return this.getPlanById(planId);
  }

  async deletePlan(planId: string): Promise<{ success: boolean; deletedTasks: number }> {
    const plan = await this.orchestrationPlanModel.findOne({ _id: planId }).exec();
    if (!plan) {
      throw new NotFoundException('Plan not found');
    }

    const taskDeleteResult = await this.orchestrationTaskModel
      .deleteMany({ planId: plan._id.toString() })
      .exec();

    await this.planSessionModel.deleteOne({ planId: plan._id.toString() }).exec();
    await this.orchestrationPlanModel.deleteOne({ _id: plan._id }).exec();

    return {
      success: true,
      deletedTasks: taskDeleteResult.deletedCount || 0,
    };
  }

  async startGeneration(planId: string): Promise<{ accepted: boolean }> {
    const plan = await this.orchestrationPlanModel.findOne({ _id: planId }).exec();
    if (!plan) {
      throw new NotFoundException('Plan not found');
    }

    const generationMode = plan.generationMode || 'batch';
    if (generationMode !== 'incremental') {
      throw new BadRequestException('Only incremental plans support generation start');
    }

    if (plan.generationState?.isComplete) {
      throw new BadRequestException('Planning already completed');
    }

    setTimeout(() => {
      if (this.isStepDispatcherEnabled()) {
        this.stepDispatcher
          .advanceOnce(planId, { source: 'internal' })
          .catch((error) => {
            const message = error instanceof Error ? error.message : 'Step dispatcher failed';
            this.logger.error(`Step dispatcher failed for plan ${planId}: ${message}`);
          });
      } else {
        this.incrementalPlanningService
          .executeIncrementalPlanning(planId)
          .catch((error) => {
            const message = error instanceof Error ? error.message : 'Incremental planning failed';
            this.logger.error(`Incremental planning failed for plan ${planId}: ${message}`);
          });
      }
    }, 0);

    return { accepted: true };
  }

  async generateNext(planId: string): Promise<{ accepted: boolean }> {
    const plan = await this.orchestrationPlanModel.findOne({ _id: planId }).exec();
    if (!plan) {
      throw new NotFoundException('Plan not found');
    }

    if ((plan.generationMode || 'batch') !== 'incremental') {
      throw new BadRequestException('Only incremental plans support generate-next');
    }

    // User-initiated generate-next: reset isComplete and consecutive failures
    // so the user can always manually trigger the next step (even after auto-stop).
    const currentState = plan.generationState;
    const needsReset =
      currentState?.isComplete ||
      Number(currentState?.consecutiveFailures || 0) > 0;
    if (needsReset) {
      await this.orchestrationPlanModel
        .updateOne(
          { _id: planId },
          {
            $set: {
              'generationState.isComplete': false,
              'generationState.consecutiveFailures': 0,
              'generationState.lastError': undefined,
              'generationState.currentPhase': 'idle',
              'generationState.lastDecision': undefined,
              status: 'planned',
            },
          },
        )
        .exec();
    }

    setTimeout(() => {
      if (this.isStepDispatcherEnabled()) {
        this.stepDispatcher
          .advanceOnce(planId, { source: 'api' })
          .catch((error) => {
            const message = error instanceof Error ? error.message : 'Step dispatcher step failed';
            this.logger.error(`Step dispatcher step failed for plan ${planId}: ${message}`);
          });
      } else {
        this.incrementalPlanningService
          .executeSinglePlanningStep(planId)
          .catch((error) => {
            const message = error instanceof Error ? error.message : 'Incremental step failed';
            this.logger.error(`Incremental step failed for plan ${planId}: ${message}`);
          });
      }
    }, 0);

    return { accepted: true };
  }

  async stopGeneration(
    planId: string,
    reason?: string,
  ): Promise<{ success: boolean; planId: string; stopped: boolean; alreadyStopped?: boolean }> {
    const plan = await this.orchestrationPlanModel.findOne({ _id: planId }).exec();
    if (!plan) {
      throw new NotFoundException('Plan not found');
    }

    if ((plan.generationMode || 'batch') !== 'incremental') {
      throw new BadRequestException('Only incremental plans support stop-generation');
    }

    const stopResult = await this.stepDispatcher.stopGeneration(planId);
    const normalizedReason = String(reason || '').trim() || 'manually stopped by user';

    if (stopResult.stopped) {
      await this.orchestrationPlanModel
        .updateOne(
          { _id: planId },
          {
            $set: {
              status: 'draft',
              'generationState.isComplete': true,
              'generationState.currentPhase': 'idle',
              'generationState.currentTaskId': undefined,
              'generationState.lastDecision': 'stop',
              'generationState.lastError': undefined,
              'metadata.planningStoppedAt': new Date().toISOString(),
              'metadata.planningStoppedReason': normalizedReason,
            },
          },
        )
        .exec();

      await this.planStatsService.setPlanStatus(planId, 'draft');
      await this.planStatsService.setPlanSessionStatus(planId, 'draft');
      this.planEventStreamService.emitPlanStreamEvent(planId, 'plan.status.changed', {
        planId,
        status: 'draft',
        phase: 'generation_stopped',
        reason: normalizedReason,
      });

      return {
        success: true,
        planId,
        stopped: true,
      };
    }

    return {
      success: true,
      planId,
      stopped: false,
      alreadyStopped: stopResult.alreadyStopped,
    };
  }

  async replanPlan(planId: string, dto: ReplanPlanDto): Promise<any> {
    const plan = await this.orchestrationPlanModel.findOne({ _id: planId }).exec();
    if (!plan) {
      throw new NotFoundException('Plan not found');
    }
    if (await this.isPlanRunActive(planId)) {
      throw new BadRequestException('Plan is running and cannot be replanned');
    }
    this.assertPlanUnlocked(plan);

    const prompt = dto.prompt?.trim();
    if (!prompt) {
      throw new BadRequestException('prompt is required');
    }

    const plannerAgentId = dto.plannerAgentId?.trim();
    const resolvedPlannerAgentId = plannerAgentId || String(plan.strategy?.plannerAgentId || '').trim() || undefined;
    const title = dto.title?.trim() || plan.title || this.derivePlanTitle(prompt);
    const fallbackMode = dto.mode || plan.strategy?.mode || 'hybrid';
    const fallbackRunMode = dto.runMode || (plan.strategy as any)?.runMode || 'multi';
    const domainType = this.normalizeDomainType(dto.domainType || (plan as any).domainType);
    const requirementId = this.contextService.resolveRequirementIdFromPlan(plan as any);
    const shouldStartGeneration = dto.autoGenerate ?? dto.autoRun ?? false;

    try {
      await this.orchestrationTaskModel.deleteMany({ planId }).exec();

      await this.archivePlannerSessionForReplan(plan.generationState?.plannerSessionId);
      const replannedPlannerSessionId = await this.createPlannerSessionForReplan(planId, title, resolvedPlannerAgentId);

      await this.planSessionModel
        .updateOne(
          { planId },
          {
            $set: {
              planId,
              title,
              status: 'active',
              tasks: [],
            },
          },
          { upsert: true },
        )
        .exec();

      await this.orchestrationPlanModel
        .updateOne(
          { _id: planId },
          {
            $set: {
              title,
              sourcePrompt: prompt,
              domainType,
              status: 'draft',
              strategy: {
                plannerAgentId: plannerAgentId || plan.strategy?.plannerAgentId,
                mode: fallbackMode,
                runMode: fallbackRunMode,
              },
              generationMode: 'incremental',
              generationConfig: {
                maxRetries: plan.generationConfig?.maxRetries || 3,
                maxTotalFailures: plan.generationConfig?.maxTotalFailures || 6,
                maxCostTokens: plan.generationConfig?.maxCostTokens || 500000,
                maxTasks: plan.generationConfig?.maxTasks || 15,
              },
              generationState: {
                currentStep: 0,
                totalGenerated: 0,
                totalRetries: 0,
                consecutiveFailures: 0,
                totalFailures: 0,
                totalCost: 0,
                isComplete: false,
                currentPhase: 'idle',
                plannerSessionId: replannedPlannerSessionId,
              },
              stats: {
                totalTasks: 0,
                completedTasks: 0,
                failedTasks: 0,
                waitingHumanTasks: 0,
              },
              taskIds: [],
              'metadata.replanStartedAt': new Date().toISOString(),
              ...(requirementId ? { 'metadata.requirementId': requirementId } : {}),
            },
            $unset: {
              'metadata.asyncReplanError': 1,
              'metadata.replannedAt': 1,
              'metadata.replanFailedAt': 1,
              'metadata.planningFailedAt': 1,
              'metadata.planningCompletedAt': 1,
            },
          },
        )
        .exec();

      await this.planStatsService.setPlanStatus(planId, 'draft');
      await this.planStatsService.setPlanSessionStatus(planId, 'draft');
      await this.planStatsService.syncPlanSessionTasks(planId);

      this.planEventStreamService.emitPlanStreamEvent(planId, 'plan.status.changed', {
        planId,
        status: 'draft',
        phase: 'replan_reset',
      });

      if (shouldStartGeneration) {
        await this.startGeneration(planId);
      } else {
        this.planEventStreamService.emitPlanStreamEvent(planId, 'plan.replan.ready', {
          planId,
          status: 'draft',
        });
      }

      return this.getPlanById(planId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Async replan failed';
      await this.planStatsService.setPlanStatus(planId, 'draft');
      await this.planStatsService.setPlanSessionStatus(planId, 'draft');
      await this.orchestrationPlanModel
        .updateOne(
          { _id: planId },
          {
            $set: {
              'metadata.asyncReplanError': message,
              'metadata.replanFailedAt': new Date().toISOString(),
            },
          },
        )
        .exec();

      this.planEventStreamService.emitPlanStreamEvent(planId, 'plan.failed', {
        planId,
        status: 'failed',
        error: message,
      });
      throw error;
    }
  }

  async replanPlanAsync(
    planId: string,
    dto: ReplanPlanDto,
  ): Promise<{ accepted: boolean; planId: string; status: string; alreadyRunning?: boolean }> {
    const plan = await this.orchestrationPlanModel.findOne({ _id: planId }).exec();
    if (!plan) {
      throw new NotFoundException('Plan not found');
    }

    const prompt = String(dto.prompt || '').trim();
    if (!prompt) {
      throw new BadRequestException('prompt is required');
    }
    if (await this.isPlanRunActive(planId)) {
      throw new BadRequestException('Plan is running and cannot be replanned');
    }
    this.assertPlanUnlocked(plan);

    const runKey = `replan:${planId}`;
    if (this.runningPlans.has(runKey)) {
      return {
        accepted: true,
        planId,
        status: 'running',
        alreadyRunning: true,
      };
    }

    this.runningPlans.add(runKey);

    setTimeout(() => {
      this.replanPlan(planId, dto)
        .catch((error) => {
          const message = error instanceof Error ? error.message : 'Async replan failed';
          this.logger.error(`Async replan failed for plan ${planId}: ${message}`);
        })
        .finally(() => {
          this.runningPlans.delete(runKey);
        });
    }, 0);

    return {
      accepted: true,
      planId,
      status: 'accepted',
      alreadyRunning: false,
    };
  }

  async publishPlan(planId: string): Promise<OrchestrationPlan> {
    const plan = await this.orchestrationPlanModel.findOne({ _id: planId }).exec();
    if (!plan) {
      throw new NotFoundException('Plan not found');
    }
    if (await this.isPlanRunActive(planId)) {
      throw new BadRequestException('Plan is running and cannot be published');
    }

    const normalizedStatus = this.planStatsService.normalizePlanStatus(plan.status, plan.taskIds?.length);
    if (normalizedStatus !== 'planned') {
      throw new BadRequestException(`Plan in "${normalizedStatus}" status cannot be published`);
    }

    await this.planStatsService.setPlanStatus(planId, 'production');
    this.planEventStreamService.emitPlanStreamEvent(planId, 'plan.status.changed', {
      planId,
      status: 'production',
      phase: 'published',
    });

    const updated = await this.orchestrationPlanModel.findOne({ _id: planId }).exec();
    if (!updated) {
      throw new NotFoundException('Plan not found');
    }
    return updated;
  }

  async unlockPlan(planId: string): Promise<OrchestrationPlan> {
    const plan = await this.orchestrationPlanModel.findOne({ _id: planId }).exec();
    if (!plan) {
      throw new NotFoundException('Plan not found');
    }
    if (await this.isPlanRunActive(planId)) {
      throw new BadRequestException('Plan is running and cannot be unlocked');
    }

    const normalizedStatus = this.planStatsService.normalizePlanStatus(plan.status, plan.taskIds?.length);
    if (normalizedStatus !== 'production') {
      throw new BadRequestException(`Plan in "${normalizedStatus}" status cannot be unlocked`);
    }

    await this.planStatsService.setPlanStatus(planId, 'planned');
    this.planEventStreamService.emitPlanStreamEvent(planId, 'plan.status.changed', {
      planId,
      status: 'planned',
      phase: 'unlocked',
    });

    const updated = await this.orchestrationPlanModel.findOne({ _id: planId }).exec();
    if (!updated) {
      throw new NotFoundException('Plan not found');
    }
    return updated;
  }

  private derivePlanTitle(prompt: string): string {
    return prompt.length > 40 ? `${prompt.slice(0, 40)}...` : prompt;
  }

  private normalizeDomainType(value?: string): OrchestrationDomainType {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'development' || normalized === 'research') {
      return normalized;
    }
    return 'general';
  }

  private async isPlanRunActive(planId: string): Promise<boolean> {
    const runningRun = await this.orchestrationRunModel
      .findOne({ planId, status: 'running' })
      .select({ _id: 1 })
      .lean()
      .exec();
    return Boolean(runningRun);
  }

  private assertPlanUnlocked(plan: OrchestrationPlan): void {
    const normalizedStatus = this.planStatsService.normalizePlanStatus(plan.status, plan.taskIds?.length);
    if (normalizedStatus === 'production') {
      throw new BadRequestException('Plan is in production and cannot be edited. Please unlock first.');
    }
  }

  private isStepDispatcherEnabled(): boolean {
    const value = String(process.env.ORCH_STEP_DISPATCHER_ENABLED || '').trim().toLowerCase();
    return value === '1' || value === 'true' || value === 'yes' || value === 'on';
  }

  private async archivePlannerSessionForReplan(existingPlannerSessionId?: string): Promise<void> {
    const sessionId = String(existingPlannerSessionId || '').trim();
    if (!sessionId) {
      return;
    }

    try {
      await this.agentClientService.archiveSession(sessionId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Archive old planner session failed: sessionId=${sessionId}, error=${message}`);
    }
  }

  private async createPlannerSessionForReplan(
    planId: string,
    planTitle: string,
    plannerAgentId?: string,
  ): Promise<string | undefined> {
    const normalizedPlannerAgentId = String(plannerAgentId || '').trim();
    if (!normalizedPlannerAgentId) {
      return undefined;
    }

    const session = await this.agentClientService.getOrCreatePlanSession(
      planId,
      normalizedPlannerAgentId,
      `Planner Session: ${planTitle}`,
      {
        orchestrationRunId: `replan-${Date.now()}`,
        collaborationContext: CollaborationContextFactory.orchestration({
          planId,
          roleInPlan: 'planner',
        }),
      },
    );

    const sessionId = String(session?.id || session?.sessionId || '').trim();
    return sessionId || undefined;
  }

}
