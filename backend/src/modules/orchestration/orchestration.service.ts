import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import axios from 'axios';
import { Model, Types } from 'mongoose';
import { Observable, Subject } from 'rxjs';
import { Agent, AgentDocument } from '@agent/schemas/agent.schema';
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
  OrchestrationRun,
  OrchestrationRunDocument,
  OrchestrationRunStatus,
  OrchestrationRunTriggerType,
} from '../../shared/schemas/orchestration-run.schema';
import {
  OrchestrationRunTask,
  OrchestrationRunTaskDocument,
} from '../../shared/schemas/orchestration-run-task.schema';
import {
  AgentClientService,
  AsyncAgentTaskSnapshot,
} from '../agents-client/agent-client.service';
import { PlannerService } from './planner.service';
import { PlanningContextService } from './services/planning-context.service';
import { ExecutorSelectionService } from './services/executor-selection.service';
import { TaskClassificationService } from './services/task-classification.service';
import { TaskOutputValidationService } from './services/task-output-validation.service';
import {
  AddTaskToPlanDto,
  BatchUpdateTaskItemDto,
  BatchUpdateTasksDto,
  CompleteHumanTaskDto,
  CreatePlanFromPromptDto,
  DebugTaskStepDto,
  ReorderPlanTasksDto,
  ReplanPlanDto,
  ReassignTaskDto,
  RunPlanDto,
  UpdatePlanDto,
  UpdateTaskFullDto,
  UpdateTaskDraftDto,
} from './dto';
import { AgentRoleTier, canDelegateAcrossTier, normalizeAgentRoleTier } from '../../shared/role-tier';
import { inferDomainTypeFromText } from '../../shared/domain-context/domain-type.util';

const FULLY_EDITABLE_PLAN_STATUSES: OrchestrationPlanStatus[] = ['draft', 'planned', 'failed'];
const PARTIALLY_EDITABLE_PLAN_STATUSES: OrchestrationPlanStatus[] = ['paused'];
const PARTIALLY_EDITABLE_TASK_STATUSES: OrchestrationTaskStatus[] = ['pending', 'assigned', 'blocked', 'failed', 'cancelled'];

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
    @InjectModel(OrchestrationRun.name)
    private readonly orchestrationRunModel: Model<OrchestrationRunDocument>,
    @InjectModel(OrchestrationRunTask.name)
    private readonly orchestrationRunTaskModel: Model<OrchestrationRunTaskDocument>,
    private readonly plannerService: PlannerService,
    private readonly planningContextService: PlanningContextService,
    private readonly agentClientService: AgentClientService,
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
    const inferredDomainContext = this.inferDomainContext(prompt, dto.domainType);
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
        const autoRun = await this.executePlanRun(planId, 'autorun', { continueOnFailure: true });
        this.emitPlanStreamEvent(planId, 'plan.autorun.accepted', {
          planId,
          status: autoRun.status,
          runId: this.getEntityId(autoRun as any),
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
    const inferredDomainContext = this.inferDomainContext(prompt, dto.domainType);
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

      await this.setPlanStatus(planId, 'drafting');
      this.emitPlanStreamEvent(planId, 'plan.status.changed', {
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
        const autoRun = await this.executePlanRun(planId, 'autorun', { continueOnFailure: true });
        this.emitPlanStreamEvent(planId, 'plan.autorun.accepted', {
          planId,
          status: autoRun.status,
          runId: this.getEntityId(autoRun as any),
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
      updatePayload.domainContext = this.inferDomainContext(sourcePrompt, dto.domainType || plan.domainContext?.domainType);
    } else if (dto.domainType) {
      updatePayload.domainContext = this.inferDomainContext(plan.sourcePrompt || '', dto.domainType);
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

    const lastRunId = String(plan.lastRunId || '').trim();
    const lastRun = lastRunId
      ? await this.orchestrationRunModel.findOne({ _id: lastRunId }).exec()
      : await this.orchestrationRunModel
        .findOne({ planId: plan._id.toString() })
        .sort({ startedAt: -1 })
        .exec();

    return {
      ...plan.toObject(),
      tasks,
      planSession,
      lastRun,
    };
  }

  async listTasksByPlan(planId: string): Promise<OrchestrationTask[]> {
    return this.orchestrationTaskModel
      .find({ planId })
      .sort({ order: 1 })
      .exec();
  }

  async listPlanRuns(planId: string, limit = 20): Promise<OrchestrationRun[]> {
    await this.getPlanById(planId);
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    return this.orchestrationRunModel
      .find({ planId })
      .sort({ startedAt: -1 })
      .limit(safeLimit)
      .exec();
  }

  async getLatestPlanRun(planId: string): Promise<OrchestrationRun | null> {
    await this.getPlanById(planId);
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

  async addTaskToPlan(planId: string, dto: AddTaskToPlanDto): Promise<OrchestrationTask> {
    const plan = await this.orchestrationPlanModel.findOne({ _id: planId }).exec();
    if (!plan) {
      throw new NotFoundException('Plan not found');
    }
    this.assertPlanEditable(plan);

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

    await this.refreshPlanStats(planId);
    await this.syncPlanSessionTasks(planId);

    this.emitPlanStreamEvent(planId, 'plan.task.added', {
      planId,
      task: createdTask.toObject(),
    });

    await this.emitTaskLifecycleEvent({
      eventType: 'task.created',
      task: createdTask,
      status: createdTask.status,
      payload: {
        assignment: createdTask.assignment,
      },
    }).catch(() => undefined);

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
    this.assertPlanEditable(plan, task);

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

    await this.refreshPlanStats(planId);
    await this.syncPlanSessionTasks(planId);

    this.emitPlanStreamEvent(planId, 'plan.task.removed', {
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
    this.assertPlanEditable(plan);

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
    nextTaskIds.forEach((taskId, index) => {
      orderByTaskId.set(taskId, index);
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

    await this.syncPlanSessionTasks(planId);

    this.emitPlanStreamEvent(planId, 'plan.tasks.reordered', {
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
    this.assertPlanEditable(plan);

    const updates = Array.isArray(dto.updates) ? dto.updates : [];
    if (!updates.length) {
      throw new BadRequestException('updates is required');
    }

    const updateTaskIds = this.normalizeTaskIdList(updates.map((item) => item.taskId));
    await this.assertTaskIdsBelongToPlan(planId, updateTaskIds);

    const updatedTasks: OrchestrationTask[] = [];
    for (const updateItem of updates) {
      const updated = await this.updateTaskFullInternal(updateItem.taskId, updateItem, {
        emitPlanEvent: false,
        emitTaskLogMessage: 'Task updated in batch',
      });
      updatedTasks.push(updated);
    }

    await this.refreshPlanStats(planId);
    await this.syncPlanSessionTasks(planId);

    this.emitPlanStreamEvent(planId, 'plan.tasks.batch-updated', {
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
    this.assertPlanEditable(plan);

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

    await this.refreshPlanStats(planId);
    await this.syncPlanSessionTasks(planId);

    this.emitPlanStreamEvent(planId, 'plan.task.added', {
      planId,
      sourceTaskId,
      task: duplicatedTask.toObject(),
    });

    await this.emitTaskLifecycleEvent({
      eventType: 'task.created',
      task: duplicatedTask,
      status: duplicatedTask.status,
      payload: {
        sourceTaskId,
        assignment: duplicatedTask.assignment,
      },
    }).catch(() => undefined);

    return duplicatedTask;
  }

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

  async executePlanRun(
    planId: string,
    triggerType: OrchestrationRunTriggerType,
    options?: { scheduleId?: string; continueOnFailure?: boolean },
  ): Promise<OrchestrationRun> {
    const plan = await this.orchestrationPlanModel.findOne({ _id: planId }).exec();
    if (!plan) {
      throw new NotFoundException('Plan not found');
    }

    const templateTasks = await this.listTasksByPlan(planId);
    if (!templateTasks.length) {
      throw new BadRequestException('Plan has no tasks to run');
    }

    const requirementId = this.resolveRequirementIdFromPlan(plan);
    if (requirementId) {
      await this.tryUpdateRequirementStatus(requirementId, 'in_progress', 'orchestration plan started');
    }

    await this.setPlanStatus(planId, 'running');
    await this.setPlanSessionStatus(planId, 'running');

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
    this.emitPlanStreamEvent(planId, 'run.started', {
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

    const nextPlanStatus: OrchestrationPlanStatus =
      runStatus === 'completed'
        ? 'completed'
        : stats.waitingHumanTasks > 0
          ? 'paused'
          : 'failed';
    await this.setPlanStatus(planId, nextPlanStatus);
    await this.setPlanSessionStatus(planId, nextPlanStatus);
    await this.refreshPlanStats(planId);

    this.emitPlanStreamEvent(planId, runStatus === 'completed' ? 'run.completed' : 'run.failed', {
      planId,
      runId,
      status: runStatus,
      stats,
      completedAt,
    });

    if (requirementId && nextPlanStatus === 'completed') {
      await this.tryUpdateRequirementStatus(requirementId, 'review', 'orchestration plan passed auto review gate');
      await this.tryUpdateRequirementStatus(requirementId, 'done', 'orchestration plan completed');
    }

    const latestRun = await this.orchestrationRunModel.findOne({ _id: runId }).exec();
    if (!latestRun) {
      throw new NotFoundException('Run not found');
    }
    return latestRun;
  }

  private async executeRunTasks(
    plan: OrchestrationPlan,
    runId: string,
    options: { continueOnFailure: boolean },
  ): Promise<void> {
    let keepRunning = true;

    while (keepRunning) {
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
        const results = await Promise.all(runnableTasks.map((task) => this.executeRunTaskNode(runId, task)));
        if (!options.continueOnFailure && results.some((result) => result.status === 'failed')) {
          keepRunning = false;
        }
      } else {
        for (const task of runnableTasks) {
          const result = await this.executeRunTaskNode(runId, task);
          if (!options.continueOnFailure && result.status === 'failed') {
            keepRunning = false;
            break;
          }
        }
      }
    }
  }

  async reassignTask(taskId: string, dto: ReassignTaskDto): Promise<OrchestrationTask> {
    const task = await this.orchestrationTaskModel.findOne({ _id: taskId }).exec();
    if (!task) {
      throw new NotFoundException('Task not found');
    }

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
        throw this.buildTierGuardException('delegation_direction_forbidden', 'Delegation direction is not allowed by tier governance', {
          sourceAgentId: dto.sourceAgentId,
          sourceTier,
          targetTier,
          executorType: dto.executorType,
          executorId: normalizedExecutorId,
        });
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
      await this.updatePlanSessionTask(planId, taskId, {
        status: updated.status,
        executorType: dto.executorType,
        executorId: nextExecutorId,
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
  ): Promise<any> {
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

      this.emitPlanStreamEvent(updatedRunTask.planId, 'run.task.completed', {
        runId,
        runTaskId: taskId,
      });

      return updatedRunTask;
    }

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
    const planId = task.planId;
    if (planId) {
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

      await this.executeRunTaskNode(updatedRunTask.runId, updatedRunTask as unknown as OrchestrationRunTask);

      const runTasks = await this.orchestrationRunTaskModel.find({ runId: updatedRunTask.runId }).exec() as unknown as OrchestrationRunTask[];
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
    return this.updateTaskFullInternal(taskId, dto, {
      emitPlanEvent: false,
      emitTaskLogMessage: 'Task draft updated for step debugging',
    });
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
    this.assertPlanEditable(plan, task);

    if (task.status === 'in_progress' || task.status === 'completed') {
      throw new BadRequestException(`Task in "${task.status}" status cannot be edited`);
    }

    const setPayload: Record<string, any> = {};
    const normalizedTitle = dto.title === undefined ? undefined : String(dto.title || '').trim();
    const normalizedDescription =
      dto.description === undefined ? undefined : String(dto.description || '').trim();

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

    const updated = await this.orchestrationTaskModel
      .findOneAndUpdate(
        { _id: taskId },
        {
          $set: setPayload,
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

    await this.updatePlanSessionTask(planId, taskId, {
      input: updated.description,
      status: updated.status,
      executorType: updated.assignment?.executorType,
      executorId: updated.assignment?.executorId,
    });

    if (options.emitPlanEvent) {
      this.emitPlanStreamEvent(planId, 'plan.task.updated', {
        planId,
        task: updated.toObject(),
      });
    }

    return updated;
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
    const planDomainContext = await this.resolvePlanDomainContext(planId);
    const collaborationContext = this.buildOrchestrationCollaborationContext(task, {
      dependencyContext,
      executorAgentId: assignment.executorType === 'agent' ? assignment.executorId : undefined,
    });

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

    let requestedSessionId = `plan-${planId}-${assignment.executorId || 'unassigned'}`;
    let planSessionSnapshot: any = null;
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
      if (assignment.executorType === 'agent' && assignment.executorId) {
        planSessionSnapshot = await this.agentClientService.getOrCreatePlanSession(
          planId,
          assignment.executorId,
          task.title,
          {
            currentTaskId: taskId,
            domainContext: planDomainContext,
            collaborationContext,
          },
        );
        if (planSessionSnapshot?.id) {
          requestedSessionId = String(planSessionSnapshot.id);
        }
      }

      const accepted = await this.agentClientService.createAsyncAgentTask({
        agentId: assignment.executorId,
        prompt: taskPrompt,
        idempotencyKey: agentTaskIdempotencyKey,
        sessionContext: {
          source: 'orchestration',
          planId,
          orchestrationTaskId: taskId,
          sessionId: requestedSessionId,
          domainContext: planDomainContext,
          collaborationContext,
          runSummaries: Array.isArray(planSessionSnapshot?.runSummaries) ? planSessionSnapshot.runSummaries : [],
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

  private async executeRunTaskNode(
    runId: string,
    runTask: OrchestrationRunTask,
  ): Promise<{ status: OrchestrationTaskStatus; result?: string; error?: string }> {
    const runTaskId = this.getEntityId(runTask as Record<string, any>);
    const assignment = runTask.assignment || { executorType: 'unassigned' as const };
    const isExternalAction = this.taskClassificationService.isExternalActionTask(runTask.title, runTask.description);
    const researchTaskKind = this.taskClassificationService.detectResearchTaskKind(runTask.title, runTask.description);
    const isResearchTask = Boolean(researchTaskKind);
    const isReviewTask = this.taskClassificationService.isReviewTask(runTask.title, runTask.description);
    const dependencyContext = await this.buildRunDependencyContext(runId, runTask.dependencyTaskIds || []);
    const retryHint = this.getRetryFailureHint(runTask as any as OrchestrationTask);
    const planDomainContext = await this.resolvePlanDomainContext(runTask.planId);
    const collaborationContext = this.buildOrchestrationCollaborationContext(runTask as any as OrchestrationTask, {
      dependencyContext,
      executorAgentId: assignment.executorType === 'agent' ? assignment.executorId : undefined,
    });

    await this.orchestrationRunTaskModel
      .updateOne(
        { _id: runTaskId },
        {
          $set: {
            status: 'in_progress',
            startedAt: new Date(),
          },
          $push: {
            runLogs: {
              timestamp: new Date(),
              level: 'info',
              message: 'Run task execution started',
              metadata: assignment,
            },
          },
        },
      )
      .exec();

    this.emitPlanStreamEvent(runTask.planId, 'run.task.started', {
      runId,
      runTaskId,
      sourceTaskId: runTask.sourceTaskId,
    });

    if (assignment.executorType === 'employee') {
      await this.markRunTaskWaitingHuman(runTaskId, 'Waiting for human assignee');
      this.emitPlanStreamEvent(runTask.planId, 'run.task.updated', {
        runId,
        runTaskId,
        status: 'waiting_human',
      });
      return { status: 'waiting_human' };
    }

    if (assignment.executorType !== 'agent' || !assignment.executorId) {
      if (isExternalAction) {
        await this.markRunTaskWaitingHuman(runTaskId, 'External action requires manual handling');
        this.emitPlanStreamEvent(runTask.planId, 'run.task.updated', {
          runId,
          runTaskId,
          status: 'waiting_human',
        });
        return { status: 'waiting_human' };
      }
      await this.markRunTaskFailed(runTaskId, 'No agent assigned for execution');
      this.emitPlanStreamEvent(runTask.planId, 'run.task.failed', {
        runId,
        runTaskId,
        error: 'No agent assigned for execution',
      });
      return { status: 'failed', error: 'No agent assigned for execution' };
    }

    if (isExternalAction) {
      const hasEmailCapability = await this.executorSelectionService.hasEmailExecutionCapability(assignment.executorId);
      if (!hasEmailCapability) {
        await this.markRunTaskWaitingHuman(runTaskId, 'Agent lacks email tool capability, switched to human review');
        this.emitPlanStreamEvent(runTask.planId, 'run.task.updated', {
          runId,
          runTaskId,
          status: 'waiting_human',
        });
        return { status: 'waiting_human' };
      }
    }

    let requestedSessionId = `run-${runId}-${assignment.executorId || 'unassigned'}`;
    let planSessionSnapshot: any = null;
    const runtimeTaskType = this.resolveAgentRuntimeTaskType(runTask.title, runTask.description, {
      isExternalAction,
      isResearchTask,
      isReviewTask,
    });
    const runtimeChannelHint: 'native' | 'opencode' = runtimeTaskType === 'development' ? 'opencode' : 'native';
    const taskPrompt = this.buildTaskDescription(runTask.description, {
      dependencyContext,
      isExternalAction,
      isResearchTask,
      isReviewTask,
      researchTaskKind: researchTaskKind || undefined,
      retryHint,
    });
    const agentTaskIdempotencyKey = `orch-run:${runId}:${runTaskId}:${new Date().getTime()}`;

    try {
      if (assignment.executorType === 'agent' && assignment.executorId) {
        planSessionSnapshot = await this.agentClientService.getOrCreatePlanSession(
          runTask.planId,
          assignment.executorId,
          runTask.title,
          {
            currentTaskId: runTaskId,
            domainContext: planDomainContext,
            collaborationContext,
          },
        );
        if (planSessionSnapshot?.id) {
          requestedSessionId = String(planSessionSnapshot.id);
        }
      }

      const accepted = await this.agentClientService.createAsyncAgentTask({
        agentId: assignment.executorId,
        prompt: taskPrompt,
        idempotencyKey: agentTaskIdempotencyKey,
        sessionContext: {
          source: 'orchestration',
          planId: runTask.planId,
          runId,
          orchestrationRunTaskId: runTaskId,
          sourceTaskId: runTask.sourceTaskId,
          sessionId: requestedSessionId,
          domainContext: planDomainContext,
          collaborationContext,
          runSummaries: Array.isArray(planSessionSnapshot?.runSummaries) ? planSessionSnapshot.runSummaries : [],
          dependencies: runTask.dependencyTaskIds,
          dependencyContext,
          runtimeTaskType,
          runtimeChannelHint,
          externalActionValidationRequired: isExternalAction,
          researchTaskKind,
          reviewValidationRequired: isReviewTask,
        },
      });

      await this.orchestrationRunTaskModel
        .updateOne(
          { _id: runTaskId },
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
          await this.markRunTaskFailed(runTaskId, `Research output validation failed: ${validation.reason}${detail}`);
          return { status: 'failed', error: validation.reason };
        }
      }

      if (isReviewTask) {
        const validation = this.taskOutputValidationService.validateReviewOutput(output);
        if (!validation.valid) {
          const detail = validation.missing?.length
            ? `; missing=${validation.missing.join(',')}`
            : '';
          await this.markRunTaskFailed(runTaskId, `Review output validation failed: ${validation.reason}${detail}`);
          return { status: 'failed', error: validation.reason };
        }
      }

      if (isExternalAction) {
        const proof = this.taskOutputValidationService.extractEmailSendProof(output);
        if (!proof.valid) {
          await this.markRunTaskWaitingHuman(
            runTaskId,
            'External action execution lacks verifiable proof, waiting for human confirmation',
            output,
          );
          this.emitPlanStreamEvent(runTask.planId, 'run.task.updated', {
            runId,
            runTaskId,
            status: 'waiting_human',
          });
          return { status: 'waiting_human', result: output };
        }
      }

      await this.orchestrationRunTaskModel
        .updateOne(
          { _id: runTaskId },
          {
            $set: {
              status: 'completed',
              completedAt: new Date(),
              sessionId: execution.sessionId || requestedSessionId,
              result: {
                summary: output.slice(0, 500),
                output,
              },
            },
            $push: {
              runLogs: {
                timestamp: new Date(),
                level: 'info',
                message: 'Run task execution completed',
              },
            },
          },
        )
        .exec();

      this.emitPlanStreamEvent(runTask.planId, 'run.task.completed', {
        runId,
        runTaskId,
        sourceTaskId: runTask.sourceTaskId,
      });

      return { status: 'completed', result: output };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown execution failure';
      await this.markRunTaskFailed(runTaskId, message);
      this.emitPlanStreamEvent(runTask.planId, 'run.task.failed', {
        runId,
        runTaskId,
        sourceTaskId: runTask.sourceTaskId,
        error: message,
      });
      return { status: 'failed', error: message };
    }
  }

  private async buildRunDependencyContext(runId: string, dependencySourceTaskIds: string[]): Promise<string> {
    if (!dependencySourceTaskIds.length) {
      return '';
    }

    const dependencyTasks = await this.orchestrationRunTaskModel
      .find({
        runId,
        sourceTaskId: { $in: dependencySourceTaskIds },
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

  private async markRunTaskFailed(runTaskId: string, errorMessage: string): Promise<void> {
    await this.orchestrationRunTaskModel
      .updateOne(
        { _id: runTaskId },
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

  private async markRunTaskWaitingHuman(runTaskId: string, reason: string, output?: string): Promise<void> {
    await this.orchestrationRunTaskModel
      .updateOne(
        { _id: runTaskId },
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
    if (tasks.some((task) => task.status === 'failed')) {
      return 'failed';
    }
    if (tasks.some((task) => task.status === 'waiting_human')) {
      return 'failed';
    }
    return 'failed';
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
    const scopeId = task.planId || `schedule-${taskId}`;
    return this.executeTaskNode(scopeId, task);
  }

  private requirePlanId(task: OrchestrationTask): string {
    if (!task.planId) {
      throw new BadRequestException('Task is not associated with orchestration plan');
    }
    return task.planId;
  }

  private assertPlanEditable(
    plan: OrchestrationPlan,
    task?: OrchestrationTask,
  ): 'full' | 'partial' {
    if (FULLY_EDITABLE_PLAN_STATUSES.includes(plan.status)) {
      return 'full';
    }
    if (PARTIALLY_EDITABLE_PLAN_STATUSES.includes(plan.status)) {
      if (!task) {
        throw new BadRequestException(`Plan in "${plan.status}" status allows task-level partial editing only`);
      }
      if (!PARTIALLY_EDITABLE_TASK_STATUSES.includes(task.status)) {
        throw new BadRequestException(
          `Task in "${task.status}" status cannot be edited when plan is "${plan.status}"`,
        );
      }
      return 'partial';
    }

    throw new BadRequestException(`Plan in "${plan.status}" status cannot be edited`);
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
    const count = await this.orchestrationTaskModel.countDocuments({
      planId,
      _id: { $in: taskIds },
    });
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

  private hasCyclicDependency(
    tasks: Array<{ id: string; dependencyTaskIds: string[] }>,
  ): boolean {
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

  private async syncPlanSessionTasks(planId: string): Promise<void> {
    const plan = await this.orchestrationPlanModel.findOne({ _id: planId }).select({ title: 1 }).lean().exec();
    const tasks = await this.orchestrationTaskModel
      .find({ planId })
      .sort({ order: 1 })
      .lean<OrchestrationTask[]>()
      .exec();

    const snapshots = tasks.map((task, index) => ({
      taskId: this.getEntityId(task as any),
      order: index,
      title: task.title,
      status: task.status,
      input: task.description,
      output: task.result?.output,
      error: task.result?.error,
      executorType: task.assignment?.executorType,
      executorId: task.assignment?.executorId,
      updatedAt: new Date(),
    }));

    await this.planSessionModel
      .updateOne(
        { planId },
        {
          $set: {
            ...(plan?.title ? { title: plan.title } : {}),
            tasks: snapshots,
          },
        },
        { upsert: true },
      )
      .exec();
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
      completedTasks: 0,
      failedTasks: 0,
      waitingHumanTasks: 0,
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

    await this.agentClientService.publishTaskLifecycleEvent({
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

  private async resolvePlanDomainContext(planId: string): Promise<Record<string, unknown> | undefined> {
    const plan = await this.orchestrationPlanModel
      .findOne({ _id: planId })
      .select({ domainContext: 1, sourcePrompt: 1 })
      .lean<{ domainContext?: Record<string, unknown>; sourcePrompt?: string }>()
      .exec();
    if (plan?.domainContext && typeof plan.domainContext === 'object') {
      return plan.domainContext;
    }
    if (!plan?.sourcePrompt) {
      return undefined;
    }
    return this.inferDomainContext(String(plan.sourcePrompt));
  }

  private inferDomainContext(prompt: string, preferredDomainType?: string): Record<string, unknown> {
    const normalizedPrompt = String(prompt || '').trim();
    const domainType = this.inferDomainType(normalizedPrompt, preferredDomainType);
    return {
      domainType,
      description: normalizedPrompt.slice(0, 500),
    };
  }

  private inferDomainType(prompt: string, preferredDomainType?: string): string {
    return inferDomainTypeFromText({
      prompt,
      preferredDomainType,
    });
  }

  private buildOrchestrationCollaborationContext(
    task: OrchestrationTask,
    options: { dependencyContext: string; executorAgentId?: string },
  ): Record<string, unknown> {
    return {
      mode: 'orchestration',
      roleInPlan: 'execute_assigned_task',
      currentTaskId: this.getEntityId(task as any),
      currentTaskTitle: task.title,
      executorAgentId: options.executorAgentId,
      dependencies: task.dependencyTaskIds || [],
      upstreamOutputs: options.dependencyContext,
    };
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
