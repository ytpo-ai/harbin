import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import axios from 'axios';
import { Agent, AgentDocument } from '../../../../../src/shared/schemas/agent.schema';
import { AgentProfile, AgentProfileDocument } from '../../../../../src/shared/schemas/agent-profile.schema';
import { ToolService } from '../tools/tool.service';
import { AgentMcpProfileService } from './agent-mcp-profile.service';
import {
  AgentBusinessRole,
  AgentMcpProfile,
  AgentMcpMapProfile,
  AgentToolPermissionSet,
} from './agent.types';
import {
  MEMO_MCP_SEARCH_TOOL_ID,
  MEMO_MCP_APPEND_TOOL_ID,
  normalizeToolId,
  normalizeToolIds,
  uniqueStrings,
} from './agent.constants';
import { getTierByAgentRoleCode } from '../../../../../src/shared/role-tier';

@Injectable()
export class AgentRoleService {
  private readonly logger = new Logger(AgentRoleService.name);
  private readonly roleRegistryBaseUrl = (
    process.env.ROLE_REGISTRY_BASE_URL ||
    process.env.LEGACY_SERVICE_URL ||
    'http://localhost:3001/api'
  ).replace(/\/$/, '');
  private readonly roleRequestTimeoutMs = Number(process.env.AGENT_ROLE_REQUEST_TIMEOUT_MS || 8000);

  constructor(
    @InjectModel(Agent.name) private agentModel: Model<AgentDocument>,
    @InjectModel(AgentProfile.name) private agentProfileModel: Model<AgentProfileDocument>,
    private readonly toolService: ToolService,
    private readonly agentMcpProfileService: AgentMcpProfileService,
  ) {}

  // ---- public role HTTP methods ----

  async getAvailableRoles(options?: { status?: 'active' | 'inactive' }): Promise<AgentBusinessRole[]> {
    const params: Record<string, string> = {};
    if (options?.status) {
      params.status = options.status;
    }

    try {
      const response = await axios.get(`${this.roleRegistryBaseUrl}/roles`, {
        params,
        timeout: this.roleRequestTimeoutMs,
      });
      const rows = Array.isArray(response.data) ? response.data : [];
      return rows.map((row) => this.normalizeRoleTier(row));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch roles from role registry';
      this.logger.warn(`Fetch roles failed: ${message}`);
      throw new BadRequestException('Failed to fetch roles from role registry');
    }
  }

  async getRoleById(roleId: string): Promise<AgentBusinessRole | null> {
    const normalizedRoleId = String(roleId || '').trim();
    if (!normalizedRoleId) {
      return null;
    }

    try {
      const response = await axios.get(`${this.roleRegistryBaseUrl}/roles/${encodeURIComponent(normalizedRoleId)}`, {
        timeout: this.roleRequestTimeoutMs,
      });
      return response.data ? this.normalizeRoleTier(response.data) : null;
    } catch (error: any) {
      if (error?.response?.status === 404) {
        return null;
      }
      const message = error instanceof Error ? error.message : 'Failed to fetch role from role registry';
      this.logger.warn(`Fetch role by id failed: ${message}`);
      throw new BadRequestException('Failed to validate role with role registry');
    }
  }

  async assertRoleExists(roleId: string): Promise<AgentBusinessRole> {
    const normalizedRoleId = String(roleId || '').trim();
    if (!normalizedRoleId) {
      throw new BadRequestException('roleId is required');
    }

    const role = await this.getRoleById(normalizedRoleId);
    if (!role) {
      throw new BadRequestException(`Invalid roleId: ${normalizedRoleId}`);
    }
    if (role.status !== 'active') {
      throw new BadRequestException(`Role is not active: ${normalizedRoleId}`);
    }
    return role;
  }

  async getRoleMapByIds(roleIds: string[]): Promise<Map<string, AgentBusinessRole>> {
    const uniqueIds = Array.from(new Set(roleIds.map((item) => String(item || '').trim()).filter(Boolean)));
    const map = new Map<string, AgentBusinessRole>();
    if (!uniqueIds.length) {
      return map;
    }

    await Promise.all(
      uniqueIds.map(async (roleId) => {
        try {
          const role = await this.getRoleById(roleId);
          if (role) {
            map.set(roleId, role);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'unknown role fetch error';
          this.logger.warn(`Skip role ${roleId} due to fetch failure: ${message}`);
        }
      }),
    );

    return map;
  }

  // ---- role-dependent permission/tool methods ----

  async inheritRoleProfilePermissions(roleId: string, currentPermissions: string[]): Promise<string[]> {
    const role = await this.assertRoleExists(roleId);
    const profile = await this.agentMcpProfileService.getMcpProfileByRoleCode(role.code);
    return uniqueStrings(currentPermissions || [], profile.permissions || profile.capabilities || []);
  }

  async ensureToolsWithinRolePermissionWhitelist(
    roleId: string,
    tools: string[],
    action: 'create' | 'update',
  ): Promise<string[]> {
    const normalizedRoleId = String(roleId || '').trim();
    if (!normalizedRoleId) {
      throw new BadRequestException('roleId is required before assigning tools');
    }

    const role = await this.assertRoleExists(normalizedRoleId);
    const profile = await this.agentMcpProfileService.getMcpProfileByRoleCode(role.code);
    const whitelist = new Set(normalizeToolIds(profile.tools || []));
    const normalized = normalizeToolIds(tools || []);
    const invalid = normalized.filter((toolId) => !whitelist.has(toolId));

    if (invalid.length > 0) {
      throw new BadRequestException(
        `Invalid tools for role ${role.code} on ${action}: ${invalid.join(', ')}. ` +
          'Agent.tools must be a subset of the role tool permission set.',
      );
    }

    return normalized;
  }

  async getAllowedToolIds(agent: { tools?: string[]; roleId: string }): Promise<string[]> {
    const role = await this.getRoleById(agent.roleId);
    const profile = await this.agentMcpProfileService.getMcpProfileByRoleCode(role?.code);
    const merged = uniqueStrings(agent.tools || [], profile.tools || [], [MEMO_MCP_SEARCH_TOOL_ID, MEMO_MCP_APPEND_TOOL_ID])
      .map((toolId) => normalizeToolId(toolId));

    return merged;
  }

  // ---- MCP profile assembly (depends on role HTTP) ----

  async getMcpAgents(
    allAgents: any[],
    options?: { includeHidden?: boolean },
  ): Promise<{
    total: number;
    visible: number;
    agents: AgentMcpProfile[];
  }> {
    const includeHidden = options?.includeHidden === true;
    const normalizedAgents = allAgents.map((agent) => this.normalizeAgentEntity(agent));
    const roleMap = await this.getRoleMapByIds(normalizedAgents.map((agent) => agent.roleId));
    const mapped = await this.agentMcpProfileService.buildAgentMcpProfiles(normalizedAgents, roleMap as any);
    const visibleAgents = mapped.filter((item) => includeHidden || item.exposed);

    return {
      total: mapped.length,
      visible: visibleAgents.length,
      agents: visibleAgents,
    };
  }

  async getMcpAgent(
    agent: any,
    options?: { includeHidden?: boolean },
  ): Promise<AgentMcpProfile> {
    const includeHidden = options?.includeHidden === true;
    const normalized = this.normalizeAgentEntity(agent);
    const role = await this.getRoleById(normalized.roleId);
    const profile = await this.agentMcpProfileService.buildSingleAgentMcpProfile(normalized, (role || undefined) as any);

    if (!includeHidden && !profile.exposed) {
      throw new NotFoundException(`MCP profile is not exposed for agent: ${normalized.id}`);
    }

    return profile;
  }

  // ---- tool permission set methods ----

  async getToolPermissionSets(): Promise<AgentToolPermissionSet[]> {
    const roles = await this.getAvailableRoles();
    return this.agentMcpProfileService.getToolPermissionSets(roles as any);
  }

  async upsertToolPermissionSet(
    roleCode: string,
    updates: Partial<Pick<AgentMcpMapProfile, 'tools' | 'permissions' | 'capabilities' | 'exposed' | 'description'>>,
  ): Promise<AgentToolPermissionSet> {
    const roles = await this.getAvailableRoles();
    return this.agentMcpProfileService.upsertToolPermissionSet(roleCode, updates, roles as any);
  }

  async resetToolPermissionSetsBySystemRoles(): Promise<{
    totalRoles: number;
    resetCount: number;
    missingRoleCodes: string[];
  }> {
    const roles = await this.getAvailableRoles();
    return this.agentMcpProfileService.resetToolPermissionSetsBySystemRoles(roles as any);
  }

  // ---- private helpers ----

  private normalizeAgentEntity(agent: any): any {
    const plain = agent?.toObject ? agent.toObject() : agent;
    const id = plain?.id || plain?._id?.toString?.() || plain?._id;
    return {
      ...plain,
      id,
    };
  }

  private normalizeRoleTier(role: AgentBusinessRole): AgentBusinessRole {
    const code = String(role?.code || '').trim().toLowerCase();
    const tier = role?.tier || getTierByAgentRoleCode(code);
    return {
      ...role,
      tier,
    };
  }
}
