import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Agent, AgentDocument } from '@agent/schemas/agent.schema';
import { Tool, ToolDocument } from '../../../../apps/agents/src/schemas/tool.schema';
import {
  Employee,
  EmployeeDocument,
  EmployeeStatus,
} from '../../../shared/schemas/employee.schema';
import { AgentRole, AgentRoleDocument } from '@agent/schemas/agent-role.schema';
import {
  AgentRoleTier,
  canDelegateAcrossTier,
  getTierByAgentRoleCode,
  normalizeAgentRoleTier,
} from '@legacy/shared/role-tier';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExecutorSelectionContext {
  title: string;
  description: string;
  taskType?: 'development.plan' | 'development.exec' | 'development.review' | 'research' | 'general';
  requiredTools?: string[];
  requiredCapabilities?: string[];
  preferredRoleCode?: string;
  plannerAgentId?: string;
  assignmentPolicy?: 'default' | 'lock_to_planner';
}

export interface ExecutorSelectionResult {
  executorType: 'agent' | 'employee' | 'unassigned';
  executorId?: string;
  reason: string;
  score?: number;
  capabilityMatch?: {
    toolsCovered: string[];
    toolsMissing: string[];
    capabilitiesCovered: string[];
    capabilitiesMissing: string[];
  };
}

export interface AgentToolFitValidationResult {
  fit: boolean;
  requiredTools: string[];
  missingTools: string[];
  suggestion?: ExecutorSelectionResult;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Tier → compatible task types (weight = 40 when exact match, 25 when compatible) */
const TIER_TASK_COMPATIBILITY: Record<AgentRoleTier, string[]> = {
  leadership: ['general', 'research', 'development.plan', 'development.exec', 'development.review'],
  operations: ['general', 'research', 'development.plan', 'development.exec', 'development.review'],
  temporary: ['general', 'research', 'development.plan', 'development.exec', 'development.review'],
};

/** Task-type → tool-id fragments used for inferring tool coverage when no explicit requiredTools */
const TASK_TOOL_HINTS: Record<string, string[]> = {
  research: ['web-search', 'web-fetch', 'websearch', 'webfetch', 'exa', 'serp'],
};

const TEXT_TOOL_HINTS: Array<{ keywords: string[]; toolHints: string[] }> = [
  {
    keywords: ['save-prompt-template', 'prompt template', '提示词模板', '发布模板'],
    toolHints: ['save-prompt-template', 'prompt'],
  },
  {
    keywords: ['websearch', 'webfetch', 'search', 'research', '调研', '检索'],
    toolHints: ['web-search', 'web-fetch', 'websearch', 'webfetch'],
  },
];

/** Score dimension weights (configurable via env) */
const W_ROLE = parseInt(process.env.EXECUTOR_WEIGHT_ROLE || '40', 10);
const W_TOOL = parseInt(process.env.EXECUTOR_WEIGHT_TOOL || '30', 10);
const W_CAPABILITY = parseInt(process.env.EXECUTOR_WEIGHT_CAPABILITY || '20', 10);
const W_KEYWORD = parseInt(process.env.EXECUTOR_WEIGHT_KEYWORD || '10', 10);

const MIN_SCORE_THRESHOLD = parseInt(process.env.EXECUTOR_MIN_SCORE_THRESHOLD || '10', 10);

/** Task types that require opencode execution capability. */
const OPENCODE_REQUIRED_TASK_TYPES = new Set(['development.plan', 'development.exec', 'development.review']);

const TASK_TYPE_REQUIRED_CAPABILITIES: Record<string, string[]> = {
  'development.plan': ['development_plan', 'opencode'],
  'development.exec': ['development_exec', 'opencode'],
  'development.review': ['development_review', 'opencode'],
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class ExecutorSelectionService {
  private readonly logger = new Logger(ExecutorSelectionService.name);

  constructor(
    @InjectModel(Agent.name)
    private readonly agentModel: Model<AgentDocument>,
    @InjectModel(Tool.name)
    private readonly toolModel: Model<ToolDocument>,
    @InjectModel(Employee.name)
    private readonly employeeModel: Model<EmployeeDocument>,
    @InjectModel(AgentRole.name)
    private readonly agentRoleModel: Model<AgentRoleDocument>,
  ) {}

  // -----------------------------------------------------------------------
  // Public API (overloaded for backward compatibility)
  // -----------------------------------------------------------------------

  async selectExecutor(title: string, description: string): Promise<ExecutorSelectionResult>;
  async selectExecutor(ctx: ExecutorSelectionContext): Promise<ExecutorSelectionResult>;
  async selectExecutor(
    titleOrCtx: string | ExecutorSelectionContext,
    description?: string,
  ): Promise<ExecutorSelectionResult> {
    const ctx: ExecutorSelectionContext =
      typeof titleOrCtx === 'string'
        ? { title: titleOrCtx, description: description || '' }
        : titleOrCtx;

    return this.routeExecutor(ctx);
  }

  async validateAgentToolFit(input: {
    agentId: string;
    taskTitle: string;
    taskDescription: string;
    taskType?:
      | 'research'
      | 'development.plan'
      | 'development.exec'
      | 'development.review'
      | 'general';
    requiredTools?: string[];
  }): Promise<AgentToolFitValidationResult> {
    const normalizedAgentId = String(input.agentId || '').trim();
    const normalizedTaskType = this.normalizeExternalTaskType(input.taskType);
    const explicitRequiredTools = (input.requiredTools || [])
      .map((item) => String(item || '').trim())
      .filter(Boolean);
    const requiredTools = explicitRequiredTools.length > 0
      ? explicitRequiredTools
      : this.resolveRequiredToolHints(normalizedTaskType, input.taskTitle, input.taskDescription);

    if (!normalizedAgentId || requiredTools.length === 0) {
      return {
        fit: true,
        requiredTools,
        missingTools: [],
      };
    }

    const agentLookup: Record<string, unknown> = { id: normalizedAgentId, isActive: true };
    if (Types.ObjectId.isValid(normalizedAgentId)) {
      agentLookup.$or = [{ id: normalizedAgentId }, { _id: new Types.ObjectId(normalizedAgentId) }];
      delete agentLookup.id;
    }

    const agent = await this.agentModel.findOne(agentLookup).select({ tools: 1, config: 1 }).lean().exec();
    if (!agent) {
      return {
        fit: false,
        requiredTools,
        missingTools: [...requiredTools],
        suggestion: await this.selectExecutor({
          title: input.taskTitle,
          description: input.taskDescription,
          taskType: normalizedTaskType,
        }),
      };
    }

    // OpenCode capability hard gate: development runtime tasks require opencode-enabled agent.
    const executorTaskType = normalizedTaskType;
    if (OPENCODE_REQUIRED_TASK_TYPES.has(executorTaskType) && !this.isOpenCodeCapable(agent as unknown as Agent)) {
      this.logger.warn(
        `[validate_opencode_gate] agent=${normalizedAgentId} taskType=${executorTaskType} — agent lacks opencode capability, rejecting`,
      );
      return {
        fit: false,
        requiredTools,
        missingTools: ['opencode_capability'],
        suggestion: await this.selectExecutor({
          title: input.taskTitle,
          description: input.taskDescription,
          taskType: normalizedTaskType,
        }),
      };
    }

    const toolIds = (agent as { tools?: string[] }).tools || [];
    const tools = toolIds.length
      ? await this.toolModel.find({ id: { $in: toolIds }, enabled: true }).select({ id: 1, name: 1, description: 1, category: 1 }).lean().exec()
      : [];

    const toolText = [
      ...toolIds.map((id) => String(id || '').toLowerCase()),
      ...tools.map((tool) => `${tool.id || ''} ${tool.name || ''} ${tool.description || ''} ${tool.category || ''}`.toLowerCase()),
    ].join(' ');

    const missingTools = requiredTools.filter((hint) => !toolText.includes(hint.toLowerCase()));
    if (missingTools.length === 0) {
      return {
        fit: true,
        requiredTools,
        missingTools: [],
      };
    }

    return {
      fit: false,
      requiredTools,
      missingTools,
      suggestion: await this.selectExecutor({
        title: input.taskTitle,
        description: input.taskDescription,
        taskType: normalizedTaskType,
      }),
    };
  }

  // -----------------------------------------------------------------------
  // Core routing
  // -----------------------------------------------------------------------

  private async routeExecutor(ctx: ExecutorSelectionContext): Promise<ExecutorSelectionResult> {
    // 0. lock_to_planner fast path
    if (ctx.assignmentPolicy === 'lock_to_planner' && ctx.plannerAgentId) {
      this.logger.log(
        `[executor_lock] Locked to planner=${ctx.plannerAgentId} title="${ctx.title.slice(0, 60)}"`,
      );
      return {
        executorType: 'agent',
        executorId: ctx.plannerAgentId,
        reason: 'Locked to planner by assignment policy',
      };
    }

    // 1. Resolve task type
    const taskType = ctx.taskType || 'general';
    const requiredCapabilities = this.resolveRequiredCapabilities(taskType, ctx.requiredCapabilities);

    // 2. Load candidates + roles
    const [agents, employees, roles] = await Promise.all([
      this.agentModel.find({ isActive: true }).exec(),
      this.employeeModel
        .find({ status: { $in: [EmployeeStatus.ACTIVE, EmployeeStatus.PROBATION] } })
        .exec(),
      this.agentRoleModel.find({ status: 'active' }).exec(),
    ]);
    const roleMap = new Map<string, AgentRole>();
    for (const role of roles) {
      const roleCode = String(role.code || '').trim();
      const roleId = String(role.id || '').trim();
      if (roleCode) {
        roleMap.set(roleCode, role as unknown as AgentRole);
      }
      if (roleId) {
        roleMap.set(roleId, role as unknown as AgentRole);
      }
    }

    const plannerTier = await this.resolvePlannerTier(ctx.plannerAgentId, roleMap);
    if (ctx.plannerAgentId && !plannerTier) {
      return {
        executorType: 'unassigned',
        reason: 'tier_resolution_required: cannot resolve planner tier',
      };
    }

    // 3. Multi-dimension scoring for agents
    const scored = agents.map((agent) => {
      const agentId = this.getEntityId(agent as unknown as Record<string, any>);
      const role = roleMap.get(agent.roleId);
      const tier = this.resolveAgentTier(agent, role);
      const agentToolSet = new Set((agent.tools || []).map((t) => t.toLowerCase()));
      const agentCaps = new Set(
        [...(agent.capabilities || []), ...(role?.capabilities || [])].map((c) => c.toLowerCase()),
      );

      const breakdown: Record<string, number> = {};

      // A. Role match
      if (ctx.preferredRoleCode && agent.roleId === ctx.preferredRoleCode) {
        breakdown.roleMatch = W_ROLE;
      } else if (this.isTierCompatible(tier, taskType)) {
        breakdown.roleMatch = Math.round(W_ROLE * 0.6);
      } else {
        breakdown.roleMatch = 0;
      }

      if (plannerTier && !canDelegateAcrossTier(plannerTier, tier)) {
        breakdown.roleMatch = 0;
        breakdown.toolCoverage = 0;
        breakdown.capabilityMatch = 0;
        breakdown.keywordRelevance = 0;
      }

      const missingRequiredCapabilities = requiredCapabilities
        .map((cap) => cap.toLowerCase())
        .filter((cap) => !agentCaps.has(cap));
      if (missingRequiredCapabilities.length > 0) {
        breakdown.roleMatch = 0;
        breakdown.toolCoverage = 0;
        breakdown.capabilityMatch = 0;
        breakdown.keywordRelevance = 0;
      }

      // A-2. OpenCode capability gate — development runtime tasks MUST go to
      //      an agent whose config.execution.provider === 'opencode'. Agents without
      //      this capability cannot execute code operations, so zero out their scores.
      if (OPENCODE_REQUIRED_TASK_TYPES.has(taskType) && !this.isOpenCodeCapable(agent)) {
        breakdown.roleMatch = 0;
        breakdown.toolCoverage = 0;
        breakdown.capabilityMatch = 0;
        breakdown.keywordRelevance = 0;
      }

      // B. Tool coverage
      breakdown.toolCoverage = ctx.requiredTools?.length
        ? this.computeExplicitToolScore(agentToolSet, ctx.requiredTools)
        : this.computeInferredToolScore(agentToolSet, taskType);

      // C. Capability tags
      if (requiredCapabilities.length > 0) {
        const covered = requiredCapabilities.filter((c) => agentCaps.has(c.toLowerCase()));
        breakdown.capabilityMatch = Math.round(
          (covered.length / requiredCapabilities.length) * W_CAPABILITY,
        );
      } else {
        breakdown.capabilityMatch = 0;
      }

      // D. Keyword relevance (lightweight, preserved for breadth)
      breakdown.keywordRelevance = this.computeKeywordScore(ctx.title, ctx.description, agent, role);

      const score = Object.values(breakdown).reduce((a, b) => a + b, 0);
      return { agentId, score, breakdown, agentToolSet, tier };
    });

    scored.sort((a, b) => b.score - a.score);

    if (OPENCODE_REQUIRED_TASK_TYPES.has(taskType)) {
      const eligible = scored.filter((s) => s.score > 0).length;
      this.logger.log(
        `[executor_opencode_gate] taskType=${taskType} totalAgents=${scored.length} eligibleAfterGate=${eligible}`,
      );
    }

    // 4. Employee fallback scoring (keyword only — employees don't have role/tools)
    const employeeCandidates = plannerTier
      ? employees.filter((employee) => {
          const targetTier = normalizeAgentRoleTier(employee.tier) || 'operations';
          return canDelegateAcrossTier(plannerTier, targetTier);
        })
      : employees;
    const employeeScored = this.scoreEmployees(employeeCandidates, ctx.title, ctx.description);

    const bestAgent = scored[0];
    const bestEmployee = employeeScored[0];

    // 5. Required-tools hard gate
    if (ctx.requiredTools?.length && bestAgent) {
      const missing = ctx.requiredTools.filter((t) => !bestAgent.agentToolSet.has(t.toLowerCase()));
      if (missing.length > 0) {
        this.logger.warn(
          `[executor_tool_gap] Best agent=${bestAgent.agentId} missing tools: ${missing.join(',')}`,
        );
        return {
          executorType: 'unassigned',
          reason: `Best candidate missing required tools: ${missing.join(', ')}`,
          capabilityMatch: {
            toolsCovered: ctx.requiredTools.filter((t) => bestAgent.agentToolSet.has(t.toLowerCase())),
            toolsMissing: missing,
            capabilitiesCovered: [],
            capabilitiesMissing: [],
          },
        };
      }
    }

    // 6. Threshold + final pick
    if (bestAgent && bestAgent.score >= MIN_SCORE_THRESHOLD) {
      this.logger.log(
        `[executor_selected] agent=${bestAgent.agentId} score=${bestAgent.score} breakdown=${JSON.stringify(bestAgent.breakdown)}`,
      );
      return {
        executorType: 'agent',
        executorId: bestAgent.agentId,
        reason: `Capability-routed: score=${bestAgent.score} breakdown=${JSON.stringify(bestAgent.breakdown)}`,
        score: bestAgent.score,
      };
    }

    // Agent score too low — try employee
    if (bestEmployee && bestEmployee.score > 0) {
      return {
        executorType: 'employee',
        executorId: bestEmployee.id,
        reason: `Best human assignment score=${bestEmployee.score}`,
        score: bestEmployee.score,
      };
    }

    // Absolute fallback — first active agent (with opencode gate for development runtime tasks)
    const requiresOpenCode = OPENCODE_REQUIRED_TASK_TYPES.has(taskType);
    const fallbackAgent = agents.find((agent) => {
      if (requiresOpenCode && !this.isOpenCodeCapable(agent)) {
        return false;
      }
      if (plannerTier) {
        const role = roleMap.get(agent.roleId);
        const targetTier = this.resolveAgentTier(agent, role);
        return canDelegateAcrossTier(plannerTier, targetTier);
      }
      return true;
    });
    if (fallbackAgent?._id) {
      return {
        executorType: 'agent',
        executorId: fallbackAgent._id.toString(),
        reason: 'Fallback assignment to first active agent (no candidate met threshold)',
      };
    }

    return { executorType: 'unassigned', reason: 'No matching capability found' };
  }

  // -----------------------------------------------------------------------
  // Scoring helpers
  // -----------------------------------------------------------------------

  private isTierCompatible(tier: AgentRoleTier, taskType: string): boolean {
    const compatible = TIER_TASK_COMPATIBILITY[tier];
    return compatible ? compatible.includes(taskType) : false;
  }

  private resolveAgentTier(agent: Agent, role?: AgentRole): AgentRoleTier {
    return (
      normalizeAgentRoleTier(agent.tier) ||
      normalizeAgentRoleTier((role as any)?.tier) ||
      getTierByAgentRoleCode(role?.code) ||
      'operations'
    );
  }

  /**
   * 判断 agent 是否具备 opencode 执行能力。
   * 依据：agent.config.execution.provider === 'opencode'。
   */
  private isOpenCodeCapable(agent: Agent): boolean {
    const config = agent.config;
    if (!config || typeof config !== 'object') {
      return false;
    }
    const execution = (config as Record<string, unknown>).execution;
    if (!execution || typeof execution !== 'object') {
      return false;
    }
    const provider = String((execution as Record<string, unknown>).provider || '').trim().toLowerCase();
    return provider === 'opencode';
  }

  private async resolvePlannerTier(
    plannerAgentId: string | undefined,
    roleMap: Map<string, AgentRole>,
  ): Promise<AgentRoleTier | undefined> {
    const normalizedPlannerAgentId = String(plannerAgentId || '').trim();
    if (!normalizedPlannerAgentId) {
      return undefined;
    }

    const plannerLookup: Record<string, unknown> = { id: normalizedPlannerAgentId };
    if (Types.ObjectId.isValid(normalizedPlannerAgentId)) {
      plannerLookup.$or = [{ id: normalizedPlannerAgentId }, { _id: new Types.ObjectId(normalizedPlannerAgentId) }];
      delete plannerLookup.id;
    }
    const planner = await this.agentModel.findOne(plannerLookup).select({ roleId: 1, tier: 1 }).lean().exec();
    if (!planner) {
      return undefined;
    }
    const role = roleMap.get(String(planner.roleId || '').trim());
    return this.resolveAgentTier(planner as unknown as Agent, role);
  }

  /** Explicit required tools → exact coverage ratio */
  private computeExplicitToolScore(agentToolSet: Set<string>, requiredTools: string[]): number {
    const covered = requiredTools.filter((t) => agentToolSet.has(t.toLowerCase()));
    return Math.round((covered.length / requiredTools.length) * W_TOOL);
  }

  /** No explicit required tools → infer from taskType's tool hints */
  private computeInferredToolScore(
    agentToolSet: Set<string>,
    taskType: string,
  ): number {
    const hints = TASK_TOOL_HINTS[taskType];
    if (!hints?.length) return Math.round(W_TOOL * 0.15); // general → small base score
    const toolStr = [...agentToolSet].join(' ');
    const matched = hints.filter((h) => toolStr.includes(h));
    return Math.round((matched.length / hints.length) * W_TOOL);
  }

  /** Keyword relevance (capped at W_KEYWORD) */
  private computeKeywordScore(
    title: string,
    description: string,
    agent: Agent,
    role?: AgentRole,
  ): number {
    const text = `${title} ${description}`.toLowerCase();
    const keywords = text
      .split(/[^a-zA-Z0-9\u4e00-\u9fa5]+/)
      .filter((w) => w.length >= 2)
      .slice(0, 20);
    if (!keywords.length) return 0;

    const context = `${agent.name} ${agent.description} ${(agent.capabilities || []).join(' ')} ${role?.description || ''} ${(role?.capabilities || []).join(' ')}`.toLowerCase();
    const hits = keywords.filter((kw) => context.includes(kw)).length;
    // Normalize to W_KEYWORD scale (cap at keyword count ≥ 3 → full score)
    return Math.min(W_KEYWORD, Math.round((hits / Math.min(keywords.length, 3)) * W_KEYWORD));
  }

  private scoreEmployees(
    employees: Employee[],
    title: string,
    description: string,
  ): Array<{ id: string; score: number; type: string }> {
    const text = `${title} ${description}`.toLowerCase();
    const keywords = text
      .split(/[^a-zA-Z0-9\u4e00-\u9fa5]+/)
      .filter((w) => w.length >= 2)
      .slice(0, 20);
    return employees
      .map((emp) => {
        const ctx = `${emp.name || ''} ${emp.title || ''} ${emp.description || ''} ${(emp.capabilities || []).join(' ')}`.toLowerCase();
        const score = keywords.reduce((acc, kw) => (ctx.includes(kw) ? acc + 1 : acc), 0);
        return { id: emp.id, score, type: emp.type };
      })
      .sort((a, b) => b.score - a.score);
  }

  private resolveRequiredToolHints(taskType: string, title: string, description: string): string[] {
    const hints = new Set<string>(TASK_TOOL_HINTS[taskType] || []);
    if (hints.size > 0) {
      return Array.from(hints);
    }

    const text = `${title} ${description}`.toLowerCase();
    for (const item of TEXT_TOOL_HINTS) {
      if (item.keywords.some((keyword) => text.includes(keyword.toLowerCase()))) {
        for (const hint of item.toolHints) {
          hints.add(hint);
        }
      }
    }

    return Array.from(hints);
  }

  private normalizeExternalTaskType(
    taskType?:
      | 'research'
      | 'development.plan'
      | 'development.exec'
      | 'development.review'
      | 'general',
  ): 'development.plan' | 'development.exec' | 'development.review' | 'research' | 'general' {
    if (
      taskType === 'development.plan'
      || taskType === 'development.exec'
      || taskType === 'development.review'
      || taskType === 'research'
      || taskType === 'general'
    ) {
      return taskType;
    }
    return 'general';
  }

  private resolveRequiredCapabilities(taskType: string, requiredCapabilities?: string[]): string[] {
    const explicit = (requiredCapabilities || [])
      .map((capability) => String(capability || '').trim())
      .filter(Boolean);
    if (explicit.length > 0) {
      return explicit;
    }

    return TASK_TYPE_REQUIRED_CAPABILITIES[taskType] || [];
  }

  private getEntityId(entity: Record<string, any>): string {
    if (entity.id) return String(entity.id);
    if (entity._id) return entity._id.toString();
    return '';
  }
}
