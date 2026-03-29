import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CollaborationContextFactory } from '@libs/contracts';
import {
  OrchestrationTask,
  OrchestrationTaskDocument,
} from '../../../shared/schemas/orchestration-task.schema';
import {
  OrchestrationRunTask,
  OrchestrationRunTaskDocument,
} from '../../../shared/schemas/orchestration-run-task.schema';
import { OrchestrationPlanDocument } from '../../../shared/schemas/orchestration-plan.schema';
import { TaskOutputValidationService } from './task-output-validation.service';

@Injectable()
export class OrchestrationContextService {
  constructor(
    @InjectModel(OrchestrationTask.name)
    private readonly orchestrationTaskModel: Model<OrchestrationTaskDocument>,
    @InjectModel(OrchestrationRunTask.name)
    private readonly orchestrationRunTaskModel: Model<OrchestrationRunTaskDocument>,
    private readonly taskOutputValidationService: TaskOutputValidationService,
  ) {}

  buildTaskDescription(
    baseDescription: string,
    options: {
      dependencyContext: string;
      isResearchTask: boolean;
      isReviewTask: boolean;
      researchTaskKind?: 'generic_research';
      retryHint?: string;
      stepIndex?: number;
      currentTaskTitle?: string;
      runtimeTaskType?: string;
      planTaskContext?: Record<string, unknown>;
    },
  ): string {
    const {
      dependencyContext,
      isResearchTask,
      isReviewTask,
      researchTaskKind,
      retryHint,
      stepIndex,
      currentTaskTitle,
      runtimeTaskType,
      planTaskContext,
    } = options;
    const sections = [`【Task Target】\n${this.extractCurrentTaskGoal(baseDescription)}`];
    const planTaskContextSection = this.buildPlanTaskContextSection(planTaskContext);
    if (planTaskContextSection) {
      sections.push(planTaskContextSection);
    }
    const stepStatusContext = this.buildStepStatusContext(stepIndex, runtimeTaskType, currentTaskTitle);
    if (stepStatusContext) {
      sections.push(stepStatusContext);
    }
    if (dependencyContext) {
      sections.push(`Dependency context:\n${dependencyContext}`);
    }
    if (retryHint) {
      sections.push(`Previous failed attempt hint:\n${retryHint}`);
    }
    if (isResearchTask) {
      sections.push(this.taskOutputValidationService.buildResearchOutputContract(researchTaskKind || 'generic_research'));
    }
    if (isReviewTask) {
      sections.push(
        [
          'Review output contract (MUST comply):',
          '- output must be a generic implementation review result',
          '- include: 1) review verdict (pass/needs-fix), 2) evidence list, 3) minimal fix suggestions',
          '- each evidence item should reference code behavior or file path when available',
        ].join('\n'),
      );
    }
    sections.push(
      [
        'Task output contract (MUST comply):',
        '- this applies only when execution cannot proceed; otherwise follow task-specific output contract first',
        '- if tool/permission is missing, start response with: TASK_INABILITY: <reason>',
        '- do not output fallback suggestions or manual instructions as completed task result',
        '- only return executable result after required actions are actually performed',
      ].join('\n'),
    );
    return sections.join('\n\n');
  }

  private extractCurrentTaskGoal(baseDescription: string): string {
    const normalized = String(baseDescription || '').trim();
    if (!normalized) {
      return '按当前步骤要求完成任务并输出可执行结果。';
    }

    const actionMatch = normalized.match(/动作\s*[：:]\s*([\s\S]*?)(?:\n\s*产出\s*[：:]|$)/i);
    if (actionMatch?.[1]) {
      return actionMatch[1].replace(/\s+/g, ' ').trim();
    }

    const firstSentence = normalized.split(/\n|。/).map((item) => item.trim()).find(Boolean);
    if (firstSentence) {
      return firstSentence;
    }

    return normalized.slice(0, 200);
  }

  private buildStepStatusContext(stepIndex?: number, runtimeTaskType?: string, currentTaskTitle?: string): string {
    if (!Number.isInteger(stepIndex) || Number(stepIndex) < 0) {
      return '';
    }
    const currentStep = Number(stepIndex);
    const lines: string[] = [];
    const taskTypeLabel = this.toTaskTypeLabel(runtimeTaskType);
    lines.push('———————————');
    lines.push(`Task #${currentStep + 1} 【当前任务】`);
    lines.push(
      `标题: 根据 step${Math.max(currentStep - 1, 0)} 的输出,你需要执行的工作是 [${taskTypeLabel}]${currentTaskTitle ? `（${currentTaskTitle}）` : ''}`,
    );
    return lines.join('\n');
  }

  private toTaskTypeLabel(runtimeTaskType?: string): string {
    const normalized = String(runtimeTaskType || '').trim().toLowerCase();
    if (normalized === 'development.exec') {
      return '开发执行';
    }
    if (normalized === 'development.plan') {
      return '开发规划';
    }
    if (normalized === 'development.review') {
      return '开发评审';
    }
    if (normalized === 'research') {
      return '调研';
    }
    return '开发方案';
  }

  async buildDependencyContext(planId: string, dependencyTaskIds: string[]): Promise<string> {
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
        return this.buildTaskContextBlock(depTask.order + 1, depTask.title, depTask.status, output || 'N/A');
      })
      .join('\n\n');
  }

  async buildRunDependencyContext(runId: string, dependencySourceTaskIds: string[]): Promise<string> {
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
        return this.buildTaskContextBlock(depTask.order + 1, depTask.title, depTask.status, output || 'N/A');
      })
      .join('\n\n');
  }

  private buildTaskContextBlock(stepNo: number, title: string, status: string, output: string): string {
    const statusLabel = this.toTaskStatusLabel(status);
    return [
      '———————————',
      `Task #${stepNo} 【${statusLabel}】`,
      `标题: ${title}`,
      '',
      output,
    ].join('\n');
  }

  private toTaskStatusLabel(status: string): string {
    const normalized = String(status || '').trim().toLowerCase();
    if (normalized === 'completed') {
      return '已完成';
    }
    if (normalized === 'failed') {
      return '失败';
    }
    if (normalized === 'in_progress') {
      return '执行中';
    }
    if (normalized === 'waiting_human') {
      return '待人工';
    }
    if (normalized === 'assigned') {
      return '已分配';
    }
    if (normalized === 'pending') {
      return '待执行';
    }
    if (normalized === 'blocked') {
      return '阻塞';
    }
    if (normalized === 'cancelled') {
      return '已取消';
    }
    return normalized || '未知';
  }

  buildPreTaskContext(input: {
    step: number;
    taskId: string;
    taskTitle: string;
    taskDescription: string;
    runtimeTaskType?: string;
    planDomainType?: string;
    planGoal?: string;
  }): string {
    return [
      '先激活并严格遵循 skill: docs/skill/orchestration-runtime-tasktype-selection.md',
      '请进行执行前评估，并仅返回 JSON。',
      '目标：判断当前任务是否允许进入执行阶段。',
      `step: ${input.step}`,
      `taskId: ${input.taskId}`,
      `taskTitle: ${input.taskTitle}`,
      `planDomainType: ${input.planDomainType || 'general'}`,
      `planGoal: ${String(input.planGoal || '').slice(0, 500)}`,
      `runtimeTaskType: ${input.runtimeTaskType || 'general'}`,
      'taskDescription:',
      input.taskDescription,
      '输出 JSON schema:',
      '{"allowExecute":true,"executionHints":["..."],"riskFlags":["..."],"notes":"..."}',
    ].join('\n');
  }

  inferRuntimeTaskTypeFromPlanContext(input: {
    planDomainType?: string;
    planGoal?: string;
    step?: number;
    taskTitle: string;
    taskDescription: string;
    taskType?: string;
    existingRuntimeTaskType?: string;
  }): 'research' | 'development.plan' | 'development.exec' | 'development.review' | 'general' {
    const existing = this.normalizeRuntimeTaskTypeOverride(input.existingRuntimeTaskType);
    if (existing) {
      return existing;
    }

    const taskType = this.normalizeRuntimeTaskTypeOverride(input.taskType);
    if (taskType) {
      return taskType;
    }

    // Fallback: planner did not provide a valid taskType.
    // Use only the plan-level domain as a coarse hint; fine-grained
    // classification (plan / exec / review) is the planner's responsibility.
    const domain = String(input.planDomainType || 'general').trim().toLowerCase();

    if (domain === 'research') {
      return 'research';
    }

    if (domain === 'development') {
      return 'development.exec';
    }

    return 'general';
  }

  buildPostTaskContext(input: {
    step: number;
    taskId: string;
    taskTitle: string;
    runtimeTaskType?: string;
    executionStatus: string;
    executionOutput?: string;
    executionError?: string;
    planDomainType?: string;
    totalGeneratedSteps?: number;
    outlineStepCount?: number;
  }): string {
    const lines = [
      '请进行执行后决策。',
      '先激活并严格遵循 skill: docs/skill/orchestration-runtime-task-out-validation.md',
      '目标：根据当前任务执行结果，决定下一步动作。',
      '你必须调用工具 builtin.sys-mg.mcp.orchestration.report-task-run-result 报告决策结果。',
      '禁止直接输出纯文本 JSON 作为最终结果。',
      `step: ${input.step}`,
      `taskId: ${input.taskId}`,
      `taskTitle: ${input.taskTitle}`,
      `runtimeTaskType: ${input.runtimeTaskType || 'general'}`,
      `executionStatus: ${input.executionStatus}`,
      `executionOutput: ${String(input.executionOutput || '').slice(0, 3000)}`,
      `executionError: ${String(input.executionError || '').slice(0, 1000)}`,
    ];

    // 多步流程进度提示：根据 outline 步骤数（或 development 兜底）引导 Planner 决策
    const totalSteps = input.outlineStepCount;
    if (input.planDomainType === 'development' || (totalSteps && totalSteps > 1)) {
      const completed = input.totalGeneratedSteps ?? input.step;
      const stepCount = totalSteps || 3;
      lines.push('');
      lines.push('## 多步流程进度');
      if (input.planDomainType === 'development') {
        lines.push(`当前计划类型: development（由 rd-workflow 技能定义的多步流程）`);
      }
      lines.push(`已完成步骤数: ${completed}`);
      lines.push(`计划总步骤数: ${stepCount}（step1 → step${stepCount}）`);
      lines.push('决策指引：若当前任务 executionStatus=completed 且输出有效，应优先返回 action="generate_next" 以继续下一步骤。');
      lines.push(`仅当所有 ${stepCount} 个步骤均已完成时，才应返回 action="stop"。`);
    }

    lines.push('工具参数约束: action=generate_next|stop|redesign|retry, reason 必填, action=redesign 时 redesignTaskId 必填。');
    return lines.join('\n');
  }

  buildOrchestrationCollaborationContext(
    task: OrchestrationTask | OrchestrationTaskDocument,
    options: { dependencyContext?: string; executorAgentId?: string } = {},
  ): Record<string, unknown> {
    return CollaborationContextFactory.orchestration({
      planId: String((task as any).planId || '').trim(),
      roleInPlan: 'executor',
      currentTaskId: this.getEntityId(task as any),
      currentTaskTitle: task.title,
      executorAgentId: options.executorAgentId,
      dependencies: task.dependencyTaskIds || [],
      upstreamOutputs: options.dependencyContext || '',
    });
  }

  resolveRequirementIdFromPlan(plan: OrchestrationPlanDocument): string | undefined {
    const metadata = (plan.metadata || {}) as Record<string, unknown>;
    const taskContext = this.resolvePlanTaskContextFromMetadata(metadata);
    return String(taskContext.requirementId || metadata.requirementId || '').trim() || undefined;
  }

  resolveRequirementObjectIdFromPlan(plan: OrchestrationPlanDocument): string | undefined {
    const raw = String(this.resolveRequirementIdFromPlan(plan) || '').trim();
    if (!raw || !Types.ObjectId.isValid(raw)) {
      return undefined;
    }
    return new Types.ObjectId(raw).toString();
  }

  parseRequirementObjectId(requirementId?: string): Types.ObjectId | undefined {
    const normalized = String(requirementId || '').trim();
    if (!normalized) {
      return undefined;
    }
    if (!Types.ObjectId.isValid(normalized)) {
      return undefined;
    }
    return new Types.ObjectId(normalized);
  }

  resolvePlanTaskContextFromMetadata(metadata?: Record<string, unknown>): Record<string, unknown> {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return {};
    }
    const candidate = (metadata as Record<string, unknown>).taskContext;
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return {};
    }
    return candidate as Record<string, unknown>;
  }

  getRunTaskId(runTask: OrchestrationRunTaskDocument): string {
    return this.getEntityId(runTask as any);
  }

  normalizeRuntimeTaskTypeOverride(
    value?: string,
  ):
    | 'research'
    | 'development.plan'
    | 'development.exec'
    | 'development.review'
    | 'general'
    | null {
    if (!value) {
      return null;
    }
    const normalized = String(value).trim().toLowerCase();
    if (
      normalized === 'research'
      || normalized === 'development.plan'
      || normalized === 'development.exec'
      || normalized === 'development.review'
      || normalized === 'general'
    ) {
      return normalized;
    }
    return null;
  }

  getRetryFailureHint(task: OrchestrationTask): string {
    const logs = task.runLogs || [];
    for (let i = logs.length - 1; i >= 0; i--) {
      const log = logs[i];
      if (log.level === 'error' && log.message) {
        return log.message;
      }
    }
    return '';
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

  private buildPlanTaskContextSection(planTaskContext?: Record<string, unknown>): string {
    const context = planTaskContext && typeof planTaskContext === 'object' ? planTaskContext : {};
    const lines = Object.entries(context)
      .filter(([key, value]) => Boolean(String(key || '').trim()) && value !== undefined && value !== null)
      .map(([key, value]) => `- ${key}: ${this.stringifyPlanTaskContextValue(value)}`);

    if (lines.length === 0) {
      return '';
    }

    return [
      '## 计划上下文（系统自动注入，不可修改）',
      ...lines,
    ].join('\n');
  }

  private stringifyPlanTaskContextValue(value: unknown): string {
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

}
