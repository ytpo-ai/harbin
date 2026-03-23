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
      sections.push(this.taskOutputValidationService.buildResearchOutputContract(researchTaskKind || 'generic_research'));
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
        return [
          `Task #${depTask.order + 1}: ${depTask.title}`,
          `Status: ${depTask.status}`,
          `Output: ${output || 'N/A'}`,
        ].join('\n');
      })
      .join('\n\n---\n\n');
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
        return [
          `Task #${depTask.order + 1}: ${depTask.title}`,
          `Status: ${depTask.status}`,
          `Output: ${output || 'N/A'}`,
        ].join('\n');
      })
      .join('\n\n---\n\n');
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
