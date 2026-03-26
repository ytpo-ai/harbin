import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Agent, AgentDocument } from '@agent/schemas/agent.schema';
import { AgentClientService } from '../agents-client/agent-client.service';
import { AgentExecutionTask } from '../../shared/types';
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
}

export interface GenerateNextTaskResult {
  action?: 'new' | 'redesign';
  redesignTaskId?: string;
  task?: {
    title: string;
    description: string;
    priority: 'low' | 'medium' | 'high' | 'urgent';
    agentId: string;
    taskType?: 'external_action' | 'research' | 'review' | 'development' | 'general';
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
  nextAction: 'generate_next' | 'stop' | 'redesign' | 'retry';
  reason: string;
  redesignTaskId?: string;
  nextTaskHints?: string[];
}

const DEFAULT_PLANNER_TASK_DECOMPOSITION_PROMPT = [
  '将用户需求拆解为可执行任务清单并返回 JSON。',
  '需求: {{prompt}}',
  '输出规则:',
  '1) JSON 结构: {"mode":"sequential|parallel|hybrid","tasks":[{"title":"","description":"","priority":"low|medium|high|urgent","dependencies":[0]}]}',
  '2) dependencies 为当前任务依赖的前置任务索引数组。',
  '3) mode 优先使用 {{mode}}。',
  '3.1) {{requirementScope}}',
  '4) 若存在发送邮件/外部动作任务，优先依赖"邮件草稿/内容生成"任务，而不是"校对/润色"任务，避免过度阻塞。',
  '5) 若需求涉及编排/分配/通知，最后一个任务应为"汇总输出编排结果 JSON"。',
  '6) task 的 description 必须具体可执行，包含文件路径、接口名、字段名等具体信息（如有）。禁止空泛描述。',
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

    const prompt = this.buildIncrementalPlannerPrompt(context);
    const task: AgentExecutionTask = {
      title: 'Incremental planning: generate next task',
      description: prompt,
      type: 'planning',
      priority: 'high',
      status: 'pending',
      assignedAgents: [plannerAgentId],
      teamId: 'orchestration',
      messages: [],
    };

    const response = await this.agentClientService.executeTask(plannerAgentId, task, {
      collaborationContext: {
        planId,
        mode: 'planning',
        format: 'json',
        roleInPlan: 'planner',
      },
      ...(options?.sessionId
        ? {
            sessionContext: {
              sessionId: options.sessionId,
            },
          }
        : {}),
    });

    const parsed = this.tryParseJson(response);
    if (!parsed) {
      return {
        isGoalReached: false,
        reasoning: 'Failed to parse planner response',
      };
    }

    const parsedAgentId = String(parsed?.task?.agentId || '').trim();
    const parsedTaskType = this.normalizeTaskType(parsed?.task?.taskType);
    const parsedAction = this.normalizePlannerAction(parsed?.action);
    const parsedRedesignTaskId = String(parsed?.redesignTaskId || '').trim() || undefined;
    const parsedRequiredTools = Array.isArray(parsed?.task?.requiredTools)
      ? parsed.task.requiredTools
        .map((item: unknown) => String(item || '').trim())
        .filter(Boolean)
      : undefined;

    const parsedTask = parsed?.task && !Array.isArray(parsed.task)
      ? {
          title: String(parsed.task.title || '').trim().slice(0, MAX_TITLE_LENGTH),
          description: String(parsed.task.description || '').trim().slice(0, MAX_DESCRIPTION_LENGTH),
          priority: this.normalizePriority(parsed.task.priority),
          agentId: parsedAgentId,
          taskType: parsedTaskType,
          requiredTools: parsedRequiredTools,
        }
      : undefined;
    const validatedTask = parsedTask && parsedTask.agentId ? parsedTask : undefined;

    return {
      action: parsedAction,
      redesignTaskId: parsedAction === 'redesign' ? parsedRedesignTaskId : undefined,
      task: validatedTask,
      isGoalReached: Boolean(parsed.isGoalReached),
      reasoning: String(parsed.reasoning || '').trim() || (!validatedTask ? 'Planner did not provide a valid agentId' : ''),
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
      title: 'Incremental planning: pre-execution decision',
      description: taskContext,
      type: 'planning',
      priority: 'high',
      status: 'pending',
      assignedAgents: [plannerAgentId],
      teamId: 'orchestration',
      messages: [],
    };

    const response = await this.agentClientService.executeTask(plannerAgentId, task, {
      collaborationContext: {
        planId,
        mode: 'planning',
        format: 'json',
        roleInPlan: 'planner_pre_execution',
      },
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
      title: 'Incremental planning: post-execution decision',
      description: executionResult,
      type: 'planning',
      priority: 'high',
      status: 'pending',
      assignedAgents: [plannerAgentId],
      teamId: 'orchestration',
      messages: [],
    };

    const response = await this.agentClientService.executeTask(plannerAgentId, task, {
      collaborationContext: {
        planId,
        mode: 'planning',
        format: 'json',
        roleInPlan: 'planner_post_execution',
      },
      sessionContext: {
        sessionId,
      },
    });

    const parsed = this.tryParseJson(response);
    if (!parsed || typeof parsed !== 'object') {
      return {
        nextAction: 'stop',
        reason: 'Failed to parse planner post-task response',
      };
    }

    const nextActionRaw = String(parsed.nextAction || '').trim().toLowerCase();
    const nextAction: PostExecutionDecision['nextAction'] =
      nextActionRaw === 'generate_next'
      || nextActionRaw === 'redesign'
      || nextActionRaw === 'retry'
        ? (nextActionRaw as PostExecutionDecision['nextAction'])
        : 'stop';

    return {
      nextAction,
      reason: String(parsed.reason || '').trim() || 'Planner post-task response missing reason',
      redesignTaskId: String(parsed.redesignTaskId || '').trim() || undefined,
      nextTaskHints: Array.isArray(parsed.nextTaskHints)
        ? parsed.nextTaskHints.map((item: unknown) => String(item || '').trim()).filter(Boolean)
        : undefined,
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
        collaborationContext: {
          mode: 'planning',
          format: 'json',
          roleInPlan: 'planner',
        },
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

  private buildIncrementalPlannerPrompt(context: IncrementalPlannerContext): string {
    const sections: string[] = [];

    // ── 最高优先级：输出格式强制约束（放在最前面，压制角色 prompt 影响） ──
    sections.push('[SYSTEM OVERRIDE] 你当前处于 **Planner JSON-only 模式**。');
    sections.push('此模式下的硬性规则：');
    sections.push('- 你只能输出一个合法 JSON 对象，绝对禁止输出任何自然语言、问候、确认、解释。');
    sections.push('- 如果你输出了非 JSON 内容，系统将视为失败并立即重试。');
    sections.push('- 不要回复"好的"、"收到"、"我来执行"等确认性文字。直接输出 JSON。');
    sections.push('- JSON 必须严格符合以下 schema:');
    sections.push('  {"action":"new|redesign","redesignTaskId":"(redesign 时必填)","task":{"title":"...","description":"...","priority":"low|medium|high|urgent","agentId":"...","taskType":"general|research|development|review|external_action","requiredTools":["..."]},"isGoalReached":false,"reasoning":"..."}');
    sections.push('- taskType 用于指定任务执行类型。大多数任务使用 general；仅当任务确实需要信息检索/调研时才用 research；代码开发用 development；审阅评审用 review；外部动作（如发邮件）用 external_action。');
    sections.push('');

    sections.push('你是一个计划编排器 (Planner)，负责逐步生成可执行任务来达成用户目标。');
    sections.push('请确保每一步都可验证、可执行、可被单个执行者独立完成。');
    sections.push('');
    sections.push('## Plan 目标（sourcePrompt 原文）');
    sections.push(context.planGoal);
    sections.push('');
    sections.push('## 当前编排进度');
    sections.push(`已累计执行步骤数: ${context.totalSteps}`);
    sections.push('');

    if (context.completedTasks.length > 0) {
      sections.push('## 已完成任务摘要');
      for (const item of context.completedTasks) {
        sections.push(`- [${item.title}] (agent=${item.agentId || 'unknown'}): ${item.outputSummary}`);
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
    sections.push('4) 若本轮未调用 list-agents，不允许输出 task。请返回 isGoalReached=false、task=null，并在 reasoning 说明原因。');
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
    sections.push('## 输出规则（严格遵守）');
    sections.push('1) 仅输出 JSON，禁止输出任何非 JSON 文本（包括问候、确认、解释、markdown fence 之外的内容）。');
    sections.push('2) JSON 结构: {"action": "new|redesign", "redesignTaskId": "...", "task": {"title": "...", "description": "...", "priority": "low|medium|high|urgent", "agentId": "...", "taskType": "general|research|development|review|external_action", "requiredTools": ["..."]}, "isGoalReached": false, "reasoning": "..."}');
    sections.push('3) 若目标已全部达成，设置 isGoalReached=true，task 可为 null。');
    sections.push('4) 每个任务必须足够简单、明确、可快速验证。');
    sections.push('5) task.description 必须包含具体执行信息（输入、动作、产出），禁止空泛描述。');
    sections.push('6) 你必须从本轮 list-agents 返回中选择一个真实存在的 agentId，不允许臆造。');
    sections.push('7) 当存在失败任务时，下一步【必须】满足至少一项纠偏条件：a) 更换执行 agent；b) 更换 taskType；c) 根本性改变任务描述与执行路径。仅增加解释或细化措辞不算有效纠偏。');
    sections.push('8) 相邻任务若可由同一 agent 在一次交付中完成，请倾向生成可合并的连续步骤，避免过碎任务。');
    sections.push('9) 当失败根因是 agent 工具缺失或分配不当时，优先使用 action="redesign" 并填写 redesignTaskId，重新指定 agent，而不是继续新增任务。');
    sections.push('10) 对工具依赖明确的任务，尽量填写 task.requiredTools（例如 ["repo-writer"]、["save-prompt-template"]），便于系统做二次校验。');
    sections.push('');
    sections.push('再次强调：你的回复必须以 { 开头，以 } 结尾，中间是合法 JSON。不要输出任何其他内容。');

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

  private normalizeTaskType(input: unknown): 'external_action' | 'research' | 'review' | 'development' | 'general' | undefined {
    const val = String(input || '').trim().toLowerCase();
    const validTypes = ['external_action', 'research', 'review', 'development', 'general'] as const;
    return (validTypes as readonly string[]).includes(val)
      ? (val as 'external_action' | 'research' | 'review' | 'development' | 'general')
      : undefined;
  }

  private normalizePlannerAction(input: unknown): 'new' | 'redesign' {
    const val = String(input || '').trim().toLowerCase();
    return val === 'redesign' ? 'redesign' : 'new';
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
