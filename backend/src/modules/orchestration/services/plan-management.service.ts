import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
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
import { PlannerService } from '../planner.service';
import { PlanningContextService } from './planning-context.service';
import { ExecutorSelectionService } from './executor-selection.service';
import { PlanStatsService } from './plan-stats.service';
import { OrchestrationContextService } from './orchestration-context.service';
import { PlanEventStreamService } from './plan-event-stream.service';
import { PlanExecutionService } from './plan-execution.service';

@Injectable()
export class PlanManagementService {
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
    private readonly plannerService: PlannerService,
    private readonly planningContextService: PlanningContextService,
    private readonly executorSelectionService: ExecutorSelectionService,
    private readonly planStatsService: PlanStatsService,
    private readonly contextService: OrchestrationContextService,
    private readonly planEventStreamService: PlanEventStreamService,
    private readonly planExecutionService: PlanExecutionService,
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
      status: 'drafting',
      strategy: {
        plannerAgentId: dto.plannerAgentId,
        mode: dto.mode || 'hybrid',
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
      status: 'drafting',
      phase: 'queued',
      planId,
      title: plan.title,
    });

    const runKey = `create:${planId}`;
    this.runningPlans.add(runKey);

    setTimeout(() => {
      this.generatePlanTasksAsync(planId, dto)
        .finally(() => {
          this.runningPlans.delete(runKey);
        });
    }, 0);

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
    const requirementObjectId = this.contextService.parseRequirementObjectId(requirementId);

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
              status: 'drafting',
              strategy: {
                plannerAgentId: plannerAgentId || plan.strategy?.plannerAgentId,
                mode: fallbackMode,
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
            },
          },
        )
        .exec();

      await this.planStatsService.setPlanStatus(planId, 'drafting');
      this.planEventStreamService.emitPlanStreamEvent(planId, 'plan.status.changed', {
        planId,
        status: 'drafting',
        phase: 'replanning',
      });

      const replanPlannerAgentId = plannerAgentId || plan.strategy?.plannerAgentId;
      const replanContext = await this.planningContextService.buildPlanningContext({
        prompt,
        requirementId,
        plannerAgentId: replanPlannerAgentId,
      });

      const planningResult = await this.plannerService.planFromPrompt({
        prompt,
        mode: fallbackMode,
        plannerAgentId: replanPlannerAgentId,
        requirementId,
        planningContext: replanContext,
      });

      if (!planningResult.tasks?.length) {
        throw new BadRequestException('Planner did not produce any tasks');
      }

      await this.orchestrationPlanModel
        .updateOne(
          { _id: planId },
          {
            $set: {
              strategy: {
                plannerAgentId: planningResult.plannerAgentId,
                mode: planningResult.mode,
              },
              'metadata.strategyNote': planningResult.strategyNote,
              'metadata.planningStartedAt': new Date().toISOString(),
            },
          },
        )
        .exec();

      const idByIndex: string[] = [];
      const total = planningResult.tasks.length;
      const replanAssignmentPolicy = this.detectAssignmentPolicy(plan.sourcePrompt);

      for (let i = 0; i < planningResult.tasks.length; i++) {
        const planningTask = planningResult.tasks[i];
        const assignment = await this.executorSelectionService.selectExecutor({
          title: planningTask.title,
          description: planningTask.description,
          plannerAgentId: planningResult.plannerAgentId,
          assignmentPolicy: replanAssignmentPolicy,
        });

        const createdTask = await new this.orchestrationTaskModel({
          planId,
          ...(requirementObjectId ? { requirementId: requirementObjectId } : {}),
          title: planningTask.title,
          description: planningTask.description,
          priority: planningTask.priority,
          status: assignment.executorType === 'unassigned' ? 'pending' : 'assigned',
          order: i,
          dependencyTaskIds: [],
          assignment,
          runLogs: [
            {
              timestamp: new Date(),
              level: 'info',
              message: `Task replanned and assigned to ${assignment.executorType}`,
              metadata: {
                executorId: assignment.executorId,
                reason: assignment.reason,
              },
            },
          ],
        }).save();

        const taskId = createdTask._id.toString();
        idByIndex.push(taskId);

        const deps = (planningTask.dependencies || [])
          .map((depIndex) => idByIndex[depIndex])
          .filter(Boolean);

        if (deps.length) {
          await this.orchestrationTaskModel
            .updateOne({ _id: createdTask._id }, { $set: { dependencyTaskIds: deps } })
            .exec();
          createdTask.dependencyTaskIds = deps;
        }

        await this.orchestrationPlanModel
          .updateOne(
            { _id: planId },
            {
              $push: {
                taskIds: taskId,
              },
              $set: {
                'stats.totalTasks': idByIndex.length,
              },
            },
          )
          .exec();

        await this.planSessionModel
          .updateOne(
            { planId },
            {
              $push: {
                tasks: {
                  taskId,
                  order: createdTask.order,
                  title: createdTask.title,
                  status: createdTask.status,
                  input: planningTask.description || createdTask.description,
                  executorType: createdTask.assignment?.executorType,
                  executorId: createdTask.assignment?.executorId,
                  updatedAt: new Date(),
                },
              },
            },
          )
          .exec();

        this.planEventStreamService.emitTaskLifecycleEvent(taskId, 'task.created', {
          planId,
          status: createdTask.status,
          taskTitle: createdTask.title,
          assignment: createdTask.assignment,
        });

        this.planEventStreamService.emitPlanStreamEvent(planId, 'plan.task.generated', {
          planId,
          index: i + 1,
          total,
          task: createdTask.toObject(),
        });
      }

      await this.planStatsService.refreshPlanStats(planId);
      await this.planStatsService.setPlanStatus(planId, 'planned');
      await this.planStatsService.setPlanSessionStatus(planId, 'planned');

      await this.orchestrationPlanModel
        .updateOne(
          { _id: planId },
          {
            $set: {
              'metadata.strategyNote': planningResult.strategyNote,
              'metadata.replannedAt': new Date().toISOString(),
              'metadata.planningCompletedAt': new Date().toISOString(),
            },
            $unset: {
              'metadata.asyncReplanError': 1,
            },
          },
        )
        .exec();

      this.planEventStreamService.emitPlanStreamEvent(planId, 'plan.completed', {
        planId,
        status: 'planned',
        totalTasks: total,
      });

      if (dto.autoRun) {
        const autoRun = await this.planExecutionService.executePlanRun(planId, 'autorun', { continueOnFailure: true });
        this.planEventStreamService.emitPlanStreamEvent(planId, 'plan.autorun.accepted', {
          planId,
          status: autoRun.status,
          runId: this.getEntityId(autoRun as any),
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

  private async generatePlanTasksAsync(planId: string, dto: CreatePlanFromPromptDto): Promise<void> {
    const plan = await this.orchestrationPlanModel.findOne({ _id: planId }).exec();
    if (!plan) {
      return;
    }

    const requirementId = this.contextService.resolveRequirementIdFromPlan(plan as any);
    const requirementObjectId = this.contextService.parseRequirementObjectId(requirementId);

    try {
      await this.planStatsService.setPlanStatus(planId, 'drafting');
      this.planEventStreamService.emitPlanStreamEvent(planId, 'plan.status.changed', {
        planId,
        status: 'drafting',
        phase: 'planning',
      });

      const plannerAgentId = dto.plannerAgentId || plan.strategy?.plannerAgentId;
      const planningContext = await this.planningContextService.buildPlanningContext({
        prompt: plan.sourcePrompt,
        requirementId,
        plannerAgentId,
      });

      const planningResult = await this.plannerService.planFromPrompt({
        prompt: plan.sourcePrompt,
        mode: dto.mode || plan.strategy?.mode,
        plannerAgentId,
        requirementId,
        planningContext,
      });

      if (!planningResult.tasks?.length) {
        throw new BadRequestException('Planner did not produce any tasks');
      }

      await this.orchestrationPlanModel
        .updateOne(
          { _id: planId },
          {
            $set: {
              strategy: {
                plannerAgentId: planningResult.plannerAgentId,
                mode: planningResult.mode,
              },
              'metadata.strategyNote': planningResult.strategyNote,
              'metadata.planningStartedAt': new Date().toISOString(),
              stats: {
                totalTasks: 0,
                completedTasks: 0,
                failedTasks: 0,
                waitingHumanTasks: 0,
              },
            },
          },
        )
        .exec();

      const idByIndex: string[] = [];
      const total = planningResult.tasks.length;
      const assignmentPolicy = this.detectAssignmentPolicy(plan.sourcePrompt);

      for (let i = 0; i < planningResult.tasks.length; i++) {
        const planningTask = planningResult.tasks[i];
        const assignment = await this.executorSelectionService.selectExecutor({
          title: planningTask.title,
          description: planningTask.description,
          plannerAgentId: planningResult.plannerAgentId,
          assignmentPolicy,
        });

        const createdTask = await new this.orchestrationTaskModel({
          planId,
          ...(requirementObjectId ? { requirementId: requirementObjectId } : {}),
          title: planningTask.title,
          description: planningTask.description,
          priority: planningTask.priority,
          status: assignment.executorType === 'unassigned' ? 'pending' : 'assigned',
          order: i,
          dependencyTaskIds: [],
          assignment,
          runLogs: [
            {
              timestamp: new Date(),
              level: 'info',
              message: `Task created and assigned to ${assignment.executorType}`,
              metadata: {
                executorId: assignment.executorId,
                reason: assignment.reason,
              },
            },
          ],
        }).save();

        const taskId = createdTask._id.toString();
        idByIndex.push(taskId);

        const deps = (planningTask.dependencies || [])
          .map((depIndex) => idByIndex[depIndex])
          .filter(Boolean);

        if (deps.length) {
          await this.orchestrationTaskModel
            .updateOne({ _id: createdTask._id }, { $set: { dependencyTaskIds: deps } })
            .exec();
          createdTask.dependencyTaskIds = deps;
        }

        await this.orchestrationPlanModel
          .updateOne(
            { _id: planId },
            {
              $push: {
                taskIds: taskId,
              },
              $set: {
                'stats.totalTasks': idByIndex.length,
              },
            },
          )
          .exec();

        await this.planSessionModel
          .updateOne(
            { planId },
            {
              $push: {
                tasks: {
                  taskId,
                  order: createdTask.order,
                  title: createdTask.title,
                  status: createdTask.status,
                  input: planningTask.description || createdTask.description,
                  executorType: createdTask.assignment?.executorType,
                  executorId: createdTask.assignment?.executorId,
                  updatedAt: new Date(),
                },
              },
            },
          )
          .exec();

        this.planEventStreamService.emitTaskLifecycleEvent(taskId, 'task.created', {
          planId,
          status: createdTask.status,
          taskTitle: createdTask.title,
          assignment: createdTask.assignment,
        });

        this.planEventStreamService.emitPlanStreamEvent(planId, 'plan.task.generated', {
          planId,
          index: i + 1,
          total,
          task: createdTask.toObject(),
        });
      }

      await this.planStatsService.refreshPlanStats(planId);
      await this.planStatsService.setPlanStatus(planId, 'planned');
      await this.planStatsService.setPlanSessionStatus(planId, 'planned');

      await this.orchestrationPlanModel
        .updateOne(
          { _id: planId },
          {
            $set: {
              'metadata.strategyNote': planningResult.strategyNote,
              'metadata.planningCompletedAt': new Date().toISOString(),
            },
          },
        )
        .exec();

      this.planEventStreamService.emitPlanStreamEvent(planId, 'plan.completed', {
        planId,
        status: 'planned',
        totalTasks: total,
      });

      if (dto.autoRun) {
        const autoRun = await this.planExecutionService.executePlanRun(planId, 'autorun', { continueOnFailure: true });
        this.planEventStreamService.emitPlanStreamEvent(planId, 'plan.autorun.accepted', {
          planId,
          status: autoRun.status,
          runId: this.getEntityId(autoRun as any),
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Async create plan failed';
      await this.planStatsService.setPlanStatus(planId, 'draft');
      await this.planStatsService.setPlanSessionStatus(planId, 'draft');
      await this.orchestrationPlanModel
        .updateOne(
          { _id: planId },
          {
            $set: {
              'metadata.asyncCreateError': message,
              'metadata.planningFailedAt': new Date().toISOString(),
            },
          },
        )
        .exec();

      this.planEventStreamService.emitPlanStreamEvent(planId, 'plan.failed', {
        planId,
        status: 'failed',
        error: message,
      });
    }
  }

  private derivePlanTitle(prompt: string): string {
    return prompt.length > 40 ? `${prompt.slice(0, 40)}...` : prompt;
  }

  private detectAssignmentPolicy(prompt: string): 'default' | 'lock_to_planner' {
    const text = (prompt || '').toLowerCase();
    const lockSignals = [
      'assignee 必须',
      'assignee必须',
      'all tasks assigned to me',
      'assignmentpolicy=lock_to_planner',
      'enforcesingleassignee=true',
    ];
    if (lockSignals.some((signal) => text.includes(signal))) return 'lock_to_planner';
    if (/所有.*任务.*归属.*自身/.test(text)) return 'lock_to_planner';
    if (/plan\s*tasks.*assignee.*必须.*(cto|planner|自身|自己)/.test(text)) return 'lock_to_planner';
    return 'default';
  }

  private async isPlanRunActive(planId: string): Promise<boolean> {
    const runningRun = await this.orchestrationRunModel
      .findOne({ planId, status: 'running' })
      .select({ _id: 1 })
      .lean()
      .exec();
    return Boolean(runningRun);
  }

  private getEntityId(entity: Record<string, any>): string {
    if (entity.id) {
      return String(entity.id);
    }
    if (entity._id) {
      if (typeof entity._id === 'string') {
        return entity._id;
      }
      if (entity._id instanceof Types.ObjectId) {
        return entity._id.toString();
      }
      if (typeof entity._id.toString === 'function') {
        return entity._id.toString();
      }
    }
    return '';
  }
}
