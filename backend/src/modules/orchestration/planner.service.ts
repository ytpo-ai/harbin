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
  requirementId?: string;
  requirementTitle?: string;
  requirementDescription?: string;
  outline: Array<{
    step: number;
    title: string;
    taskType: 'development.plan' | 'development.exec' | 'development.review' | 'general' | 'research';
  }>;
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
    const prompt = this.buildIncrementalPlannerPrompt(context, { domainType: planDomainType, planId });
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

    const prompt = this.buildPhaseInitializePrompt({
      sourcePrompt: input.sourcePrompt,
      domainType: input.domainType,
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
        roleInPlan: 'planner',
        responseDirective: 'text',
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

    const parsed = this.tryParseJson(response);
    if (!parsed || typeof parsed !== 'object') {
      return {
        outline: this.buildDefaultOutline(input.domainType),
        reasoning: 'Failed to parse initialize response, fallback to default outline',
      };
    }

    const result = this.extractPostDecisionPayload(parsed);
    const outline = this.normalizeOutline(result.outline, input.domainType);

    return {
      requirementId: String(result.requirementId || '').trim() || undefined,
      requirementTitle: String(result.requirementTitle || '').trim() || undefined,
      requirementDescription: String(result.requirementDescription || '').trim() || undefined,
      outline,
      reasoning: String(result.reasoning || result.reason || '').trim() || undefined,
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
    options?: { domainType?: string; planId?: string },
  ): string {
    const sections: string[] = [];
    const isDevelopment = options?.domainType === 'development';

    sections.push('你必须通过调用工具 builtin.sys-mg.mcp.orchestration.submit-task 提交下一步任务。');
    if (options?.planId) {
      sections.push(`调用 submit-task 时，planId 参数必须填写: ${options.planId}`);
    }
    sections.push('禁止直接输出纯文本 JSON 作为最终结果。');
    sections.push('当目标已达成时，调用 submit-task 并传 isGoalReached=true。');
    sections.push('');
    sections.push('【最高优先级行为约束】');
    sections.push('- 你的第一条回复必须是 <tool_call> 工具调用，禁止输出任何确认性文本（如"已收到"、"我将按照..."、"好的"等）。');
    sections.push('- 每次回复只允许包含一个 <tool_call> 标签，标签外不要有其他文本。');
    sections.push('- **每次调用只提交一个 submit-task**。提交成功后必须立即停止，不要继续提交后续步骤。系统会在任务执行完成后自动再次调用你生成下一步。');
    sections.push('');

    sections.push('你是一个计划编排器 (Planner)，负责逐步生成可执行任务来达成用户目标。');
    sections.push('请确保每一步都可验证、可执行、可被单个执行者独立完成。');
    sections.push('');
    sections.push('## 上下文锚点（高优先级）');
    sections.push(`- requirementId: ${context.requirementId || '(none)'}`);
    if (context.requirementTitle) {
      sections.push(`- requirementTitle: ${context.requirementTitle}`);
    }
    if (context.requirementDescription) {
      sections.push(`- requirementDescription: ${context.requirementDescription.slice(0, 800)}`);
    }
    if (isDevelopment && !context.requirementId) {
      sections.push('- development 计划必须沿用 phaseInitialize 注入的 requirementId，缺失时应停止并报告原因。');
    }
    sections.push('- 若 Plan 目标中出现 `${...}` 形式占位符，请忽略占位符字面值，以本节锚点为准。');
    sections.push('');
    sections.push('## Plan 目标（sourcePrompt 原文）');
    sections.push(context.planGoal);
    sections.push('');

    // ── development 模式：注入 skill 步骤引导指令 ──
    if (isDevelopment) {
      sections.push('## 角色边界（最高优先级，覆盖一切其他指令）');
      sections.push('你是 Planner（规划器），不是执行者。你的唯一输出是通过 submit-task 工具提交任务卡片。');
      sections.push('- skill 中的"动作"描述是给**执行者**的指令，你只需将其转化为 task.description 的内容。');
      sections.push('- **禁止在规划阶段调用任何业务工具**（如需求查询、代码读写、状态更新等）。');
      sections.push('- **禁止输出确认性文本**（如"已收到"、"我将按照..."）。');
      sections.push('- **禁止输出 TASK_INABILITY**。即使上下文不完整，也必须按 skill 步骤定义提交任务。');
      sections.push('');
      sections.push('## 技能步骤引导（强制，优先级高于 sourcePrompt）');
      sections.push('你的 system messages 中已注入 rd-workflow 技能的完整流程定义，包含步骤序号（step1 → step2 → step3 → ...）、执行角色、输入、动作、输出契约和 taskType 约束。');
      sections.push('**你必须严格按 skill 中定义的步骤顺序逐步生成任务，每次只生成一个步骤对应的任务。**');
      const completedStepCount = context.completedTasks.length;
      const nextStep = completedStepCount + 1;
      sections.push('');
      sections.push(`### 步骤进度（强制遵守）`);
      sections.push(`- 已完成步骤数: ${completedStepCount}`);
      sections.push(`- **你现在必须生成的步骤: step${nextStep}**`);
      sections.push(`- 禁止生成 step1 ~ step${completedStepCount} 的任务（这些步骤已完成）`);
      if (nextStep <= 3) {
        sections.push(`- 请参照 skill 中 "### step${nextStep}" 的定义生成任务`);
      }
      sections.push('');
      sections.push('步骤引导约束：');
      sections.push('- task.description 必须反映该步骤定义的具体动作和输出契约，禁止抄写或复述流程定义本身。');
      sections.push('- task.taskType 必须使用 skill 步骤中指定的任务类型（如 general、development.plan、development.exec、development.review）。');
      sections.push('- 执行角色按 skill 步骤中的定义，通过 list-agents 结果匹配。');
      sections.push('- 当 skill 步骤中有"输出契约"时，task.description 必须明确列出需要交付的内容项。');
      sections.push('- 当 skill 步骤中有"约束"时，task.description 必须体现这些约束。');
      sections.push('- sourcePrompt 仅作为补充背景，步骤定义以 skill 内容为准。');
      sections.push('');
    }
    sections.push('## 当前编排进度');
    sections.push(`已累计执行步骤数: ${context.totalSteps}`);
    sections.push('');

    if (context.completedTasks.length > 0) {
      sections.push('## 已完成任务摘要');
      for (let i = 0; i < context.completedTasks.length; i++) {
        const item = context.completedTasks[i];
        const stepLabel = isDevelopment ? `(对应 skill step${i + 1}) ` : '';
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

    sections.push('## 执行者发现步骤（每次规划都必须执行）');
    sections.push('1) 先调用 builtin.sys-mg.internal.agent-master.list-agents 获取当前可用 Agent 的实时列表。');
    sections.push('2) 按 requiredTools（如 repo-writer、save-prompt-template、web-search、web-fetch）过滤候选。');
    sections.push('3) 在工具满足的候选内，再按能力标签、角色、失败历史做选择。');
    sections.push('4) 若本轮未调用 list-agents，不允许提交 task。');
    sections.push('');

    sections.push('## 执行者选择规则（关键，严格遵守）');
    sections.push('选择 agentId 时必须按以下优先级判断：');
    sections.push('A) **工具匹配优先（强制）**：先确定本任务需要的工具（如 repo-writer、save-prompt-template、web-search、web-fetch 等），再逐个核对 list-agents 返回结果中的工具列表。');
    sections.push('   - 【禁止】将任务分配给缺少所需工具的 agent，即使该 agent 在能力标签或角色层级上更匹配。');
    sections.push('   - 若无任何 agent 拥有所需工具，必须在 reasoning 明确说明，并给出可执行的替代路径。');
    sections.push('B) **多人有工具时可委派**：若多个 agent 都拥有所需工具，优先选择职级更低/更专注的执行者，让高层级 agent 专注决策。');
    sections.push('C) **仅自己有工具时必须选自己**：若实时清单显示只有你自己拥有所需工具，必须选择自己（你的 agentId）执行，不得委派给没有相应工具的 agent。');
    sections.push('D) **无工具需求时按能力匹配**：若任务不依赖特定工具，按能力标签和角色匹配度选择。');
    sections.push('E) **失败回避**：若某 agent 在本计划中已因"缺少工具"或"工具不匹配"失败，【禁止】再次将同类任务分配给该 agent，必须从失败 agent 列表中排除后重选。');
    sections.push('F) **【禁止】生成验证/预检类元任务**：执行者匹配必须在规划阶段通过 list-agents 结果直接完成，严禁外化为执行任务（如"核验可用执行者"、"确认谁具备某工具"等）。');
    sections.push('');
    sections.push('## 输出规则');
    sections.push('1) 若目标已全部达成，调用 submit-task 并设置 isGoalReached=true。');
    sections.push('2) 每个任务必须足够简单、明确、可快速验证。');
    sections.push('3) task.description 必须包含具体执行信息（输入、动作、产出），禁止空泛描述。');
    sections.push('4) 你必须从本轮 list-agents 返回中选择一个真实存在的 agentId，不允许臆造。');
    sections.push('5) 调用 submit-task 时必须显式传 agentId（或兼容字段 executorId），不得省略执行者字段。');
    sections.push('6) 当存在失败任务时，下一步【必须】满足至少一项纠偏条件：a) 更换执行 agent；b) 根本性改变任务描述与执行路径。仅增加解释或细化措辞不算有效纠偏。');
    sections.push('7) 相邻任务若可由同一 agent 在一次交付中完成，请倾向生成可合并的连续步骤，避免过碎任务。');
    sections.push('8) 当失败根因是 agent 工具缺失或分配不当时，优先使用 action="redesign" 并填写 redesignTaskId，重新指定 agent，而不是继续新增任务。');
    sections.push('9) 对工具依赖明确的任务，尽量填写 task.requiredTools（例如 ["repo-writer"]、["save-prompt-template"]），便于系统做二次校验。');

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
    sourcePrompt: string;
    domainType: string;
    existingTaskContext?: Record<string, unknown>;
  }): string {
    const sections: string[] = [];
    const domainType = String(input.domainType || 'general').trim().toLowerCase();
    const isDevelopment = domainType === 'development';
    const existingTaskContext = input.existingTaskContext || {};
    const existingRequirementId = String(existingTaskContext.requirementId || '').trim();

    sections.push('你正在执行 Orchestration 的 phaseInitialize 阶段。');
    sections.push('你必须在一次回复内完成所有工具调用，然后输出最终 JSON 结果。');
    sections.push('');

    // ── 工具调用序列 ──
    sections.push('## 工具调用序列（必须按序执行）');
    sections.push('');
    sections.push('1. 调用 `builtin.sys-mg.internal.agent-master.list-agents` 获取可用 agent 列表。');
    if (isDevelopment) {
      if (existingRequirementId) {
        sections.push(`2. requirementId 已存在（${existingRequirementId}），跳过 requirement.list。`);
        sections.push(`3. 调用 \`builtin.sys-mg.mcp.requirement.get\`（参数 requirementId=${existingRequirementId}）获取需求详情。`);
      } else {
        sections.push('2. 调用 `builtin.sys-mg.mcp.requirement.list`（参数 status=todo）获取待办需求列表。');
        sections.push('3. 从返回结果中选择优先级最高且可执行的需求。');
        sections.push('4. 调用 `builtin.sys-mg.mcp.requirement.get`（参数 requirementId=<选定的ID>）获取该需求的完整详情。');
        sections.push('5. 调用 `builtin.sys-mg.mcp.requirement.update-status`（参数 requirementId=<选定的ID>, status=assigned, changedByType=agent, changedByName=orchestration-planner-agent, note=phaseInitialize 选定需求）。');
      }
    }
    sections.push('');

    // ── 目标 ──
    sections.push('## 目标');
    if (isDevelopment) {
      sections.push('- 通过上述工具调用选定一个 requirementId，获取其详情。');
      sections.push('- 输出任务大纲 outline（step/title/taskType）。');
      if (existingRequirementId) {
        sections.push(`- requirementId 已锚定为 ${existingRequirementId}，直接沿用。`);
      }
    } else {
      sections.push('- 输出任务大纲 outline（step/title/taskType）。');
    }
    sections.push('');

    // ── 输入 ──
    sections.push('## 输入');
    sections.push(`- domainType: ${domainType}`);
    sections.push(`- sourcePrompt: ${input.sourcePrompt}`);
    if (existingRequirementId) {
      sections.push(`- existingRequirementId: ${existingRequirementId}`);
    }
    sections.push('');

    // ── 失败处理 ──
    if (isDevelopment && !existingRequirementId) {
      sections.push('## 失败处理');
      sections.push('- 如果 requirement.list 返回空列表，输出 {"requirementId": null, "outline": [], "reasoning": "需求池为空"}。');
      sections.push('- 如果工具调用失败，仍尽可能输出 outline 以确保后续流程可降级。');
      sections.push('');
    }

    // ── 最终输出 ──
    sections.push('## 最终输出');
    sections.push('完成所有工具调用后，输出以下 JSON 作为最终结果（工具调用结果之外的唯一文本输出）：');
    sections.push('```');
    sections.push('{"requirementId":"<ID或null>","requirementTitle":"<标题>","requirementDescription":"<描述>","outline":[{"step":1,"title":"...","taskType":"development.plan|development.exec|development.review|general|research"}],"reasoning":"<理由>"}');
    sections.push('```');
    sections.push('');
    sections.push('约束：工具调用完成后，最终回复只包含上述 JSON 对象，不要附加解释文字。');

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
        return {
          step: typeof row.step === 'number' && Number.isInteger(row.step) ? Number(row.step) : index + 1,
          title: title || `步骤 ${index + 1}`,
          taskType,
        };
      })
      .filter((item) => Boolean(item.title));

    if (normalized.length === 0) {
      return this.buildDefaultOutline(domainType);
    }

    return normalized;
  }

  private buildDefaultOutline(domainType: string): PhaseInitializeResult['outline'] {
    const normalized = String(domainType || 'general').trim().toLowerCase();
    if (normalized === 'development') {
      return [
        { step: 1, title: '制定技术开发计划', taskType: 'development.plan' },
        { step: 2, title: '执行开发', taskType: 'development.exec' },
        { step: 3, title: '实现评估', taskType: 'development.review' },
      ];
    }
    return [
      { step: 1, title: '执行任务', taskType: normalized === 'research' ? 'research' : 'general' },
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
}
