import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import axios from 'axios';
import { Model, Types } from 'mongoose';
import { Observable, Subject } from 'rxjs';
import { Agent, AgentDocument } from '../../shared/schemas/agent.schema';
import { Tool, ToolDocument } from '../../../apps/agents/src/schemas/tool.schema';
import {
  OrchestrationPlan,
  OrchestrationPlanDocument,
  OrchestrationPlanStatus,
} from '../../shared/schemas/orchestration-plan.schema';
import {
  OrchestrationTask,
  OrchestrationTaskDocument,
  OrchestrationTaskStatus,
} from '../../shared/schemas/orchestration-task.schema';
import {
  Employee,
  EmployeeDocument,
  EmployeeStatus,
  EmployeeType,
} from '../../shared/schemas/employee.schema';
import { PlanSession, PlanSessionDocument } from '../../shared/schemas/orchestration-plan-session.schema';
import {
  OrchestrationSchedule,
  OrchestrationScheduleDocument,
} from '../../shared/schemas/orchestration-schedule.schema';
import {
  AgentClientService,
  AsyncAgentTaskSnapshot,
} from '../agents-client/agent-client.service';
import { InnerMessageService } from '../inner-message/inner-message.service';
import { PlannerService } from './planner.service';
import { ExecutorSelectionService } from './services/executor-selection.service';
import { TaskClassificationService } from './services/task-classification.service';
import { TaskOutputValidationService } from './services/task-output-validation.service';
import {
  CompleteHumanTaskDto,
  CreatePlanFromPromptDto,
  DebugTaskStepDto,
  ReplanPlanDto,
  ReassignTaskDto,
  RunPlanDto,
  UpdatePlanDto,
  UpdateTaskDraftDto,
} from './dto';
import { AgentRoleTier, canDelegateAcrossTier, normalizeAgentRoleTier } from '../../shared/role-tier';

@Injectable()
export class OrchestrationService {
  private readonly runningPlans = new Set<string>();
  private readonly planEventStreams = new Map<string, Set<Subject<any>>>();
  private readonly engineeringIntelligenceBaseUrl =
    process.env.ENGINEERING_INTELLIGENCE_SERVICE_URL || 'http://localhost:3004/api';
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

  constructor(
    @InjectModel(OrchestrationPlan.name)
    private readonly orchestrationPlanModel: Model<OrchestrationPlanDocument>,
    @InjectModel(OrchestrationTask.name)
    private readonly orchestrationTaskModel: Model<OrchestrationTaskDocument>,
    @InjectModel(Agent.name)
    private readonly agentModel: Model<AgentDocument>,
    @InjectModel(Tool.name)
    private readonly toolModel: Model<ToolDocument>,
    @InjectModel(Employee.name)
    private readonly employeeModel: Model<EmployeeDocument>,
    @InjectModel(PlanSession.name)
    private readonly planSessionModel: Model<PlanSessionDocument>,
    @InjectModel(OrchestrationSchedule.name)
    private readonly orchestrationScheduleModel: Model<OrchestrationScheduleDocument>,
    private readonly plannerService: PlannerService,
    private readonly agentClientService: AgentClientService,
    private readonly innerMessageService: InnerMessageService,
    private readonly executorSelectionService: ExecutorSelectionService,
    private readonly taskClassificationService: TaskClassificationService,
    private readonly taskOutputValidationService: TaskOutputValidationService,
  ) {}

  async createPlanFromPrompt(
    createdBy: string,
    dto: CreatePlanFromPromptDto,
  ): Promise<any> {
    const prompt = String(dto.prompt || '').trim();
    if (!prompt) {
      throw new BadRequestException('prompt is required');
    }
    const requirementId = String(dto.requirementId || '').trim() || undefined;
    const plan = await new this.orchestrationPlanModel({
      title: dto.title || this.derivePlanTitle(prompt),
      sourcePrompt: prompt,
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

    this.emitPlanStreamEvent(planId, 'plan.status.changed', {
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

  async streamPlanEvents(planId: string): Promise<Observable<any>> {
    const plan = await this.orchestrationPlanModel.findOne({ _id: planId }).exec();
    if (!plan) {
      throw new NotFoundException('Plan not found');
    }

    return new Observable((subscriber) => {
      let streamSet = this.planEventStreams.get(planId);
      if (!streamSet) {
        streamSet = new Set<Subject<any>>();
        this.planEventStreams.set(planId, streamSet);
      }

      const channel = new Subject<any>();
      const channelSubscription = channel.subscribe({
        next: (event) => subscriber.next(event),
        error: (error) => subscriber.error(error),
        complete: () => subscriber.complete(),
      });

      streamSet.add(channel);

      void this.getPlanById(planId)
        .then((snapshot) => {
          channel.next({
            data: {
              type: 'plan.snapshot',
              data: {
                planId,
                status: snapshot.status,
                stats: snapshot.stats,
                tasks: snapshot.tasks || [],
              },
            },
          });
        })
        .catch(() => undefined);

      return () => {
        channelSubscription.unsubscribe();
        const targetSet = this.planEventStreams.get(planId);
        if (!targetSet) {
          return;
        }
        targetSet.delete(channel);
        channel.complete();
        if (!targetSet.size) {
          this.planEventStreams.delete(planId);
        }
      };
    });
  }

  private async generatePlanTasksAsync(planId: string, dto: CreatePlanFromPromptDto): Promise<void> {
    const plan = await this.orchestrationPlanModel.findOne({ _id: planId }).exec();
    if (!plan) {
      return;
    }

    const requirementId = this.resolveRequirementIdFromPlan(plan);
    const requirementObjectId = this.resolveRequirementObjectIdFromPlan(plan);

    try {
      await this.setPlanStatus(planId, 'drafting');
      this.emitPlanStreamEvent(planId, 'plan.status.changed', {
        planId,
        status: 'drafting',
        phase: 'planning',
      });

      const planningResult = await this.plannerService.planFromPrompt({
        prompt: plan.sourcePrompt,
        mode: dto.mode || plan.strategy?.mode,
        plannerAgentId: dto.plannerAgentId || plan.strategy?.plannerAgentId,
        requirementId,
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
          mode: 'plan',
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
              message: 'Task created and assigned to ' + assignment.executorType,
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

        await this.emitTaskLifecycleEvent({
          eventType: 'task.created',
          task: createdTask,
          status: createdTask.status,
          payload: {
            assignment: createdTask.assignment,
          },
        }).catch(() => undefined);

        this.emitPlanStreamEvent(planId, 'plan.task.generated', {
          planId,
          index: i + 1,
          total,
          task: createdTask.toObject(),
        });
      }

      await this.refreshPlanStats(planId);
      await this.setPlanStatus(planId, 'planned');
      await this.setPlanSessionStatus(planId, 'planned');

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

      this.emitPlanStreamEvent(planId, 'plan.completed', {
        planId,
        status: 'planned',
        totalTasks: total,
      });

      if (dto.autoRun) {
        const run = await this.runPlanAsync(planId, { continueOnFailure: true });
        this.emitPlanStreamEvent(planId, 'plan.autorun.accepted', {
          planId,
          status: run.status,
          alreadyRunning: run.alreadyRunning,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Async create plan failed';
      await this.setPlanStatus(planId, 'failed');
      await this.setPlanSessionStatus(planId, 'failed');
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

      this.emitPlanStreamEvent(planId, 'plan.failed', {
        planId,
        status: 'failed',
        error: message,
      });
    }
  }

  async listPlans(): Promise<OrchestrationPlan[]> {
    return this.orchestrationPlanModel.find({}).sort({ createdAt: -1 }).exec();
  }

  async replanPlan(planId: string, dto: ReplanPlanDto): Promise<any> {
    const plan = await this.orchestrationPlanModel.findOne({ _id: planId }).exec();
    if (!plan) {
      throw new NotFoundException('Plan not found');
    }
    if (plan.status === 'running') {
      throw new BadRequestException('Plan is running and cannot be replanned');
    }

    const prompt = dto.prompt?.trim();
    if (!prompt) {
      throw new BadRequestException('prompt is required');
    }

    const plannerAgentId = dto.plannerAgentId?.trim();
    const title = dto.title?.trim() || plan.title || this.derivePlanTitle(prompt);
    const fallbackMode = dto.mode || plan.strategy?.mode || 'hybrid';
    const requirementId = this.resolveRequirementIdFromPlan(plan);
    const requirementObjectId = this.resolveRequirementObjectIdFromPlan(plan);
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

      await this.setPlanStatus(planId, 'drafting');
      this.emitPlanStreamEvent(planId, 'plan.status.changed', {
        planId,
        status: 'drafting',
        phase: 'replanning',
      });

      const planningResult = await this.plannerService.planFromPrompt({
        prompt,
        mode: fallbackMode,
        plannerAgentId: plannerAgentId || plan.strategy?.plannerAgentId,
        requirementId,
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
          mode: 'plan',
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
              message: 'Task replanned and assigned to ' + assignment.executorType,
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

        await this.emitTaskLifecycleEvent({
          eventType: 'task.created',
          task: createdTask,
          status: createdTask.status,
          payload: {
            assignment: createdTask.assignment,
          },
        }).catch(() => undefined);

        this.emitPlanStreamEvent(planId, 'plan.task.generated', {
          planId,
          index: i + 1,
          total,
          task: createdTask.toObject(),
        });
      }

      await this.refreshPlanStats(planId);
      await this.setPlanStatus(planId, 'planned');
      await this.setPlanSessionStatus(planId, 'planned');

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

      this.emitPlanStreamEvent(planId, 'plan.completed', {
        planId,
        status: 'planned',
        totalTasks: total,
      });

      if (dto.autoRun) {
        const run = await this.runPlanAsync(planId, { continueOnFailure: true });
        this.emitPlanStreamEvent(planId, 'plan.autorun.accepted', {
          planId,
          status: run.status,
          alreadyRunning: run.alreadyRunning,
        });
      }

      return this.getPlanById(planId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Async replan failed';
      await this.setPlanStatus(planId, 'failed');
      await this.setPlanSessionStatus(planId, 'failed');
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

      this.emitPlanStreamEvent(planId, 'plan.failed', {
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

  async updatePlan(planId: string, dto: UpdatePlanDto): Promise<any> {
    const plan = await this.orchestrationPlanModel.findOne({ _id: planId }).exec();
    if (!plan) {
      throw new NotFoundException('Plan not found');
    }
    if (plan.status === 'running') {
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

    return {
      ...plan.toObject(),
      tasks,
      planSession,
    };
  }

  async listTasksByPlan(planId: string): Promise<OrchestrationTask[]> {
    return this.orchestrationTaskModel
      .find({ planId })
      .sort({ order: 1 })
      .exec();
  }

  async runPlan(planId: string, dto: RunPlanDto): Promise<any> {
    const plan = await this.orchestrationPlanModel.findOne({ _id: planId }).exec();
    if (!plan) {
      throw new NotFoundException('Plan not found');
    }

    const requirementId = this.resolveRequirementIdFromPlan(plan);
    if (requirementId) {
      await this.tryUpdateRequirementStatus(requirementId, 'in_progress', 'orchestration plan started');
    }

    await this.setPlanStatus(planId, 'running');
    const continueOnFailure = dto.continueOnFailure ?? false;

    let keepRunning = true;
    while (keepRunning) {
      const tasks = await this.listTasksByPlan(planId);
      const completedSet = new Set(
        tasks
          .filter((task) => task.status === 'completed')
          .map((task) => this.getEntityId(task as Record<string, any>))
          .filter(Boolean),
      );

      const runnableTasks = tasks.filter((task) => {
        const statusAllowsRun = task.status === 'pending' || task.status === 'assigned';
        if (!statusAllowsRun) {
          return false;
        }
        return (task.dependencyTaskIds || []).every((dependency) => completedSet.has(dependency));
      });

      if (!runnableTasks.length) {
        keepRunning = false;
        break;
      }

      if (plan.strategy.mode === 'parallel') {
        const results = await Promise.all(runnableTasks.map((task) => this.executeTaskNode(planId, task)));
        if (!continueOnFailure && results.some((result) => result.status === 'failed')) {
          keepRunning = false;
        }
      } else {
        for (const task of runnableTasks) {
          const result = await this.executeTaskNode(planId, task);
          if (!continueOnFailure && result.status === 'failed') {
            keepRunning = false;
            break;
          }
        }
      }
    }

    await this.refreshPlanStats(planId);
    const latest = await this.getPlanById(planId);
    const nextStatus = this.derivePlanStatus(latest.tasks);
    await this.setPlanStatus(planId, nextStatus);
    await this.setPlanSessionStatus(planId, nextStatus);
    if (requirementId && nextStatus === 'completed') {
      await this.tryUpdateRequirementStatus(requirementId, 'review', 'orchestration plan passed auto review gate');
      await this.tryUpdateRequirementStatus(requirementId, 'done', 'orchestration plan completed');
    }
    return this.getPlanById(planId);
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
          await this.setPlanStatus(planId, 'failed');
          await this.setPlanSessionStatus(planId, 'failed');
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

  async reassignTask(taskId: string, dto: ReassignTaskDto): Promise<OrchestrationTask> {
    const task = await this.orchestrationTaskModel.findOne({ _id: taskId }).exec();
    if (!task) {
      throw new NotFoundException('Task not found');
    }

    if (dto.executorType !== 'unassigned' && !dto.executorId) {
      throw new BadRequestException('executorId is required when executorType is agent or employee');
    }

    if (dto.sourceAgentId && dto.executorType !== 'unassigned') {
      const sourceTier = await this.resolveAgentTierById(dto.sourceAgentId);
      if (!sourceTier) {
        throw this.buildTierGuardException('tier_resolution_required', 'Cannot resolve source agent tier', {
          sourceAgentId: dto.sourceAgentId,
        });
      }

      const targetTier = await this.resolveAssignmentTargetTier(dto.executorType, dto.executorId);
      if (!targetTier) {
        throw this.buildTierGuardException('tier_resolution_required', 'Cannot resolve assignment target tier', {
          executorType: dto.executorType,
          executorId: dto.executorId,
        });
      }

      if (!canDelegateAcrossTier(sourceTier, targetTier)) {
        throw this.buildTierGuardException('delegation_direction_forbidden', 'Delegation direction is not allowed by tier governance', {
          sourceAgentId: dto.sourceAgentId,
          sourceTier,
          targetTier,
          executorType: dto.executorType,
          executorId: dto.executorId,
        });
      }
    }

    const updated = await this.orchestrationTaskModel
      .findOneAndUpdate(
        { _id: taskId },
        {
          $set: {
            assignment: {
              executorType: dto.executorType,
              executorId: dto.executorId,
              reason: dto.reason,
            },
            status: dto.executorType === 'unassigned' ? 'pending' : 'assigned',
          },
          $push: {
            runLogs: {
              timestamp: new Date(),
              level: 'info',
              message: 'Task reassigned',
              metadata: {
                executorType: dto.executorType,
                executorId: dto.executorId,
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
    if (task.mode === 'plan') {
      const planId = this.requirePlanId(task);
      await this.updatePlanSessionTask(planId, taskId, {
        status: updated.status,
        executorType: dto.executorType,
        executorId: dto.executorId,
      });
    }

    await this.emitTaskLifecycleEvent({
      eventType: 'task.status.changed',
      task: updated,
      status: updated.status,
      payload: {
        previousStatus: task.status,
        assignment: updated.assignment,
        reason: dto.reason,
      },
    }).catch(() => undefined);

    return updated;
  }

  async completeHumanTask(
    taskId: string,
    dto: CompleteHumanTaskDto,
  ): Promise<OrchestrationTask> {
    const task = await this.orchestrationTaskModel.findOne({ _id: taskId }).exec();
    if (!task) {
      throw new NotFoundException('Task not found');
    }
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
    if (task.mode === 'plan') {
      const planId = this.requirePlanId(task);
      await this.updatePlanSessionTask(planId, taskId, {
        status: 'completed',
        output: dto.output || dto.summary || 'Completed by human assignee',
        error: undefined,
      });
      await this.refreshPlanStats(planId);
    }

    await this.emitTaskLifecycleEvent({
      eventType: 'task.status.changed',
      task: updated,
      status: 'completed',
      payload: {
        previousStatus: task.status,
      },
    }).catch(() => undefined);

    await this.emitTaskLifecycleEvent({
      eventType: 'task.completed',
      task: updated,
      status: 'completed',
      payload: {
        completedBy: 'human',
      },
    }).catch(() => undefined);

    return updated;
  }

  async retryTask(
    taskId: string,
  ): Promise<{ task: OrchestrationTask; run: { accepted: boolean; planId: string; status: string; alreadyRunning?: boolean } }> {
    const task = await this.orchestrationTaskModel.findOne({ _id: taskId }).exec();
    if (!task) {
      throw new NotFoundException('Task not found');
    }
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

    await this.updatePlanSessionTask(planId, taskId, {
      status: nextStatus,
      output: undefined,
      error: undefined,
    });

    await this.refreshPlanStats(planId);
    await this.emitTaskLifecycleEvent({
      eventType: 'task.status.changed',
      task: updatedTask,
      status: nextStatus,
      payload: {
        previousStatus: task.status,
        reason: 'manual_retry',
      },
    }).catch(() => undefined);

    const run = await this.runPlanAsync(planId, { continueOnFailure: true });

    return {
      task: updatedTask,
      run,
    };
  }

  async updateTaskDraft(taskId: string, dto: UpdateTaskDraftDto): Promise<OrchestrationTask> {
    const task = await this.orchestrationTaskModel.findOne({ _id: taskId }).exec();
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    if (task.status === 'in_progress') {
      throw new BadRequestException('Task is running and cannot be edited');
    }

    const title = dto.title?.trim();
    const description = dto.description?.trim();

    const updated = await this.orchestrationTaskModel
      .findOneAndUpdate(
        { _id: taskId },
        {
          $set: {
            ...(title ? { title } : {}),
            ...(description ? { description } : {}),
          },
          $push: {
            runLogs: {
              timestamp: new Date(),
              level: 'info',
              message: 'Task draft updated for step debugging',
            },
          },
        },
        { new: true },
      )
      .exec();

    if (!updated) {
      throw new NotFoundException('Task not found');
    }

    if (task.mode === 'plan') {
      const planId = this.requirePlanId(task);
      await this.updatePlanSessionTask(planId, taskId, {
        input: updated.description,
      });
    }

    return updated;
  }

  async debugTaskStep(
    taskId: string,
    dto: DebugTaskStepDto,
  ): Promise<{ task: OrchestrationTask; execution: { status: OrchestrationTaskStatus; result?: string; error?: string } }> {
    const task = await this.orchestrationTaskModel.findOne({ _id: taskId }).exec();
    if (!task) {
      throw new NotFoundException('Task not found');
    }
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

    await this.updateTaskDraft(taskId, dto);

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

    const execution = await this.executeTaskNode(planId, refreshedTask);

    await this.refreshPlanStats(planId);
    const latest = await this.getPlanById(planId);
    const nextPlanStatus = this.derivePlanStatus(latest.tasks);
    await this.setPlanStatus(planId, nextPlanStatus);
    await this.setPlanSessionStatus(planId, nextPlanStatus);

    const latestTask = await this.orchestrationTaskModel.findOne({ _id: taskId }).exec();
    if (!latestTask) {
      throw new NotFoundException('Task not found');
    }

    return {
      task: latestTask,
      execution,
    };
  }

  private async executeTaskNode(
    planId: string,
    task: OrchestrationTask,
  ): Promise<{ status: OrchestrationTaskStatus; result?: string; error?: string }> {
    const taskId = this.getEntityId(task as Record<string, any>);
    const assignment = task.assignment || { executorType: 'unassigned' as const };
    const isExternalAction = this.taskClassificationService.isExternalActionTask(task.title, task.description);
    const researchTaskKind = this.taskClassificationService.detectResearchTaskKind(task.title, task.description);
    const isResearchTask = Boolean(researchTaskKind);
    const isReviewTask = this.taskClassificationService.isReviewTask(task.title, task.description);
    const dependencyContext = await this.buildDependencyContext(planId, task.dependencyTaskIds || []);
    const retryHint = this.getRetryFailureHint(task);

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

    await this.updatePlanSessionTask(planId, taskId, {
      status: 'in_progress',
      input: task.description,
      executorType: assignment.executorType,
      executorId: assignment.executorId,
    });

    await this.emitTaskLifecycleEvent({
      eventType: 'task.status.changed',
      task,
      status: 'in_progress',
      payload: {
        previousStatus: task.status,
        assignment,
      },
    }).catch(() => undefined);

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

      await this.updatePlanSessionTask(planId, taskId, {
        status: 'waiting_human',
      });

      await this.emitTaskLifecycleEvent({
        eventType: 'task.status.changed',
        task,
        status: 'waiting_human',
        payload: {
          previousStatus: 'in_progress',
          reason: 'waiting_human_assignee',
        },
      }).catch(() => undefined);

      return { status: 'waiting_human' };
    }

    if (assignment.executorType !== 'agent' || !assignment.executorId) {
      if (isExternalAction) {
        await this.markTaskWaitingHuman(taskId, 'External action requires manual handling');
        await this.updatePlanSessionTask(planId, taskId, {
          status: 'waiting_human',
          error: 'External action requires manual handling',
        });
        await this.emitTaskLifecycleEvent({
          eventType: 'task.exception',
          task,
          status: 'waiting_human',
          payload: {
            reason: 'external_action_requires_manual_handling',
          },
        }).catch(() => undefined);
        return { status: 'waiting_human' };
      }
      await this.markTaskFailed(taskId, 'No agent assigned for execution');
      await this.updatePlanSessionTask(planId, taskId, {
        status: 'failed',
        error: 'No agent assigned for execution',
      });
      await this.emitTaskLifecycleEvent({
        eventType: 'task.failed',
        task,
        status: 'failed',
        payload: {
          reason: 'no_agent_assigned',
        },
      }).catch(() => undefined);
      return { status: 'failed', error: 'No agent assigned for execution' };
    }

    if (isExternalAction) {
      const hasEmailCapability = await this.executorSelectionService.hasEmailExecutionCapability(assignment.executorId);
      if (!hasEmailCapability) {
        await this.markTaskWaitingHuman(taskId, 'Agent lacks email tool capability, switched to human review');
        await this.updatePlanSessionTask(planId, taskId, {
          status: 'waiting_human',
          error: 'Agent lacks email tool capability, switched to human review',
        });
        await this.emitTaskLifecycleEvent({
          eventType: 'task.exception',
          task,
          status: 'waiting_human',
          payload: {
            reason: 'agent_lacks_email_capability',
          },
        }).catch(() => undefined);
        return { status: 'waiting_human' };
      }
    }

    const requestedSessionId = `orch-task-${taskId}`;
    const runtimeTaskType = this.resolveAgentRuntimeTaskType(task.title, task.description, {
      isExternalAction,
      isResearchTask,
      isReviewTask,
    });
    const runtimeChannelHint: 'native' | 'opencode' = runtimeTaskType === 'development' ? 'opencode' : 'native';
    const taskPrompt = this.buildTaskDescription(task.description, {
      dependencyContext,
      isExternalAction,
      isResearchTask,
      isReviewTask,
      researchTaskKind: researchTaskKind || undefined,
      retryHint,
    });
    const agentTaskIdempotencyKey = `orch:${planId}:${taskId}:${new Date().getTime()}`;

    try {
      const accepted = await this.agentClientService.createAsyncAgentTask({
        agentId: assignment.executorId,
        prompt: taskPrompt,
        idempotencyKey: agentTaskIdempotencyKey,
        sessionContext: {
          source: 'orchestration',
          planId,
          orchestrationTaskId: taskId,
          sessionId: requestedSessionId,
          dependencies: task.dependencyTaskIds,
          dependencyContext,
          runtimeTaskType,
          runtimeChannelHint,
          externalActionValidationRequired: isExternalAction,
          researchTaskKind,
          reviewValidationRequired: isReviewTask,
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

      if (isResearchTask) {
        const validation = this.taskOutputValidationService.validateResearchOutput(output, researchTaskKind!);
        if (!validation.valid) {
          const detail = validation.missing?.length
            ? `; missing=${validation.missing.join(',')}`
            : '';
          await this.markTaskFailed(taskId, `Research output validation failed: ${validation.reason}${detail}`);
          await this.updatePlanSessionTask(planId, taskId, {
            status: 'failed',
            error: `Research output validation failed: ${validation.reason}${detail}`,
          });
          await this.emitTaskLifecycleEvent({
            eventType: 'task.failed',
            task,
            status: 'failed',
            senderAgentId: assignment.executorId,
            payload: {
              reason: 'research_output_validation_failed',
              error: validation.reason,
              missing: validation.missing,
            },
          }).catch(() => undefined);
          return { status: 'failed', error: validation.reason };
        }
      }

      if (isReviewTask) {
        const validation = this.taskOutputValidationService.validateReviewOutput(output);
        if (!validation.valid) {
          const detail = validation.missing?.length
            ? `; missing=${validation.missing.join(',')}`
            : '';
          await this.markTaskFailed(taskId, `Review output validation failed: ${validation.reason}${detail}`);
          await this.updatePlanSessionTask(planId, taskId, {
            status: 'failed',
            error: `Review output validation failed: ${validation.reason}${detail}`,
          });
          await this.emitTaskLifecycleEvent({
            eventType: 'task.failed',
            task,
            status: 'failed',
            senderAgentId: assignment.executorId,
            payload: {
              reason: 'review_output_validation_failed',
              error: validation.reason,
              missing: validation.missing,
            },
          }).catch(() => undefined);
          return { status: 'failed', error: validation.reason };
        }
      }

      if (isExternalAction) {
        const proof = this.taskOutputValidationService.extractEmailSendProof(output);
        if (!proof.valid) {
          await this.markTaskWaitingHuman(
            taskId,
            'External action execution lacks verifiable proof, waiting for human confirmation',
            output,
          );
          await this.updatePlanSessionTask(planId, taskId, {
            status: 'waiting_human',
            output,
            error: 'External action execution lacks verifiable proof, waiting for human confirmation',
          });
          await this.emitTaskLifecycleEvent({
            eventType: 'task.exception',
            task,
            status: 'waiting_human',
            senderAgentId: assignment.executorId,
            payload: {
              reason: 'external_action_missing_proof',
            },
          }).catch(() => undefined);
          return { status: 'waiting_human' };
        }
      }

      const codeValidation = this.taskOutputValidationService.validateCodeExecutionProof(task.title, task.description, output);
      if (!codeValidation.valid) {
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

      await this.updatePlanSessionTask(planId, taskId, {
        status: 'completed',
        output,
        error: undefined,
        agentSessionId: execution.sessionId || requestedSessionId,
        agentRunId: execution.runId,
      });

      await this.emitTaskLifecycleEvent({
        eventType: 'task.status.changed',
        task,
        status: 'completed',
        senderAgentId: assignment.executorId,
        payload: {
          previousStatus: 'in_progress',
        },
      }).catch(() => undefined);

      await this.emitTaskLifecycleEvent({
        eventType: 'task.completed',
        task,
        status: 'completed',
        senderAgentId: assignment.executorId,
        payload: {
          output,
          agentSessionId: execution.sessionId || requestedSessionId,
          agentRunId: execution.runId,
          asyncAgentTaskId: execution.agentTaskId,
        },
      }).catch(() => undefined);

      return { status: 'completed', result: output };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown execution error';
      await this.markTaskFailed(taskId, message);
      await this.updatePlanSessionTask(planId, taskId, {
        status: 'failed',
        error: message,
      });
      await this.emitTaskLifecycleEvent({
        eventType: 'task.status.changed',
        task,
        status: 'failed',
        senderAgentId: assignment.executorId,
        payload: {
          previousStatus: 'in_progress',
          error: message,
        },
      }).catch(() => undefined);
      await this.emitTaskLifecycleEvent({
        eventType: 'task.exception',
        task,
        status: 'failed',
        senderAgentId: assignment.executorId,
        payload: {
          error: message,
        },
      }).catch(() => undefined);
      await this.emitTaskLifecycleEvent({
        eventType: 'task.failed',
        task,
        status: 'failed',
        senderAgentId: assignment.executorId,
        payload: {
          error: message,
        },
      }).catch(() => undefined);
      return { status: 'failed', error: message };
    }
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

  private buildTierGuardException(
    code:
      | 'tier_resolution_required'
      | 'delegation_direction_forbidden'
      | 'temporary_worker_tool_violation'
      | 'executive_instruction_auth_missing',
    message: string,
    details?: Record<string, unknown>,
  ): BadRequestException {
    return new BadRequestException({
      code,
      message,
      ...(details ? { details } : {}),
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

  async executeStandaloneTask(taskId: string): Promise<{ status: OrchestrationTaskStatus; result?: string; error?: string }> {
    const task = await this.orchestrationTaskModel.findOne({ _id: taskId }).exec();
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    const scopeId = task.mode === 'plan'
      ? this.requirePlanId(task)
      : task.scheduleId || `schedule-${taskId}`;
    return this.executeTaskNode(scopeId, task);
  }

  private requirePlanId(task: OrchestrationTask): string {
    if (!task.planId) {
      throw new BadRequestException('Task is not associated with orchestration plan');
    }
    return task.planId;
  }

  private parseRequirementObjectId(requirementId?: string): Types.ObjectId | undefined {
    const normalized = String(requirementId || '').trim();
    if (!normalized) {
      return undefined;
    }
    if (!Types.ObjectId.isValid(normalized)) {
      return undefined;
    }
    return new Types.ObjectId(normalized);
  }

  private resolveRequirementObjectIdFromPlan(plan: OrchestrationPlan): Types.ObjectId | undefined {
    const raw = String((plan.metadata || {}).requirementId || '').trim();
    if (!raw || !Types.ObjectId.isValid(raw)) {
      return undefined;
    }
    return new Types.ObjectId(raw);
  }

  private resolveRequirementIdFromPlan(plan: OrchestrationPlan): string | undefined {
    return String((plan.metadata || {}).requirementId || '').trim() || undefined;
  }

  private async tryUpdateRequirementStatus(
    requirementId: string,
    status: 'todo' | 'assigned' | 'in_progress' | 'review' | 'done' | 'blocked',
    note: string,
  ): Promise<void> {
    try {
      await axios.post(
        `${this.engineeringIntelligenceBaseUrl}/ei/requirements/${encodeURIComponent(requirementId)}/status`,
        {
          status,
          changedByType: 'system',
          changedByName: 'orchestration-service',
          note,
        },
        {
          timeout: Number(process.env.AGENTS_EXEC_TIMEOUT_MS || 120000),
        },
      );
    } catch {
      // requirement sync is best-effort and should not block orchestration execution.
    }
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

  private buildTaskDescription(
    baseDescription: string,
    options: {
      dependencyContext: string;
      isExternalAction: boolean;
      isResearchTask: boolean;
      isReviewTask: boolean;
      researchTaskKind?: 'city_population' | 'generic_research';
      retryHint?: string;
    },
  ): string {
    const { dependencyContext, isExternalAction, isResearchTask, isReviewTask, researchTaskKind, retryHint } = options;
    const sections = [baseDescription];
    if (dependencyContext) {
      sections.push(`Dependency context:\n${dependencyContext}`);
    }
    if (retryHint) {
      sections.push(`Previous failed attempt hint:\n${retryHint}`);
    }
    if (isResearchTask) {
      sections.push(
        this.taskOutputValidationService.buildResearchOutputContract(researchTaskKind || 'generic_research'),
      );
    }
    if (isReviewTask) {
      sections.push(
        [
          'Review output contract (MUST comply):',
          '- return the FULL revised email body, not just suggestions',
          '- include Subject line + greeting + revised body + closing signature',
          '- output the final email directly',
        ].join('\n'),
      );
    }
    if (isExternalAction) {
      sections.push(
        [
          'For external action completion, include a verifiable proof block in your final response:',
          'EMAIL_SEND_PROOF: {"recipient":"...","provider":"...","messageId":"..."}',
          'Do not claim success without this proof block.',
        ].join('\n'),
      );
    }
    return sections.join('\n\n');
  }

  private resolveAgentRuntimeTaskType(
    title: string,
    description: string,
    flags: {
      isExternalAction: boolean;
      isResearchTask: boolean;
      isReviewTask: boolean;
    },
  ): string {
    if (flags.isExternalAction) {
      return 'external_action';
    }
    if (flags.isResearchTask) {
      return 'research';
    }
    if (flags.isReviewTask) {
      return 'review';
    }
    if (this.taskClassificationService.isCodeTask(title, description)) {
      return 'development';
    }
    return 'general';
  }

  private getRetryFailureHint(task: OrchestrationTask): string {
    const logs = task.runLogs || [];
    for (let i = logs.length - 1; i >= 0; i--) {
      const log = logs[i];
      if (log.level === 'error' && log.message) {
        return log.message;
      }
    }
    return '';
  }

  private async waitForAsyncAgentTaskResult(
    agentTaskId: string,
  ): Promise<{ status: 'succeeded'; output: string; runId?: string; sessionId?: string; agentTaskId: string }> {
    if (this.asyncAgentTaskSseEnabled) {
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

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async buildDependencyContext(
    planId: string,
    dependencyTaskIds: string[],
  ): Promise<string> {
    if (!dependencyTaskIds.length) {
      return '';
    }

    const dependencyTasks = await this.orchestrationTaskModel
      .find({
        planId,
        _id: { $in: dependencyTaskIds },
      })
      .sort({ order: 1 })
      .exec();

    if (!dependencyTasks.length) {
      return '';
    }

    return dependencyTasks
      .map((depTask) => {
        const output = depTask.result?.output || depTask.result?.summary || '';
        return [
          `Task #${depTask.order + 1}: ${depTask.title}`,
          `Status: ${depTask.status}`,
          `Output: ${output || 'N/A'}`,
        ].join('\n');
      })
      .join('\n\n---\n\n');
  }

  private extractEmailSendProof(output: string): { valid: boolean; recipient?: string; provider?: string; messageId?: string } {
    const text = output || '';
    const markerMatch = text.match(/EMAIL_SEND_PROOF\s*:\s*(\{[\s\S]*?\})/i);
    if (markerMatch?.[1]) {
      try {
        const parsed = JSON.parse(markerMatch[1]);
        const recipient = String(parsed.recipient || '');
        const provider = String(parsed.provider || '');
        const messageId = String(parsed.messageId || '');
        if (recipient.includes('@') && provider && messageId) {
          return { valid: true, recipient, provider, messageId };
        }
      } catch {
        // ignore and fallback to heuristic
      }
    }

    const hasRecipient = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(text);
    const hasProvider = /gmail|smtp|mailgun|ses|sendgrid|outlook/i.test(text);
    const hasMessageId = /message[\s_-]?id\s*[:=]/i.test(text) || /queued\s+as\s+/i.test(text);

    return {
      valid: hasRecipient && hasProvider && hasMessageId,
    };
  }

  private async refreshPlanStats(planId: string): Promise<void> {
    const tasks = await this.orchestrationTaskModel.find({ planId }).exec();
    const stats = {
      totalTasks: tasks.length,
      completedTasks: tasks.filter((task) => task.status === 'completed').length,
      failedTasks: tasks.filter((task) => task.status === 'failed').length,
      waitingHumanTasks: tasks.filter((task) => task.status === 'waiting_human').length,
    };

    await this.orchestrationPlanModel
      .updateOne(
        { _id: planId },
        {
          $set: {
            stats,
          },
        },
      )
      .exec();
  }

  private derivePlanStatus(tasks: OrchestrationTask[]): OrchestrationPlanStatus {
    if (!tasks.length) {
      return 'failed';
    }
    if (tasks.every((task) => task.status === 'completed')) {
      return 'completed';
    }
    if (tasks.some((task) => task.status === 'failed')) {
      return 'failed';
    }
    if (tasks.some((task) => task.status === 'waiting_human')) {
      return 'paused';
    }
    if (tasks.some((task) => task.status === 'in_progress')) {
      return 'running';
    }
    return 'planned';
  }

  private async setPlanStatus(
    planId: string,
    status: OrchestrationPlanStatus,
  ): Promise<void> {
    await this.orchestrationPlanModel
      .updateOne(
        { _id: planId },
        {
          $set: {
            status,
          },
        },
      )
      .exec();
  }

  private async setPlanSessionStatus(
    planId: string,
    status: OrchestrationPlanStatus,
  ): Promise<void> {
    const mappedStatus =
      status === 'completed'
        ? 'completed'
        : status === 'failed'
          ? 'failed'
          : status === 'paused'
            ? 'active'
            : status === 'running'
              ? 'active'
              : 'active';
    await this.planSessionModel
      .updateOne(
        { planId },
        {
          $set: {
            status: mappedStatus,
          },
        },
      )
      .exec();
  }

  private async updatePlanSessionTask(
    planId: string,
    taskId: string,
    patch: {
      status?: 'pending' | 'assigned' | 'in_progress' | 'blocked' | 'waiting_human' | 'completed' | 'failed' | 'cancelled';
      input?: string;
      output?: string;
      error?: string;
      executorType?: 'agent' | 'employee' | 'unassigned';
      executorId?: string;
      agentSessionId?: string;
      agentRunId?: string;
    },
  ): Promise<void> {
    const setPayload: Record<string, any> = {
      'tasks.$.updatedAt': new Date(),
    };
    if (patch.status) setPayload['tasks.$.status'] = patch.status;
    if (patch.input !== undefined) setPayload['tasks.$.input'] = patch.input;
    if (patch.output !== undefined) setPayload['tasks.$.output'] = patch.output;
    if (patch.error !== undefined) setPayload['tasks.$.error'] = patch.error;
    if (patch.executorType !== undefined) setPayload['tasks.$.executorType'] = patch.executorType;
    if (patch.executorId !== undefined) setPayload['tasks.$.executorId'] = patch.executorId;
    if (patch.agentSessionId !== undefined) setPayload['tasks.$.agentSessionId'] = patch.agentSessionId;
    if (patch.agentRunId !== undefined) setPayload['tasks.$.agentRunId'] = patch.agentRunId;

    await this.planSessionModel
      .updateOne(
        { planId, 'tasks.taskId': taskId },
        {
          $set: setPayload,
        },
      )
      .exec();
  }

  private emitPlanStreamEvent(planId: string, type: string, data: Record<string, any>): void {
    const listeners = this.planEventStreams.get(planId);
    if (!listeners?.size) {
      return;
    }
    const event = {
      data: {
        type,
        data,
      },
    };
    for (const channel of listeners) {
      channel.next(event);
    }
  }

  private async emitTaskLifecycleEvent(input: {
    eventType: string;
    task: OrchestrationTask;
    status?: OrchestrationTaskStatus;
    senderAgentId?: string;
    payload?: Record<string, any>;
  }): Promise<void> {
    const taskId = this.getEntityId(input.task as Record<string, any>);
    if (!taskId) {
      return;
    }

    await this.innerMessageService.publishTaskEvent({
      eventType: input.eventType,
      taskId,
      planId: input.task.planId,
      status: input.status,
      senderAgentId: input.senderAgentId || 'orchestration-system',
      title: `${input.eventType}: ${input.task.title}`,
      content: `Task ${input.task.title} event ${input.eventType}`,
      payload: {
        taskId,
        planId: input.task.planId,
        taskTitle: input.task.title,
        taskDescription: input.task.description,
        taskPriority: input.task.priority,
        assignment: input.task.assignment,
        ...(input.payload || {}),
      },
    });
  }

  private derivePlanTitle(prompt: string): string {
    return prompt.length > 40 ? `${prompt.slice(0, 40)}...` : prompt;
  }

  /**
   * Detect whether the plan prompt requires locking all task assignees to the planner agent.
   */
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

  // NOTE: Legacy selectExecutor and duplicate classification methods removed.
  // All executor selection now goes through ExecutorSelectionService.
  // All task classification now goes through TaskClassificationService.

  // Legacy classification/validation methods removed — now in TaskClassificationService/TaskOutputValidationService/ExecutorSelectionService

  private validateResearchOutput(
    output: string,
    kind: 'city_population' | 'generic_research',
  ): { valid: boolean; reason?: string; missing?: string[] } {
    const text = (output || '').trim();
    if (!text) {
      return { valid: false, reason: 'empty output', missing: ['content'] };
    }

    const lower = text.toLowerCase();
    const inabilitySignals = [
      'cannot browse',
      'unable to access',
      "don't have direct access",
      '无法访问',
      '无法直接访问',
      '无法浏览',
    ];
    if (inabilitySignals.some((signal) => lower.includes(signal))) {
      return {
        valid: false,
        reason: 'agent reported inability to access source data',
        missing: ['usable-research-result'],
      };
    }

    const evidenceValidation = this.validateResearchExecutionProof(text);
    if (!evidenceValidation.valid) {
      return {
        valid: false,
        reason: 'missing or invalid research execution proof',
        missing: evidenceValidation.missing,
      };
    }

    const jsonValidation = this.validateResearchJson(text);
    if (jsonValidation.valid && this.validateKindSpecificJson(jsonValidation.parsed!, kind)) {
      return { valid: true };
    }

    const tableValidation = this.validateResearchTable(text);
    if (tableValidation.valid && this.validateKindSpecificTable(text, kind)) {
      return { valid: true };
    }

    const listValidation = this.validateResearchNumberedList(text);
    if (listValidation.valid && this.validateKindSpecificList(text, kind)) {
      return { valid: true };
    }

    const mergedMissing = Array.from(
      new Set([...(jsonValidation.missing || []), ...(tableValidation.missing || []), ...(listValidation.missing || [])]),
    );
    return {
      valid: false,
      reason:
        kind === 'city_population'
          ? 'missing top-10 structured city list with population figures'
          : 'missing structured research findings with source links',
      missing:
        mergedMissing.length
          ? mergedMissing
          : kind === 'city_population'
            ? ['top10-list', 'population-values']
            : ['findings-list', 'source-links'],
    };
  }

  private validateResearchJson(text: string): { valid: boolean; missing?: string[]; parsed?: any } {
    const parsed = this.tryParseJson(text);
    if (!parsed) {
      return { valid: false, missing: ['json-structure'] };
    }

    const cities = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.cities)
        ? parsed.cities
        : Array.isArray(parsed.items)
          ? parsed.items
          : [];

    const findings = Array.isArray(parsed.findings)
      ? parsed.findings
      : Array.isArray(parsed.results)
        ? parsed.results
        : [];

    if (cities.length === 0 && findings.length === 0 && !Array.isArray(parsed)) {
      return { valid: false, missing: ['json-items'] };
    }

    return { valid: true, parsed };
  }

  private validateResearchTable(text: string): { valid: boolean; missing?: string[] } {
    const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
    const tableRows = lines.filter((line) => line.includes('|') && /\|/.test(line));
    if (tableRows.length < 4) {
      return { valid: false, missing: ['markdown-table-rows'] };
    }
    return { valid: true };
  }

  private validateResearchNumberedList(text: string): { valid: boolean; missing?: string[] } {
    const numberedLines = text.match(/(^|\n)\s*(\d+\.|[-*])\s*.*$/g) || [];
    if (numberedLines.length < 4) {
      return { valid: false, missing: ['numbered-list-items'] };
    }
    return { valid: true };
  }

  private detectResearchTaskKind(
    title: string,
    description: string,
  ): 'city_population' | 'generic_research' | null {
    const text = `${title} ${description}`.toLowerCase();
    const isResearchLike =
      text.includes('research') ||
      text.includes('search') ||
      text.includes('compile') ||
      text.includes('investigate') ||
      text.includes('identify') ||
      text.includes('collection') ||
      text.includes('collect') ||
      text.includes('gather') ||
      text.includes('analyze') ||
      text.includes('analysis') ||
      text.includes('data source') ||
      text.includes('dataset') ||
      text.includes('调研') ||
      text.includes('检索') ||
      text.includes('汇总') ||
      text.includes('识别') ||
      text.includes('收集') ||
      text.includes('分析') ||
      text.includes('数据源');

    if (!isResearchLike) {
      return null;
    }

    const isCityPopulation =
      text.includes('most populous') ||
      text.includes('population') ||
      text.includes('top 10 cities') ||
      text.includes('中国人口最多') ||
      text.includes('城市人口');

    return isCityPopulation ? 'city_population' : 'generic_research';
  }

  private buildResearchOutputContract(kind: 'city_population' | 'generic_research'): string {
    if (kind === 'city_population') {
      return [
        'Research output contract (MUST follow one format):',
        'Preferred JSON format:',
        '{"cities":[{"rank":1,"city":"Shanghai","population":"24870000","year":2023,"source":"https://..."}]}',
        'Execution proof (REQUIRED):',
        'RESEARCH_EXECUTION_PROOF: {"toolCalls":["websearch","webfetch","content_extract"],"fetchedUrls":["https://...","https://..."]}',
        'Requirements:',
        '- exactly 10 cities in descending population order',
        '- each item must include city and population',
        '- include source URL whenever available',
      ].join('\n');
    }

    return [
      'Research output contract (MUST follow one format):',
      'Preferred JSON format:',
      '{"findings":[{"rank":1,"title":"...","summary":"...","source":"https://..."}]}',
      'Execution proof (REQUIRED):',
      'RESEARCH_EXECUTION_PROOF: {"toolCalls":["websearch","webfetch"],"fetchedUrls":["https://...","https://..."]}',
      'Requirements:',
      '- at least 3 findings',
      '- each finding includes title/summary/source',
      '- source should be URL',
    ].join('\n');
  }

  private validateResearchExecutionProof(text: string): { valid: boolean; missing?: string[] } {
    const markerMatch = text.match(/RESEARCH_EXECUTION_PROOF\s*:\s*(\{[\s\S]*?\})/i);
    if (!markerMatch?.[1]) {
      return { valid: false, missing: ['research-execution-proof'] };
    }

    try {
      const parsed = JSON.parse(markerMatch[1]);
      const toolCalls = Array.isArray(parsed.toolCalls) ? parsed.toolCalls.map((item: any) => String(item)) : [];
      const fetchedUrls = Array.isArray(parsed.fetchedUrls) ? parsed.fetchedUrls.map((item: any) => String(item)) : [];
      const hasWebSearch = toolCalls.includes('websearch');
      const hasWebFetch = toolCalls.includes('webfetch');
      const validUrls = fetchedUrls.filter((url) => /^https?:\/\//i.test(url));
      const missing: string[] = [];
      if (!hasWebSearch) missing.push('proof-websearch-call');
      if (!hasWebFetch) missing.push('proof-webfetch-call');
      if (validUrls.length < 1) missing.push('proof-fetched-urls');

      return { valid: missing.length === 0, missing };
    } catch {
      return { valid: false, missing: ['proof-json-parse'] };
    }
  }

  private validateKindSpecificJson(parsed: any, kind: 'city_population' | 'generic_research'): boolean {
    if (kind === 'city_population') {
      const cities = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed.cities)
          ? parsed.cities
          : [];
      if (cities.length < 10) return false;
      return cities.slice(0, 10).every((item: any) => item?.city && item?.population);
    }

    const findings = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.findings)
        ? parsed.findings
        : Array.isArray(parsed.items)
          ? parsed.items
          : [];
    if (findings.length < 3) return false;
    return findings.slice(0, 3).every((item: any) => item?.title && item?.summary && item?.source);
  }

  private validateKindSpecificTable(text: string, kind: 'city_population' | 'generic_research'): boolean {
    const lower = text.toLowerCase();
    if (kind === 'city_population') {
      const hasCityColumn = lower.includes('city');
      const hasPopulationColumn = lower.includes('population');
      return hasCityColumn && hasPopulationColumn;
    }
    const hasTitleColumn = lower.includes('title') || lower.includes('finding');
    const hasSourceColumn = lower.includes('source');
    return hasTitleColumn && hasSourceColumn;
  }

  private validateKindSpecificList(text: string, kind: 'city_population' | 'generic_research'): boolean {
    if (kind === 'city_population') {
      const hasPopulationFigures = /(\d{1,3}(,\d{3})+|\d+\s*(million|bn|billion|万|亿))/i.test(text);
      return hasPopulationFigures;
    }

    const hasSources = /(https?:\/\/)/i.test(text);
    return hasSources;
  }

  private isReviewTask(title: string, description: string): boolean {
    const text = `${title} ${description}`.toLowerCase();
    return (
      text.includes('review') ||
      text.includes('finalize') ||
      text.includes('revise') ||
      text.includes('proofread') ||
      text.includes('edit draft') ||
      text.includes('校对') ||
      text.includes('复核') ||
      text.includes('润色') ||
      text.includes('修订')
    );
  }

  private validateReviewOutput(output: string): { valid: boolean; reason?: string; missing?: string[] } {
    const text = (output || '').trim();
    if (!text) {
      return { valid: false, reason: 'empty review output', missing: ['email-content'] };
    }

    const lower = text.toLowerCase();
    const askForDraftSignals = ['please provide', 'provide the draft', '请提供草稿'];
    if (askForDraftSignals.some((signal) => lower.includes(signal))) {
      return {
        valid: false,
        reason: 'review output asks user for draft instead of providing revised email',
        missing: ['final-revised-email'],
      };
    }

    const suggestionOnlySignals = ['suggestion', 'you might consider', 'could be improved', '建议如下'];
    const hasSubject = /(subject\s*:|主题\s*[:：])/i.test(text);
    const hasGreeting = /(dear\s+|hi\s+|hello\s+|尊敬的|您好)/i.test(text);
    const hasClosing = /(best regards|regards|sincerely|thanks|此致|敬礼|祝好)/i.test(text);
    const bodyLengthEnough = text.length >= 220;

    const missing: string[] = [];
    if (!hasSubject) missing.push('subject-line');
    if (!hasGreeting) missing.push('greeting');
    if (!hasClosing) missing.push('closing-signature');
    if (!bodyLengthEnough) missing.push('full-body-content');

    if (missing.length > 0) {
      return {
        valid: false,
        reason: 'review output is not a complete revised email',
        missing,
      };
    }

    if (suggestionOnlySignals.some((signal) => lower.includes(signal)) && !hasSubject) {
      return {
        valid: false,
        reason: 'review output contains suggestions only',
        missing: ['final-revised-email'],
      };
    }

    return { valid: true };
  }

  private tryParseJson(content: string): any | null {
    const trimmed = (content || '').trim();
    if (!trimmed) {
      return null;
    }
    try {
      return JSON.parse(trimmed);
    } catch {
      const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i)?.[1] || trimmed.match(/```\s*([\s\S]*?)```/i)?.[1];
      if (fenced) {
        try {
          return JSON.parse(fenced.trim());
        } catch {
          return null;
        }
      }
      const start = trimmed.indexOf('{');
      const end = trimmed.lastIndexOf('}');
      if (start >= 0 && end > start) {
        try {
          return JSON.parse(trimmed.slice(start, end + 1));
        } catch {
          return null;
        }
      }
      return null;
    }
  }
}
