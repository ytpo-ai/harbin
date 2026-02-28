import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Agent, AgentDocument } from '../../shared/schemas/agent.schema';
import { Tool, ToolDocument } from '../../shared/schemas/tool.schema';
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
import { Task } from '../../shared/types';
import { AgentService } from '../agents/agent.service';
import { PlannerService } from './planner.service';
import { SessionManagerService } from './session-manager.service';
import { CompleteHumanTaskDto, CreatePlanFromPromptDto, ReassignTaskDto, RunPlanDto } from './dto';

@Injectable()
export class OrchestrationService {
  private readonly runningPlans = new Set<string>();

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
    private readonly plannerService: PlannerService,
    private readonly agentService: AgentService,
    private readonly sessionManagerService: SessionManagerService,
  ) {}

  async createPlanFromPrompt(
    organizationId: string,
    createdBy: string,
    dto: CreatePlanFromPromptDto,
  ): Promise<any> {
    const planningResult = await this.plannerService.planFromPrompt({
      prompt: dto.prompt,
      mode: dto.mode,
      plannerAgentId: dto.plannerAgentId,
    });

    if (!planningResult.tasks?.length) {
      throw new BadRequestException('Planner did not produce any tasks');
    }

    const plan = await new this.orchestrationPlanModel({
      organizationId,
      title: dto.title || this.derivePlanTitle(dto.prompt),
      sourcePrompt: dto.prompt,
      status: 'planned',
      strategy: {
        plannerAgentId: planningResult.plannerAgentId,
        mode: planningResult.mode,
      },
      stats: {
        totalTasks: planningResult.tasks.length,
        completedTasks: 0,
        failedTasks: 0,
        waitingHumanTasks: 0,
      },
      taskIds: [],
      metadata: {
        strategyNote: planningResult.strategyNote,
      },
      createdBy,
    }).save();

    const tasksToCreate = [] as Partial<OrchestrationTask>[];
    for (let i = 0; i < planningResult.tasks.length; i++) {
      const task = planningResult.tasks[i];
      const assignment = await this.selectExecutor(organizationId, task.title, task.description);
      tasksToCreate.push({
        organizationId,
        planId: plan._id.toString(),
        title: task.title,
        description: task.description,
        priority: task.priority,
        status: assignment.executorType === 'unassigned' ? 'pending' : 'assigned',
        order: i,
        dependencyTaskIds: [],
        assignment,
        runLogs: [{
          timestamp: new Date(),
          level: 'info',
          message: `Task created and assigned to ${assignment.executorType}`,
          metadata: {
            executorId: assignment.executorId,
            reason: assignment.reason,
          },
        }],
      });
    }

    const createdTasks = await this.orchestrationTaskModel.insertMany(tasksToCreate);

    const idByIndex = createdTasks.map((task) => task._id.toString());
    await Promise.all(
      createdTasks.map((task, index) => {
        const deps = planningResult.tasks[index].dependencies
          .map((depIndex) => idByIndex[depIndex])
          .filter(Boolean);
        return this.orchestrationTaskModel
          .updateOne({ _id: task._id }, { $set: { dependencyTaskIds: deps } })
          .exec();
      }),
    );

    await this.orchestrationPlanModel
      .updateOne(
        { _id: plan._id },
        {
          $set: {
            taskIds: idByIndex,
          },
        },
      )
      .exec();

    const latestPlan = await this.getPlanById(organizationId, plan._id.toString());
    if (dto.autoRun) {
      await this.runPlan(organizationId, plan._id.toString(), { continueOnFailure: true });
      return this.getPlanById(organizationId, plan._id.toString());
    }

    return latestPlan;
  }

  async listPlans(organizationId: string): Promise<OrchestrationPlan[]> {
    return this.orchestrationPlanModel.find({ organizationId }).sort({ createdAt: -1 }).exec();
  }

  async deletePlan(organizationId: string, planId: string): Promise<{ success: boolean; deletedTasks: number }> {
    const plan = await this.orchestrationPlanModel.findOne({ _id: planId, organizationId }).exec();
    if (!plan) {
      throw new NotFoundException('Plan not found');
    }

    const taskDeleteResult = await this.orchestrationTaskModel
      .deleteMany({ organizationId, planId: plan._id.toString() })
      .exec();

    await this.orchestrationPlanModel.deleteOne({ _id: plan._id, organizationId }).exec();

    return {
      success: true,
      deletedTasks: taskDeleteResult.deletedCount || 0,
    };
  }

  async getPlanById(organizationId: string, planId: string): Promise<any> {
    const plan = await this.orchestrationPlanModel.findOne({ _id: planId, organizationId }).exec();
    if (!plan) {
      throw new NotFoundException('Plan not found');
    }

    const tasks = await this.orchestrationTaskModel
      .find({ planId: plan._id.toString(), organizationId })
      .sort({ order: 1 })
      .exec();

    return {
      ...plan.toObject(),
      tasks,
    };
  }

  async listTasksByPlan(organizationId: string, planId: string): Promise<OrchestrationTask[]> {
    return this.orchestrationTaskModel
      .find({ organizationId, planId })
      .sort({ order: 1 })
      .exec();
  }

  async runPlan(organizationId: string, planId: string, dto: RunPlanDto): Promise<any> {
    const plan = await this.orchestrationPlanModel.findOne({ _id: planId, organizationId }).exec();
    if (!plan) {
      throw new NotFoundException('Plan not found');
    }

    await this.setPlanStatus(planId, organizationId, 'running');
    const continueOnFailure = dto.continueOnFailure ?? false;

    let keepRunning = true;
    while (keepRunning) {
      const tasks = await this.listTasksByPlan(organizationId, planId);
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
        const results = await Promise.all(runnableTasks.map((task) => this.executeTaskNode(organizationId, planId, task)));
        if (!continueOnFailure && results.some((result) => result.status === 'failed')) {
          keepRunning = false;
        }
      } else {
        for (const task of runnableTasks) {
          const result = await this.executeTaskNode(organizationId, planId, task);
          if (!continueOnFailure && result.status === 'failed') {
            keepRunning = false;
            break;
          }
        }
      }
    }

    await this.refreshPlanStats(organizationId, planId);
    const latest = await this.getPlanById(organizationId, planId);
    const nextStatus = this.derivePlanStatus(latest.tasks);
    await this.setPlanStatus(planId, organizationId, nextStatus);
    return this.getPlanById(organizationId, planId);
  }

  async runPlanAsync(
    organizationId: string,
    planId: string,
    dto: RunPlanDto,
  ): Promise<{ accepted: boolean; planId: string; status: string; alreadyRunning?: boolean }> {
    const plan = await this.orchestrationPlanModel.findOne({ _id: planId, organizationId }).exec();
    if (!plan) {
      throw new NotFoundException('Plan not found');
    }

    const runKey = `${organizationId}:${planId}`;
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
      this.runPlan(organizationId, planId, dto)
        .catch(async (error) => {
          const message = error instanceof Error ? error.message : 'Async plan run failed';
          await this.setPlanStatus(planId, organizationId, 'failed');
          await this.orchestrationPlanModel
            .updateOne(
              { _id: planId, organizationId },
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

  async reassignTask(organizationId: string, taskId: string, dto: ReassignTaskDto): Promise<OrchestrationTask> {
    const task = await this.orchestrationTaskModel.findOne({ _id: taskId, organizationId }).exec();
    if (!task) {
      throw new NotFoundException('Task not found');
    }

    if (dto.executorType !== 'unassigned' && !dto.executorId) {
      throw new BadRequestException('executorId is required when executorType is agent or employee');
    }

    const updated = await this.orchestrationTaskModel
      .findOneAndUpdate(
        { _id: taskId, organizationId },
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
    return updated;
  }

  async completeHumanTask(
    organizationId: string,
    taskId: string,
    dto: CompleteHumanTaskDto,
  ): Promise<OrchestrationTask> {
    const task = await this.orchestrationTaskModel.findOne({ _id: taskId, organizationId }).exec();
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    if (task.assignment.executorType !== 'employee') {
      throw new BadRequestException('Only employee tasks can be completed manually');
    }

    const updated = await this.orchestrationTaskModel
      .findOneAndUpdate(
        { _id: taskId, organizationId },
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
    await this.refreshPlanStats(organizationId, task.planId);
    return updated;
  }

  async retryTask(
    organizationId: string,
    taskId: string,
  ): Promise<{ task: OrchestrationTask; run: { accepted: boolean; planId: string; status: string; alreadyRunning?: boolean } }> {
    const task = await this.orchestrationTaskModel.findOne({ _id: taskId, organizationId }).exec();
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    if (task.status !== 'failed') {
      throw new BadRequestException('Only failed tasks can be retried');
    }

    const nextStatus = task.assignment?.executorType === 'unassigned' ? 'pending' : 'assigned';

    const updatedTask = await this.orchestrationTaskModel
      .findOneAndUpdate(
        { _id: taskId, organizationId },
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

    await this.refreshPlanStats(organizationId, task.planId);
    const run = await this.runPlanAsync(organizationId, task.planId, { continueOnFailure: true });

    return {
      task: updatedTask,
      run,
    };
  }

  private async executeTaskNode(
    organizationId: string,
    planId: string,
    task: OrchestrationTask,
  ): Promise<{ status: OrchestrationTaskStatus; result?: string; error?: string }> {
    const taskId = this.getEntityId(task as Record<string, any>);
    const assignment = task.assignment || { executorType: 'unassigned' as const };
    const isExternalAction = this.isExternalActionTask(task.title, task.description);
    const researchTaskKind = this.detectResearchTaskKind(task.title, task.description);
    const isResearchTask = Boolean(researchTaskKind);
    const isReviewTask = this.isReviewTask(task.title, task.description);
    const dependencyContext = await this.buildDependencyContext(organizationId, planId, task.dependencyTaskIds || []);
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

      return { status: 'waiting_human' };
    }

    if (assignment.executorType !== 'agent' || !assignment.executorId) {
      if (isExternalAction) {
        await this.markTaskWaitingHuman(taskId, 'External action requires manual handling');
        return { status: 'waiting_human' };
      }
      await this.markTaskFailed(taskId, 'No agent assigned for execution');
      return { status: 'failed', error: 'No agent assigned for execution' };
    }

    if (isExternalAction) {
      const agent = await this.agentModel.findById(assignment.executorId).exec();
      const hasEmailCapability = await this.hasEmailExecutionCapability(agent || null);
      if (!hasEmailCapability) {
        await this.markTaskWaitingHuman(taskId, 'Agent lacks email tool capability, switched to human review');
        return { status: 'waiting_human' };
      }
    }

    const session = await this.sessionManagerService.getOrCreateAgentSession(
      organizationId,
      assignment.executorId,
      planId,
      `Plan ${planId} / ${task.title}`,
      taskId,
    );
    const sessionId = this.getEntityId(session as Record<string, any>);

    const taskPayload: Task = {
      title: task.title,
      description: this.buildTaskDescription(task.description, {
        dependencyContext,
        isExternalAction,
        isResearchTask,
        isReviewTask,
        researchTaskKind: researchTaskKind || undefined,
        retryHint,
      }),
      type: 'orchestration',
      priority: task.priority,
      status: 'pending',
      assignedAgents: [assignment.executorId],
      teamId: planId,
      messages: [
        {
          role: 'system',
          content: dependencyContext || 'No dependency context available.',
          timestamp: new Date(),
        },
        {
          role: 'user',
          content: this.buildTaskDescription(task.description, {
            dependencyContext,
            isExternalAction,
            isResearchTask,
            isReviewTask,
            researchTaskKind: researchTaskKind || undefined,
            retryHint,
          }),
          timestamp: new Date(),
        },
      ],
    };

    try {
      const output = await this.agentService.executeTask(assignment.executorId, taskPayload, {
        teamContext: {
          planId,
          orchestrationTaskId: taskId,
          sessionId,
          dependencies: task.dependencyTaskIds,
          dependencyContext,
          externalActionValidationRequired: isExternalAction,
          researchTaskKind,
          reviewValidationRequired: isReviewTask,
        },
      });

      if (isResearchTask) {
        const validation = this.validateResearchOutput(output, researchTaskKind!);
        if (!validation.valid) {
          const detail = validation.missing?.length
            ? `; missing=${validation.missing.join(',')}`
            : '';
          await this.markTaskFailed(taskId, `Research output validation failed: ${validation.reason}${detail}`);
          return { status: 'failed', error: validation.reason };
        }
      }

      if (isReviewTask) {
        const validation = this.validateReviewOutput(output);
        if (!validation.valid) {
          const detail = validation.missing?.length
            ? `; missing=${validation.missing.join(',')}`
            : '';
          await this.markTaskFailed(taskId, `Review output validation failed: ${validation.reason}${detail}`);
          return { status: 'failed', error: validation.reason };
        }
      }

      if (isExternalAction) {
        const proof = this.extractEmailSendProof(output);
        if (!proof.valid) {
          await this.markTaskWaitingHuman(
            taskId,
            'External action execution lacks verifiable proof, waiting for human confirmation',
            output,
          );
          return { status: 'waiting_human' };
        }
      }

      await this.sessionManagerService.appendMessages(organizationId, sessionId, [
        {
          role: 'user',
          content: task.description,
          metadata: {
            taskId,
          },
        },
        {
          role: 'assistant',
          content: output,
          metadata: {
            taskId,
          },
        },
      ]);

      await this.orchestrationTaskModel
        .updateOne(
          { _id: taskId },
          {
            $set: {
              status: 'completed',
              completedAt: new Date(),
              sessionId,
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

      return { status: 'completed', result: output };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown execution error';
      await this.markTaskFailed(taskId, message);
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
        this.buildResearchOutputContract(researchTaskKind || 'generic_research'),
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

  private async buildDependencyContext(
    organizationId: string,
    planId: string,
    dependencyTaskIds: string[],
  ): Promise<string> {
    if (!dependencyTaskIds.length) {
      return '';
    }

    const dependencyTasks = await this.orchestrationTaskModel
      .find({
        organizationId,
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

  private async refreshPlanStats(organizationId: string, planId: string): Promise<void> {
    const tasks = await this.orchestrationTaskModel.find({ organizationId, planId }).exec();
    const stats = {
      totalTasks: tasks.length,
      completedTasks: tasks.filter((task) => task.status === 'completed').length,
      failedTasks: tasks.filter((task) => task.status === 'failed').length,
      waitingHumanTasks: tasks.filter((task) => task.status === 'waiting_human').length,
    };

    await this.orchestrationPlanModel
      .updateOne(
        { _id: planId, organizationId },
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
    organizationId: string,
    status: OrchestrationPlanStatus,
  ): Promise<void> {
    await this.orchestrationPlanModel
      .updateOne(
        { _id: planId, organizationId },
        {
          $set: {
            status,
          },
        },
      )
      .exec();
  }

  private derivePlanTitle(prompt: string): string {
    return prompt.length > 40 ? `${prompt.slice(0, 40)}...` : prompt;
  }

  private async selectExecutor(
    organizationId: string,
    title: string,
    description: string,
  ): Promise<{ executorType: 'agent' | 'employee' | 'unassigned'; executorId?: string; reason: string }> {
    const emailTask = this.isEmailTask(title, description);
    const researchTask = this.isResearchTask(title, description);
    const text = `${title} ${description}`.toLowerCase();
    const keywords = text
      .split(/[^a-zA-Z0-9\u4e00-\u9fa5]+/)
      .filter((item) => item.length >= 2)
      .slice(0, 20);

    const [agents, employees] = await Promise.all([
      this.agentModel.find({ isActive: true }).exec(),
      this.employeeModel
        .find({
          organizationId,
          status: { $in: [EmployeeStatus.ACTIVE, EmployeeStatus.PROBATION] },
        })
        .exec(),
    ]);

    const emailCapableAgentIdSet = await this.getEmailCapableAgentIdSet(agents);
    const researchCapableAgentIdSet = this.getResearchCapableAgentIdSet(agents);

    const agentCandidates = agents
      .map((agent) => {
        const context = `${agent.name} ${agent.description} ${(agent.capabilities || []).join(' ')}`.toLowerCase();
        const score = keywords.reduce((acc, keyword) => (context.includes(keyword) ? acc + 1 : acc), 0);
        return { id: agent._id.toString(), score };
      })
      .sort((a, b) => b.score - a.score);

    const employeeCandidates = employees
      .map((employee) => {
        const context = `${employee.name || ''} ${employee.title || ''} ${employee.description || ''} ${(employee.capabilities || []).join(' ')}`.toLowerCase();
        const score = keywords.reduce((acc, keyword) => (context.includes(keyword) ? acc + 1 : acc), 0);
        return { id: employee.id, score, type: employee.type };
      })
      .sort((a, b) => b.score - a.score);

    const bestAgent = agentCandidates[0];
    const bestEmployee = employeeCandidates[0];

    if (emailTask) {
      const emailAgent = agentCandidates.find((candidate) => emailCapableAgentIdSet.has(candidate.id));
      if (emailAgent) {
        return {
          executorType: 'agent',
          executorId: emailAgent.id,
          reason: `Email task routed to mail-capable agent score=${emailAgent.score}`,
        };
      }

      const humanEmployee = employees.find((employee) => employee.type === EmployeeType.HUMAN);
      if (humanEmployee) {
        return {
          executorType: 'employee',
          executorId: humanEmployee.id,
          reason: 'Email task routed to human due to missing mail tool capability',
        };
      }

      return {
        executorType: 'unassigned',
        reason: 'Email task requires tool/credential, manual assignment required',
      };
    }

    if (researchTask) {
      const researchAgent = agentCandidates.find((candidate) => researchCapableAgentIdSet.has(candidate.id));
      if (researchAgent) {
        return {
          executorType: 'agent',
          executorId: researchAgent.id,
          reason: `Research task routed to research-capable agent score=${researchAgent.score}`,
        };
      }
    }

    if ((!bestAgent || bestAgent.score <= 0) && (!bestEmployee || bestEmployee.score <= 0)) {
      const fallbackAgent = agents[0];
      if (fallbackAgent?._id) {
        return {
          executorType: 'agent',
          executorId: fallbackAgent._id.toString(),
          reason: 'Fallback assignment to first active agent (no keyword match)',
        };
      }
      return {
        executorType: 'unassigned',
        reason: 'No matching capability found, manual assignment required',
      };
    }

    if ((bestAgent?.score || 0) >= (bestEmployee?.score || 0)) {
      return {
        executorType: 'agent',
        executorId: bestAgent.id,
        reason: `Best capability match score=${bestAgent.score}`,
      };
    }

    if (bestEmployee.type === EmployeeType.AGENT && bestEmployee.id) {
      const mappedEmployee = employees.find((item) => item.id === bestEmployee.id);
      if (mappedEmployee?.agentId) {
        return {
          executorType: 'agent',
          executorId: mappedEmployee.agentId,
          reason: `Mapped from agent employee score=${bestEmployee.score}`,
        };
      }
    }

    return {
      executorType: 'employee',
      executorId: bestEmployee.id,
      reason: `Best human assignment score=${bestEmployee.score}`,
    };
  }

  private isExternalActionTask(title: string, description: string): boolean {
    return this.isEmailTask(title, description);
  }

  private isEmailTask(title: string, description: string): boolean {
    const text = `${title} ${description}`.toLowerCase();
    return (
      text.includes('send email') ||
      text.includes('email to') ||
      text.includes('发送邮件') ||
      text.includes('发邮件') ||
      text.includes('gmail') ||
      text.includes('@')
    );
  }

  private isResearchTask(title: string, description: string): boolean {
    const text = `${title} ${description}`.toLowerCase();
    return (
      text.includes('research') ||
      text.includes('search') ||
      text.includes('compile') ||
      text.includes('population') ||
      text.includes('most populous') ||
      text.includes('调研') ||
      text.includes('检索') ||
      text.includes('汇总')
    );
  }

  private async getEmailCapableAgentIdSet(agents: Agent[]): Promise<Set<string>> {
    const toolIds = Array.from(new Set(agents.flatMap((agent) => agent.tools || []).filter(Boolean)));
    if (!toolIds.length) {
      return new Set();
    }

    const tools = await this.toolModel.find({ id: { $in: toolIds }, enabled: true }).exec();
    const emailToolIdSet = new Set(
      tools
        .filter((tool) => this.isEmailTool(tool))
        .map((tool) => tool.id),
    );

    return new Set(
      agents
        .filter((agent) => (agent.tools || []).some((toolId) => emailToolIdSet.has(toolId)))
        .map((agent) => this.getEntityId(agent as unknown as Record<string, any>))
        .filter(Boolean),
    );
  }

  private getResearchCapableAgentIdSet(agents: Agent[]): Set<string> {
    const researchToolSet = new Set(['websearch', 'webfetch', 'content_extract']);
    return new Set(
      agents
        .filter((agent) => (agent.tools || []).some((toolId) => researchToolSet.has(toolId)))
        .map((agent) => this.getEntityId(agent as unknown as Record<string, any>))
        .filter(Boolean),
    );
  }

  private async hasEmailExecutionCapability(agent: Agent | null): Promise<boolean> {
    if (!agent) {
      return false;
    }
    const toolIds = (agent.tools || []).filter(Boolean);
    if (!toolIds.length) {
      return false;
    }
    const tools = await this.toolModel.find({ id: { $in: toolIds }, enabled: true }).exec();
    return tools.some((tool) => this.isEmailTool(tool));
  }

  private isEmailTool(tool: Tool): boolean {
    const text = `${tool.id} ${tool.name} ${tool.description} ${tool.category}`.toLowerCase();
    return text.includes('gmail') || text.includes('email') || text.includes('mail');
  }

  private requiresResearchQualityValidation(title: string, description: string): boolean {
    return Boolean(this.detectResearchTaskKind(title, description));
  }

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
