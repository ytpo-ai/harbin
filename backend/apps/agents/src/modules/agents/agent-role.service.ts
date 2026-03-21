import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AgentRole, AgentRoleDocument, AgentRoleStatus } from '../../schemas/agent-role.schema';
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
import {
  AgentRoleTier,
  getTierByAgentRoleCode,
  hasPresetTierByAgentRoleCode,
  normalizeAgentRoleTier,
} from '../../../../../src/shared/role-tier';

@Injectable()
export class AgentRoleService {
  private readonly logger = new Logger(AgentRoleService.name);

  constructor(
    @InjectModel(AgentRole.name) private roleModel: Model<AgentRoleDocument>,
    private readonly agentMcpProfileService: AgentMcpProfileService,
  ) {}

  // ---- public role methods ----

  async getAvailableRoles(options?: { status?: AgentRoleStatus }): Promise<AgentBusinessRole[]> {
    const filter: Record<string, unknown> = {};
    if (options?.status) {
      filter.status = options.status;
    }

    const rows = await this.roleModel.find(filter).sort({ updatedAt: -1 }).lean().exec();
    return rows.map((row) => this.normalizeRoleTier(row as AgentBusinessRole));
  }

  async getRoleById(roleId: string): Promise<AgentBusinessRole | null> {
    const normalizedRoleId = String(roleId || '').trim();
    if (!normalizedRoleId) {
      return null;
    }

    const role = await this.roleModel.findOne({ id: normalizedRoleId }).lean().exec();
    return role ? this.normalizeRoleTier(role as AgentBusinessRole) : null;
  }

  async createRole(input: {
    code: string;
    name: string;
    description?: string;
    capabilities?: string[];
    tools?: string[];
    promptTemplate?: string;
    status?: AgentRoleStatus;
    tier?: AgentRoleTier;
  }): Promise<AgentBusinessRole> {
    const code = String(input?.code || '').trim();
    const name = String(input?.name || '').trim();
    if (!code) {
      throw new BadRequestException('Role code is required');
    }
    if (!name) {
      throw new BadRequestException('Role name is required');
    }

    const existing = await this.roleModel.findOne({ code }).lean().exec();
    if (existing) {
      throw new BadRequestException(`Role code already exists: ${code}`);
    }

    const normalizedTier = normalizeAgentRoleTier(input?.tier);
    if (input?.tier !== undefined && !normalizedTier) {
      throw new BadRequestException('Role tier must be one of leadership, operations, temporary');
    }
    if (normalizedTier && hasPresetTierByAgentRoleCode(code) && normalizedTier !== getTierByAgentRoleCode(code)) {
      throw new BadRequestException(`Role tier mismatch with code ${code}: expected ${getTierByAgentRoleCode(code)}`);
    }

    const role = await this.roleModel.create({
      code,
      name,
      tier: normalizedTier || getTierByAgentRoleCode(code),
      description: String(input?.description || '').trim(),
      capabilities: this.normalizeStringArray(input?.capabilities),
      tools: this.normalizeStringArray(input?.tools),
      promptTemplate: String(input?.promptTemplate || '').trim(),
      status: input?.status === 'inactive' ? 'inactive' : 'active',
    });
    return this.normalizeRoleTier(role.toObject() as AgentBusinessRole);
  }

  async updateRole(
    roleId: string,
    updates: {
      code?: string;
      name?: string;
      description?: string;
      capabilities?: string[];
      tools?: string[];
      promptTemplate?: string;
      status?: AgentRoleStatus;
      tier?: AgentRoleTier;
    },
  ): Promise<AgentBusinessRole> {
    const normalizedRoleId = String(roleId || '').trim();
    if (!normalizedRoleId) {
      throw new BadRequestException('Role id is required');
    }

    const role = await this.roleModel.findOne({ id: normalizedRoleId }).exec();
    if (!role) {
      throw new NotFoundException(`Role not found: ${normalizedRoleId}`);
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'code')) {
      const nextCode = String(updates.code || '').trim();
      if (!nextCode) {
        throw new BadRequestException('Role code cannot be empty');
      }
      const duplicate = await this.roleModel.findOne({ code: nextCode, id: { $ne: normalizedRoleId } }).lean().exec();
      if (duplicate) {
        throw new BadRequestException(`Role code already exists: ${nextCode}`);
      }
      role.code = nextCode;
      if (!Object.prototype.hasOwnProperty.call(updates, 'tier')) {
        role.tier = getTierByAgentRoleCode(nextCode);
      }
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'tier')) {
      const nextTier = normalizeAgentRoleTier(updates.tier);
      if (!nextTier) {
        throw new BadRequestException('Role tier must be one of leadership, operations, temporary');
      }
      if (hasPresetTierByAgentRoleCode(role.code) && nextTier !== getTierByAgentRoleCode(role.code)) {
        throw new BadRequestException(`Role tier mismatch with code ${role.code}: expected ${getTierByAgentRoleCode(role.code)}`);
      }
      role.tier = nextTier;
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'name')) {
      const nextName = String(updates.name || '').trim();
      if (!nextName) {
        throw new BadRequestException('Role name cannot be empty');
      }
      role.name = nextName;
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'description')) {
      role.description = String(updates.description || '').trim();
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'capabilities')) {
      role.capabilities = this.normalizeStringArray(updates.capabilities);
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'tools')) {
      role.tools = this.normalizeStringArray(updates.tools);
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'promptTemplate')) {
      role.promptTemplate = String(updates.promptTemplate || '').trim();
    }

    if (updates.status === 'active' || updates.status === 'inactive') {
      role.status = updates.status;
    }

    const saved = await role.save();
    return this.normalizeRoleTier(saved.toObject() as AgentBusinessRole);
  }

  async deleteRole(roleId: string): Promise<{ deleted: boolean }> {
    const normalizedRoleId = String(roleId || '').trim();
    if (!normalizedRoleId) {
      throw new BadRequestException('Role id is required');
    }
    const result = await this.roleModel.deleteOne({ id: normalizedRoleId }).exec();
    return { deleted: result.deletedCount === 1 };
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

  // ---- MCP profile assembly ----

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

  private normalizeStringArray(items?: unknown[]): string[] {
    return Array.from(new Set((Array.isArray(items) ? items : []).map((item) => String(item || '').trim()).filter(Boolean)));
  }
}
