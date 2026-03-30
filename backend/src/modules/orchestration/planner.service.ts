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
import { PromptResolverService } from '../../../apps/agents/src/modules/prompt-registry/prompt-resolver.service';
import { PROMPT_ROLES, PROMPT_SCENES } from '../../../apps/agents/src/modules/prompt-registry/prompt-resolver.constants';
import {
  MAX_TASKS,
  MAX_TITLE_LENGTH,
  MAX_DESCRIPTION_LENGTH,
} from './services/scene-optimization.service';

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

const DEFAULT_PLANNER_TASK_DECOMPOSITION_PROMPT = [
  '将用户需求拆解为可执行任务清单并返回 JSON。',
  '需求: {{prompt}}',
  '输出规则:',
  '1) JSON 结构: {"mode":"sequential|parallel|hybrid","tasks":[{"title":"","description":"","priority":"low|medium|high|urgent","dependencies":[0]}]}',
  '2) dependencies 为当前任务依赖的前置任务索引数组。',
  '3) mode 优先使用 {{mode}}。',
  '3.1) {{requirementScope}}',
  '4) 若需求涉及编排/分配/通知，最后一个任务应为"汇总输出编排结果 JSON"。',
  '5) task 的 description 必须具体可执行，包含文件路径、接口名、字段名等具体信息（如有）。禁止空泛描述。',
].join('\n');

@Injectable()
export class PlannerService {
  private readonly logger = new Logger(PlannerService.name);

  constructor(
    @InjectModel(Agent.name) private readonly agentModel: Model<AgentDocument>,
    @InjectModel(OrchestrationPlan.name)
    private readonly planModel: Model<OrchestrationPlanDocument>,
    private readonly agentClientService: AgentClientService,
    private readonly promptResolver: PromptResolverService,
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
    const prompt = this.buildIncrementalPlannerPrompt(context, {
      domainType: planDomainType,
      planId,
      plan,
    });
    const task: AgentExecutionTask = {
      title: `[Incremental Planning] ${plan.title} generate next task`,
      description: prompt,
      type: 'planning',
      priority: 'high',
      status: 'pending',
      assignedAgents: [plannerAgentId],
      teamId: 'orchestration',
      messages: [],
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
      ...(options?.sessionId
        ? {
            sessionContext: {
              sessionId: options.sessionId,
            },
          }
        : {}),
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
  ): Promise<PreExecutionDecision> {
    const plan = await this.planModel.findById(planId).exec();
    if (!plan) {
      throw new NotFoundException('Plan not found');
    }
    const plannerAgentId = String(plan.strategy?.plannerAgentId || '').trim();
    if (!plannerAgentId) {
      throw new BadRequestException('Plan has no planner agent configured');
    }

    const task: AgentExecutionTask = {
      title: `[Incremental Planning] ${plan.title} pre-execution`,
      description: taskContext,
      type: 'planning',
      priority: 'high',
      status: 'pending',
      assignedAgents: [plannerAgentId],
      teamId: 'orchestration',
      messages: [],
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
    const prompt = this.buildPhaseInitializePrompt({
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
      messages: [],
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
      ...(options?.sessionId
        ? {
            sessionContext: {
              sessionId: options.sessionId,
            },
          }
        : {}),
    });

    const refreshedPlan = await this.planModel.findById(planId).select({ metadata: 1 }).lean().exec();
    const metadata = ((refreshedPlan as { metadata?: Record<string, unknown> } | null)?.metadata || {}) as Record<string, unknown>;
    const taskContext = this.resolveTaskContextFromMetadata(metadata);
    const outline = this.normalizeOutline(metadata.outline, planDomainType);
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
  ): Promise<PostExecutionDecision> {
    const plan = await this.planModel.findById(planId).exec();
    if (!plan) {
      throw new NotFoundException('Plan not found');
    }
    const plannerAgentId = String(plan.strategy?.plannerAgentId || '').trim();
    if (!plannerAgentId) {
      throw new BadRequestException('Plan has no planner agent configured');
    }

    const task: AgentExecutionTask = {
      title: `[Incremental Planning] ${plan.title} post-execution`,
      description: executionResult,
      type: 'planning',
      priority: 'high',
      status: 'pending',
      assignedAgents: [plannerAgentId],
      teamId: 'orchestration',
      messages: [],
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
      },
    });

    const parsed = this.tryParseJson(response);
    if (!parsed || typeof parsed !== 'object') {
      return {
        action: 'stop',
        reason: 'Failed to parse planner post-task response',
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
    const plannerPrompt = await this.resolvePlannerTaskPrompt({
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

  private buildIncrementalPlannerPrompt(
    context: IncrementalPlannerContext,
    options?: { domainType?: string; planId?: string; plan?: OrchestrationPlanDocument },
  ): string {
    const sections: string[] = [];
    const nextStep = Math.max(1, context.completedTasks.length + 1);
    const metadata = ((options?.plan as unknown as { metadata?: Record<string, unknown> } | undefined)?.metadata || {}) as Record<string, unknown>;
    const outline = Array.isArray(metadata.outline) ? metadata.outline as Array<Record<string, unknown>> : [];
    const currentOutlineStep = outline.find((item) => Number(item.step) === nextStep);
    const phasePrompts = currentOutlineStep?.phasePrompts;
    const generatingPrompt = phasePrompts && typeof phasePrompts === 'object'
      ? String((phasePrompts as Record<string, unknown>).generating || '').trim()
      : '';

    sections.push('【当前阶段声明 — 最高优先级】');
    sections.push('你当前处于 generating 阶段，只负责提交下一步任务。');
    sections.push('- 仅允许调用 `builtin.sys-mg.internal.agent-master.list-agents` 与 `builtin.sys-mg.mcp.orchestration.submit-task`。');
    sections.push('- 禁止调用 requirement.* 工具，禁止输出确认性文本。');
    sections.push('- 每次只提交一个任务。');
    if (options?.planId) {
      sections.push(`- submit-task 的 planId 必须是: ${options.planId}`);
    }
    sections.push('');

    if (generatingPrompt) {
      sections.push(`## 当前步骤指导（Step ${nextStep}）`);
      sections.push(generatingPrompt);
      sections.push('');
    }

    sections.push('## 计划上下文');
    sections.push(`- 当前步骤: ${nextStep} / ${Math.max(nextStep, outline.length || 1)}`);
    sections.push(`- requirementId: ${context.requirementId || '(none)'}`);
    sections.push(`- Plan 目标: ${context.planGoal}`);
    if (context.completedTasks.length > 0) {
      sections.push(`- 已完成任务: ${context.completedTasks.map((item) => item.title).join(' | ')}`);
    }

    if (!generatingPrompt) {
      sections.push('');
      sections.push('## 降级规则（无预编译提示时）');
      sections.push('- 先调用 list-agents 获取执行者，再提交一个可执行任务。');
      sections.push('- task.description 需包含输入、动作、产出与验证标准。');
      sections.push('- 任务类型使用 general/research/development.plan/development.exec/development.review。');
    }

    sections.push('## 当前编排进度');
    sections.push(`已创建任务数: ${context.totalSteps}`);
    sections.push('');

    if (context.completedTasks.length > 0) {
      sections.push('## 已完成任务摘要');
      for (let i = 0; i < context.completedTasks.length; i++) {
        const item = context.completedTasks[i];
        const stepLabel = options?.domainType === 'development' ? `(对应 step${i + 1}) ` : '';
        sections.push(`- ${stepLabel}[${item.title}] (agent=${item.agentId || 'unknown'}): ${item.outputSummary}`);
      }
      sections.push('注意：如果 outputSummary 中出现"无法执行"、"无法完成"、"缺少工具"、"没有权限"等语义，该任务可能是"虚假完成"（被标记 completed 但实际未完成），应视为未完成并重新规划。');
      sections.push('');
    }

    if (context.failedTasks.length > 0) {
      sections.push('## 失败任务（请调整策略）');
      for (const item of context.failedTasks) {
        const agentLabel = item.agentId || 'unknown';
        const toolsLabel = item.agentTools?.length ? item.agentTools.join(', ') : 'unknown';
        sections.push(`- [${item.title}] (taskId=${item.taskId}, agent=${agentLabel}, tools=[${toolsLabel}]): ${item.error}`);
      }
      sections.push('重要：当 action="redesign" 时，redesignTaskId 必须填写上方失败任务中的 taskId 原值，禁止臆造或替换为其他系统 task id。');
      sections.push('');
    }

    if (context.lastError) {
      sections.push('## 最近失败原因');
      sections.push(context.lastError);
      sections.push('');
    }
    sections.push('## 输出规则');
    sections.push('1) 若目标已达成，调用 submit-task 并传 isGoalReached=true。');
    sections.push('2) 调用 submit-task 时必须传真实 agentId。');
    sections.push('3) 禁止直接输出文本 JSON，结果必须通过工具调用给出。');

    return sections.join('\n');
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

  private buildPhaseInitializePrompt(input: {
    planId: string;
    sourcePrompt: string;
    domainType: string;
    existingTaskContext?: Record<string, unknown>;
  }): string {
    const sections: string[] = [];
    const domainType = String(input.domainType || 'general').trim().toLowerCase();
    const existingTaskContext = input.existingTaskContext || {};
    const existingRequirementId = String(existingTaskContext.requirementId || '').trim();

    sections.push('## 你正在执行 phaseInitialize 阶段');
    sections.push('');
    sections.push('### Phase 1：大纲与 Prompt 预编译（必做）');
    sections.push('1. 调用 `builtin.sys-mg.internal.agent-master.list-agents` 获取可用 agent 列表。');
    sections.push('2. 结合 domainType、sourcePrompt 与已注入 skill 定义，产出执行步骤 outline。');
    sections.push('3. 为每个步骤生成 phasePrompts：`generating`、`pre_execute`、`execute`、`post_execute`。');
    sections.push('4. 为每个步骤选择推荐执行 agent（recommendedAgent）和可选 phaseTools。');
    sections.push('5. 调用 `builtin.sys-mg.mcp.orchestration.plan-initialize` 写入 outline：');
    sections.push(`   - planId=${input.planId}`);
    sections.push('   - mode="outline"');
    sections.push('   - data=OutlineItem[]（每项必须包含 step/title/taskType/phasePrompts）');
    sections.push('');
    sections.push('### Phase 2：扩展步骤（可选）');
    sections.push('- 若技能文档中存在 `## phaseInitialize 扩展步骤`，按该段落执行相关工具调用。');
    sections.push('- 需要共享到后续阶段的数据，统一调用 `builtin.sys-mg.mcp.orchestration.plan-initialize` 写入：');
    sections.push(`  - planId=${input.planId}`);
    sections.push('  - mode="taskContext"');
    sections.push('  - data={...}');
    sections.push('');
    sections.push('### 约束');
    sections.push('- 禁止调用 `builtin.sys-mg.mcp.orchestration.submit-task`。');
    sections.push('- 所有初始化产出必须通过 `plan-initialize` 工具写入 metadata。');
    sections.push('- 禁止输出确认性文本。优先使用工具调用。');
    sections.push('');
    sections.push('### 输入');
    sections.push(`- planId: ${input.planId}`);
    sections.push(`- domainType: ${domainType}`);
    sections.push(`- sourcePrompt: ${input.sourcePrompt}`);
    if (existingRequirementId) {
      sections.push(`- existingRequirementId: ${existingRequirementId}`);
    }

    return sections.join('\n');
  }

  private normalizeOutline(
    outline: unknown,
    domainType: string,
  ): PhaseInitializeResult['outline'] {
    if (!Array.isArray(outline)) {
      return this.buildDefaultOutline(domainType);
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
      return this.buildDefaultOutline(domainType);
    }

    return normalized;
  }

  private buildDefaultOutline(domainType: string): PhaseInitializeResult['outline'] {
    const normalized = String(domainType || 'general').trim().toLowerCase();
    if (normalized === 'development') {
      return [
        {
          step: 1,
          title: '制定技术开发计划',
          taskType: 'development.plan',
          phasePrompts: {
            generating: '生成技术规划任务，要求输出结构化开发计划与验收要点。',
            post_execute: '验证开发计划是否完整；完整则 generate_next，否则 redesign/retry。',
          },
        },
        {
          step: 2,
          title: '执行开发',
          taskType: 'development.exec',
          phasePrompts: {
            generating: '生成开发执行任务，要求按上一步计划落地代码变更并附验证证据。',
            post_execute: '验证是否完成代码变更与必要验证；通过则 generate_next。',
          },
        },
        {
          step: 3,
          title: '实现评估',
          taskType: 'development.review',
          phasePrompts: {
            generating: '生成实现评审任务，要求输出评审结论与修复建议。',
            post_execute: '验证评审结论是否完整，完成则 stop。',
          },
        },
      ];
    }
    return [
      {
        step: 1,
        title: '执行任务',
        taskType: normalized === 'research' ? 'research' : 'general',
        phasePrompts: {
          generating: '生成可执行任务，明确输入、动作、产出与验收标准。',
          post_execute: '根据执行结果判断 generate_next 或 stop。',
        },
      },
    ];
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

  private async resolvePlannerTaskPrompt(input: {
    prompt: string;
    mode: 'sequential' | 'parallel' | 'hybrid';
    requirementId?: string;
    sessionOverride?: string;
  }): Promise<string> {
    const requirementScope = input.requirementId
      ? `来源需求ID: ${input.requirementId}，请确保任务拆解围绕该需求交付闭环。`
      : '若存在来源需求ID，应保持任务拆解与需求范围一致。';

    const resolved = await this.promptResolver.resolve({
      scene: PROMPT_SCENES.orchestration,
      role: PROMPT_ROLES.plannerTaskDecomposition,
      defaultContent: DEFAULT_PLANNER_TASK_DECOMPOSITION_PROMPT,
      sessionOverride: input.sessionOverride,
    });

    return this.renderPlannerPromptTemplate(resolved.content, {
      prompt: input.prompt,
      mode: input.mode,
      requirementScope,
    });
  }

  private renderPlannerPromptTemplate(
    template: string,
    params: {
      prompt: string;
      mode: 'sequential' | 'parallel' | 'hybrid';
      requirementScope: string;
    },
  ): string {
    const normalizedTemplate = String(template || '').trim() || DEFAULT_PLANNER_TASK_DECOMPOSITION_PROMPT;
    const replaced = normalizedTemplate
      .replace(/{{\s*prompt\s*}}/g, params.prompt)
      .replace(/{{\s*mode\s*}}/g, params.mode)
      .replace(/{{\s*requirementScope\s*}}/g, params.requirementScope);

    const lines = [replaced.trim()];

    // Safety net: append missing critical variables
    if (!/{{\s*prompt\s*}}/i.test(normalizedTemplate) && !replaced.includes('需求:')) {
      lines.push(`需求: ${params.prompt}`);
    }
    if (!/{{\s*mode\s*}}/i.test(normalizedTemplate) && !replaced.includes(params.mode)) {
      lines.push(`mode 优先使用 ${params.mode}。`);
    }
    if (!/{{\s*requirementScope\s*}}/i.test(normalizedTemplate) && !replaced.includes(params.requirementScope)) {
      lines.push(params.requirementScope);
    }

    return lines.join('\n').trim();
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
}
