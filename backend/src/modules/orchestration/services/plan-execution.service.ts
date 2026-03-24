import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { RunPlanDto } from '../dto';
import {
  OrchestrationRun,
  OrchestrationRunDocument,
  OrchestrationRunTriggerType,
} from '../../../shared/schemas/orchestration-run.schema';
import {
  OrchestrationRunTask,
  OrchestrationRunTaskDocument,
} from '../../../shared/schemas/orchestration-run-task.schema';
import {
  OrchestrationPlan,
  OrchestrationPlanDocument,
} from '../../../shared/schemas/orchestration-plan.schema';
import {
  OrchestrationTask,
  OrchestrationTaskDocument,
} from '../../../shared/schemas/orchestration-task.schema';
import {
  OrchestrationSchedule,
  OrchestrationScheduleDocument,
} from '../../../shared/schemas/orchestration-schedule.schema';
import { PlanStatsService } from './plan-stats.service';
import { PlanEventStreamService } from './plan-event-stream.service';
import { OrchestrationContextService } from './orchestration-context.service';
import { OrchestrationExecutionEngineService } from './orchestration-execution-engine.service';

@Injectable()
export class PlanExecutionService {
  private readonly runningPlans = new Set<string>();

  constructor(
    @InjectModel(OrchestrationPlan.name)
    private readonly orchestrationPlanModel: Model<OrchestrationPlanDocument>,
    @InjectModel(OrchestrationRun.name)
    private readonly orchestrationRunModel: Model<OrchestrationRunDocument>,
    @InjectModel(OrchestrationRunTask.name)
    private readonly orchestrationRunTaskModel: Model<OrchestrationRunTaskDocument>,
    @InjectModel(OrchestrationTask.name)
    private readonly orchestrationTaskModel: Model<OrchestrationTaskDocument>,
    @InjectModel(OrchestrationSchedule.name)
    private readonly orchestrationScheduleModel: Model<OrchestrationScheduleDocument>,
    private readonly planStatsService: PlanStatsService,
    private readonly planEventStreamService: PlanEventStreamService,
    private readonly contextService: OrchestrationContextService,
    private readonly executionEngineService: OrchestrationExecutionEngineService,
  ) {}

  async runPlan(planId: string, dto: RunPlanDto): Promise<OrchestrationRun> {
    return this.executePlanRun(planId, 'manual', {
      continueOnFailure: dto.continueOnFailure ?? false,
    });
  }

  async runPlanAsync(
    planId: string,
    dto: RunPlanDto,
  ): Promise<{ accepted: boolean; planId: string; status: string; alreadyRunning?: boolean }> {
    const plan = await this.orchestrationPlanModel.findOne({ _id: planId }).exec();
    if (!plan) {
      throw new NotFoundException('Plan not found');
    }

    const runKey = planId;
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
      this.runPlan(planId, dto)
        .catch(async (error) => {
          const message = error instanceof Error ? error.message : 'Async plan run failed';

          const latestRunningRun = await this.orchestrationRunModel
            .findOne({ planId, status: 'running' })
            .sort({ startedAt: -1 })
            .exec();
          if (latestRunningRun) {
            await this.orchestrationRunModel
              .updateOne(
                { _id: latestRunningRun._id },
                {
                  $set: {
                    status: 'failed',
                    error: message,
                    completedAt: new Date(),
                  },
                },
              )
              .exec();
          }

          await this.planStatsService.setPlanStatus(planId, 'planned');
          await this.planStatsService.setPlanSessionStatus(planId, 'planned');
          await this.orchestrationPlanModel
            .updateOne(
              { _id: planId },
              {
                $set: {
                  metadata: {
                    ...(plan.metadata || {}),
                    asyncRunError: message,
                  },
                },
              },
            )
            .exec();
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

  async executePlanRun(
    planId: string,
    triggerType: OrchestrationRunTriggerType,
    options?: {
      scheduleId?: string;
      continueOnFailure?: boolean;
    },
  ): Promise<OrchestrationRun> {
    const plan = await this.orchestrationPlanModel.findOne({ _id: planId }).exec();
    if (!plan) {
      throw new NotFoundException('Plan not found');
    }

    const templateTasks = await this.orchestrationTaskModel.find({ planId }).sort({ order: 1 }).exec();
    if (!templateTasks.length) {
      throw new BadRequestException('Plan has no tasks to run');
    }

    const requirementId = this.contextService.resolveRequirementIdFromPlan(plan as any);
    if (requirementId) {
      await this.contextService.tryUpdateRequirementStatus(requirementId, 'in_progress', 'orchestration plan started');
    }

    await this.planStatsService.setPlanStatus(planId, 'planned');
    await this.planStatsService.setPlanSessionStatus(planId, 'planned');

    const startedAt = new Date();
    const run = await new this.orchestrationRunModel({
      planId,
      triggerType,
      scheduleId: options?.scheduleId,
      status: 'running',
      startedAt,
      stats: {
        totalTasks: templateTasks.length,
        completedTasks: 0,
        failedTasks: 0,
        waitingHumanTasks: 0,
      },
    }).save();

    const runId = this.getEntityId(run as any);
    this.planEventStreamService.emitPlanStreamEvent(planId, 'run.started', {
      planId,
      runId,
      triggerType,
      scheduleId: options?.scheduleId,
      startedAt,
    });

    await this.orchestrationRunTaskModel.insertMany(
      templateTasks.map((task) => ({
        runId,
        planId,
        sourceTaskId: this.getEntityId(task as any),
        order: task.order,
        title: task.title,
        description: task.description,
        priority: task.priority,
        status: task.assignment?.executorType === 'unassigned' ? 'pending' : 'assigned',
        assignment: task.assignment,
        dependencyTaskIds: task.dependencyTaskIds || [],
        runtimeTaskType: (task as any).runtimeTaskType,
        runLogs: [
          {
            timestamp: new Date(),
            level: 'info',
            message: 'Run task snapshot created from template task',
          },
        ],
      })),
    );

    try {
      await this.executeRunTasks(plan, runId, {
        continueOnFailure: options?.continueOnFailure ?? false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'run execution failed';
      await this.orchestrationRunModel
        .updateOne(
          { _id: runId },
          {
            $set: {
              status: 'failed',
              error: message,
            },
          },
        )
        .exec();
    }

    const finalRunTasks = await this.orchestrationRunTaskModel.find({ runId }).sort({ order: 1 }).exec();
    const completedAt = new Date();
    const stats = this.computeRunStats(finalRunTasks as unknown as OrchestrationRunTask[]);
    const runStatus = this.deriveRunStatus(finalRunTasks as unknown as OrchestrationRunTask[]);

    await this.orchestrationRunModel
      .updateOne(
        { _id: runId },
        {
          $set: {
            status: runStatus,
            completedAt,
            durationMs: completedAt.getTime() - startedAt.getTime(),
            stats,
          },
        },
      )
      .exec();

    await this.orchestrationPlanModel
      .updateOne(
        { _id: planId },
        {
          $set: {
            lastRunId: runId,
          },
        },
      )
      .exec();

    if (options?.scheduleId) {
      await this.orchestrationScheduleModel
        .updateOne(
          { _id: options.scheduleId },
          {
            $set: {
              lastRun: {
                startedAt,
                completedAt,
                success: runStatus === 'completed',
                result: undefined,
                error: runStatus === 'failed' ? 'Run failed' : undefined,
                taskId: undefined,
                sessionId: undefined,
              },
            },
          },
        )
        .exec();
    }

    await this.planStatsService.setPlanStatus(planId, 'planned');
    await this.planStatsService.setPlanSessionStatus(planId, 'planned');
    await this.planStatsService.refreshPlanStats(planId);

    this.planEventStreamService.emitPlanStreamEvent(planId, runStatus === 'completed' ? 'run.completed' : 'run.failed', {
      planId,
      runId,
      status: runStatus,
      stats,
      completedAt,
    });

    if (requirementId && runStatus === 'completed') {
      await this.contextService.tryUpdateRequirementStatus(
        requirementId,
        'review',
        'orchestration plan passed auto review gate',
      );
      await this.contextService.tryUpdateRequirementStatus(requirementId, 'done', 'orchestration plan completed');
    }

    const latestRun = await this.orchestrationRunModel.findOne({ _id: runId }).exec();
    if (!latestRun) {
      throw new NotFoundException('Run not found');
    }
    return latestRun;
  }

  async cancelRun(
    runId: string,
    reason?: string,
  ): Promise<{ success: boolean; runId: string; status: 'cancelled'; cancelledTasks: number }> {
    const run = await this.orchestrationRunModel.findOne({ _id: runId }).exec();
    if (!run) {
      throw new NotFoundException('Run not found');
    }
    if (run.status !== 'running') {
      throw new BadRequestException(`Run in "${run.status}" status cannot be cancelled`);
    }

    const cancelReason = String(reason || '').trim() || '用户手动取消';
    const completedAt = new Date();
    const cancellableStatuses: Array<OrchestrationTask['status']> = ['pending', 'assigned', 'blocked', 'in_progress'];

    const cancelUpdateResult = await this.orchestrationRunTaskModel
      .updateMany(
        {
          runId,
          status: { $in: cancellableStatuses },
        },
        {
          $set: {
            status: 'cancelled',
            completedAt,
            result: {
              error: 'Run cancelled by user',
            },
          },
          $push: {
            runLogs: {
              timestamp: completedAt,
              level: 'warn',
              message: cancelReason,
            },
          },
        },
      )
      .exec();

    const runTasks = await this.orchestrationRunTaskModel.find({ runId }).sort({ order: 1 }).exec();
    const stats = this.computeRunStats(runTasks as unknown as OrchestrationRunTask[]);

    await this.orchestrationRunModel
      .updateOne(
        { _id: runId },
        {
          $set: {
            status: 'cancelled',
            completedAt,
            durationMs: completedAt.getTime() - new Date(run.startedAt).getTime(),
            error: cancelReason,
            stats,
          },
        },
      )
      .exec();

    await this.planStatsService.setPlanStatus(run.planId, 'planned');
    await this.planStatsService.setPlanSessionStatus(run.planId, 'planned');

    this.planEventStreamService.emitPlanStreamEvent(run.planId, 'run.cancelled', {
      planId: run.planId,
      runId,
      status: 'cancelled',
      reason: cancelReason,
      cancelledTasks: cancelUpdateResult.modifiedCount || 0,
      completedAt,
    });

    return {
      success: true,
      runId,
      status: 'cancelled',
      cancelledTasks: cancelUpdateResult.modifiedCount || 0,
    };
  }

  async listPlanRuns(planId: string, limit = 20): Promise<OrchestrationRun[]> {
    await this.assertPlanExists(planId);
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    return this.orchestrationRunModel
      .find({ planId })
      .sort({ startedAt: -1 })
      .limit(safeLimit)
      .exec();
  }

  async getLatestPlanRun(planId: string): Promise<OrchestrationRun | null> {
    await this.assertPlanExists(planId);
    return this.orchestrationRunModel
      .findOne({ planId })
      .sort({ startedAt: -1 })
      .exec();
  }

  async getRunById(runId: string): Promise<OrchestrationRun> {
    const run = await this.orchestrationRunModel.findOne({ _id: runId }).exec();
    if (!run) {
      throw new NotFoundException('Run not found');
    }
    return run;
  }

  async listRunTasks(runId: string): Promise<OrchestrationRunTask[]> {
    await this.getRunById(runId);
    return this.orchestrationRunTaskModel
      .find({ runId })
      .sort({ order: 1 })
      .exec();
  }

  private async assertPlanExists(planId: string): Promise<void> {
    const plan = await this.orchestrationPlanModel.findOne({ _id: planId }).select({ _id: 1 }).lean().exec();
    if (!plan) {
      throw new NotFoundException('Plan not found');
    }
  }

  private async executeRunTasks(
    plan: OrchestrationPlan,
    runId: string,
    options: { continueOnFailure: boolean },
  ): Promise<void> {
    let keepRunning = true;

    while (keepRunning) {
      const runSnapshot = await this.orchestrationRunModel.findOne({ _id: runId }).select({ status: 1 }).lean().exec();
      if (!runSnapshot || runSnapshot.status === 'cancelled') {
        break;
      }

      const runTasks = await this.orchestrationRunTaskModel
        .find({ runId })
        .sort({ order: 1 })
        .exec() as unknown as OrchestrationRunTask[];

      const completedSourceTaskIds = new Set(
        runTasks
          .filter((task) => task.status === 'completed')
          .map((task) => task.sourceTaskId)
          .filter(Boolean),
      );

      const runnableTasks = runTasks.filter((task) => {
        const statusAllowsRun = task.status === 'pending' || task.status === 'assigned';
        if (!statusAllowsRun) {
          return false;
        }
        return (task.dependencyTaskIds || []).every((dependencySourceTaskId) =>
          completedSourceTaskIds.has(dependencySourceTaskId),
        );
      });

      if (!runnableTasks.length) {
        break;
      }

      if (plan.strategy.mode === 'parallel') {
        const results = await Promise.all(
          runnableTasks.map((task) => this.executionEngineService.executeRunTaskNode(runId, task)),
        );
        if (!options.continueOnFailure && results.some((result: any) => result.status === 'failed')) {
          keepRunning = false;
        }
      } else {
        for (const task of runnableTasks) {
          const latestRun = await this.orchestrationRunModel.findOne({ _id: runId }).select({ status: 1 }).lean().exec();
          if (!latestRun || latestRun.status === 'cancelled') {
            keepRunning = false;
            break;
          }
          const result = await this.executionEngineService.executeRunTaskNode(runId, task);
          if (!options.continueOnFailure && result.status === 'failed') {
            keepRunning = false;
            break;
          }
        }
      }
    }
  }

  private computeRunStats(tasks: OrchestrationRunTask[]): {
    totalTasks: number;
    completedTasks: number;
    failedTasks: number;
    waitingHumanTasks: number;
  } {
    return {
      totalTasks: tasks.length,
      completedTasks: tasks.filter((task) => task.status === 'completed').length,
      failedTasks: tasks.filter((task) => task.status === 'failed').length,
      waitingHumanTasks: tasks.filter((task) => task.status === 'waiting_human').length,
    };
  }

  private deriveRunStatus(tasks: OrchestrationRunTask[]): 'running' | 'completed' | 'failed' | 'cancelled' {
    if (!tasks.length) {
      return 'failed';
    }
    if (tasks.every((task) => task.status === 'completed')) {
      return 'completed';
    }
    if (tasks.some((task) => task.status === 'failed')) {
      return 'failed';
    }

    if (tasks.some((task) => task.status === 'in_progress')) {
      return 'running';
    }
    if (tasks.some((task) => task.status === 'waiting_human')) {
      return 'running';
    }

    if (tasks.some((task) => task.status === 'pending' || task.status === 'assigned' || task.status === 'blocked')) {
      return 'running';
    }

    if (tasks.some((task) => task.status === 'cancelled')) {
      return 'cancelled';
    }

    return 'failed';
  }

  private getEntityId(entity: Record<string, any>): string {
    if (entity.id) {
      return String(entity.id);
    }
    if (entity._id) {
      if (typeof entity._id === 'string') {
        return entity._id;
      }
      if (typeof entity._id.toString === 'function') {
        return entity._id.toString();
      }
    }
    return '';
  }
}
