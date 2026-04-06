import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Agent, AgentDocument } from '@agent/schemas/agent.schema';
import { AgentClientService } from '../agents-client/agent-client.service';
import { AgentExecutionTask } from '../../shared/types';
import { CollaborationContextFactory } from '@libs/contracts';
import {
  OrchestrationPlan,
  OrchestrationPlanDocument,
} from '../../shared/schemas/orchestration-plan.schema';
import {
  MAX_TASKS,
  MAX_TITLE_LENGTH,
  MAX_DESCRIPTION_LENGTH,
} from './services/scene-optimization.service';
import { OrchestrationContextService } from './services/orchestration-context.service';

interface PlannerTaskDraft {
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  dependencies: number[];
}

interface PlannerResult {
  mode: 'sequential' | 'parallel' | 'hybrid';
  tasks: PlannerTaskDraft[];
  plannerAgentId?: string;
  strategyNote?: string;
}

export interface IncrementalPlannerContext {
  planGoal: string;
  completedTasks: Array<{
    title: string;
    agentId?: string;
    outputSummary: string;
  }>;
  failedTasks: Array<{
    taskId: string;
    title: string;
    agentId?: string;
    agentTools?: string[];
    error: string;
  }>;
  totalSteps: number;
  lastError?: string;
  /** plan.metadata.requirementId — 已锚定的需求 ID，replan 时从 metadata 透传 */
  requirementId?: string;
  requirementTitle?: string;
  requirementDescription?: string;
}

export interface PhaseInitializeResult {
  outline: Array<{
    step: number;
    title: string;
    taskType: 'development.plan' | 'development.exec' | 'development.review' | 'general' | 'research';
    recommendedAgent?: {
      agentId: string;
      agentName: string;
      reason: string;
    };
    phasePrompts: {
      generating: string;
      pre_execute?: string;
      execute?: string;
      post_execute: string;
    };
    phaseTools?: {
      pre_execute?: string[];
      execute?: string[];
      post_execute?: string[];
    };
  }>;
  taskContext?: Record<string, unknown>;
  reasoning?: string;
}

export interface GenerateNextTaskResult {
  action?: 'new' | 'redesign';
  redesignTaskId?: string;
  createdTaskId?: string;
  task?: {
    title: string;
    description: string;
    priority: 'low' | 'medium' | 'high' | 'urgent';
    agentId?: string;
    taskType: 'research' | 'development.plan' | 'development.exec' | 'development.review' | 'general';
    requiredTools?: string[];
  };
  isGoalReached: boolean;
  reasoning: string;
  costTokens?: number;
}

export interface PreExecutionDecision {
  allowExecute: boolean;
  executionHints?: string[];
  riskFlags?: string[];
  notes?: string;
}

export interface PostExecutionDecision {
  action: 'generate_next' | 'stop' | 'redesign' | 'retry';
  reason: string;
  redesignTaskId?: string;
  nextTaskHints?: string[];
  validation?: {
    passed: boolean;
    verdict?: 'pass' | 'needs_fix' | 'blocked';
    missing?: string[];
    ruleVersion?: string;
  };
}

@Injectable()
export class PlannerService {
  private readonly logger = new Logger(PlannerService.name);

  constructor(
    @InjectModel(Agent.name) private readonly agentModel: Model<AgentDocument>,
    @InjectModel(OrchestrationPlan.name)
    private readonly planModel: Model<OrchestrationPlanDocument>,
    private readonly agentClientService: AgentClientService,
    private readonly contextService: OrchestrationContextService,
  ) {}

  /**
   * @deprecated Legacy batch planning path. Incremental planning should use generateNextTask().
   */
  async planFromPrompt(input: {
    prompt: string;
    mode?: 'sequential' | 'parallel' | 'hybrid';
    plannerAgentId?: string;
    requirementId?: string;
  }): Promise<PlannerResult> {
    const mode = input.mode || 'hybrid';
    if (input.plannerAgentId) {
      const result = await this.planByAgent(input.prompt, input.plannerAgentId, mode, input.requirementId);
      if (result) {
        return result;
      }
    }

    const defaultPlanner = await this.agentModel.findOne({ isActive: true }).sort({ createdAt: 1 }).exec();
    if (defaultPlanner?._id) {
      const result = await this.planByAgent(input.prompt, defaultPlanner._id.toString(), mode, input.requirementId);
      if (result) {
        return result;
      }
    }

    return this.planByHeuristic(input.prompt, mode);
  }

  async generateNextTask(
    planId: string,
    context: IncrementalPlannerContext,
    options?: { sessionId?: string },
  ): Promise<GenerateNextTaskResult> {
    const plan = await this.planModel.findById(planId).exec();
    if (!plan) {
      throw new NotFoundException('Plan not found');
    }

    const plannerAgentId = String(plan.strategy?.plannerAgentId || '').trim();
    if (!plannerAgentId) {
      throw new BadRequestException('Plan has no planner agent configured');
    }

    const planDomainType = String((plan as any).domainType || 'general').trim();
    const prompt = await this.contextService.buildGeneratingPrompt(context, {
      domainType: planDomainType,
      planId,
      plan,
    });
    const stepn = Number(context.totalSteps || 0) + 1;
    const task: AgentExecutionTask = {
      title: `[Incremental Planning] ${plan.title} 任务#${stepn} generating`,
      description: prompt,
      type: 'planning',
      priority: 'high',
      status: 'pending',
      assignedAgents: [plannerAgentId],
      teamId: 'orchestration',
      messages: [{ role: 'user', content: prompt, timestamp: new Date() }],
    };

    const response = await this.agentClientService.executeTask(plannerAgentId, task, {
      collaborationContext: CollaborationContextFactory.orchestration({
        planId,
        roleInPlan: 'planner',
        responseDirective: 'text',
        domainType: planDomainType as 'general' | 'development' | 'research',
        phase: 'generating',
        taskType: 'planning',
        ...(plan.strategy?.skillActivation ? { skillActivation: plan.strategy.skillActivation } : {}),
      }),
      sessionContext: {
        ...(options?.sessionId ? { sessionId: options.sessionId } : {}),
        preactivatedToolIds: ['builtin.sys-mg.mcp.orchestration.submit-task'],
      },
    });

    this.logger.log(
      `[planner_raw_response] planId=${planId} step=${context.totalSteps} responseLen=${(response || '').length} preview=${JSON.stringify((response || '').slice(0, 500))}`,
    );

    const parsed = this.tryParseJson(response);
    if (!parsed) {
      this.logger.warn(
        `[planner_parse_fail] planId=${planId} step=${context.totalSteps} response=${JSON.stringify((response || '').slice(0, 800))}`,
      );
      return {
        isGoalReached: false,
        reasoning: 'Failed to parse planner response',
      };
    }

    const submittedTask = this.resolveSubmittedTaskFromToolPayload(parsed);
    if (submittedTask) {
      return {
        action: submittedTask.action,
        redesignTaskId: submittedTask.action === 'redesign' ? submittedTask.redesignTaskId : undefined,
        createdTaskId: submittedTask.createdTaskId,
        task: submittedTask.task,
        isGoalReached: false,
        reasoning: submittedTask.reasoning,
      };
    }

    if (parsed.goalReached === true || parsed.isGoalReached === true) {
      return {
        isGoalReached: true,
        reasoning: this.resolvePlannerReasoning(parsed),
      };
    }

    const taskCandidate = this.resolvePlannerTaskCandidate(parsed);
    const parsedAgentId = String(taskCandidate?.agentId || '').trim();
    const parsedAction = this.normalizePlannerAction(parsed?.action);
    const parsedRedesignTaskId = String(parsed?.redesignTaskId || '').trim() || undefined;
    const parsedRequiredTools = Array.isArray(taskCandidate?.requiredTools)
      ? taskCandidate.requiredTools
        .map((item: unknown) => String(item || '').trim())
        .filter(Boolean)
      : undefined;

    const parsedTask = taskCandidate
      ? {
          title: String(taskCandidate.title || taskCandidate.name || '').trim().slice(0, MAX_TITLE_LENGTH),
          description: String(taskCandidate.description || taskCandidate.goal || '').trim().slice(0, MAX_DESCRIPTION_LENGTH),
          priority: this.normalizePriority(taskCandidate.priority),
          agentId: parsedAgentId || undefined,
          taskType: this.normalizeRuntimeTaskType(taskCandidate.taskType),
          requiredTools: parsedRequiredTools,
        }
      : undefined;
    const validatedTask = parsedTask && parsedTask.title && parsedTask.description ? parsedTask : undefined;
    const normalizedReasoning = this.resolvePlannerReasoning(parsed, validatedTask);

    return {
      action: parsedAction,
      redesignTaskId: parsedAction === 'redesign' ? parsedRedesignTaskId : undefined,
      createdTaskId: undefined,
      task: validatedTask,
      isGoalReached: Boolean(parsed.isGoalReached),
      reasoning: normalizedReasoning,
      costTokens: Number.isFinite(parsed.costTokens) ? Number(parsed.costTokens) : undefined,
    };
  }

  async executePreTask(
    planId: string,
    taskContext: string,
    sessionId: string,
    step?: number,
    preactivatedToolIds?: string[],
  ): Promise<PreExecutionDecision> {
    const plan = await this.planModel.findById(planId).exec();
    if (!plan) {
      throw new NotFoundException('Plan not found');
    }
    const plannerAgentId = String(plan.strategy?.plannerAgentId || '').trim();
    if (!plannerAgentId) {
      throw new BadRequestException('Plan has no planner agent configured');
    }

    const stepTag = Number.isFinite(step) && Number(step) > 0 ? ` 任务#${Number(step)}` : '';
    const task: AgentExecutionTask = {
      title: `[Incremental Planning] ${plan.title}${stepTag} pre-execution`,
      description: taskContext,
      type: 'planning',
      priority: 'high',
      status: 'pending',
      assignedAgents: [plannerAgentId],
      teamId: 'orchestration',
      messages: [{ role: 'user', content: taskContext, timestamp: new Date() }],
    };

    const response = await this.agentClientService.executeTask(plannerAgentId, task, {
      collaborationContext: CollaborationContextFactory.orchestration({
        planId,
        roleInPlan: 'planner_pre_execution',
        responseDirective: 'text',
        domainType: String((plan as { domainType?: string }).domainType || 'general').trim().toLowerCase() as 'general' | 'development' | 'research',
        phase: 'pre_execute',
        taskType: 'planning',
        ...(plan.strategy?.skillActivation ? { skillActivation: plan.strategy.skillActivation } : {}),
      }),
      sessionContext: {
        sessionId,
        preactivatedToolIds: this.normalizePreactivatedToolIds(preactivatedToolIds),
      },
    });

    const parsed = this.tryParseJson(response);
    if (!parsed || typeof parsed !== 'object') {
      return { allowExecute: true };
    }

    return {
      allowExecute: parsed.allowExecute !== false,
      executionHints: Array.isArray(parsed.executionHints)
        ? parsed.executionHints.map((item: unknown) => String(item || '').trim()).filter(Boolean)
        : undefined,
      riskFlags: Array.isArray(parsed.riskFlags)
        ? parsed.riskFlags.map((item: unknown) => String(item || '').trim()).filter(Boolean)
        : undefined,
      notes: String(parsed.notes || '').trim() || undefined,
    };
  }

  async initializePlan(
    planId: string,
    input: {
      sourcePrompt: string;
      domainType: string;
      existingTaskContext?: Record<string, unknown>;
    },
    options?: { sessionId?: string },
  ): Promise<PhaseInitializeResult> {
    const plan = await this.planModel.findById(planId).exec();
    if (!plan) {
      throw new NotFoundException('Plan not found');
    }

    const plannerAgentId = String(plan.strategy?.plannerAgentId || '').trim();
    if (!plannerAgentId) {
      throw new BadRequestException('Plan has no planner agent configured');
    }

    const planDomainType = String((plan as { domainType?: string }).domainType || input.domainType || 'general').trim().toLowerCase();
    const prompt = await this.contextService.buildPhaseInitializePrompt({
      planId,
      sourcePrompt: input.sourcePrompt,
      domainType: planDomainType,
      existingTaskContext: input.existingTaskContext,
    });

    const task: AgentExecutionTask = {
      title: `[Incremental Planning] ${plan.title} initialize`,
      description: prompt,
      type: 'planning',
      priority: 'high',
      status: 'pending',
      assignedAgents: [plannerAgentId],
      teamId: 'orchestration',
      messages: [{ role: 'user', content: prompt, timestamp: new Date() }],
    };

    const response = await this.agentClientService.executeTask(plannerAgentId, task, {
      collaborationContext: CollaborationContextFactory.orchestration({
        planId,
        roleInPlan: 'planner_initialize',
        responseDirective: 'text',
        domainType: planDomainType as 'general' | 'development' | 'research',
        phase: 'initialize',
        taskType: 'planning',
        ...(plan.strategy?.skillActivation ? { skillActivation: plan.strategy.skillActivation } : {}),
      }),
      sessionContext: {
        ...(options?.sessionId ? { sessionId: options.sessionId } : {}),
        preactivatedToolIds: [
          'builtin.sys-mg.mcp.orchestration.initialize',
          'builtin.sys-mg.mcp.agent.list',
        ],
      },
    });

    const refreshedPlan = await this.planModel.findById(planId).select({ metadata: 1 }).lean().exec();
    const metadata = ((refreshedPlan as { metadata?: Record<string, unknown> } | null)?.metadata || {}) as Record<string, unknown>;
    const taskContext = this.resolveTaskContextFromMetadata(metadata);
    const outline = await this.normalizeOutline(metadata.outline, planDomainType);
    const parsed = this.tryParseJson(response);
    const parsedResult = parsed && typeof parsed === 'object' ? this.extractPostDecisionPayload(parsed) : {};

    return {
      outline,
      taskContext,
      reasoning: String(parsedResult.reasoning || parsedResult.reason || '').trim() || undefined,
    };
  }

  async executePostTask(
    planId: string,
    executionResult: string,
    sessionId: string,
    step?: number,
    progressHint?: { totalGenerated?: number; outlineStepCount?: number },
  ): Promise<PostExecutionDecision> {
    const plan = await this.planModel.findById(planId).exec();
    if (!plan) {
      throw new NotFoundException('Plan not found');
    }
    const plannerAgentId = String(plan.strategy?.plannerAgentId || '').trim();
    if (!plannerAgentId) {
      throw new BadRequestException('Plan has no planner agent configured');
    }

    const stepTag = Number.isFinite(step) && Number(step) > 0 ? ` 任务#${Number(step)}` : '';
    const task: AgentExecutionTask = {
      title: `[Incremental Planning] ${plan.title}${stepTag} post-execution`,
      description: executionResult,
      type: 'planning',
      priority: 'high',
      status: 'pending',
      assignedAgents: [plannerAgentId],
      teamId: 'orchestration',
      messages: [{ role: 'user', content: executionResult, timestamp: new Date() }],
    };

    const response = await this.agentClientService.executeTask(plannerAgentId, task, {
      collaborationContext: CollaborationContextFactory.orchestration({
        planId,
        roleInPlan: 'planner_post_execution',
        responseDirective: 'text',
        domainType: String((plan as { domainType?: string }).domainType || 'general').trim().toLowerCase() as 'general' | 'development' | 'research',
        phase: 'post_execute',
        taskType: 'planning',
        ...(plan.strategy?.skillActivation ? { skillActivation: plan.strategy.skillActivation } : {}),
      }),
      sessionContext: {
        sessionId,
        preactivatedToolIds: ['builtin.sys-mg.mcp.orchestration.submit-task-run-result'],
      },
    });

    const parsed = this.tryParseJson(response);
    if (!parsed || typeof parsed !== 'object') {
      // 修复1-2: 当 outline 中仍有未完成步骤时，解析失败应继续而非终止
      const hasRemainingSteps = progressHint?.outlineStepCount
        && progressHint?.totalGenerated != null
        && progressHint.totalGenerated < progressHint.outlineStepCount;
      const fallbackAction = hasRemainingSteps ? 'generate_next' : 'stop';
      this.logger.warn(
        `[post_task_parse_fallback] planId=${planId} fallbackAction=${fallbackAction} totalGenerated=${progressHint?.totalGenerated} outlineStepCount=${progressHint?.outlineStepCount}`,
      );
      return {
        action: fallbackAction,
        reason: `Failed to parse planner post-task response (fallback=${fallbackAction})`,
      };
    }

    const decisionCandidate = this.extractPostDecisionPayload(parsed);
    const action = this.normalizePostDecisionAction(decisionCandidate.action ?? decisionCandidate.nextAction);

    return {
      action,
      reason: String(decisionCandidate.reason || '').trim() || 'Planner post-task response missing reason',
      redesignTaskId: String(decisionCandidate.redesignTaskId || '').trim() || undefined,
      nextTaskHints: Array.isArray(decisionCandidate.nextTaskHints)
        ? decisionCandidate.nextTaskHints.map((item: unknown) => String(item || '').trim()).filter(Boolean)
        : undefined,
      validation: this.normalizePostValidationResult(decisionCandidate.validation),
    };
  }

  private normalizePostValidationResult(input: unknown): PostExecutionDecision['validation'] {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return undefined;
    }

    const candidate = input as Record<string, unknown>;
    const passed = candidate.passed;
    if (typeof passed !== 'boolean') {
      return undefined;
    }

    const rawVerdict = String(candidate.verdict || '').trim().toLowerCase();
    const verdict = rawVerdict === 'pass' || rawVerdict === 'needs_fix' || rawVerdict === 'blocked'
      ? rawVerdict as 'pass' | 'needs_fix' | 'blocked'
      : undefined;

    return {
      passed,
      verdict,
      missing: Array.isArray(candidate.missing)
        ? candidate.missing.map((item: unknown) => String(item || '').trim()).filter(Boolean)
        : undefined,
      ruleVersion: String(candidate.ruleVersion || '').trim() || undefined,
    };
  }

  /**
   * @deprecated Legacy batch planning path. Incremental planning should use generateNextTask().
   */
  private async planByAgent(
    prompt: string,
    plannerAgentId: string,
    mode: 'sequential' | 'parallel' | 'hybrid',
    requirementId?: string,
  ): Promise<PlannerResult | null> {
    const plannerPrompt = await this.contextService.resolvePlannerTaskPrompt({
      prompt,
      mode,
      requirementId,
    });

    const task: AgentExecutionTask = {
      title: 'Planner agent task decomposition',
      description: plannerPrompt,
      type: 'planning',
      priority: 'high',
      status: 'pending',
      assignedAgents: [plannerAgentId],
      teamId: 'orchestration',
      messages: [],
    };

    try {
      const response = await this.agentClientService.executeTask(plannerAgentId, task, {
        collaborationContext: CollaborationContextFactory.orchestration({
          planId: 'legacy-planning-session',
          roleInPlan: 'planner',
        }),
      });
      const parsed = this.tryParseJson(response);
      if (!parsed?.tasks || !Array.isArray(parsed.tasks) || parsed.tasks.length === 0) {
        return null;
      }

      const tasks: PlannerTaskDraft[] = parsed.tasks.slice(0, MAX_TASKS).map((item: any, index: number) => ({
        title: String(item.title || `子任务 ${index + 1}`).slice(0, MAX_TITLE_LENGTH),
        description: String(item.description || item.title || '').slice(0, MAX_DESCRIPTION_LENGTH),
        priority: this.normalizePriority(item.priority),
        dependencies: Array.isArray(item.dependencies)
          ? item.dependencies.filter((dep: any) => Number.isInteger(dep) && dep >= 0)
          : index > 0
            ? [index - 1]
            : [],
      }));

      return {
        mode: this.normalizeMode(parsed.mode, mode),
        tasks,
        plannerAgentId,
        strategyNote: 'Generated by planner agent',
      };
    } catch (err) {
      this.logger.warn(`planByAgent failed for agent=${plannerAgentId}: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * @deprecated Legacy batch planning fallback. Incremental planning should use generateNextTask().
   */
  private planByHeuristic(prompt: string, mode: 'sequential' | 'parallel' | 'hybrid'): PlannerResult {
    const blocks = prompt
      .split(/[\n。！？!?;；]+/)
      .map((item) => item.trim())
      .filter(Boolean);

    const taskDrafts = (blocks.length > 1 ? blocks : this.defaultBreakdown(prompt)).slice(0, MAX_TASKS);
    const tasks: PlannerTaskDraft[] = taskDrafts.map((item, index) => ({
      title: `步骤 ${index + 1}: ${item.slice(0, 30)}`,
      description: item,
      priority: index === 0 ? 'high' : 'medium',
      dependencies: index === 0 ? [] : [index - 1],
    }));

    return {
      mode,
      tasks,
      strategyNote: 'Generated by heuristic planner fallback',
    };
  }

  private defaultBreakdown(prompt: string): string[] {
    return [
      `分析需求与边界: ${prompt}`,
      '设计实现方案并明确任务依赖关系',
      '实现核心功能并补充必要接口',
      '验证结果并整理交付说明',
    ];
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

  private normalizePriority(input: string): 'low' | 'medium' | 'high' | 'urgent' {
    if (input === 'low' || input === 'medium' || input === 'high' || input === 'urgent') {
      return input;
    }
    return 'medium';
  }

  private normalizePlannerAction(input: unknown): 'new' | 'redesign' {
    const val = String(input || '').trim().toLowerCase();
    return val === 'redesign' ? 'redesign' : 'new';
  }

  private normalizePostDecisionAction(input: unknown): PostExecutionDecision['action'] {
    const normalized = String(input || '').trim().toLowerCase();
    if (
      normalized === 'generate_next'
      || normalized === 'stop'
      || normalized === 'redesign'
      || normalized === 'retry'
    ) {
      return normalized;
    }
    return 'stop';
  }

  private resolveSubmittedTaskFromToolPayload(parsed: any): {
    action: 'new' | 'redesign';
    redesignTaskId?: string;
    createdTaskId: string;
    task?: GenerateNextTaskResult['task'];
    reasoning: string;
  } | null {
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const candidate = this.extractToolResultPayload(parsed);
    if (!candidate) {
      return null;
    }

    const taskId = String(candidate.taskId || '').trim();
    if (!taskId) {
      return null;
    }

    const action = this.normalizePlannerAction(candidate.plannerAction || candidate.action);
    const title = String(candidate.title || '').trim();
    const description = String(candidate.description || '').trim();
    const runtimeTask = title && description
      ? {
          title,
          description,
          priority: this.normalizePriority(String(candidate.priority || 'medium')),
          agentId: String(candidate.assignment?.executorId || candidate.agentId || '').trim() || undefined,
          taskType: this.normalizeRuntimeTaskType(candidate.taskType),
          requiredTools: undefined,
        }
      : undefined;

    return {
      action,
      redesignTaskId: action === 'redesign' ? String(candidate.redesignTaskId || '').trim() || undefined : undefined,
      createdTaskId: taskId,
      task: runtimeTask,
      reasoning: String(candidate.reasoning || candidate.reason || candidate.message || '').trim() || 'Task submitted via tool',
    };
  }

  private extractToolResultPayload(parsed: any): Record<string, any> | null {
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    if (typeof parsed.taskId === 'string' && parsed.taskId.trim()) {
      return parsed;
    }
    if (parsed.result && typeof parsed.result === 'object' && !Array.isArray(parsed.result)) {
      const result = parsed.result as Record<string, any>;
      if (typeof result.taskId === 'string' && result.taskId.trim()) {
        return result;
      }
    }
    return null;
  }

  private extractPostDecisionPayload(parsed: any): Record<string, any> {
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }
    if (parsed.result && typeof parsed.result === 'object' && !Array.isArray(parsed.result)) {
      return parsed.result as Record<string, any>;
    }
    return parsed as Record<string, any>;
  }

  private resolvePlannerTaskCandidate(parsed: any): Record<string, any> | null {
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    if (parsed.task && typeof parsed.task === 'object' && !Array.isArray(parsed.task)) {
      return parsed.task as Record<string, any>;
    }

    if (parsed.nextTask && typeof parsed.nextTask === 'object' && !Array.isArray(parsed.nextTask)) {
      return parsed.nextTask as Record<string, any>;
    }

    // Fallback: if the root object directly contains title and description,
    // treat the root object itself as the task candidate (planner may omit the "task" wrapper).
    if (
      typeof parsed.title === 'string' && parsed.title.trim()
      && typeof parsed.description === 'string' && parsed.description.trim()
    ) {
      return parsed as Record<string, any>;
    }

    return null;
  }

  private resolvePlannerReasoning(parsed: any, validatedTask?: GenerateNextTaskResult['task']): string {
    const reasoningCandidates = [
      parsed?.reasoning,
      parsed?.reason,
      parsed?.message,
      typeof parsed?.result === 'string' ? parsed.result : undefined,
      !validatedTask ? 'Planner did not provide a valid task payload' : undefined,
    ];

    for (const candidate of reasoningCandidates) {
      const normalized = String(candidate || '').trim();
      if (normalized) {
        return normalized;
      }
    }

    return '';
  }

  private async normalizeOutline(
    outline: unknown,
    domainType: string,
  ): Promise<PhaseInitializeResult['outline']> {
    if (!Array.isArray(outline)) {
      return this.contextService.buildDefaultOutline(domainType);
    }

    const normalized = outline
      .map((item: unknown, index: number) => {
        const row = (item && typeof item === 'object' && !Array.isArray(item))
          ? item as Record<string, unknown>
          : {};
        const taskType = this.normalizeRuntimeTaskType(row.taskType);
        const title = String(row.title || '').trim();

        const rawPrompts = row.phasePrompts;
        const promptObj = rawPrompts && typeof rawPrompts === 'object' && !Array.isArray(rawPrompts)
          ? rawPrompts as Record<string, unknown>
          : {};
        const generating = String(promptObj.generating || '').trim();
        const postExecute = String(promptObj.post_execute || '').trim();
        const preExecute = String(promptObj.pre_execute || '').trim() || undefined;
        const execute = String(promptObj.execute || '').trim() || undefined;

        const phaseToolsCandidate = row.phaseTools;
        const phaseTools = phaseToolsCandidate && typeof phaseToolsCandidate === 'object' && !Array.isArray(phaseToolsCandidate)
          ? {
              pre_execute: Array.isArray((phaseToolsCandidate as Record<string, unknown>).pre_execute)
                ? ((phaseToolsCandidate as Record<string, unknown>).pre_execute as unknown[]).map((v) => String(v || '').trim()).filter(Boolean)
                : undefined,
              execute: Array.isArray((phaseToolsCandidate as Record<string, unknown>).execute)
                ? ((phaseToolsCandidate as Record<string, unknown>).execute as unknown[]).map((v) => String(v || '').trim()).filter(Boolean)
                : undefined,
              post_execute: Array.isArray((phaseToolsCandidate as Record<string, unknown>).post_execute)
                ? ((phaseToolsCandidate as Record<string, unknown>).post_execute as unknown[]).map((v) => String(v || '').trim()).filter(Boolean)
                : undefined,
            }
          : undefined;

        const recommendedAgentCandidate = row.recommendedAgent;
        const recommendedAgent = recommendedAgentCandidate
          && typeof recommendedAgentCandidate === 'object'
          && !Array.isArray(recommendedAgentCandidate)
          && String((recommendedAgentCandidate as Record<string, unknown>).agentId || '').trim()
          ? {
              agentId: String((recommendedAgentCandidate as Record<string, unknown>).agentId || '').trim(),
              agentName: String((recommendedAgentCandidate as Record<string, unknown>).agentName || '').trim() || '',
              reason: String((recommendedAgentCandidate as Record<string, unknown>).reason || '').trim() || '',
            }
          : undefined;

        return {
          step: typeof row.step === 'number' && Number.isInteger(row.step) ? Number(row.step) : index + 1,
          title: title || `步骤 ${index + 1}`,
          taskType,
          phasePrompts: {
            generating,
            ...(preExecute ? { pre_execute: preExecute } : {}),
            ...(execute ? { execute } : {}),
            post_execute: postExecute,
          },
          ...(recommendedAgent ? { recommendedAgent } : {}),
          ...(phaseTools ? { phaseTools } : {}),
        };
      })
      .filter((item) => Boolean(item.title) && Boolean(item.phasePrompts.generating) && Boolean(item.phasePrompts.post_execute));

    if (normalized.length === 0) {
      return this.contextService.buildDefaultOutline(domainType);
    }

    return normalized;
  }


  private normalizeRuntimeTaskType(
    input: unknown,
  ): 'research' | 'development.plan' | 'development.exec' | 'development.review' | 'general' {
    const normalized = String(input || '').trim().toLowerCase();
    if (
      normalized === 'research'
      || normalized === 'development.plan'
      || normalized === 'development.exec'
      || normalized === 'development.review'
      || normalized === 'general'
    ) {
      return normalized;
    }
    return 'general';
  }

  private normalizeMode(input: string, fallback: 'sequential' | 'parallel' | 'hybrid'): 'sequential' | 'parallel' | 'hybrid' {
    if (input === 'sequential' || input === 'parallel' || input === 'hybrid') {
      return input;
    }
    return fallback;
  }

  private resolveTaskContextFromMetadata(metadata?: Record<string, unknown>): Record<string, unknown> {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return {};
    }
    const taskContext = (metadata as Record<string, unknown>).taskContext;
    if (!taskContext || typeof taskContext !== 'object' || Array.isArray(taskContext)) {
      return {};
    }
    return taskContext as Record<string, unknown>;
  }

  private normalizePreactivatedToolIds(toolIds?: string[]): string[] | undefined {
    if (!Array.isArray(toolIds) || toolIds.length === 0) {
      return undefined;
    }

    const normalized = Array.from(new Set(toolIds.map((item) => String(item || '').trim()).filter(Boolean)));
    return normalized.length > 0 ? normalized : undefined;
  }
}
