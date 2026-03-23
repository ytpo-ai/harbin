import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import axios from 'axios';
import { Agent, AgentDocument } from '@agent/schemas/agent.schema';
import { AgentRole, AgentRoleDocument } from '@agent/schemas/agent-role.schema';
import { Tool, ToolDocument } from '../../../../apps/agents/src/schemas/tool.schema';
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
  ) {}

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  async buildPlanningContext(input: {
    prompt: string;
    requirementId?: string;
    plannerAgentId?: string;
  }): Promise<PlanningContext> {
    void input.prompt;
    void input.plannerAgentId;
    const [agentManifest, requirementDetail] = await Promise.all([
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
    ]);

    return {
      agentManifest,
      requirementDetail,
      planningConstraints: '',
    };
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
    const lines: string[] = ['可用执行者清单（分配任务时请参考其能力范围，agentId 必须使用括号内的 id 值）:'];

    for (const entry of entries) {
      const parts = [
        `- ${entry.name}（id=${entry.id}, ${entry.roleName}, ${entry.tier}层）`,
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

}
