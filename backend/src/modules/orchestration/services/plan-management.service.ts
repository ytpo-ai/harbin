import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  CreatePlanFromPromptDto,
  ReplanPlanDto,
  UpdatePlanDto,
} from '../dto';
import {
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
  OrchestrationSchedule,
  OrchestrationScheduleDocument,
} from '../../../shared/schemas/orchestration-schedule.schema';
import {
  OrchestrationRun,
  OrchestrationRunDocument,
} from '../../../shared/schemas/orchestration-run.schema';
import { PlanStatsService } from './plan-stats.service';
import { OrchestrationContextService } from './orchestration-context.service';
import { PlanEventStreamService } from './plan-event-stream.service';
import { IncrementalPlanningService } from './incremental-planning.service';

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
    @InjectModel(OrchestrationSchedule.name)
    private readonly orchestrationScheduleModel: Model<OrchestrationScheduleDocument>,
    @InjectModel(OrchestrationRun.name)
    private readonly orchestrationRunModel: Model<OrchestrationRunDocument>,
    private readonly planStatsService: PlanStatsService,
    private readonly contextService: OrchestrationContextService,
    private readonly planEventStreamService: PlanEventStreamService,
    private readonly incrementalPlanningService: IncrementalPlanningService,
  ) {}

  async createPlanFromPrompt(createdBy: string, dto: CreatePlanFromPromptDto): Promise<any> {
    const prompt = String(dto.prompt || '').trim();
    if (!prompt) {
      throw new BadRequestException('prompt is required');
    }

    const inferredDomainContext = this.contextService.inferDomainContext(prompt, dto.domainType);
    const requirementId = String(dto.requirementId || '').trim() || undefined;
    const plan = await new this.orchestrationPlanModel({
      title: dto.title || this.derivePlanTitle(prompt),
      sourcePrompt: prompt,
      domainContext: inferredDomainContext,
      status: 'draft',
      strategy: {
        plannerAgentId: dto.plannerAgentId,
        mode: dto.mode || 'hybrid',
      },
      generationMode: 'incremental',
      generationConfig: {
        maxRetries: 3,
        maxCostTokens: 500000,
        maxTasks: 15,
      },
      generationState: {
        currentStep: 0,
        totalGenerated: 0,
        totalRetries: 0,
        consecutiveFailures: 0,
        totalCost: 0,
        isComplete: false,
      },
      stats: {
        totalTasks: 0,
        completedTasks: 0,
        failedTasks: 0,
        waitingHumanTasks: 0,
      },
      taskIds: [],
      ...(dto.defaultTaskType ? { defaultTaskType: dto.defaultTaskType } : {}),
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
      updatePayload.domainContext = this.contextService.inferDomainContext(
        sourcePrompt,
        dto.domainType || String((plan.domainContext as any)?.domainType || ''),
      );
    } else if (dto.domainType) {
      updatePayload.domainContext = this.contextService.inferDomainContext(plan.sourcePrompt || '', dto.domainType);
    }
    if (dto.mode) {
      updatePayload['strategy.mode'] = dto.mode;
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
    if (dto.defaultTaskType) {
      updatePayload.defaultTaskType = dto.defaultTaskType;
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

    const linkedSchedules = await this.orchestrationScheduleModel
      .find({ planId: plan._id.toString() })
      .exec();
    if (linkedSchedules.length > 0) {
      throw new BadRequestException(
        `该计划已绑定 ${linkedSchedules.length} 个定时服务，无法删除。请先删除关联的定时服务后再试。`,
      );
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
      this.incrementalPlanningService
        .executeIncrementalPlanning(planId)
        .catch((error) => {
          const message = error instanceof Error ? error.message : 'Incremental planning failed';
          this.logger.error(`Incremental planning failed for plan ${planId}: ${message}`);
        });
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

    if (plan.generationState?.isComplete) {
      throw new BadRequestException('Planning already completed');
    }

    setTimeout(() => {
      this.incrementalPlanningService
        .executeSinglePlanningStep(planId)
        .catch((error) => {
          const message = error instanceof Error ? error.message : 'Incremental step failed';
          this.logger.error(`Incremental step failed for plan ${planId}: ${message}`);
        });
    }, 0);

    return { accepted: true };
  }

  async replanPlan(planId: string, dto: ReplanPlanDto): Promise<any> {
    const plan = await this.orchestrationPlanModel.findOne({ _id: planId }).exec();
    if (!plan) {
      throw new NotFoundException('Plan not found');
    }
    if (await this.isPlanRunActive(planId)) {
      throw new BadRequestException('Plan is running and cannot be replanned');
    }

    const prompt = dto.prompt?.trim();
    if (!prompt) {
      throw new BadRequestException('prompt is required');
    }

    const plannerAgentId = dto.plannerAgentId?.trim();
    const title = dto.title?.trim() || plan.title || this.derivePlanTitle(prompt);
    const fallbackMode = dto.mode || plan.strategy?.mode || 'hybrid';
    const inferredDomainContext = this.contextService.inferDomainContext(prompt, dto.domainType);
    const requirementId = this.contextService.resolveRequirementIdFromPlan(plan as any);
    const shouldStartGeneration = dto.autoGenerate ?? dto.autoRun ?? false;

    try {
      await this.orchestrationTaskModel.deleteMany({ planId }).exec();

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
              domainContext: inferredDomainContext,
              status: 'draft',
              strategy: {
                plannerAgentId: plannerAgentId || plan.strategy?.plannerAgentId,
                mode: fallbackMode,
              },
              ...(dto.defaultTaskType ? { defaultTaskType: dto.defaultTaskType } : {}),
              generationMode: 'incremental',
              generationConfig: {
                maxRetries: plan.generationConfig?.maxRetries || 3,
                maxCostTokens: plan.generationConfig?.maxCostTokens || 500000,
                maxTasks: plan.generationConfig?.maxTasks || 15,
              },
              generationState: {
                currentStep: 0,
                totalGenerated: 0,
                totalRetries: 0,
                consecutiveFailures: 0,
                totalCost: 0,
                isComplete: false,
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
        .catch(() => undefined)
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

  private derivePlanTitle(prompt: string): string {
    return prompt.length > 40 ? `${prompt.slice(0, 40)}...` : prompt;
  }

  private async isPlanRunActive(planId: string): Promise<boolean> {
    const runningRun = await this.orchestrationRunModel
      .findOne({ planId, status: 'running' })
      .select({ _id: 1 })
      .lean()
      .exec();
    return Boolean(runningRun);
  }

}
