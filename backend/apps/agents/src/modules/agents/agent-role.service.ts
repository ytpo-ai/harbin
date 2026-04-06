import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AgentRole, AgentRoleDocument, AgentRoleStatus } from '../../schemas/agent-role.schema';
import { Agent } from '@agent/schemas/agent.schema';
import { ToolService } from '../tools/tool.service';
import {
  AgentBusinessRole,
  AgentMcpProfile,
  AgentMcpMapProfile,
  AgentMcpToolSummary,
  AgentToolPermissionSet,
} from './agent.types';
import {
  normalizeToolId,
  normalizeToolIds,
  uniqueStrings,
} from './agent.constants';
import { AUTH_FREE_TOOL_IDS } from '@agent/modules/tools/builtin-tool-catalog';
import {
  AgentRoleTier,
  getTierByAgentRoleCode,
  hasPresetTierByAgentRoleCode,
  normalizeAgentRoleTier,
} from '../../../../../src/shared/role-tier';

interface RoleLike {
  id: string;
  code: string;
  name: string;
  description?: string;
  status: 'active' | 'inactive' | 'unknown';
  tools?: string[];
  permissions?: string[];
  permissionsManual?: string[];
  permissionsDerived?: string[];
  capabilities?: string[];
  exposed?: boolean;
}

const DEFAULT_MCP_PROFILE: AgentMcpMapProfile = {
  role: 'general-assistant',
  tools: [],
  permissions: [],
  permissionsManual: [],
  permissionsDerived: [],
  capabilities: [],
  exposed: false,
  description: 'No MCP profile found for this role',
};

@Injectable()
export class AgentRoleService {
  private readonly logger = new Logger(AgentRoleService.name);

  constructor(
    @InjectModel(AgentRole.name) private roleModel: Model<AgentRoleDocument>,
    private readonly toolService: ToolService,
  ) {}

  // ---- public role CRUD methods ----

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

  async getRoleByCode(roleCode: string): Promise<AgentBusinessRole | null> {
    const normalizedCode = String(roleCode || '').trim();
    if (!normalizedCode) {
      return null;
    }

    const role = await this.roleModel.findOne({ code: normalizedCode }).lean().exec();
    return role ? this.normalizeRoleTier(role as AgentBusinessRole) : null;
  }

  async createRole(input: {
    code: string;
    name: string;
    description?: string;
    capabilities?: string[];
    tools?: string[];
    permissions?: string[];
    permissionsManual?: string[];
    permissionsDerived?: string[];
    exposed?: boolean;
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
      permissions: this.normalizeStringArray(input?.permissions),
      permissionsManual: this.normalizeStringArray(input?.permissionsManual),
      permissionsDerived: this.normalizeStringArray(input?.permissionsDerived),
      exposed: input?.exposed === true,
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
      permissions?: string[];
      permissionsManual?: string[];
      permissionsDerived?: string[];
      exposed?: boolean;
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

    if (Object.prototype.hasOwnProperty.call(updates, 'permissions')) {
      (role as any).permissions = this.normalizeStringArray(updates.permissions);
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'permissionsManual')) {
      (role as any).permissionsManual = this.normalizeStringArray(updates.permissionsManual);
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'permissionsDerived')) {
      (role as any).permissionsDerived = this.normalizeStringArray(updates.permissionsDerived);
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'exposed')) {
      (role as any).exposed = updates.exposed === true;
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

  // ---- role-dependent permission/tool methods (merged from AgentMcpProfileService) ----

  async inheritRoleProfilePermissions(roleId: string, currentPermissions: string[]): Promise<string[]> {
    const role = await this.assertRoleExists(roleId);
    return uniqueStrings(currentPermissions || [], role.permissions || role.capabilities || []);
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
    const whitelist = new Set(normalizeToolIds(role.tools || []));
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
    const merged = uniqueStrings(agent.tools || [], role?.tools || [], [...AUTH_FREE_TOOL_IDS])
      .map((toolId) => normalizeToolId(toolId));

    return merged;
  }

  // ---- MCP map / profile assembly (merged from AgentMcpProfileService) ----

  async getAgentsMcpMap(): Promise<Record<string, AgentMcpMapProfile>> {
    const roles = await this.roleModel.find().lean().exec();
    const record: Record<string, AgentMcpMapProfile> = {};
    for (const role of roles) {
      const code = String((role as any).code || '').trim();
      if (code) {
        record[code] = this.roleToMcpMapProfile(role);
      }
    }
    return record;
  }

  async getMcpProfileByRoleCode(roleCode?: string): Promise<AgentMcpMapProfile> {
    const normalizedRoleCode = String(roleCode || '').trim();
    if (!normalizedRoleCode) {
      return DEFAULT_MCP_PROFILE;
    }

    const role = await this.roleModel.findOne({ code: normalizedRoleCode }).lean().exec();
    if (!role) {
      return DEFAULT_MCP_PROFILE;
    }
    return this.roleToMcpMapProfile(role);
  }

  async getMcpProfilesByRoleCodes(roleCodes: string[]): Promise<Map<string, AgentMcpMapProfile>> {
    const uniqueRoleCodes = Array.from(new Set(roleCodes.map((item) => item.trim()).filter(Boolean)));
    if (!uniqueRoleCodes.length) {
      return new Map();
    }

    const roles = await this.roleModel.find({ code: { $in: uniqueRoleCodes } }).lean().exec();
    const map = new Map<string, AgentMcpMapProfile>();
    for (const role of roles) {
      const code = String((role as any).code || '').trim();
      if (code) {
        map.set(code, this.roleToMcpMapProfile(role));
      }
    }
    return map;
  }

  /**
   * @deprecated Use getAvailableRoles() instead. Kept for backward API compatibility.
   */
  async getMcpProfiles(): Promise<AgentMcpMapProfile[]> {
    const roles = await this.roleModel.find().sort({ code: 1 }).lean().exec();
    return roles.map((role) => this.roleToMcpMapProfile(role));
  }

  /**
   * @deprecated Use getRoleByCode() instead. Kept for backward API compatibility.
   */
  async getMcpProfile(roleCode: string): Promise<AgentMcpMapProfile | null> {
    const normalizedCode = String(roleCode || '').trim();
    if (!normalizedCode) return null;
    const role = await this.roleModel.findOne({ code: normalizedCode }).lean().exec();
    if (!role) return null;
    return this.roleToMcpMapProfile(role);
  }

  /**
   * @deprecated Update role directly. Kept for backward API compatibility.
   */
  async upsertMcpProfile(roleCode: string, updates: Partial<AgentMcpMapProfile>): Promise<AgentMcpMapProfile> {
    const normalizedRoleCode = String(roleCode || '').trim();
    if (!normalizedRoleCode) {
      throw new BadRequestException('roleCode is required');
    }

    const existing = await this.roleModel.findOne({ code: normalizedRoleCode }).exec();
    const normalizedTools = normalizeToolIds(
      Object.prototype.hasOwnProperty.call(updates, 'tools') ? updates.tools || [] : (existing?.tools || []),
    );
    const hasManualPermissionUpdates =
      Object.prototype.hasOwnProperty.call(updates, 'permissions') ||
      Object.prototype.hasOwnProperty.call(updates, 'capabilities') ||
      Object.prototype.hasOwnProperty.call(updates, 'permissionsManual');
    const manualPermissions = hasManualPermissionUpdates
      ? this.normalizeIncomingPermissions(updates)
      : this.normalizeIncomingPermissions((existing as any) || {});
    const permissionsDerived = await this.derivePermissionsFromTools(normalizedTools);
    const mergedPermissions = uniqueStrings(manualPermissions, permissionsDerived);

    const updatePayload: Record<string, unknown> = {
      tools: normalizedTools,
      permissionsManual: manualPermissions,
      permissionsDerived,
      permissions: mergedPermissions,
      exposed: Object.prototype.hasOwnProperty.call(updates, 'exposed')
        ? updates.exposed === true
        : (existing as any)?.exposed === true,
    };

    if (Object.prototype.hasOwnProperty.call(updates, 'description')) {
      updatePayload.description = updates.description || '';
    }

    const role = await this.roleModel
      .findOneAndUpdate({ code: normalizedRoleCode }, { $set: updatePayload }, { new: true })
      .lean()
      .exec();

    if (!role) {
      throw new BadRequestException(`Role not found for code: ${normalizedRoleCode}`);
    }

    return this.roleToMcpMapProfile(role);
  }

  // ---- tool permission set methods (merged from AgentMcpProfileService) ----

  async getToolPermissionSets(): Promise<AgentToolPermissionSet[]> {
    const roles = await this.getAvailableRoles();
    return roles.map((role) => this.roleToToolPermissionSet(role));
  }

  async upsertToolPermissionSet(
    roleCode: string,
    updates: Partial<Pick<AgentMcpMapProfile, 'tools' | 'permissions' | 'capabilities' | 'exposed' | 'description'>>,
  ): Promise<AgentToolPermissionSet> {
    const normalizedRoleCode = String(roleCode || '').trim();
    if (!normalizedRoleCode) {
      throw new BadRequestException('roleCode is required');
    }

    const existing = await this.roleModel.findOne({ code: normalizedRoleCode }).exec();
    if (!existing) {
      throw new BadRequestException(`Role code not found: ${normalizedRoleCode}`);
    }

    const normalizedTools = normalizeToolIds(
      Object.prototype.hasOwnProperty.call(updates, 'tools') ? updates.tools || [] : (existing.tools || []),
    );
    const hasManualPermissionUpdates =
      Object.prototype.hasOwnProperty.call(updates, 'permissions') ||
      Object.prototype.hasOwnProperty.call(updates, 'capabilities') ||
      Object.prototype.hasOwnProperty.call(updates, 'permissionsManual');
    const manualPermissions = hasManualPermissionUpdates
      ? this.normalizeIncomingPermissions(updates)
      : this.normalizeIncomingPermissions((existing as any) || {});
    const permissionsDerived = await this.derivePermissionsFromTools(normalizedTools);
    const mergedPermissions = uniqueStrings(manualPermissions, permissionsDerived);

    existing.tools = normalizedTools;
    (existing as any).permissionsManual = manualPermissions;
    (existing as any).permissionsDerived = permissionsDerived;
    (existing as any).permissions = mergedPermissions;
    (existing as any).exposed = Object.prototype.hasOwnProperty.call(updates, 'exposed')
      ? updates.exposed === true
      : (existing as any).exposed === true;
    if (Object.prototype.hasOwnProperty.call(updates, 'description')) {
      existing.description = String(updates.description || '').trim();
    }

    const saved = await existing.save();
    return this.roleToToolPermissionSet(saved.toObject() as AgentBusinessRole);
  }

  // ---- MCP agent assembly ----

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
    const mapped = await this.buildAgentMcpProfiles(normalizedAgents, roleMap);
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
    const profile = await this.buildSingleAgentMcpProfile(normalized, role || undefined);

    if (!includeHidden && !profile.exposed) {
      throw new NotFoundException(`MCP profile is not exposed for agent: ${normalized.id}`);
    }

    return profile;
  }

  // ---- MCP profile building (merged from AgentMcpProfileService) ----

  async buildAgentMcpProfiles(
    agents: Agent[],
    roleMap: Map<string, AgentBusinessRole>,
  ): Promise<AgentMcpProfile[]> {
    const profileKeys = agents.map((agent) => this.resolveProfileLookupKey(roleMap.get(agent.roleId)));
    const profileMap = await this.getMcpProfilesByRoleCodes(profileKeys);
    const toolMap = await this.buildToolSummaryMap(agents, profileMap, roleMap);

    return agents.map((agent) => {
      const role = roleMap.get(agent.roleId);
      const mapKey = this.resolveProfileLookupKey(role);
      const profile = profileMap.get(mapKey) || DEFAULT_MCP_PROFILE;
      return this.toMcpProfile(agent, profile, mapKey, toolMap, role);
    });
  }

  async buildSingleAgentMcpProfile(agent: Agent, role?: AgentBusinessRole): Promise<AgentMcpProfile> {
    const mapKey = this.resolveProfileLookupKey(role);
    const mapProfile = await this.getMcpProfileByRoleCode(role?.code);
    const roleMap = new Map<string, AgentBusinessRole>();
    if (role) {
      roleMap.set(agent.roleId, role);
    }
    const toolMap = await this.buildToolSummaryMap([agent], new Map([[mapKey, mapProfile]]), roleMap);
    return this.toMcpProfile(agent, mapProfile, mapKey, toolMap, role);
  }

  // ---- permission derivation (merged from AgentMcpProfileService) ----

  async derivePermissionsFromTools(tools: string[]): Promise<string[]> {
    const normalizedTools = normalizeToolIds(tools || []);
    if (!normalizedTools.length) {
      return [];
    }
    const matchedTools = await this.toolService.getToolsByIds(normalizedTools);
    const permissionIds = (matchedTools || []).flatMap((tool: any) =>
      (Array.isArray(tool.requiredPermissions) ? tool.requiredPermissions : [])
        .map((item: any) => String(item?.id || '').trim())
        .filter(Boolean),
    );
    return this.normalizeStringArray(permissionIds);
  }

  // ---- private helpers ----

  private resolveProfileLookupKey(role?: AgentBusinessRole | RoleLike): string {
    const roleCode = String(role?.code || '').trim();
    if (roleCode) return roleCode;
    return '';
  }

  private async buildToolSummaryMap(
    agents: Agent[],
    profileMap: Map<string, AgentMcpMapProfile>,
    roleMap?: Map<string, AgentBusinessRole>,
  ): Promise<Map<string, AgentMcpToolSummary>> {
    const mergedIds = uniqueStrings(
      ...agents.map((agent) => {
        const mapKey = this.resolveProfileLookupKey(roleMap?.get(agent.roleId));
        const mapProfile = profileMap.get(mapKey) || DEFAULT_MCP_PROFILE;
        return [...(agent.tools || []), ...(mapProfile.tools || [])];
      }),
    ).map((toolId) => normalizeToolId(toolId));

    if (!mergedIds.length) {
      return new Map();
    }

    const tools = await this.toolService.getToolsByIds(mergedIds);
    const summaryMap = new Map<string, AgentMcpToolSummary>();
    for (const tool of tools as any[]) {
      const canonicalId = tool.canonicalId || normalizeToolId(tool.id);
      const summary = {
        id: canonicalId,
        name: tool.name,
        description: tool.description,
        type: tool.type,
        category: tool.category,
      };
      summaryMap.set(canonicalId, summary);
      summaryMap.set(tool.id, summary);
    }
    return summaryMap;
  }

  private toMcpProfile(
    agent: Agent,
    profile: AgentMcpMapProfile,
    mapKey: string,
    toolMap: Map<string, AgentMcpToolSummary>,
    role?: AgentBusinessRole | RoleLike,
  ): AgentMcpProfile {
    const toolIds = uniqueStrings(agent.tools || [], profile.tools || []).map((toolId) => normalizeToolId(toolId));
    const toolSet = toolIds.map((toolId) => {
      const existing = toolMap.get(toolId);
      if (existing) return existing;
      return {
        id: toolId,
        name: toolId,
        description: 'Tool metadata not found in registry',
      };
    });

    return {
      id: agent.id || '',
      name: agent.name,
      description: agent.description || profile.description || '',
      roleId: agent.roleId,
      role: role?.name || (role as any)?.code || profile.role,
      capabilitySet: uniqueStrings(agent.capabilities || [], profile.permissions || profile.capabilities || []),
      toolSet,
      exposed: profile.exposed === true,
      mapKey: mapKey || 'default',
    };
  }

  private roleToMcpMapProfile(role: any): AgentMcpMapProfile {
    const tools = normalizeToolIds(role?.tools || []);
    const permissionsManual = this.normalizeStringArray(role?.permissionsManual || []);
    const permissionsDerived = this.normalizeStringArray(role?.permissionsDerived || []);
    const permissions = this.resolveRolePermissions(role);
    return {
      role: String(role?.code || role?.name || '').trim() || DEFAULT_MCP_PROFILE.role,
      tools,
      permissions,
      permissionsManual,
      permissionsDerived,
      capabilities: permissions,
      exposed: role?.exposed === true,
      description: role?.description || '',
    };
  }

  private roleToToolPermissionSet(role: AgentBusinessRole): AgentToolPermissionSet {
    const permissions = this.resolveRolePermissions(role);
    return {
      roleId: role.id,
      roleCode: role.code,
      roleName: role.name || role.code,
      roleStatus: role.status || 'unknown',
      tools: normalizeToolIds(role.tools || []),
      permissions,
      permissionsManual: this.normalizeStringArray(role.permissionsManual || []),
      permissionsDerived: this.normalizeStringArray(role.permissionsDerived || []),
      capabilities: permissions,
      exposed: role.exposed === true,
      description: role.description || '',
    };
  }

  private resolveRolePermissions(role: any): string[] {
    if (!role) {
      return [];
    }
    return uniqueStrings(
      this.normalizeStringArray(role.permissions || []),
      this.normalizeStringArray(role.permissionsManual || []),
      this.normalizeStringArray(role.permissionsDerived || []),
      this.normalizeStringArray(role.capabilities || []),
    );
  }

  private normalizeIncomingPermissions(updates: Partial<AgentMcpMapProfile> | Record<string, any>): string[] {
    return uniqueStrings(
      this.normalizeStringArray((updates as any)?.permissions || []),
      this.normalizeStringArray((updates as any)?.permissionsManual || []),
      this.normalizeStringArray((updates as any)?.capabilities || []),
    );
  }

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
