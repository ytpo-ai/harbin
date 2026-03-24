import { Injectable } from '@nestjs/common';
import { Observable } from 'rxjs';
import {
  AddTaskToPlanDto,
  BatchUpdateTasksDto,
  CompleteHumanTaskDto,
  CreatePlanFromPromptDto,
  DebugTaskStepDto,
  ReorderPlanTasksDto,
  ReplanPlanDto,
  ReassignTaskDto,
  RunPlanDto,
  UpdatePlanDto,
  UpdateTaskDraftDto,
  UpdateTaskFullDto,
} from './dto';
import { OrchestrationPlan } from '../../shared/schemas/orchestration-plan.schema';
import {
  OrchestrationTask,
  OrchestrationTaskStatus,
} from '../../shared/schemas/orchestration-task.schema';
import {
  OrchestrationRun,
  OrchestrationRunTriggerType,
} from '../../shared/schemas/orchestration-run.schema';
import { OrchestrationRunTask } from '../../shared/schemas/orchestration-run-task.schema';
import { PlanManagementService } from './services/plan-management.service';
import { TaskManagementService } from './services/task-management.service';
import { PlanExecutionService } from './services/plan-execution.service';
import { TaskLifecycleService } from './services/task-lifecycle.service';
import { PlanStatsService } from './services/plan-stats.service';
import { PlanEventStreamService } from './services/plan-event-stream.service';
import { OrchestrationContextService } from './services/orchestration-context.service';

@Injectable()
export class OrchestrationService {
  constructor(
    private readonly planManagementService: PlanManagementService,
    private readonly taskManagementService: TaskManagementService,
    private readonly planExecutionService: PlanExecutionService,
    private readonly taskLifecycleService: TaskLifecycleService,
    private readonly planStatsService: PlanStatsService,
    private readonly planEventStreamService: PlanEventStreamService,
    private readonly orchestrationContextService: OrchestrationContextService,
  ) {}

  async createPlanFromPrompt(createdBy: string, dto: CreatePlanFromPromptDto): Promise<any> {
    return this.planManagementService.createPlanFromPrompt(createdBy, dto);
  }

  async streamPlanEvents(planId: string): Promise<Observable<any>> {
    return this.planEventStreamService.streamPlanEvents(planId);
  }

  async listPlans(): Promise<OrchestrationPlan[]> {
    return this.planManagementService.listPlans();
  }

  async replanPlan(planId: string, dto: ReplanPlanDto): Promise<any> {
    return this.planManagementService.replanPlan(planId, dto);
  }

  async replanPlanAsync(planId: string, dto: ReplanPlanDto): Promise<any> {
    return this.planManagementService.replanPlanAsync(planId, dto);
  }

  async startGeneration(planId: string): Promise<{ accepted: boolean }> {
    return this.planManagementService.startGeneration(planId);
  }

  async generateNext(planId: string): Promise<{ accepted: boolean }> {
    return this.planManagementService.generateNext(planId);
  }

  async updatePlan(planId: string, dto: UpdatePlanDto): Promise<any> {
    return this.planManagementService.updatePlan(planId, dto);
  }

  async deletePlan(planId: string): Promise<{ success: boolean; deletedTasks: number }> {
    return this.planManagementService.deletePlan(planId);
  }

  async getPlanById(planId: string): Promise<any> {
    return this.planManagementService.getPlanById(planId);
  }

  async listTasksByPlan(planId: string): Promise<OrchestrationTask[]> {
    return this.taskManagementService.listTasksByPlan(planId);
  }

  async listPlanRuns(planId: string, limit = 20): Promise<OrchestrationRun[]> {
    return this.planExecutionService.listPlanRuns(planId, limit);
  }

  async getLatestPlanRun(planId: string): Promise<OrchestrationRun | null> {
    return this.planExecutionService.getLatestPlanRun(planId);
  }

  async getRunById(runId: string): Promise<OrchestrationRun> {
    return this.planExecutionService.getRunById(runId);
  }

  async listRunTasks(runId: string): Promise<OrchestrationRunTask[]> {
    return this.planExecutionService.listRunTasks(runId);
  }

  async addTaskToPlan(planId: string, dto: AddTaskToPlanDto): Promise<OrchestrationTask> {
    return this.taskManagementService.addTaskToPlan(planId, dto);
  }

  async removeTaskFromPlan(taskId: string): Promise<{ success: boolean }> {
    return this.taskManagementService.removeTaskFromPlan(taskId);
  }

  async updateTaskFull(taskId: string, dto: UpdateTaskFullDto): Promise<OrchestrationTask> {
    return this.taskManagementService.updateTaskFull(taskId, dto);
  }

  async reorderPlanTasks(planId: string, dto: ReorderPlanTasksDto): Promise<{ success: boolean }> {
    return this.taskManagementService.reorderPlanTasks(planId, dto);
  }

  async batchUpdateTasks(planId: string, dto: BatchUpdateTasksDto): Promise<OrchestrationTask[]> {
    return this.taskManagementService.batchUpdateTasks(planId, dto);
  }

  async duplicateTask(planId: string, sourceTaskId: string): Promise<OrchestrationTask> {
    return this.taskManagementService.duplicateTask(planId, sourceTaskId);
  }

  async runPlan(planId: string, dto: RunPlanDto): Promise<OrchestrationRun> {
    return this.planExecutionService.runPlan(planId, dto);
  }

  async runPlanAsync(
    planId: string,
    dto: RunPlanDto,
  ): Promise<{ accepted: boolean; planId: string; status: string; alreadyRunning?: boolean }> {
    return this.planExecutionService.runPlanAsync(planId, dto);
  }

  async cancelRun(
    runId: string,
    reason?: string,
  ): Promise<{ success: boolean; runId: string; status: 'cancelled'; cancelledTasks: number }> {
    return this.planExecutionService.cancelRun(runId, reason);
  }

  async publishPlan(planId: string): Promise<OrchestrationPlan> {
    return this.planManagementService.publishPlan(planId);
  }

  async unlockPlan(planId: string): Promise<OrchestrationPlan> {
    return this.planManagementService.unlockPlan(planId);
  }

  async executePlanRun(
    planId: string,
    triggerType: OrchestrationRunTriggerType,
    options?: {
      scheduleId?: string;
      continueOnFailure?: boolean;
    },
  ): Promise<OrchestrationRun> {
    return this.planExecutionService.executePlanRun(planId, triggerType, options);
  }

  async reassignTask(taskId: string, dto: ReassignTaskDto): Promise<OrchestrationTask> {
    return this.taskLifecycleService.reassignTask(taskId, dto);
  }

  async completeHumanTask(taskId: string, dto: CompleteHumanTaskDto): Promise<OrchestrationTask> {
    return this.taskLifecycleService.completeHumanTask(taskId, dto);
  }

  async retryTask(
    taskId: string,
  ): Promise<{ task: any; run: { accepted: boolean; planId: string; status: string; alreadyRunning?: boolean } }> {
    return this.taskLifecycleService.retryTask(taskId);
  }

  async updateTaskDraft(taskId: string, dto: UpdateTaskDraftDto): Promise<OrchestrationTask> {
    return this.taskManagementService.updateTaskDraft(taskId, dto);
  }

  async debugTaskStep(
    taskId: string,
    dto: DebugTaskStepDto,
  ): Promise<{ task: OrchestrationTask; execution: { status: OrchestrationTaskStatus; result?: string; error?: string } }> {
    return this.taskLifecycleService.debugTaskStep(taskId, dto);
  }

  async executeStandaloneTask(
    taskId: string,
  ): Promise<{ status: OrchestrationTaskStatus; result?: string; error?: string }> {
    return this.taskLifecycleService.executeStandaloneTask(taskId);
  }

}
