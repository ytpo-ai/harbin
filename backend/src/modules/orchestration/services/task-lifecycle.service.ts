import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  CompleteHumanTaskDto,
  DebugTaskStepDto,
  ReassignTaskDto,
} from '../dto';
import {
  OrchestrationTask,
  OrchestrationTaskDocument,
  OrchestrationTaskStatus,
} from '../../../shared/schemas/orchestration-task.schema';
import {
  OrchestrationRun,
  OrchestrationRunDocument,
  OrchestrationRunStatus,
} from '../../../shared/schemas/orchestration-run.schema';
import {
  OrchestrationPlan,
  OrchestrationPlanDocument,
} from '../../../shared/schemas/orchestration-plan.schema';
import {
  OrchestrationRunTask,
  OrchestrationRunTaskDocument,
} from '../../../shared/schemas/orchestration-run-task.schema';
import { Agent, AgentDocument } from '@agent/schemas/agent.schema';
import {
  Employee,
  EmployeeDocument,
} from '../../../shared/schemas/employee.schema';
import {
  AgentRoleTier,
  canDelegateAcrossTier,
  normalizeAgentRoleTier,
} from '../../../shared/role-tier';
import { PlanExecutionService } from './plan-execution.service';
import { PlanStatsService } from './plan-stats.service';
import { PlanEventStreamService } from './plan-event-stream.service';
import { TaskManagementService } from './task-management.service';
import { OrchestrationContextService } from './orchestration-context.service';
import { OrchestrationExecutionEngineService } from './orchestration-execution-engine.service';

@Injectable()
export class TaskLifecycleService {
  constructor(
    @InjectModel(OrchestrationTask.name)
    private readonly orchestrationTaskModel: Model<OrchestrationTaskDocument>,
    @InjectModel(OrchestrationRunTask.name)
    private readonly orchestrationRunTaskModel: Model<OrchestrationRunTaskDocument>,
    @InjectModel(OrchestrationRun.name)
    private readonly orchestrationRunModel: Model<OrchestrationRunDocument>,
    @InjectModel(OrchestrationPlan.name)
    private readonly orchestrationPlanModel: Model<OrchestrationPlanDocument>,
    @InjectModel(Agent.name)
    private readonly agentModel: Model<AgentDocument>,
    @InjectModel(Employee.name)
    private readonly employeeModel: Model<EmployeeDocument>,
    private readonly planExecutionService: PlanExecutionService,
    private readonly planStatsService: PlanStatsService,
    private readonly planEventStreamService: PlanEventStreamService,
    private readonly taskManagementService: TaskManagementService,
    private readonly contextService: OrchestrationContextService,
    private readonly executionEngineService: OrchestrationExecutionEngineService,
  ) {}

  async reassignTask(taskId: string, dto: ReassignTaskDto): Promise<OrchestrationTask> {
    const task = await this.orchestrationTaskModel.findOne({ _id: taskId }).exec();
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    await this.assertTaskPlanEditable(task, 'reassign');

    const normalizedExecutorId = dto.executorId?.trim() || undefined;
    const requiresExplicitExecutor = dto.executorType !== 'unassigned';
    const hasExplicitExecutor = Boolean(normalizedExecutorId);

    if (dto.sourceAgentId && requiresExplicitExecutor && hasExplicitExecutor) {
      const sourceTier = await this.resolveAgentTierById(dto.sourceAgentId);
      if (!sourceTier) {
        throw this.buildTierGuardException('tier_resolution_required', 'Cannot resolve source agent tier', {
          sourceAgentId: dto.sourceAgentId,
        });
      }

      const targetTier = await this.resolveAssignmentTargetTier(dto.executorType, normalizedExecutorId);
      if (!targetTier) {
        throw this.buildTierGuardException('tier_resolution_required', 'Cannot resolve assignment target tier', {
          executorType: dto.executorType,
          executorId: normalizedExecutorId,
        });
      }

      if (!canDelegateAcrossTier(sourceTier, targetTier)) {
        throw this.buildTierGuardException(
          'delegation_direction_forbidden',
          'Delegation direction is not allowed by tier governance',
          {
            sourceAgentId: dto.sourceAgentId,
            sourceTier,
            targetTier,
            executorType: dto.executorType,
            executorId: normalizedExecutorId,
          },
        );
      }
    }

    const nextStatus = requiresExplicitExecutor && hasExplicitExecutor ? 'assigned' : 'pending';
    const nextExecutorId = dto.executorType === 'unassigned' ? undefined : normalizedExecutorId;

    const updated = await this.orchestrationTaskModel
      .findOneAndUpdate(
        { _id: taskId },
        {
          $set: {
            assignment: {
              executorType: dto.executorType,
              executorId: nextExecutorId,
              reason: dto.reason,
            },
            status: nextStatus,
          },
          $push: {
            runLogs: {
              timestamp: new Date(),
              level: 'info',
              message: 'Task reassigned',
              metadata: {
                executorType: dto.executorType,
                executorId: nextExecutorId,
                reason: dto.reason,
                sourceAgentId: dto.sourceAgentId,
              },
            },
          },
        },
        { new: true },
      )
      .exec();
    if (!updated) {
      throw new NotFoundException('Task not found');
    }

    const planId = task.planId;
    if (planId) {
      await this.planStatsService.updatePlanSessionTask(planId, taskId, {
        status: updated.status,
        executorType: dto.executorType,
        executorId: nextExecutorId,
      });
    }

    this.planEventStreamService.emitTaskLifecycleEvent(taskId, 'task.status.changed', {
      planId,
      status: updated.status,
      taskTitle: updated.title,
      previousStatus: task.status,
      assignment: updated.assignment,
      reason: dto.reason,
    });

    return updated;
  }

  async completeHumanTask(taskId: string, dto: CompleteHumanTaskDto): Promise<any> {
    const runTask = await this.orchestrationRunTaskModel.findOne({ _id: taskId }).exec();
    if (runTask) {
      if (runTask.assignment.executorType !== 'employee') {
        throw new BadRequestException('Only employee tasks can be completed manually');
      }

      const updatedRunTask = await this.orchestrationRunTaskModel
        .findOneAndUpdate(
          { _id: taskId },
          {
            $set: {
              status: 'completed',
              completedAt: new Date(),
              result: {
                summary: dto.summary || 'Completed by human assignee',
                output: dto.output,
              },
            },
            $push: {
              runLogs: {
                timestamp: new Date(),
                level: 'info',
                message: 'Human run task marked as completed',
              },
            },
          },
          { new: true },
        )
        .exec();

      if (!updatedRunTask) {
        throw new NotFoundException('Task not found');
      }

      const runId = updatedRunTask.runId;
      const runTasks = await this.orchestrationRunTaskModel.find({ runId }).exec() as unknown as OrchestrationRunTask[];
      const stats = this.computeRunStats(runTasks);
      const status = this.deriveRunStatus(runTasks);
      await this.orchestrationRunModel
        .updateOne(
          { _id: runId },
          {
            $set: {
              stats,
              status,
              ...(status === 'completed' || status === 'failed' ? { completedAt: new Date() } : {}),
            },
          },
        )
        .exec();

      this.planEventStreamService.emitPlanStreamEvent(updatedRunTask.planId, 'run.task.completed', {
        runId,
        runTaskId: taskId,
      });

      return updatedRunTask;
    }

    const task = await this.orchestrationTaskModel.findOne({ _id: taskId }).exec();
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    await this.assertTaskPlanEditable(task, 'complete-human');
    if (task.assignment.executorType !== 'employee') {
      throw new BadRequestException('Only employee tasks can be completed manually');
    }

    const updated = await this.orchestrationTaskModel
      .findOneAndUpdate(
        { _id: taskId },
        {
          $set: {
            status: 'completed',
            completedAt: new Date(),
            result: {
              summary: dto.summary || 'Completed by human assignee',
              output: dto.output,
            },
          },
          $push: {
            runLogs: {
              timestamp: new Date(),
              level: 'info',
              message: 'Human task marked as completed',
            },
          },
        },
        { new: true },
      )
      .exec();
    if (!updated) {
      throw new NotFoundException('Task not found');
    }

    const planId = task.planId;
    if (planId) {
      await this.planStatsService.updatePlanSessionTask(planId, taskId, {
        status: 'completed',
        output: dto.output || dto.summary || 'Completed by human assignee',
        error: undefined,
      });
      await this.planStatsService.refreshPlanStats(planId);
    }

    this.planEventStreamService.emitTaskLifecycleEvent(taskId, 'task.status.changed', {
      planId,
      status: 'completed',
      taskTitle: updated.title,
      previousStatus: task.status,
    });

    this.planEventStreamService.emitTaskLifecycleEvent(taskId, 'task.completed', {
      planId,
      status: 'completed',
      taskTitle: updated.title,
      completedBy: 'human',
    });

    return updated;
  }

  async retryTask(
    taskId: string,
  ): Promise<{ task: any; run: { accepted: boolean; planId: string; status: string; alreadyRunning?: boolean } }> {
    const runTask = await this.orchestrationRunTaskModel.findOne({ _id: taskId }).exec();
    if (runTask) {
      if (runTask.status !== 'failed') {
        throw new BadRequestException('Only failed tasks can be retried');
      }

      const nextStatus = runTask.assignment?.executorType === 'unassigned' ? 'pending' : 'assigned';

      const updatedRunTask = await this.orchestrationRunTaskModel
        .findOneAndUpdate(
          { _id: taskId },
          {
            $set: {
              status: nextStatus,
            },
            $unset: {
              startedAt: 1,
              completedAt: 1,
              result: 1,
            },
            $push: {
              runLogs: {
                timestamp: new Date(),
                level: 'info',
                message: 'Run task retried manually',
              },
            },
          },
          { new: true },
        )
        .exec();

      if (!updatedRunTask) {
        throw new NotFoundException('Task not found');
      }

      await this.executionEngineService.executeRunTaskNode(
        updatedRunTask.runId,
        updatedRunTask as unknown as OrchestrationRunTask,
      );

      const runTasks = await this.orchestrationRunTaskModel
        .find({ runId: updatedRunTask.runId })
        .exec() as unknown as OrchestrationRunTask[];
      const stats = this.computeRunStats(runTasks);
      const status = this.deriveRunStatus(runTasks);
      await this.orchestrationRunModel
        .updateOne(
          { _id: updatedRunTask.runId },
          {
            $set: {
              stats,
              status,
              ...(status === 'completed' || status === 'failed' ? { completedAt: new Date() } : {}),
            },
          },
        )
        .exec();

      const refreshed = await this.orchestrationRunTaskModel.findOne({ _id: taskId }).exec();
      return {
        task: refreshed,
        run: {
          accepted: true,
          planId: updatedRunTask.planId,
          status: 'accepted',
        },
      };
    }

    const task = await this.orchestrationTaskModel.findOne({ _id: taskId }).exec();
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    await this.assertTaskPlanEditable(task, 'retry');
    if (task.status !== 'failed') {
      throw new BadRequestException('Only failed tasks can be retried');
    }
    const planId = this.requirePlanId(task);

    const nextStatus = task.assignment?.executorType === 'unassigned' ? 'pending' : 'assigned';

    const updatedTask = await this.orchestrationTaskModel
      .findOneAndUpdate(
        { _id: taskId },
        {
          $set: {
            status: nextStatus,
          },
          $unset: {
            startedAt: 1,
            completedAt: 1,
            result: 1,
          },
          $push: {
            runLogs: {
              timestamp: new Date(),
              level: 'info',
              message: 'Task retried manually',
            },
          },
        },
        { new: true },
      )
      .exec();

    if (!updatedTask) {
      throw new NotFoundException('Task not found');
    }

    await this.planStatsService.updatePlanSessionTask(planId, taskId, {
      status: nextStatus,
      output: undefined,
      error: undefined,
    });

    await this.planStatsService.refreshPlanStats(planId);
    this.planEventStreamService.emitTaskLifecycleEvent(taskId, 'task.status.changed', {
      planId,
      status: nextStatus,
      taskTitle: updatedTask.title,
      previousStatus: task.status,
      reason: 'manual_retry',
    });

    const run = await this.planExecutionService.runPlanAsync(planId, { continueOnFailure: true });

    return {
      task: updatedTask,
      run,
    };
  }

  async debugTaskStep(
    taskId: string,
    dto: DebugTaskStepDto,
  ): Promise<{ task: OrchestrationTask; execution: { status: OrchestrationTaskStatus; result?: string; error?: string } }> {
    const task = await this.orchestrationTaskModel.findOne({ _id: taskId }).exec();
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    await this.assertTaskPlanEditable(task, 'debug');
    const planId = this.requirePlanId(task);
    if (task.status === 'in_progress') {
      throw new BadRequestException('Task is already running');
    }

    const dependencyTasks = await this.orchestrationTaskModel
      .find({ _id: { $in: task.dependencyTaskIds || [] }, planId })
      .select({ _id: 1, status: 1, title: 1 })
      .exec();
    const unmetDependencies = dependencyTasks.filter((dep) => dep.status !== 'completed');
    if (unmetDependencies.length) {
      const names = unmetDependencies.map((dep) => dep.title).join(', ');
      throw new BadRequestException(`Cannot debug step before dependencies are completed: ${names}`);
    }

    const shouldUpdateDraft = dto.title !== undefined || dto.description !== undefined;
    if (shouldUpdateDraft) {
      await this.taskManagementService.updateTaskDraft(taskId, dto);
    }

    const normalizedRuntimeTaskType = this.contextService.normalizeRuntimeTaskTypeOverride(dto.runtimeTaskTypeOverride);
    if (dto.runtimeTaskTypeOverride !== undefined) {
      await this.orchestrationTaskModel
        .updateOne(
          { _id: taskId },
          normalizedRuntimeTaskType
            ? { $set: { runtimeTaskType: normalizedRuntimeTaskType } }
            : { $unset: { runtimeTaskType: 1 } },
        )
        .exec();
    }

    const nextStatus = task.assignment?.executorType === 'unassigned' ? 'pending' : 'assigned';
    await this.orchestrationTaskModel
      .updateOne(
        { _id: taskId },
        {
          $set: {
            status: nextStatus,
          },
          ...(dto.resetResult === false
            ? {}
            : {
                $unset: {
                  startedAt: 1,
                  completedAt: 1,
                  result: 1,
                },
              }),
          $push: {
            runLogs: {
              timestamp: new Date(),
              level: 'info',
              message: 'Step debug run requested',
            },
          },
        },
      )
      .exec();

    const refreshedTask = await this.orchestrationTaskModel.findOne({ _id: taskId }).exec();
    if (!refreshedTask) {
      throw new NotFoundException('Task not found');
    }

    const debugRunId = `debug-${Date.now()}`;
    const execution = await this.executionEngineService.executeTaskNode(planId, refreshedTask, {
      orchestrationRunId: debugRunId,
      runtimeTaskTypeOverride: dto.runtimeTaskTypeOverride,
    });

    await this.planStatsService.refreshPlanStats(planId);
    const allTasks = await this.orchestrationTaskModel.find({ planId }).exec();
    const nextPlanStatus = this.derivePlanStatus(allTasks as unknown as OrchestrationTask[]);
    await this.planStatsService.setPlanStatus(planId, nextPlanStatus);
    await this.planStatsService.setPlanSessionStatus(planId, nextPlanStatus);

    const latestTask = await this.orchestrationTaskModel.findOne({ _id: taskId }).exec();
    if (!latestTask) {
      throw new NotFoundException('Task not found');
    }

    return {
      task: latestTask,
      execution,
    };
  }

  async executeStandaloneTask(
    taskId: string,
  ): Promise<{ status: OrchestrationTaskStatus; result?: string; error?: string }> {
    const task = await this.orchestrationTaskModel.findOne({ _id: taskId }).exec();
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    const scopeId = task.planId || '';
    return this.executionEngineService.executeTaskNode(scopeId, task);
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

  private deriveRunStatus(tasks: OrchestrationRunTask[]): OrchestrationRunStatus {
    if (!tasks.length) {
      return 'failed';
    }
    if (tasks.every((task) => task.status === 'completed')) {
      return 'completed';
    }
    const hasFailed = tasks.some((task) => task.status === 'failed');
    if (hasFailed) {
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

    return 'failed';
  }

  private derivePlanStatus(tasks: OrchestrationTask[]): 'draft' | 'planned' {
    if (!tasks.length) {
      return 'draft';
    }
    return 'planned';
  }

  private requirePlanId(task: OrchestrationTask): string {
    if (!task.planId) {
      throw new BadRequestException('Task is not associated with orchestration plan');
    }
    return task.planId;
  }

  private async assertTaskPlanEditable(task: OrchestrationTask, action: string): Promise<void> {
    const planId = String(task.planId || '').trim();
    if (!planId) {
      return;
    }
    const plan = await this.orchestrationPlanModel.findOne({ _id: planId }).lean().exec();
    if (!plan) {
      throw new NotFoundException('Plan not found');
    }
    const normalizedStatus = this.planStatsService.normalizePlanStatus(plan.status, plan.taskIds?.length);
    if (normalizedStatus === 'draft' || normalizedStatus === 'planned' || normalizedStatus === 'drafting') {
      return;
    }
    throw new BadRequestException(`Plan in "${normalizedStatus}" status cannot ${action}`);
  }

  private buildTierGuardException(
    code: string,
    message: string,
    detail: Record<string, unknown>,
  ): BadRequestException {
    return new BadRequestException({
      code,
      message,
      detail,
    });
  }

  private async resolveAgentTierById(agentId?: string): Promise<AgentRoleTier | undefined> {
    const normalizedAgentId = String(agentId || '').trim();
    if (!normalizedAgentId) {
      return undefined;
    }

    const lookup: Record<string, unknown> = { id: normalizedAgentId };
    if (Types.ObjectId.isValid(normalizedAgentId)) {
      lookup.$or = [{ id: normalizedAgentId }, { _id: new Types.ObjectId(normalizedAgentId) }];
      delete lookup.id;
    }

    const agent = await this.agentModel.findOne(lookup).select({ tier: 1 }).lean().exec();
    return normalizeAgentRoleTier((agent as any)?.tier);
  }

  private async resolveEmployeeTierById(employeeId?: string): Promise<AgentRoleTier | undefined> {
    const normalizedEmployeeId = String(employeeId || '').trim();
    if (!normalizedEmployeeId) {
      return undefined;
    }
    const employee = await this.employeeModel.findOne({ id: normalizedEmployeeId }).select({ tier: 1 }).lean().exec();
    return normalizeAgentRoleTier((employee as any)?.tier);
  }

  private async resolveAssignmentTargetTier(
    executorType: 'agent' | 'employee' | 'unassigned',
    executorId?: string,
  ): Promise<AgentRoleTier | undefined> {
    if (executorType === 'agent') {
      return this.resolveAgentTierById(executorId);
    }
    if (executorType === 'employee') {
      return this.resolveEmployeeTierById(executorId);
    }
    return undefined;
  }
}
