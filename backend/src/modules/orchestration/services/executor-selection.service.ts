import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Agent, AgentDocument } from '../../../shared/schemas/agent.schema';
import { Tool, ToolDocument } from '../../../../apps/agents/src/schemas/tool.schema';
import {
  Employee,
  EmployeeDocument,
  EmployeeStatus,
  EmployeeType,
} from '../../../shared/schemas/employee.schema';
import { AgentRole, AgentRoleDocument } from '../../../shared/schemas/agent-role.schema';
import { TaskClassificationService } from './task-classification.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExecutorSelectionContext {
  title: string;
  description: string;
  taskType?: 'development' | 'code_review' | 'research' | 'email' | 'planning' | 'general';
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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Role-code → compatible task types (weight = 40 when exact match, 25 when compatible) */
const ROLE_TASK_COMPATIBILITY: Record<string, string[]> = {
  'fullstack-engineer': ['development', 'code_review', 'general'],
  'technical-architect': ['code_review', 'planning', 'development'],
  'executive-lead': ['planning', 'general'],
  'management-assistant': ['planning', 'general', 'email'],
  'devops-engineer': ['development', 'general'],
  'data-analyst': ['research', 'general'],
  'product-manager': ['planning', 'general'],
  'human-resources-manager': ['general'],
  'administrative-assistant': ['email', 'general'],
  'marketing-strategist': ['email', 'research', 'general'],
  'meeting-assistant': ['planning', 'general'],
  'system-builtin-agent': ['general'],
  'human-exclusive-assistant': ['general'],
};

/** Task-type → tool-id fragments used for inferring tool coverage when no explicit requiredTools */
const TASK_TOOL_HINTS: Record<string, string[]> = {
  email: ['gmail', 'email', 'mail'],
  research: ['web-search', 'web-fetch', 'websearch', 'webfetch', 'exa', 'serp'],
  development: ['repo-read', 'docs-read', 'docs-write', 'rd-related'],
  code_review: ['repo-read', 'docs-read', 'rd-related'],
  planning: ['orchestration', 'requirement'],
};

/** Score dimension weights */
const W_ROLE = 40;
const W_TOOL = 30;
const W_CAPABILITY = 20;
const W_KEYWORD = 10;

const MIN_SCORE_THRESHOLD = 10;

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
    private readonly taskClassificationService: TaskClassificationService,
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

  /** Runtime email-capability check (unchanged public contract) */
  async hasEmailExecutionCapability(agentId: string): Promise<boolean> {
    const agent = await this.agentModel.findById(agentId).exec();
    if (!agent) return false;
    const toolIds = (agent.tools || []).filter(Boolean);
    if (!toolIds.length) return false;
    const tools = await this.toolModel.find({ id: { $in: toolIds }, enabled: true }).exec();
    return tools.some((tool) => this.isEmailTool(tool));
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
    const taskType = ctx.taskType || this.classifyTaskType(ctx.title, ctx.description);

    // 2. Load candidates + roles
    const [agents, employees, roles] = await Promise.all([
      this.agentModel.find({ isActive: true }).exec(),
      this.employeeModel
        .find({ status: { $in: [EmployeeStatus.ACTIVE, EmployeeStatus.PROBATION] } })
        .exec(),
      this.agentRoleModel.find({ status: 'active' }).exec(),
    ]);
    const roleMap = new Map(roles.map((r) => [r.code, r]));

    // 3. Email fast-path (preserves original behaviour for mail tasks)
    if (taskType === 'email') {
      return this.routeEmailTask(agents, employees);
    }

    // 4. Multi-dimension scoring for agents
    const emailCapableSet = await this.getEmailCapableAgentIdSet(agents);
    const scored = agents.map((agent) => {
      const agentId = this.getEntityId(agent as unknown as Record<string, any>);
      const role = roleMap.get(agent.roleId);
      const agentToolSet = new Set((agent.tools || []).map((t) => t.toLowerCase()));
      const agentCaps = new Set(
        [...(agent.capabilities || []), ...(role?.capabilities || [])].map((c) => c.toLowerCase()),
      );

      const breakdown: Record<string, number> = {};

      // A. Role match
      if (ctx.preferredRoleCode && agent.roleId === ctx.preferredRoleCode) {
        breakdown.roleMatch = W_ROLE;
      } else if (this.isRoleCompatible(agent.roleId, taskType)) {
        breakdown.roleMatch = Math.round(W_ROLE * 0.6);
      } else {
        breakdown.roleMatch = 0;
      }

      // B. Tool coverage
      breakdown.toolCoverage = ctx.requiredTools?.length
        ? this.computeExplicitToolScore(agentToolSet, ctx.requiredTools)
        : this.computeInferredToolScore(agentToolSet, taskType, emailCapableSet, agentId);

      // C. Capability tags
      if (ctx.requiredCapabilities?.length) {
        const covered = ctx.requiredCapabilities.filter((c) => agentCaps.has(c.toLowerCase()));
        breakdown.capabilityMatch = Math.round(
          (covered.length / ctx.requiredCapabilities.length) * W_CAPABILITY,
        );
      } else {
        breakdown.capabilityMatch = 0;
      }

      // D. Keyword relevance (lightweight, preserved for breadth)
      breakdown.keywordRelevance = this.computeKeywordScore(ctx.title, ctx.description, agent, role);

      const score = Object.values(breakdown).reduce((a, b) => a + b, 0);
      return { agentId, score, breakdown, agentToolSet };
    });

    scored.sort((a, b) => b.score - a.score);

    // 5. Employee fallback scoring (keyword only — employees don't have role/tools)
    const employeeScored = this.scoreEmployees(employees, ctx.title, ctx.description);

    const bestAgent = scored[0];
    const bestEmployee = employeeScored[0];

    // 6. Required-tools hard gate
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

    // 7. Threshold + final pick
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

    // Absolute fallback — first active agent
    const fallbackAgent = agents[0];
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
  // Email fast path (unchanged logic, extracted for readability)
  // -----------------------------------------------------------------------

  private async routeEmailTask(
    agents: Agent[],
    employees: Employee[],
  ): Promise<ExecutorSelectionResult> {
    const emailCapableSet = await this.getEmailCapableAgentIdSet(agents);
    const emailAgent = agents.find((a) =>
      emailCapableSet.has(this.getEntityId(a as unknown as Record<string, any>)),
    );
    if (emailAgent) {
      return {
        executorType: 'agent',
        executorId: this.getEntityId(emailAgent as unknown as Record<string, any>),
        reason: 'Email task routed to mail-capable agent',
      };
    }
    const humanEmployee = employees.find((e) => e.type === EmployeeType.HUMAN);
    if (humanEmployee) {
      return {
        executorType: 'employee',
        executorId: humanEmployee.id,
        reason: 'Email task routed to human due to missing mail tool capability',
      };
    }
    return { executorType: 'unassigned', reason: 'Email task requires tool/credential, manual assignment required' };
  }

  // -----------------------------------------------------------------------
  // Scoring helpers
  // -----------------------------------------------------------------------

  private isRoleCompatible(roleCode: string, taskType: string): boolean {
    const compatible = ROLE_TASK_COMPATIBILITY[roleCode];
    return compatible ? compatible.includes(taskType) : false;
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
    emailCapableSet: Set<string>,
    agentId: string,
  ): number {
    // Special: email capability comes from DB tool lookup
    if (taskType === 'email') {
      return emailCapableSet.has(agentId) ? W_TOOL : 0;
    }
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

  // -----------------------------------------------------------------------
  // Task classification (delegates to TaskClassificationService + extension)
  // -----------------------------------------------------------------------

  private classifyTaskType(title: string, description: string): string {
    if (this.taskClassificationService.isEmailTask(title, description)) return 'email';
    if (this.taskClassificationService.isResearchTask(title, description)) return 'research';
    if (this.taskClassificationService.isCodeTask(title, description)) return 'development';
    if (this.taskClassificationService.isReviewTask(title, description)) return 'code_review';

    const text = `${title} ${description}`.toLowerCase();
    if (
      text.includes('plan') ||
      text.includes('编排') ||
      text.includes('计划') ||
      text.includes('orchestrat')
    ) {
      return 'planning';
    }
    return 'general';
  }

  // -----------------------------------------------------------------------
  // Utility (unchanged)
  // -----------------------------------------------------------------------

  private async getEmailCapableAgentIdSet(agents: Agent[]): Promise<Set<string>> {
    const toolIds = Array.from(new Set(agents.flatMap((agent) => agent.tools || []).filter(Boolean)));
    if (!toolIds.length) return new Set();
    const tools = await this.toolModel.find({ id: { $in: toolIds }, enabled: true }).exec();
    const emailToolIdSet = new Set(tools.filter((t) => this.isEmailTool(t)).map((t) => t.id));
    return new Set(
      agents
        .filter((a) => (a.tools || []).some((tid) => emailToolIdSet.has(tid)))
        .map((a) => this.getEntityId(a as unknown as Record<string, any>))
        .filter(Boolean),
    );
  }

  private isEmailTool(tool: Tool): boolean {
    const text = `${tool.id} ${tool.name} ${tool.description} ${tool.category}`.toLowerCase();
    return text.includes('gmail') || text.includes('email') || text.includes('mail');
  }

  private getEntityId(entity: Record<string, any>): string {
    if (entity.id) return String(entity.id);
    if (entity._id) return entity._id.toString();
    return '';
  }
}
