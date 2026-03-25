import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  AddTaskToPlanDto,
  BatchUpdateTaskItemDto,
  BatchUpdateTasksDto,
  ReorderPlanTasksDto,
  UpdateTaskDraftDto,
  UpdateTaskFullDto,
} from '../dto';
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
  OrchestrationRun,
  OrchestrationRunDocument,
} from '../../../shared/schemas/orchestration-run.schema';
import { PlanStatsService } from './plan-stats.service';
import { PlanEventStreamService } from './plan-event-stream.service';
import { OrchestrationContextService } from './orchestration-context.service';

@Injectable()
export class TaskManagementService {
  constructor(
    @InjectModel(OrchestrationTask.name)
    private readonly orchestrationTaskModel: Model<OrchestrationTaskDocument>,
    @InjectModel(OrchestrationPlan.name)
    private readonly orchestrationPlanModel: Model<OrchestrationPlanDocument>,
    @InjectModel(OrchestrationRun.name)
    private readonly orchestrationRunModel: Model<OrchestrationRunDocument>,
    private readonly planStatsService: PlanStatsService,
    private readonly planEventStreamService: PlanEventStreamService,
    private readonly contextService: OrchestrationContextService,
  ) {}

  async listTasksByPlan(planId: string): Promise<OrchestrationTask[]> {
    return this.orchestrationTaskModel
      .find({ planId })
      .sort({ order: 1 })
      .exec();
  }

  async addTaskToPlan(planId: string, dto: AddTaskToPlanDto): Promise<OrchestrationTask> {
    const plan = await this.orchestrationPlanModel.findOne({ _id: planId }).exec();
    if (!plan) {
      throw new NotFoundException('Plan not found');
    }
    await this.assertPlanEditable(plan);

    const title = String(dto.title || '').trim();
    const description = String(dto.description || '').trim();
    if (!title || !description) {
      throw new BadRequestException('title and description are required');
    }

    const assignment = this.normalizeAssignment(dto.assignment);
    const dependencyTaskIds = this.normalizeDependencyTaskIds(dto.dependencyTaskIds);
    if (dependencyTaskIds.length) {
      await this.assertTaskIdsBelongToPlan(planId, dependencyTaskIds);
    }

    const tasks = await this.listTasksByPlan(planId);
    let insertIndex = tasks.length;
    const insertAfterTaskId = String(dto.insertAfterTaskId || '').trim();
    if (insertAfterTaskId) {
      const targetIndex = tasks.findIndex((item) => this.getEntityId(item as any) === insertAfterTaskId);
      if (targetIndex < 0) {
        throw new BadRequestException('insertAfterTaskId does not belong to current plan');
      }
      insertIndex = targetIndex + 1;
      await this.orchestrationTaskModel
        .updateMany({ planId, order: { $gte: insertIndex } }, { $inc: { order: 1 } })
        .exec();
    }

    const createdTask = await new this.orchestrationTaskModel({
      planId,
      title,
      description,
      priority: dto.priority || 'medium',
      status: this.resolveTaskStatusByAssignment(assignment),
      order: insertIndex,
      dependencyTaskIds,
      assignment,
      runLogs: [
        {
          timestamp: new Date(),
          level: 'info',
          message: 'Task added manually',
          metadata: {
            insertAfterTaskId: insertAfterTaskId || undefined,
          },
        },
      ],
    }).save();

    const nextTaskIds = tasks.map((item) => this.getEntityId(item as any));
    nextTaskIds.splice(insertIndex, 0, createdTask._id.toString());

    await this.orchestrationPlanModel
      .updateOne(
        { _id: planId },
        {
          $set: {
            taskIds: nextTaskIds,
          },
        },
      )
      .exec();

    await this.planStatsService.refreshPlanStats(planId);
    await this.planStatsService.syncPlanSessionTasks(planId);

    this.planEventStreamService.emitPlanStreamEvent(planId, 'plan.task.added', {
      planId,
      task: createdTask.toObject(),
    });

    this.planEventStreamService.emitTaskLifecycleEvent(this.getEntityId(createdTask as any), 'task.created', {
      planId,
      status: createdTask.status,
      taskTitle: createdTask.title,
      assignment: createdTask.assignment,
    });

    return createdTask;
  }

  async removeTaskFromPlan(taskId: string): Promise<{ success: boolean }> {
    const task = await this.orchestrationTaskModel.findOne({ _id: taskId }).exec();
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    const planId = this.requirePlanId(task);

    const plan = await this.orchestrationPlanModel.findOne({ _id: planId }).exec();
    if (!plan) {
      throw new NotFoundException('Plan not found');
    }
    await this.assertPlanEditable(plan, task);

    if (task.status === 'in_progress' || task.status === 'completed' || task.status === 'waiting_human') {
      throw new BadRequestException(`Task in "${task.status}" status cannot be deleted`);
    }

    await this.orchestrationTaskModel
      .updateMany({ planId, dependencyTaskIds: taskId }, { $pull: { dependencyTaskIds: taskId } })
      .exec();

    await this.orchestrationTaskModel.deleteOne({ _id: taskId }).exec();

    const remainingTasks = await this.listTasksByPlan(planId);
    if (remainingTasks.length) {
      await this.orchestrationTaskModel
        .bulkWrite(
          remainingTasks.map((item, index) => ({
            updateOne: {
              filter: { _id: this.getEntityId(item as any) },
              update: { $set: { order: index } },
            },
          })),
        );
    }

    await this.orchestrationPlanModel
      .updateOne(
        { _id: planId },
        {
          $set: {
            taskIds: remainingTasks.map((item) => this.getEntityId(item as any)),
          },
        },
      )
      .exec();

    await this.planStatsService.refreshPlanStats(planId);
    await this.planStatsService.syncPlanSessionTasks(planId);

    this.planEventStreamService.emitPlanStreamEvent(planId, 'plan.task.removed', {
      planId,
      taskId,
    });

    return { success: true };
  }

  async updateTaskFull(taskId: string, dto: UpdateTaskFullDto): Promise<OrchestrationTask> {
    return this.updateTaskFullInternal(taskId, dto, {
      emitPlanEvent: true,
      emitTaskLogMessage: 'Task updated manually',
    });
  }

  async reorderPlanTasks(planId: string, dto: ReorderPlanTasksDto): Promise<{ success: boolean }> {
    const plan = await this.orchestrationPlanModel.findOne({ _id: planId }).exec();
    if (!plan) {
      throw new NotFoundException('Plan not found');
    }
    await this.assertPlanEditable(plan);

    const nextTaskIds = this.normalizeTaskIdList(dto.taskIds);
    const tasks = await this.listTasksByPlan(planId);
    const currentTaskIds = tasks.map((task) => this.getEntityId(task as any));
    const currentSet = new Set(currentTaskIds);

    if (nextTaskIds.length !== currentTaskIds.length) {
      throw new BadRequestException('taskIds length mismatch');
    }
    for (const taskId of nextTaskIds) {
      if (!currentSet.has(taskId)) {
        throw new BadRequestException('taskIds must contain exactly tasks from current plan');
      }
    }

    const orderByTaskId = new Map<string, number>();
    nextTaskIds.forEach((item, index) => {
      orderByTaskId.set(item, index);
    });

    if (tasks.length) {
      await this.orchestrationTaskModel
        .bulkWrite(
          tasks.map((task) => ({
            updateOne: {
              filter: { _id: this.getEntityId(task as any) },
              update: { $set: { order: orderByTaskId.get(this.getEntityId(task as any)) || 0 } },
            },
          })),
        );
    }

    await this.orchestrationPlanModel
      .updateOne(
        { _id: planId },
        {
          $set: {
            taskIds: nextTaskIds,
          },
        },
      )
      .exec();

    await this.planStatsService.syncPlanSessionTasks(planId);

    this.planEventStreamService.emitPlanStreamEvent(planId, 'plan.tasks.reordered', {
      planId,
      taskIds: nextTaskIds,
    });

    return { success: true };
  }

  async batchUpdateTasks(planId: string, dto: BatchUpdateTasksDto): Promise<OrchestrationTask[]> {
    const plan = await this.orchestrationPlanModel.findOne({ _id: planId }).exec();
    if (!plan) {
      throw new NotFoundException('Plan not found');
    }
    await this.assertPlanEditable(plan);

    const updates = Array.isArray(dto.updates) ? dto.updates : [];
    if (!updates.length) {
      throw new BadRequestException('updates is required');
    }

    const updateTaskIds = this.normalizeTaskIdList(updates.map((item) => item.taskId));
    await this.assertTaskIdsBelongToPlan(planId, updateTaskIds);

    const updatedTasks: OrchestrationTask[] = [];
    for (const item of updates) {
      const updated = await this.updateTaskFullInternal(item.taskId, item, {
        emitPlanEvent: false,
        emitTaskLogMessage: 'Task updated in batch',
      });
      updatedTasks.push(updated);
    }

    await this.planStatsService.refreshPlanStats(planId);
    await this.planStatsService.syncPlanSessionTasks(planId);

    this.planEventStreamService.emitPlanStreamEvent(planId, 'plan.tasks.batch-updated', {
      planId,
      taskIds: updatedTasks.map((task) => this.getEntityId(task as any)),
      totalUpdated: updatedTasks.length,
    });

    return updatedTasks;
  }

  async duplicateTask(planId: string, sourceTaskId: string): Promise<OrchestrationTask> {
    const plan = await this.orchestrationPlanModel.findOne({ _id: planId }).exec();
    if (!plan) {
      throw new NotFoundException('Plan not found');
    }
    await this.assertPlanEditable(plan);

    const sourceTask = await this.orchestrationTaskModel
      .findOne({ _id: sourceTaskId, planId })
      .exec();
    if (!sourceTask) {
      throw new NotFoundException('Source task not found');
    }

    const insertOrder = sourceTask.order + 1;
    await this.orchestrationTaskModel
      .updateMany({ planId, order: { $gte: insertOrder } }, { $inc: { order: 1 } })
      .exec();

    let assignment: { executorType: 'agent' | 'employee' | 'unassigned'; executorId?: string; reason?: string };
    try {
      assignment = this.normalizeAssignment(sourceTask.assignment);
    } catch {
      assignment = { executorType: 'unassigned' };
    }
    const duplicatedTask = await new this.orchestrationTaskModel({
      planId,
      title: `${sourceTask.title} (副本)`,
      description: sourceTask.description,
      priority: sourceTask.priority || 'medium',
      status: this.resolveTaskStatusByAssignment(assignment),
      order: insertOrder,
      dependencyTaskIds: [],
      assignment,
      runLogs: [
        {
          timestamp: new Date(),
          level: 'info',
          message: 'Task duplicated manually',
          metadata: {
            sourceTaskId,
          },
        },
      ],
    }).save();

    const tasks = await this.listTasksByPlan(planId);
    await this.orchestrationPlanModel
      .updateOne(
        { _id: planId },
        {
          $set: {
            taskIds: tasks.map((task) => this.getEntityId(task as any)),
          },
        },
      )
      .exec();

    await this.planStatsService.refreshPlanStats(planId);
    await this.planStatsService.syncPlanSessionTasks(planId);

    this.planEventStreamService.emitPlanStreamEvent(planId, 'plan.task.added', {
      planId,
      sourceTaskId,
      task: duplicatedTask.toObject(),
    });

    this.planEventStreamService.emitTaskLifecycleEvent(this.getEntityId(duplicatedTask as any), 'task.created', {
      planId,
      status: duplicatedTask.status,
      taskTitle: duplicatedTask.title,
      sourceTaskId,
      assignment: duplicatedTask.assignment,
    });

    return duplicatedTask;
  }

  async updateTaskDraft(taskId: string, dto: UpdateTaskDraftDto): Promise<OrchestrationTask> {
    return this.updateTaskFullInternal(taskId, dto, {
      emitPlanEvent: false,
      emitTaskLogMessage: 'Task draft updated for step debugging',
    });
  }

  private async updateTaskFullInternal(
    taskId: string,
    dto: UpdateTaskFullDto | BatchUpdateTaskItemDto,
    options: {
      emitPlanEvent: boolean;
      emitTaskLogMessage: string;
    },
  ): Promise<OrchestrationTask> {
    const task = await this.orchestrationTaskModel.findOne({ _id: taskId }).exec();
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    const planId = this.requirePlanId(task);
    const plan = await this.orchestrationPlanModel.findOne({ _id: planId }).exec();
    if (!plan) {
      throw new NotFoundException('Plan not found');
    }
    await this.assertPlanEditable(plan, task);

    const normalizedRuntimeTaskType = this.contextService.normalizeRuntimeTaskTypeOverride((dto as any).runtimeTaskType);
    if (task.status === 'in_progress') {
      throw new BadRequestException(`Task in "${task.status}" status cannot be edited`);
    }

    const setPayload: Record<string, any> = {};
    const normalizedTitle = dto.title === undefined ? undefined : String(dto.title || '').trim();
    const normalizedDescription = dto.description === undefined ? undefined : String(dto.description || '').trim();

    if (normalizedTitle !== undefined) {
      if (!normalizedTitle) {
        throw new BadRequestException('title cannot be empty');
      }
      setPayload.title = normalizedTitle;
    }
    if (normalizedDescription !== undefined) {
      if (!normalizedDescription) {
        throw new BadRequestException('description cannot be empty');
      }
      setPayload.description = normalizedDescription;
    }
    if ((dto as any).runtimeTaskType !== undefined) {
      if ((dto as any).runtimeTaskType === 'auto') {
        setPayload.runtimeTaskType = undefined;
      } else {
        setPayload.runtimeTaskType = normalizedRuntimeTaskType;
      }
    }
    if (dto.priority !== undefined) {
      setPayload.priority = dto.priority;
    }

    if (dto.assignment !== undefined) {
      const assignment = this.normalizeAssignment(dto.assignment);
      setPayload.assignment = assignment;
      setPayload.status = this.resolveTaskStatusByAssignment(assignment, task.status);
    }

    if (dto.dependencyTaskIds !== undefined) {
      const dependencyTaskIds = this.normalizeDependencyTaskIds(dto.dependencyTaskIds);
      if (dependencyTaskIds.includes(taskId)) {
        throw new BadRequestException('Task cannot depend on itself');
      }
      await this.assertTaskIdsBelongToPlan(planId, dependencyTaskIds);
      await this.assertNoDependencyCycle(planId, taskId, dependencyTaskIds);
      setPayload.dependencyTaskIds = dependencyTaskIds;
    }

    if (!Object.keys(setPayload).length) {
      throw new BadRequestException('At least one updatable field is required');
    }

    const unsetPayload: Record<string, any> = {};
    if ((dto as any).runtimeTaskType === 'auto') {
      delete setPayload.runtimeTaskType;
      unsetPayload.runtimeTaskType = 1;
    }

    const updated = await this.orchestrationTaskModel
      .findOneAndUpdate(
        { _id: taskId },
        {
          ...(Object.keys(setPayload).length ? { $set: setPayload } : {}),
          ...(Object.keys(unsetPayload).length ? { $unset: unsetPayload } : {}),
          $push: {
            runLogs: {
              timestamp: new Date(),
              level: 'info',
              message: options.emitTaskLogMessage,
            },
          },
        },
        { new: true },
      )
      .exec();

    if (!updated) {
      throw new NotFoundException('Task not found');
    }

    await this.planStatsService.updatePlanSessionTask(planId, taskId, {
      input: updated.description,
      status: updated.status,
      executorType: updated.assignment?.executorType,
      executorId: updated.assignment?.executorId,
    });

    if (options.emitPlanEvent) {
      this.planEventStreamService.emitPlanStreamEvent(planId, 'plan.task.updated', {
        planId,
        task: updated.toObject(),
      });
    }

    return updated;
  }

  private requirePlanId(task: OrchestrationTask): string {
    if (!task.planId) {
      throw new BadRequestException('Task is not associated with orchestration plan');
    }
    return task.planId;
  }

  private async assertPlanEditable(
    plan: OrchestrationPlan,
    _task?: OrchestrationTask,
  ): Promise<'full'> {
    const planId = this.getEntityId(plan as any);
    if (planId && await this.isPlanRunActive(planId)) {
      throw new BadRequestException('Plan is running and cannot be edited');
    }

    return 'full';
  }

  private normalizeTaskIdList(taskIds?: string[]): string[] {
    if (!Array.isArray(taskIds)) {
      return [];
    }
    const next: string[] = [];
    for (const item of taskIds) {
      const value = String(item || '').trim();
      if (!value) {
        continue;
      }
      if (!next.includes(value)) {
        next.push(value);
      }
    }
    return next;
  }

  private normalizeDependencyTaskIds(taskIds?: string[]): string[] {
    return this.normalizeTaskIdList(taskIds);
  }

  private normalizeAssignment(
    assignment?: {
      executorType?: 'agent' | 'employee' | 'unassigned';
      executorId?: string;
      reason?: string;
    },
  ): { executorType: 'agent' | 'employee' | 'unassigned'; executorId?: string; reason?: string } {
    const executorType = assignment?.executorType || 'unassigned';
    const executorId = String(assignment?.executorId || '').trim() || undefined;
    const reason = String(assignment?.reason || '').trim() || undefined;

    if (executorType === 'unassigned') {
      return {
        executorType,
        ...(reason ? { reason } : {}),
      };
    }

    if (!executorId) {
      throw new BadRequestException('executorId is required when executorType is agent or employee');
    }

    return {
      executorType,
      executorId,
      ...(reason ? { reason } : {}),
    };
  }

  private resolveTaskStatusByAssignment(
    assignment: { executorType: 'agent' | 'employee' | 'unassigned'; executorId?: string },
    fallbackStatus: OrchestrationTaskStatus = 'pending',
  ): OrchestrationTaskStatus {
    if (assignment.executorType === 'unassigned') {
      return 'pending';
    }
    if (!assignment.executorId) {
      return 'pending';
    }
    if (fallbackStatus === 'failed' || fallbackStatus === 'cancelled') {
      return fallbackStatus;
    }
    return 'assigned';
  }

  private async assertTaskIdsBelongToPlan(planId: string, taskIds: string[]): Promise<void> {
    if (!taskIds.length) {
      return;
    }
    const count = await this.orchestrationTaskModel
      .countDocuments({
        planId,
        _id: { $in: taskIds },
      })
      .exec();
    if (count !== taskIds.length) {
      throw new BadRequestException('dependencyTaskIds must all belong to current plan');
    }
  }

  private async assertNoDependencyCycle(
    planId: string,
    targetTaskId: string,
    targetDependencies: string[],
  ): Promise<void> {
    const tasks = await this.orchestrationTaskModel
      .find({ planId })
      .select({ _id: 1, dependencyTaskIds: 1 })
      .lean<{ _id: Types.ObjectId; dependencyTaskIds?: string[] }[]>()
      .exec();

    const graph = tasks.map((item) => {
      const id = item._id.toString();
      return {
        id,
        dependencyTaskIds: id === targetTaskId ? targetDependencies : (item.dependencyTaskIds || []),
      };
    });

    if (this.hasCyclicDependency(graph)) {
      throw new BadRequestException('dependencyTaskIds introduces cyclic dependency');
    }
  }

  private hasCyclicDependency(tasks: Array<{ id: string; dependencyTaskIds: string[] }>): boolean {
    const ids = new Set(tasks.map((task) => task.id));
    const indegree = new Map<string, number>();
    const edges = new Map<string, string[]>();

    for (const task of tasks) {
      indegree.set(task.id, 0);
      edges.set(task.id, []);
    }

    for (const task of tasks) {
      for (const dependency of task.dependencyTaskIds || []) {
        if (!ids.has(dependency)) {
          continue;
        }
        edges.get(dependency)?.push(task.id);
        indegree.set(task.id, (indegree.get(task.id) || 0) + 1);
      }
    }

    const queue: string[] = [];
    for (const [id, degree] of indegree.entries()) {
      if (degree === 0) {
        queue.push(id);
      }
    }

    let visited = 0;
    while (queue.length) {
      const current = queue.shift()!;
      visited += 1;
      for (const nextId of edges.get(current) || []) {
        const nextDegree = (indegree.get(nextId) || 0) - 1;
        indegree.set(nextId, nextDegree);
        if (nextDegree === 0) {
          queue.push(nextId);
        }
      }
    }

    return visited !== tasks.length;
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
    const docId = entity?._id;
    if (typeof docId === 'string') {
      return docId;
    }
    if (docId?.toString) {
      return docId.toString();
    }
    return String(entity?.id || '');
  }
}
