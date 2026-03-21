import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Agent, AgentDocument } from '@agent/schemas/agent.schema';
import { AgentClientService } from '../agents-client/agent-client.service';
import { AgentExecutionTask } from '../../shared/types';
import { PromptResolverService } from '../../../apps/agents/src/modules/prompt-registry/prompt-resolver.service';
import { PROMPT_ROLES, PROMPT_SCENES } from '../../../apps/agents/src/modules/prompt-registry/prompt-resolver.constants';
import { PlanningContext } from './services/planning-context.service';
import {
  SceneOptimizationService,
  MAX_TASKS,
  MAX_TITLE_LENGTH,
  MAX_DESCRIPTION_LENGTH,
} from './services/scene-optimization.service';
import { PlanningRule } from '../../../apps/agents/src/schemas/agent-skill.schema';

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

const DEFAULT_PLANNER_TASK_DECOMPOSITION_PROMPT = [
  '将用户需求拆解为可执行任务清单并返回 JSON。',
  '需求: {{prompt}}',
  '{{requirementDetail}}',
  '{{agentManifest}}',
  '{{planningConstraints}}',
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
    private readonly agentClientService: AgentClientService,
    private readonly promptResolver: PromptResolverService,
    private readonly sceneOptimizationService: SceneOptimizationService,
  ) {}

  async planFromPrompt(input: {
    prompt: string;
    mode?: 'sequential' | 'parallel' | 'hybrid';
    plannerAgentId?: string;
    requirementId?: string;
    planningContext?: PlanningContext;
  }): Promise<PlannerResult> {
    const mode = input.mode || 'hybrid';
    if (input.plannerAgentId) {
      const result = await this.planByAgent(input.prompt, input.plannerAgentId, mode, input.requirementId, input.planningContext);
      if (result) {
        return result;
      }
    }

    const defaultPlanner = await this.agentModel.findOne({ isActive: true }).sort({ createdAt: 1 }).exec();
    if (defaultPlanner?._id) {
      const result = await this.planByAgent(input.prompt, defaultPlanner._id.toString(), mode, input.requirementId, input.planningContext);
      if (result) {
        return result;
      }
    }

    return this.planByHeuristic(input.prompt, mode);
  }

  private async planByAgent(
    prompt: string,
    plannerAgentId: string,
    mode: 'sequential' | 'parallel' | 'hybrid',
    requirementId?: string,
    planningContext?: PlanningContext,
  ): Promise<PlannerResult | null> {
    const plannerPrompt = await this.resolvePlannerTaskPrompt({
      prompt,
      mode,
      requirementId,
      planningContext,
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
        teamContext: {
          mode: 'planning',
          format: 'json',
        },
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

      let tasks: PlannerTaskDraft[] = parsed.tasks.slice(0, MAX_TASKS).map((item: any, index: number) => ({
        title: String(item.title || `子任务 ${index + 1}`).slice(0, MAX_TITLE_LENGTH),
        description: String(item.description || item.title || '').slice(0, MAX_DESCRIPTION_LENGTH),
        priority: this.normalizePriority(item.priority),
        dependencies: Array.isArray(item.dependencies)
          ? item.dependencies.filter((dep: any) => Number.isInteger(dep) && dep >= 0)
          : index > 0
            ? [index - 1]
            : [],
      }));

      // Apply skill constraint validation
      const skillRules = planningContext?.rawPlanningRules || [];
      if (skillRules.length) {
        const validation = this.validateAgainstSkillConstraints(tasks, skillRules);
        tasks = validation.tasks;
        if (!tasks.length) {
          this.logger.warn('All tasks removed by skill constraint validation, falling back to pre-validation result');
          tasks = parsed.tasks.slice(0, MAX_TASKS).map((item: any, index: number) => ({
            title: String(item.title || `子任务 ${index + 1}`).slice(0, MAX_TITLE_LENGTH),
            description: String(item.description || item.title || '').slice(0, MAX_DESCRIPTION_LENGTH),
            priority: this.normalizePriority(item.priority),
            dependencies: index > 0 ? [index - 1] : [],
          }));
        }
      }

      // Apply scene-based dependency optimization and quality validation
      const optimizedTasks = this.sceneOptimizationService.optimizeTasks(tasks);
      this.sceneOptimizationService.validateTaskQuality(optimizedTasks);

      return {
        mode: this.normalizeMode(parsed.mode, mode),
        tasks: optimizedTasks,
        plannerAgentId,
        strategyNote: 'Generated by planner agent',
      };
    } catch (err) {
      this.logger.warn(`planByAgent failed for agent=${plannerAgentId}: ${(err as Error).message}`);
      return null;
    }
  }

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
      tasks: this.sceneOptimizationService.optimizeTasks(tasks),
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

  private normalizeMode(input: string, fallback: 'sequential' | 'parallel' | 'hybrid'): 'sequential' | 'parallel' | 'hybrid' {
    if (input === 'sequential' || input === 'parallel' || input === 'hybrid') {
      return input;
    }
    return fallback;
  }

  /**
   * Validate planner output against skill-defined planning rules.
   * Returns the filtered task list (forbidden patterns removed) and any violations found.
   */
  private validateAgainstSkillConstraints(
    tasks: PlannerTaskDraft[],
    rules: PlanningRule[],
  ): { tasks: PlannerTaskDraft[]; violations: string[] } {
    if (!rules.length) {
      return { tasks, violations: [] };
    }

    const violations: string[] = [];
    let filtered = [...tasks];

    for (const rule of rules) {
      switch (rule.type) {
        case 'forbidden_task_pattern': {
          if (!rule.validate) break;
          try {
            const pattern = new RegExp(rule.validate, 'i');
            const before = filtered.length;
            filtered = filtered.filter((task) => {
              const text = `${task.title} ${task.description}`;
              const matches = pattern.test(text);
              if (matches) {
                violations.push(`Removed task "${task.title}" (forbidden pattern: ${rule.rule})`);
              }
              return !matches;
            });
            if (before !== filtered.length) {
              // Reindex dependencies after removal
              filtered = this.reindexDependencies(filtered);
            }
          } catch {
            this.logger.warn(`Invalid regex in forbidden_task_pattern rule: ${rule.validate}`);
          }
          break;
        }
        case 'task_count': {
          if (!rule.validate) break;
          try {
            const constraints = JSON.parse(rule.validate);
            if (constraints.min && filtered.length < constraints.min) {
              violations.push(`Task count ${filtered.length} below minimum ${constraints.min} (${rule.rule})`);
            }
            if (constraints.max && filtered.length > constraints.max) {
              violations.push(`Task count ${filtered.length} exceeds maximum ${constraints.max}, truncating (${rule.rule})`);
              filtered = filtered.slice(0, constraints.max);
              filtered = this.reindexDependencies(filtered);
            }
          } catch {
            this.logger.warn(`Invalid JSON in task_count rule: ${rule.validate}`);
          }
          break;
        }
        case 'description_quality': {
          if (!rule.validate) break;
          try {
            const pattern = new RegExp(rule.validate, 'i');
            for (const task of filtered) {
              if (!pattern.test(task.description)) {
                violations.push(`Task "${task.title}" description does not match quality pattern (${rule.rule})`);
              }
            }
          } catch {
            this.logger.warn(`Invalid regex in description_quality rule: ${rule.validate}`);
          }
          break;
        }
        // required_task_pattern and dependency_rule are advisory — logged but not enforced
        default:
          break;
      }
    }

    if (violations.length) {
      this.logger.log(`Planning constraint violations (${violations.length}): ${violations.join('; ')}`);
    }

    return { tasks: filtered, violations };
  }

  /**
   * After removing tasks, reindex dependencies to keep them valid.
   */
  private reindexDependencies(tasks: PlannerTaskDraft[]): PlannerTaskDraft[] {
    // Dependencies are index-based, so after filtering we just ensure they're in range
    return tasks.map((task, idx) => ({
      ...task,
      dependencies: task.dependencies.filter((dep) => dep >= 0 && dep < tasks.length && dep !== idx),
    }));
  }

  private async resolvePlannerTaskPrompt(input: {
    prompt: string;
    mode: 'sequential' | 'parallel' | 'hybrid';
    requirementId?: string;
    sessionOverride?: string;
    planningContext?: PlanningContext;
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
      agentManifest: input.planningContext?.agentManifest || '',
      requirementDetail: input.planningContext?.requirementDetail || '',
      planningConstraints: input.planningContext?.planningConstraints || '',
    });
  }

  private renderPlannerPromptTemplate(
    template: string,
    params: {
      prompt: string;
      mode: 'sequential' | 'parallel' | 'hybrid';
      requirementScope: string;
      agentManifest: string;
      requirementDetail: string;
      planningConstraints: string;
    },
  ): string {
    const normalizedTemplate = String(template || '').trim() || DEFAULT_PLANNER_TASK_DECOMPOSITION_PROMPT;
    const replaced = normalizedTemplate
      .replace(/{{\s*prompt\s*}}/g, params.prompt)
      .replace(/{{\s*mode\s*}}/g, params.mode)
      .replace(/{{\s*requirementScope\s*}}/g, params.requirementScope)
      .replace(/{{\s*agentManifest\s*}}/g, params.agentManifest)
      .replace(/{{\s*requirementDetail\s*}}/g, params.requirementDetail)
      .replace(/{{\s*planningConstraints\s*}}/g, params.planningConstraints);

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
    // Append context blocks if not already in the template
    if (params.agentManifest && !/{{\s*agentManifest\s*}}/i.test(normalizedTemplate)) {
      lines.push(params.agentManifest);
    }
    if (params.requirementDetail && !/{{\s*requirementDetail\s*}}/i.test(normalizedTemplate)) {
      lines.push(params.requirementDetail);
    }
    if (params.planningConstraints && !/{{\s*planningConstraints\s*}}/i.test(normalizedTemplate)) {
      lines.push(params.planningConstraints);
    }

    return lines.join('\n').trim();
  }
}
