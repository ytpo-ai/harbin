import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import axios from 'axios';
import { Model, Types } from 'mongoose';
import {
  OrchestrationTask,
  OrchestrationTaskDocument,
} from '../../../shared/schemas/orchestration-task.schema';
import {
  OrchestrationRunTask,
  OrchestrationRunTaskDocument,
} from '../../../shared/schemas/orchestration-run-task.schema';
import {
  OrchestrationPlan,
  OrchestrationPlanDocument,
} from '../../../shared/schemas/orchestration-plan.schema';
import { inferDomainTypeFromText } from '../../../shared/domain-context/domain-type.util';
import { TaskClassificationService } from './task-classification.service';
import { TaskOutputValidationService } from './task-output-validation.service';

type DomainStatus = 'todo' | 'assigned' | 'in_progress' | 'review' | 'done' | 'blocked';

@Injectable()
export class OrchestrationContextService {
  private readonly engineeringIntelligenceBaseUrl =
    process.env.ENGINEERING_INTELLIGENCE_SERVICE_URL || 'http://localhost:3004/api';

  constructor(
    @InjectModel(OrchestrationTask.name)
    private readonly orchestrationTaskModel: Model<OrchestrationTaskDocument>,
    @InjectModel(OrchestrationRunTask.name)
    private readonly orchestrationRunTaskModel: Model<OrchestrationRunTaskDocument>,
    @InjectModel(OrchestrationPlan.name)
    private readonly orchestrationPlanModel: Model<OrchestrationPlanDocument>,
    private readonly taskClassificationService: TaskClassificationService,
    private readonly taskOutputValidationService: TaskOutputValidationService,
  ) {}

  buildTaskDescription(
    baseDescription: string,
    options: {
      dependencyContext: string;
      isExternalAction: boolean;
      isResearchTask: boolean;
      isReviewTask: boolean;
      researchTaskKind?: 'city_population' | 'generic_research';
      retryHint?: string;
      stepIndex?: number;
      currentTaskTitle?: string;
      runtimeTaskType?: string;
    },
  ): string {
    const {
      dependencyContext,
      isExternalAction,
      isResearchTask,
      isReviewTask,
      researchTaskKind,
      retryHint,
      stepIndex,
      currentTaskTitle,
      runtimeTaskType,
    } = options;
    const sections = [`【当前任务目标】\n${this.extractCurrentTaskGoal(baseDescription)}`];
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
          '- output must be a generic implementation review result, not email draft',
          '- include: 1) review verdict (pass/needs-fix), 2) evidence list, 3) minimal fix suggestions',
          '- each evidence item should reference code behavior or file path when available',
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
      `标题: 根据 step${Math.max(currentStep - 1, 0)} 的输出 你需要执行的工作是 ***${taskTypeLabel}${currentTaskTitle ? `（${currentTaskTitle}）` : ''}`,
    );
    return lines.join('\n');
  }

  private toTaskTypeLabel(runtimeTaskType?: string): string {
    const normalized = String(runtimeTaskType || '').trim().toLowerCase();
    if (normalized === 'development') {
      return '开发';
    }
    if (normalized === 'review') {
      return 'review';
    }
    if (normalized === 'research') {
      return '调研';
    }
    if (normalized === 'external_action') {
      return '外部执行';
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

  buildOrchestrationCollaborationContext(
    task: OrchestrationTask | OrchestrationTaskDocument,
    options: { dependencyContext?: string; executorAgentId?: string } = {},
  ): Record<string, unknown> {
    return {
      mode: 'orchestration',
      roleInPlan: 'execute_assigned_task',
      currentTaskId: this.getEntityId(task as any),
      currentTaskTitle: task.title,
      executorAgentId: options.executorAgentId,
      dependencies: task.dependencyTaskIds || [],
      upstreamOutputs: options.dependencyContext || '',
    };
  }

  async resolvePlanDomainContext(planId: string): Promise<Record<string, unknown> | undefined> {
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

  async tryUpdateRequirementStatus(
    requirementId: string | undefined,
    status: DomainStatus,
    reason: string,
  ): Promise<void> {
    if (!requirementId) {
      return;
    }

    try {
      await axios.post(
        `${this.engineeringIntelligenceBaseUrl}/ei/requirements/${encodeURIComponent(requirementId)}/status`,
        {
          status,
          changedByType: 'system',
          changedByName: 'orchestration-service',
          note: reason,
        },
        {
          timeout: Number(process.env.AGENTS_EXEC_TIMEOUT_MS || 120000),
        },
      );
    } catch {
      // requirement sync is best-effort and should not block orchestration execution.
    }
  }

  inferDomainContext(prompt: string, preferredDomainType?: string): Record<string, unknown> {
    const normalizedPrompt = String(prompt || '').trim();
    const domainType = this.inferDomainType(normalizedPrompt, preferredDomainType);
    const text = normalizedPrompt.toLowerCase();
    const keywords = this.extractDomainKeywords(text);
    return {
      domainType,
      keywords,
      inferredAt: new Date().toISOString(),
      source: 'prompt',
      description: normalizedPrompt.slice(0, 500),
    };
  }

  resolveRequirementIdFromPlan(plan: OrchestrationPlanDocument): string | undefined {
    return String((plan.metadata || {}).requirementId || '').trim() || undefined;
  }

  resolveRequirementObjectIdFromPlan(plan: OrchestrationPlanDocument): string | undefined {
    const raw = String((plan.metadata || {}).requirementId || '').trim();
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

  getRunTaskId(runTask: OrchestrationRunTaskDocument): string {
    return this.getEntityId(runTask as any);
  }

  resolveAgentRuntimeTaskType(
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

  normalizeRuntimeTaskTypeOverride(
    value?: string,
  ): 'external_action' | 'research' | 'review' | 'development' | 'general' | null {
    if (!value) {
      return null;
    }
    const normalized = String(value).trim().toLowerCase();
    if (
      normalized === 'external_action'
      || normalized === 'research'
      || normalized === 'review'
      || normalized === 'development'
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

  private inferDomainType(prompt: string, preferredDomainType?: string): string {
    return inferDomainTypeFromText({
      prompt,
      preferredDomainType,
    });
  }

  private extractDomainKeywords(text: string): string[] {
    const candidates = [
      'backend',
      'frontend',
      'api',
      'database',
      'schema',
      'auth',
      'agent',
      'orchestration',
      'scheduler',
      'prompt',
      'skill',
      'meeting',
      'billing',
      'engineering',
      '智能体',
      '编排',
      '调度',
      '需求',
      '研发',
    ];
    return candidates.filter((keyword) => text.includes(keyword)).slice(0, 12);
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
