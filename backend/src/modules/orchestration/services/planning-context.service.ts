import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import axios from 'axios';
import { Agent, AgentDocument } from '@agent/schemas/agent.schema';
import { AgentRole, AgentRoleDocument } from '@agent/schemas/agent-role.schema';
import { Tool, ToolDocument } from '../../../../apps/agents/src/schemas/tool.schema';
import { Skill, SkillDocument, PlanningRule } from '../../../../apps/agents/src/schemas/agent-skill.schema';
import {
  AgentRoleTier,
  normalizeAgentRoleTier,
  getTierByAgentRoleCode,
} from '../../../shared/role-tier';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PlanningContext {
  agentManifest: string;
  requirementDetail: string;
  planningConstraints: string;
  /** Raw planning rules collected from skills, used for post-validation */
  rawPlanningRules: PlanningRule[];
}

interface AgentManifestEntry {
  id: string;
  name: string;
  roleName: string;
  tier: AgentRoleTier | string;
  capabilities: string[];
  toolNames: string[];
  description: string;
}

interface RequirementInfo {
  title: string;
  description: string;
  status: string;
  priority: string;
  labels: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AGENT_MANIFEST_MAX_LENGTH = parseInt(
  process.env.PLANNER_AGENT_MANIFEST_MAX_LENGTH || '2000',
  10,
);
const REQUIREMENT_DETAIL_MAX_LENGTH = parseInt(
  process.env.PLANNER_REQUIREMENT_DETAIL_MAX_LENGTH || '1500',
  10,
);
const EI_REQUEST_TIMEOUT_MS = parseInt(
  process.env.PLANNER_EI_REQUEST_TIMEOUT_MS || '5000',
  10,
);

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class PlanningContextService {
  private readonly logger = new Logger(PlanningContextService.name);
  private readonly engineeringIntelligenceBaseUrl =
    process.env.ENGINEERING_INTELLIGENCE_SERVICE_URL || 'http://localhost:3004/api';

  constructor(
    @InjectModel(Agent.name) private readonly agentModel: Model<AgentDocument>,
    @InjectModel(AgentRole.name) private readonly agentRoleModel: Model<AgentRoleDocument>,
    @InjectModel(Tool.name) private readonly toolModel: Model<ToolDocument>,
    @InjectModel(Skill.name) private readonly skillModel: Model<SkillDocument>,
  ) {}

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  async buildPlanningContext(input: {
    prompt: string;
    requirementId?: string;
    plannerAgentId?: string;
  }): Promise<PlanningContext> {
    let rawPlanningRules: PlanningRule[] = [];
    const [agentManifest, requirementDetail, constraintsResult] = await Promise.all([
      this.buildAgentManifest().catch((err) => {
        this.logger.warn(`Failed to build agent manifest: ${err.message}`);
        return '';
      }),
      input.requirementId
        ? this.buildRequirementDetail(input.requirementId).catch((err) => {
            this.logger.warn(`Failed to fetch requirement detail: ${err.message}`);
            return '';
          })
        : Promise.resolve(''),
      input.plannerAgentId
        ? this.buildPlanningConstraintsWithRules(input.plannerAgentId).catch((err) => {
            this.logger.warn(`Failed to build planning constraints: ${err.message}`);
            return { text: '', rules: [] as PlanningRule[] };
          })
        : Promise.resolve({ text: '', rules: [] as PlanningRule[] }),
    ]);

    rawPlanningRules = constraintsResult.rules;
    return { agentManifest, requirementDetail, planningConstraints: constraintsResult.text, rawPlanningRules };
  }

  // -----------------------------------------------------------------------
  // Agent Manifest
  // -----------------------------------------------------------------------

  private async buildAgentManifest(): Promise<string> {
    const [agents, roles, allToolIds] = await this.loadAgentsAndRoles();
    if (!agents.length) {
      return '';
    }

    const toolMap = await this.buildToolMap(allToolIds);
    const roleMap = this.buildRoleMap(roles);

    const entries: AgentManifestEntry[] = agents.map((agent) => {
      const agentId = agent._id?.toString() || (agent as any).id || '';
      const role = roleMap.get(agent.roleId);
      const roleName = role?.name || agent.roleId || 'unknown';
      const tier = this.resolveAgentTier(agent, role);
      const capabilities = [
        ...(agent.capabilities || []),
        ...(role?.capabilities || []),
      ];
      const toolNames = (agent.tools || [])
        .map((toolId) => {
          const tool = toolMap.get(toolId);
          return tool ? tool.name : null;
        })
        .filter(Boolean) as string[];

      return {
        id: agentId,
        name: agent.name,
        roleName,
        tier,
        capabilities: [...new Set(capabilities)],
        toolNames: [...new Set(toolNames)],
        description: (agent.description || '').slice(0, 100),
      };
    });

    return this.formatAgentManifest(entries);
  }

  private async loadAgentsAndRoles(): Promise<[AgentDocument[], AgentRoleDocument[], string[]]> {
    const [agents, roles] = await Promise.all([
      this.agentModel.find({ isActive: true }).exec(),
      this.agentRoleModel.find({ status: 'active' }).exec(),
    ]);
    const allToolIds = [...new Set(agents.flatMap((a) => a.tools || []).filter(Boolean))];
    return [agents, roles, allToolIds];
  }

  private async buildToolMap(toolIds: string[]): Promise<Map<string, { name: string; description: string }>> {
    if (!toolIds.length) {
      return new Map();
    }
    const tools = await this.toolModel.find({ id: { $in: toolIds }, enabled: true }).exec();
    const map = new Map<string, { name: string; description: string }>();
    for (const tool of tools) {
      map.set(tool.id, { name: tool.name || tool.id, description: tool.description || '' });
    }
    return map;
  }

  private buildRoleMap(roles: AgentRoleDocument[]): Map<string, AgentRole> {
    const map = new Map<string, AgentRole>();
    for (const role of roles) {
      const code = String(role.code || '').trim();
      const id = String(role.id || '').trim();
      if (code) map.set(code, role as unknown as AgentRole);
      if (id) map.set(id, role as unknown as AgentRole);
    }
    return map;
  }

  private resolveAgentTier(agent: AgentDocument, role?: AgentRole | null): string {
    if (agent.tier) {
      return normalizeAgentRoleTier(agent.tier) || agent.tier;
    }
    if (role?.tier) {
      return normalizeAgentRoleTier(role.tier) || role.tier;
    }
    return getTierByAgentRoleCode(agent.roleId) || 'operations';
  }

  private formatAgentManifest(entries: AgentManifestEntry[]): string {
    const lines: string[] = ['可用执行者清单（分配任务时请参考其能力范围）:'];

    for (const entry of entries) {
      const parts = [
        `- ${entry.name}（${entry.roleName}, ${entry.tier}层）`,
      ];
      if (entry.capabilities.length) {
        parts.push(`  能力: ${entry.capabilities.join(', ')}`);
      }
      if (entry.toolNames.length) {
        parts.push(`  工具: ${entry.toolNames.join(', ')}`);
      }
      if (entry.description) {
        parts.push(`  简介: ${entry.description}`);
      }
      lines.push(parts.join('\n'));
    }

    const result = lines.join('\n');
    if (result.length > AGENT_MANIFEST_MAX_LENGTH) {
      return result.slice(0, AGENT_MANIFEST_MAX_LENGTH) + '\n...(已截断)';
    }
    return result;
  }

  // -----------------------------------------------------------------------
  // Requirement Detail
  // -----------------------------------------------------------------------

  private async buildRequirementDetail(requirementId: string): Promise<string> {
    const info = await this.fetchRequirementInfo(requirementId);
    if (!info) {
      return '';
    }

    const lines = [
      '需求详情:',
      `- 标题: ${info.title}`,
      `- 状态: ${info.status}`,
      `- 优先级: ${info.priority}`,
    ];
    if (info.labels.length) {
      lines.push(`- 标签: ${info.labels.join(', ')}`);
    }
    if (info.description) {
      const desc = info.description.length > REQUIREMENT_DETAIL_MAX_LENGTH
        ? info.description.slice(0, REQUIREMENT_DETAIL_MAX_LENGTH) + '...'
        : info.description;
      lines.push(`- 描述: ${desc}`);
    }

    return lines.join('\n');
  }

  private async fetchRequirementInfo(requirementId: string): Promise<RequirementInfo | null> {
    try {
      const url = `${this.engineeringIntelligenceBaseUrl}/ei/requirements/${encodeURIComponent(requirementId)}`;
      const response = await axios.get(url, { timeout: EI_REQUEST_TIMEOUT_MS });
      const data = response.data?.data || response.data;
      if (!data) {
        return null;
      }
      return {
        title: String(data.title || ''),
        description: String(data.description || ''),
        status: String(data.status || ''),
        priority: String(data.priority || ''),
        labels: Array.isArray(data.labels) ? data.labels : [],
      };
    } catch (err) {
      this.logger.warn(`fetchRequirementInfo(${requirementId}) failed: ${(err as Error).message}`);
      return null;
    }
  }

  // -----------------------------------------------------------------------
  // Planning Constraints (from planner agent's skills)
  // -----------------------------------------------------------------------

  private async buildPlanningConstraintsWithRules(
    plannerAgentId: string,
  ): Promise<{ text: string; rules: PlanningRule[] }> {
    const agent = await this.agentModel.findById(plannerAgentId).exec();
    if (!agent?.skills?.length) {
      return { text: '', rules: [] };
    }

    const skills = await this.skillModel
      .find({
        id: { $in: agent.skills },
        status: { $in: ['active', 'experimental'] },
      })
      .exec();

    if (!skills.length) {
      return { text: '', rules: [] };
    }

    const planningSkills = skills.filter((skill) =>
      this.isSkillRelevantToPlanning(skill),
    );

    if (!planningSkills.length) {
      return { text: '', rules: [] };
    }

    const constraints: string[] = ['计划编排约束（必须遵守，违反将导致计划被拒绝）:'];
    const collectedRules: PlanningRule[] = [];

    for (const skill of planningSkills) {
      // Priority 1: Use planningRules from the dedicated schema field
      const schemaRules = skill.planningRules;
      if (Array.isArray(schemaRules) && schemaRules.length) {
        constraints.push(`\n来源技能: ${skill.name}`);
        for (const rule of schemaRules) {
          constraints.push(`- [${rule.type || 'constraint'}] ${rule.rule}`);
          collectedRules.push(rule);
        }
      }

      // Priority 2: Fall back to planningRules in metadata (backward compat)
      if (!schemaRules?.length) {
        const metadataRules = (skill.metadata as any)?.planningRules;
        if (Array.isArray(metadataRules) && metadataRules.length) {
          constraints.push(`\n来源技能: ${skill.name}`);
          for (const rule of metadataRules) {
            constraints.push(`- [${rule.type || 'constraint'}] ${rule.rule}`);
            collectedRules.push(rule);
          }
        }
      }

      // Priority 3: Extract constraints from skill content (markdown) using structured markers
      if (skill.content) {
        const extracted = this.extractConstraintsFromContent(skill.content, skill.name);
        if (extracted) {
          constraints.push(extracted);
        }
      }
    }

    // If no actual rules were extracted, return empty
    if (constraints.length <= 1) {
      return { text: '', rules: collectedRules };
    }

    return { text: constraints.join('\n'), rules: collectedRules };
  }

  private isSkillRelevantToPlanning(skill: SkillDocument): boolean {
    const tags = (skill.tags || []).map((t) => t.toLowerCase());
    const planningTags = ['planning', 'orchestration', 'planner', 'guard', 'workflow', 'requirement-planning'];
    if (tags.some((tag) => planningTags.includes(tag))) {
      return true;
    }
    const nameAndDesc = `${skill.name} ${skill.description}`.toLowerCase();
    const planningKeywords = ['planning', 'planner', '计划', '编排', '规划', '拆解', 'workflow'];
    return planningKeywords.some((kw) => nameAndDesc.includes(kw));
  }

  /**
   * Extract planning constraints from skill content using section markers.
   * Looks for sections titled with keywords like "禁止", "约束", "规则", "映射规则" etc.
   * Also extracts content from "## N. Step 到 Task 映射规则" style sections.
   */
  private extractConstraintsFromContent(content: string, skillName: string): string {
    const lines = content.split('\n');
    const constraintSections: string[] = [];
    let inConstraintSection = false;
    let currentSection: string[] = [];
    let sectionDepth = 0;

    const constraintHeadingPatterns = [
      /禁止/i, /约束/i, /规则/i, /映射/i, /红线/i,
      /forbidden/i, /constraint/i, /rule/i, /mapping/i,
      /质量红线/i, /必须包含/i, /禁止出现/i, /禁止行为/i,
    ];

    for (const line of lines) {
      const headingMatch = line.match(/^(#{1,4})\s+(.+)/);
      if (headingMatch) {
        const depth = headingMatch[1].length;
        const heading = headingMatch[2];

        if (inConstraintSection) {
          // End current section if we hit a heading at same or higher level
          if (depth <= sectionDepth) {
            if (currentSection.length) {
              constraintSections.push(currentSection.join('\n'));
            }
            currentSection = [];
            inConstraintSection = false;
          }
        }

        if (!inConstraintSection && constraintHeadingPatterns.some((p) => p.test(heading))) {
          inConstraintSection = true;
          sectionDepth = depth;
          currentSection = [`[${skillName}] ${heading}:`];
        }
      } else if (inConstraintSection) {
        const trimmed = line.trim();
        if (trimmed) {
          currentSection.push(trimmed);
        }
      }
    }

    // Flush last section
    if (inConstraintSection && currentSection.length) {
      constraintSections.push(currentSection.join('\n'));
    }

    return constraintSections.join('\n\n');
  }
}
