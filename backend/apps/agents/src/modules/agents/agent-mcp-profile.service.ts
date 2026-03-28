import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AgentProfile, AgentProfileDocument } from '@agents/schemas/agent-profile.schema';
import { Agent } from '@agent/schemas/agent.schema';
import { ToolService } from '../tools/tool.service';
import type { AgentMcpMapProfile, AgentMcpProfile, AgentMcpToolSummary, AgentToolPermissionSet } from './agent.types';

interface RoleLike {
  id: string;
  code: string;
  name: string;
  description?: string;
  status: 'active' | 'inactive' | 'unknown';
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

const LEGACY_TOOL_ID_ALIASES: Record<string, string> = {
  'mcp.orchestration.createPlan': 'builtin.sys-mg.mcp.orchestration.create-plan',
  'mcp.orchestration.updatePlan': 'builtin.sys-mg.mcp.orchestration.update-plan',
  'mcp.orchestration.runPlan': 'builtin.sys-mg.mcp.orchestration.run-plan',
  'mcp.orchestration.getPlan': 'builtin.sys-mg.mcp.orchestration.get-plan',
  'mcp.orchestration.listPlans': 'builtin.sys-mg.mcp.orchestration.list-plans',
  'mcp.model.list': 'builtin.sys-mg.mcp.model-admin.list-models',
  'mcp.model.add': 'builtin.sys-mg.mcp.model-admin.add-model',
  'mcp.humanOperationLog.list': 'builtin.sys-mg.mcp.audit.list-human-operation-log',
  'builtin.sys-mg.mcp.humanOperationLog.list': 'builtin.sys-mg.mcp.audit.list-human-operation-log',
  'internal.agents.list': 'builtin.sys-mg.internal.agent-master.list-agents',
  'internal.content.extract': 'builtin.data-analysis.internal.content-analysis.extract',
  'internal.web.search': 'builtin.web-retrieval.internal.web-search.exa',
  'internal.web.fetch': 'builtin.web-retrieval.internal.web-fetch.fetch',
};

@Injectable()
export class AgentMcpProfileService {
  constructor(
    @InjectModel(AgentProfile.name) private readonly agentProfileModel: Model<AgentProfileDocument>,
    private readonly toolService: ToolService,
  ) {}

  async getAgentsMcpMap(): Promise<Record<string, AgentMcpMapProfile>> {
    const profiles = await this.agentProfileModel.find().exec();
    const record: Record<string, AgentMcpMapProfile> = {};
    for (const profile of profiles) {
      record[profile.roleCode] = this.toAgentMcpMapProfile(profile);
    }
    return record;
  }

  async getMcpProfilesByRoleCodes(roleCodes: string[]): Promise<Map<string, AgentMcpMapProfile>> {
    const uniqueRoleCodes = Array.from(new Set(roleCodes.map((item) => item.trim()).filter(Boolean)));
    if (!uniqueRoleCodes.length) {
      return new Map();
    }

    const profiles = await this.agentProfileModel.find({ roleCode: { $in: uniqueRoleCodes } }).exec();
    const map = new Map<string, AgentMcpMapProfile>();
    for (const profile of profiles) {
      map.set(profile.roleCode, this.toAgentMcpMapProfile(profile));
    }
    return map;
  }

  async getMcpProfileByRoleCode(roleCode?: string): Promise<AgentMcpMapProfile> {
    const normalizedRoleCode = String(roleCode || '').trim();
    if (!normalizedRoleCode) {
      return DEFAULT_MCP_PROFILE;
    }

    const roleProfile = await this.agentProfileModel.findOne({ roleCode: normalizedRoleCode }).exec();
    if (!roleProfile) {
      return DEFAULT_MCP_PROFILE;
    }
    return this.toAgentMcpMapProfile(roleProfile);
  }

  async getMcpProfiles(): Promise<AgentProfile[]> {
    const profiles = await this.agentProfileModel.find().sort({ roleCode: 1 }).exec();
    return profiles.map((profile) => this.normalizeProfileEntity(profile));
  }

  async getMcpProfile(roleCode: string): Promise<AgentProfile | null> {
    const profile = await this.agentProfileModel.findOne({ roleCode: roleCode.trim() }).exec();
    if (!profile) return null;
    return this.normalizeProfileEntity(profile);
  }

  async upsertMcpProfile(roleCode: string, updates: Partial<AgentMcpMapProfile>): Promise<AgentProfile> {
    const normalizedRoleCode = roleCode.trim();
    if (!normalizedRoleCode) {
      throw new BadRequestException('roleCode is required');
    }

    const existing = await this.agentProfileModel.findOne({ roleCode: normalizedRoleCode }).lean().exec();
    const normalizedTools = this.normalizeToolIds(
      Object.prototype.hasOwnProperty.call(updates, 'tools') ? updates.tools || [] : ((existing as any)?.tools || []),
    );
    const hasManualPermissionUpdates =
      Object.prototype.hasOwnProperty.call(updates, 'permissions') ||
      Object.prototype.hasOwnProperty.call(updates, 'capabilities') ||
      Object.prototype.hasOwnProperty.call(updates, 'permissionsManual');
    const manualPermissions = hasManualPermissionUpdates
      ? this.normalizeIncomingPermissions(updates)
      : this.normalizeIncomingPermissions((existing as any) || {});
    const permissionsDerived = await this.derivePermissionsFromTools(normalizedTools);
    const payload: Partial<AgentProfile> = {
      role: updates.role || String((existing as any)?.role || '').trim() || DEFAULT_MCP_PROFILE.role,
      tools: normalizedTools,
      permissionsManual: manualPermissions,
      permissionsDerived,
      permissions: this.uniqueStrings(manualPermissions, permissionsDerived),
      capabilities: this.uniqueStrings(manualPermissions, permissionsDerived),
      exposed: Object.prototype.hasOwnProperty.call(updates, 'exposed')
        ? updates.exposed === true
        : (existing as any)?.exposed === true,
      description: Object.prototype.hasOwnProperty.call(updates, 'description')
        ? updates.description || ''
        : String((existing as any)?.description || ''),
    };

    const profile = await this.agentProfileModel
      .findOneAndUpdate({ roleCode: normalizedRoleCode }, { ...payload, roleCode: normalizedRoleCode }, { new: true, upsert: true })
      .exec();
    return this.normalizeProfileEntity(profile);
  }

  async getToolPermissionSets(roles: RoleLike[]): Promise<AgentToolPermissionSet[]> {
    const roleCodes = Array.from(new Set(roles.map((role) => String(role.code || '').trim()).filter(Boolean)));
    const profiles = await this.agentProfileModel.find({ roleCode: { $in: roleCodes } }).exec();
    const profileMap = new Map(profiles.map((profile) => [String(profile.roleCode || '').trim(), profile]));

    return roles.map((role) => {
      const roleCode = String(role.code || '').trim();
      const profile = profileMap.get(roleCode);
      return {
        roleId: role.id,
        roleCode,
        roleName: role.name || roleCode,
        roleStatus: role.status || 'unknown',
        tools: this.normalizeToolIds(profile?.tools || []),
        permissions: this.resolveProfilePermissions(profile),
        permissionsManual: this.normalizeStringArray((profile as any)?.permissionsManual || []),
        permissionsDerived: this.normalizeStringArray((profile as any)?.permissionsDerived || []),
        capabilities: this.resolveProfilePermissions(profile),
        exposed: profile?.exposed === true,
        description: profile?.description || role.description || '',
      };
    });
  }

  async upsertToolPermissionSet(
    roleCode: string,
    updates: Partial<Pick<AgentMcpMapProfile, 'tools' | 'permissions' | 'capabilities' | 'exposed' | 'description'>>,
    roles: RoleLike[],
  ): Promise<AgentToolPermissionSet> {
    const normalizedRoleCode = String(roleCode || '').trim();
    if (!normalizedRoleCode) {
      throw new BadRequestException('roleCode is required');
    }

    const role = roles.find((item) => String(item.code || '').trim() === normalizedRoleCode);
    if (!role) {
      throw new BadRequestException(`Role code not found: ${normalizedRoleCode}`);
    }

    const existing = await this.agentProfileModel.findOne({ roleCode: normalizedRoleCode }).lean().exec();
    const normalizedTools = this.normalizeToolIds(
      Object.prototype.hasOwnProperty.call(updates, 'tools') ? updates.tools || [] : ((existing as any)?.tools || []),
    );
    const hasManualPermissionUpdates =
      Object.prototype.hasOwnProperty.call(updates, 'permissions') ||
      Object.prototype.hasOwnProperty.call(updates, 'capabilities') ||
      Object.prototype.hasOwnProperty.call(updates, 'permissionsManual');
    const manualPermissions = hasManualPermissionUpdates
      ? this.normalizeIncomingPermissions(updates)
      : this.normalizeIncomingPermissions((existing as any) || {});
    const permissionsDerived = await this.derivePermissionsFromTools(normalizedTools);
    const mergedPermissions = this.uniqueStrings(manualPermissions, permissionsDerived);

    const payload: Partial<AgentProfile> = {
      role: normalizedRoleCode,
      tools: normalizedTools,
      permissionsManual: manualPermissions,
      permissionsDerived,
      permissions: mergedPermissions,
      capabilities: mergedPermissions,
      exposed: Object.prototype.hasOwnProperty.call(updates, 'exposed')
        ? updates.exposed === true
        : (existing as any)?.exposed === true,
      description: Object.prototype.hasOwnProperty.call(updates, 'description')
        ? updates.description || ''
        : String((existing as any)?.description || ''),
    };

    const profile = await this.agentProfileModel
      .findOneAndUpdate({ roleCode: normalizedRoleCode }, { ...payload, roleCode: normalizedRoleCode }, { new: true, upsert: true })
      .exec();

    return {
      roleId: role.id,
      roleCode: normalizedRoleCode,
      roleName: role.name || normalizedRoleCode,
      roleStatus: role.status || 'unknown',
      tools: this.normalizeToolIds(profile?.tools || []),
      permissions: this.resolveProfilePermissions(profile),
      permissionsManual: this.normalizeStringArray((profile as any)?.permissionsManual || []),
      permissionsDerived: this.normalizeStringArray((profile as any)?.permissionsDerived || []),
      capabilities: this.resolveProfilePermissions(profile),
      exposed: profile?.exposed === true,
      description: profile?.description || role.description || '',
    };
  }

  async buildAgentMcpProfiles(
    agents: Agent[],
    roleMap: Map<string, RoleLike>,
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

  async buildSingleAgentMcpProfile(agent: Agent, role?: RoleLike): Promise<AgentMcpProfile> {
    const mapKey = this.resolveProfileLookupKey(role);
    const mapProfile = await this.getMcpProfileByRoleCode(role?.code);
    const roleMap = new Map<string, RoleLike>();
    if (role) {
      roleMap.set(agent.roleId, role);
    }
    const toolMap = await this.buildToolSummaryMap([agent], new Map([[mapKey, mapProfile]]), roleMap);
    return this.toMcpProfile(agent, mapProfile, mapKey, toolMap, role);
  }

  private resolveProfileLookupKey(role?: RoleLike): string {
    const roleCode = String(role?.code || '').trim();
    if (roleCode) return roleCode;
    return '';
  }

  private async buildToolSummaryMap(
    agents: Agent[],
    profileMap: Map<string, AgentMcpMapProfile>,
    roleMap?: Map<string, RoleLike>,
  ): Promise<Map<string, AgentMcpToolSummary>> {
    const mergedIds = this.uniqueStrings(
      ...agents.map((agent) => {
        const mapKey = this.resolveProfileLookupKey(roleMap?.get(agent.roleId));
        const mapProfile = profileMap.get(mapKey) || DEFAULT_MCP_PROFILE;
        return [...(agent.tools || []), ...(mapProfile.tools || [])];
      }),
    ).map((toolId) => this.normalizeToolId(toolId));

    if (!mergedIds.length) {
      return new Map();
    }

    const tools = await this.toolService.getToolsByIds(mergedIds);
    const summaryMap = new Map<string, AgentMcpToolSummary>();
    for (const tool of tools as any[]) {
      const canonicalId = tool.canonicalId || this.normalizeToolId(tool.id);
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
    role?: RoleLike,
  ): AgentMcpProfile {
    const toolIds = this.uniqueStrings(agent.tools || [], profile.tools || []).map((toolId) => this.normalizeToolId(toolId));
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
      role: role?.name || role?.code || profile.role,
      capabilitySet: this.uniqueStrings(agent.capabilities || [], profile.permissions || profile.capabilities || []),
      toolSet,
      exposed: profile.exposed === true,
      mapKey: mapKey || 'default',
    };
  }

  private toAgentMcpMapProfile(profile: Partial<AgentProfile>): AgentMcpMapProfile {
    const tools = this.normalizeToolIds(profile.tools || []);
    const permissionsManual = this.normalizeStringArray(profile.permissionsManual || []);
    const permissionsDerived = this.normalizeStringArray(profile.permissionsDerived || []);
    const permissions = this.resolveProfilePermissions(profile);
    return {
      role: String(profile.role || '').trim() || DEFAULT_MCP_PROFILE.role,
      tools,
      permissions,
      permissionsManual,
      permissionsDerived,
      capabilities: permissions,
      exposed: profile.exposed === true,
      description: profile.description || '',
    };
  }

  private normalizeProfileEntity(profile: any): AgentProfile {
    const plain = profile?.toObject ? profile.toObject() : profile;
    const normalized = this.toAgentMcpMapProfile(plain || {});
    return {
      ...plain,
      tools: normalized.tools,
      permissions: normalized.permissions,
      permissionsManual: normalized.permissionsManual || [],
      permissionsDerived: normalized.permissionsDerived || [],
      capabilities: normalized.permissions,
    } as AgentProfile;
  }

  private resolveProfilePermissions(profile: Partial<AgentProfile> | null | undefined): string[] {
    if (!profile) {
      return [];
    }
    const combined = this.uniqueStrings(
      this.normalizeStringArray(profile.permissions || []),
      this.normalizeStringArray(profile.permissionsManual || []),
      this.normalizeStringArray(profile.permissionsDerived || []),
      this.normalizeStringArray(profile.capabilities || []),
    );
    return combined;
  }

  private normalizeIncomingPermissions(updates: Partial<AgentMcpMapProfile> | Partial<AgentProfile>): string[] {
    const profileLike = updates as Partial<AgentProfile>;
    return this.uniqueStrings(
      this.normalizeStringArray((updates as any)?.permissions || []),
      this.normalizeStringArray(profileLike.permissionsManual || []),
      this.normalizeStringArray((updates as any)?.capabilities || []),
    );
  }

  private async derivePermissionsFromTools(tools: string[]): Promise<string[]> {
    const normalizedTools = this.normalizeToolIds(tools || []);
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

  private normalizeStringArray(items: string[]): string[] {
    return Array.from(new Set((Array.isArray(items) ? items : []).map((item) => String(item || '').trim()).filter(Boolean))).sort();
  }

  private normalizeToolId(toolId: string): string {
    const normalized = String(toolId || '').trim();
    if (!normalized) return '';
    return LEGACY_TOOL_ID_ALIASES[normalized] || normalized;
  }

  private normalizeToolIds(toolIds: string[]): string[] {
    return this.uniqueStrings(toolIds || []).map((toolId) => this.normalizeToolId(toolId));
  }

  private uniqueStrings(...groups: string[][]): string[] {
    const merged = groups.flat().map((item) => String(item || '').trim()).filter(Boolean);
    return Array.from(new Set(merged));
  }
}
