import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Agent, AgentDocument } from '@agent/schemas/agent.schema';
import { AgentRole, AgentRoleDocument } from '../../../schemas/agent-role.schema';
import { ApiKey, ApiKeyDocument } from '../../../../../../src/shared/schemas/api-key.schema';
import { Skill, SkillDocument } from '../../../schemas/agent-skill.schema';
import { Tool, ToolDocument } from '../../../schemas/tool.schema';
import { RedisService } from '@libs/infra';
import { InternalApiClient } from '../internal-api-client.service';
import { ModelManagementService } from '../../models/model-management.service';
import { MemoService } from '../../memos/memo.service';
import { AGENT_TASK_RUNTIME_STATUS_INDEX_KEY, buildAgentRuntimeStatusKey, buildIdleAgentRuntimeStatus, parseAgentRuntimeStatus } from '../../agent-tasks/agent-task-runtime-status.util';
import { normalizeStringArray } from '../tool-identity.util';

const DEFAULT_PROFILE = {
  role: 'general-assistant',
  tools: [],
  permissions: [],
  capabilities: [],
  exposed: false,
};

@Injectable()
export class AgentMasterToolHandler {
  private readonly logger = new Logger(AgentMasterToolHandler.name);
  constructor(
    @InjectModel(Tool.name) private readonly toolModel: Model<ToolDocument>,
    @InjectModel(Agent.name) private readonly agentModel: Model<AgentDocument>,
    @InjectModel(AgentRole.name) private readonly agentRoleModel: Model<AgentRoleDocument>,
    @InjectModel(ApiKey.name) private readonly apiKeyModel: Model<ApiKeyDocument>,
    @InjectModel(Skill.name) private readonly skillModel: Model<SkillDocument>,
    private readonly redisService: RedisService,
    private readonly internalApiClient: InternalApiClient,
    private readonly modelManagementService: ModelManagementService,
    private readonly memoService: MemoService,
  ) {}

  private normalizeProvider(provider?: string): string {
    const value = String(provider || '').trim().toLowerCase();
    if (value === 'kimi') return 'moonshot';
    if (value === 'claude') return 'anthropic';
    return value;
  }
  private async resolveDefaultApiKeyId(provider?: string): Promise<string | undefined> {
    const normalizedProvider = this.normalizeProvider(provider);
    if (!normalizedProvider) {
      return undefined;
    }

    const apiKey = await this.apiKeyModel
      .findOne({
        provider: normalizedProvider,
        isDefault: true,
        isActive: true,
        isDeprecated: { $ne: true },
      })
      .sort({ updatedAt: -1, createdAt: -1 })
      .lean()
      .exec();

    return apiKey?.id ? String(apiKey.id).trim() : undefined;
  }
  private async resolveRoleIdForCreate(roleInput: string): Promise<{ roleId: string; matchedBy: 'id' | 'code' }> {
    const normalized = String(roleInput || '').trim();
    if (!normalized) {
      throw new Error('agent_master_create_agent requires roleId');
    }

    const roleById = await this.agentRoleModel.findOne({ id: normalized }).select({ id: 1 }).lean().exec();
    if ((roleById as any)?.id) {
      return { roleId: String((roleById as any).id).trim(), matchedBy: 'id' };
    }

    const roles = await this.agentRoleModel
      .find({ status: 'active' })
      .select({ id: 1, code: 1, name: 1 })
      .sort({ updatedAt: -1 })
      .lean()
      .exec() as Array<{ id: string; code: string; name?: string }>;

    const roleByCode = roles.find((item) => String(item?.code || '').trim() === normalized);
    if (roleByCode?.id) {
      return { roleId: String(roleByCode.id).trim(), matchedBy: 'code' };
    }

    const examples = roles
      .slice(0, 8)
      .map((item) => `${String(item?.code || '').trim()}=>${String(item?.id || '').trim()}`)
      .filter(Boolean)
      .join(', ');
    throw new Error(
      `agent_master_create_agent invalid roleId or roleCode: ${normalized}${examples ? `; examples=${examples}` : ''}`,
    );
  }
  async createAgentByMcp(params: {
    name?: string;
    roleId?: string;
    description?: string;
    systemPrompt?: string;
    model?: {
      id?: string;
      name?: string;
      provider?: string;
      model?: string;
      maxTokens?: number;
      temperature?: number;
      topP?: number;
      reasoning?: {
        enabled?: boolean;
        effort?: string;
        verbosity?: string;
      };
    };
    modelId?: string;
    provider?: string;
    apiKeyId?: string;
    capabilities?: string[];
    tools?: string[];
    permissions?: string[];
    learningAbility?: number;
    isActive?: boolean;
  }): Promise<any> {
    const name = String(params?.name || '').trim();
    const requestedRole = String(params?.roleId || '').trim();
    if (!name) {
      throw new Error('agent_master_create_agent requires name');
    }
    if (!requestedRole) {
      throw new Error('agent_master_create_agent requires roleId');
    }

    const resolvedRole = await this.resolveRoleIdForCreate(requestedRole);
    const roleId = resolvedRole.roleId;

    const modelId = String(params?.model?.id || params?.modelId || '').trim();
    if (!modelId) {
      throw new Error('agent_master_create_agent requires model.id or modelId');
    }

    const modelFromRegistry = await this.modelManagementService.getModelById(modelId);
    const modelProvider = this.normalizeProvider(params?.model?.provider) || this.normalizeProvider(modelFromRegistry?.provider);
    if (!modelProvider) {
      throw new Error(`agent_master_create_agent could not resolve provider for model: ${modelId}`);
    }

    const selectedApiKeyId = String(params?.apiKeyId || '').trim();
    const providerHint = this.normalizeProvider(params?.provider || 'default');
    const apiKeyProvider = providerHint && providerHint !== 'default' ? providerHint : modelProvider;
    const fallbackApiKeyId = selectedApiKeyId ? undefined : await this.resolveDefaultApiKeyId(apiKeyProvider);

    const payload = {
      name,
      roleId,
      ...(params?.description?.trim() ? { description: params.description.trim() } : {}),
      ...(params?.systemPrompt?.trim() ? { systemPrompt: params.systemPrompt.trim() } : {}),
      model: {
        id: modelId,
        name: String(params?.model?.name || modelFromRegistry?.name || modelId).trim(),
        provider: modelProvider,
        model: String(params?.model?.model || modelFromRegistry?.model || modelId).trim(),
        maxTokens: Number(params?.model?.maxTokens || modelFromRegistry?.maxTokens || 4096),
        temperature: params?.model?.temperature ?? modelFromRegistry?.temperature ?? 0.7,
        ...(params?.model?.topP !== undefined || modelFromRegistry?.topP !== undefined
          ? { topP: params?.model?.topP ?? modelFromRegistry?.topP }
          : {}),
        ...(params?.model?.reasoning || modelFromRegistry?.reasoning
          ? {
              reasoning: {
                ...(modelFromRegistry?.reasoning || {}),
                ...(params?.model?.reasoning || {}),
              },
            }
          : {}),
      },
      capabilities: normalizeStringArray(params?.capabilities),
      tools: normalizeStringArray(params?.tools),
      permissions: normalizeStringArray(params?.permissions),
      ...(params?.learningAbility !== undefined ? { learningAbility: Number(params.learningAbility) } : {}),
      ...(params?.isActive !== undefined ? { isActive: Boolean(params.isActive) } : {}),
      ...(selectedApiKeyId || fallbackApiKeyId ? { apiKeyId: selectedApiKeyId || fallbackApiKeyId } : {}),
    };

    const agent = (await this.internalApiClient.callAgentsApi('POST', '/agents', payload)) || {};
    return {
      action: 'create_agent',
      created: true,
      provider: modelProvider,
      apiKeyProvider,
      apiKeySource: selectedApiKeyId ? 'explicit' : fallbackApiKeyId ? 'provider-default' : 'system-default',
      usedApiKeyId: selectedApiKeyId || fallbackApiKeyId || '',
      agent: {
        id: String(agent.id || agent._id || '').trim(),
        name: String(agent.name || name).trim(),
        roleId: String(agent.roleId || roleId).trim(),
        isActive: Boolean(agent.isActive ?? payload.isActive ?? true),
        model: agent.model || payload.model,
      },
      roleResolvedBy: resolvedRole.matchedBy,
      createdAt: new Date().toISOString(),
    };
  }
  async getAgentsMcpList(params: { includeHidden?: boolean; limit?: number; agentId?: string }): Promise<any> {
    const includeHidden = params?.includeHidden === true;
    const limit = Math.max(1, Math.min(Number(params?.limit || 20), 100));
    const targetAgentId = String(params?.agentId || '').trim();
    const agents = await this.agentModel.find().exec();
    const roleIds = Array.from(new Set(agents.map((agent: any) => String(agent.roleId || '').trim()).filter(Boolean)));
    const roleMap = await this.getRoleMapByIds(roleIds);
    const roleCodes = Array.from(new Set(Array.from(roleMap.values()).map((role) => role.code).filter(Boolean)));
    const rolesByCode = await this.agentRoleModel.find({ code: { $in: roleCodes } }).lean().exec();
    const profileMap = new Map<string, any>();
    for (const role of rolesByCode as any[]) {
      const code = String(role.code || '').trim();
      if (code) {
        profileMap.set(code, {
          role: code,
          tools: role.tools || [],
          permissions: role.permissions || [],
          permissionsManual: role.permissionsManual || [],
          permissionsDerived: role.permissionsDerived || [],
          capabilities: role.capabilities || [],
          exposed: role.exposed === true,
          description: role.description || '',
        });
      }
    }

    const toolIds = Array.from(
      new Set(
        agents
          .flatMap((agent: any) => {
            const plain = agent?.toObject ? agent.toObject() : agent;
            const role = roleMap.get(String(plain.roleId || '').trim());
            const profile = role?.code ? profileMap.get(role.code) || DEFAULT_PROFILE : DEFAULT_PROFILE;
            return [...(plain.tools || []), ...((profile as any)?.tools || [])];
          })
          .map((item) => String(item || '').trim())
          .filter(Boolean),
      ),
    );
    const tools = toolIds.length
      ? await this.toolModel
          .find({
            $or: [{ id: { $in: toolIds } }, { canonicalId: { $in: toolIds } }],
          })
          .select({ id: 1, canonicalId: 1, name: 1, description: 1, requiredPermissions: 1 })
          .lean()
          .exec()
      : [];
    const toolMap = new Map<string, any>();
    for (const tool of tools as any[]) {
      const canonicalId = String(tool.canonicalId || tool.id || '').trim();
      const id = String(tool.id || '').trim();
      if (canonicalId) {
        toolMap.set(canonicalId, tool);
      }
      if (id) {
        toolMap.set(id, tool);
      }
      for (const alias of Array.isArray(tool.aliases) ? tool.aliases : []) {
        const normalizedAlias = String(alias || '').trim();
        if (normalizedAlias) {
          toolMap.set(normalizedAlias, tool);
        }
      }
    }

    const mapped = agents.map((agent) => {
      const plain = agent?.toObject ? agent.toObject() : agent;
      const roleId = String(plain.roleId || '').trim();
      const role = roleMap.get(roleId);
      const profile = role?.code ? profileMap.get(role.code) || DEFAULT_PROFILE : DEFAULT_PROFILE;
      const grantedPermissions = new Set(
        [
          ...(plain.permissions || []),
          ...(role?.permissions || []),
          ...((profile as any)?.permissions || []),
          ...((profile as any)?.permissionsManual || []),
          ...((profile as any)?.permissionsDerived || []),
          ...((profile as any)?.capabilities || []),
        ]
          .map((item) => String(item || '').trim())
          .filter(Boolean),
      );
      const effectiveToolIds = Array.from(
        new Set(
          [...(plain.tools || []), ...((profile as any)?.tools || [])]
            .map((item) => String(item || '').trim())
            .filter(Boolean),
        ),
      );
      const enrichedTools = effectiveToolIds.map((toolId) => {
        const tool = toolMap.get(toolId);
        const resolvedToolId = String(tool?.canonicalId || tool?.id || toolId).trim();
        const permissionSlugs: string[] = Array.from(
          new Set(
            (Array.isArray(tool?.requiredPermissions) ? tool.requiredPermissions : [])
              .map((item: any) => String(item?.id || '').trim())
              .filter(Boolean),
          ),
        );

        return {
          id: resolvedToolId,
          name: String(tool?.name || resolvedToolId).trim(),
          description: String(tool?.description || '').trim(),
          permissionSlugs,
          hasPermission: permissionSlugs.every((slug) => grantedPermissions.has(slug)),
        };
      });

      return {
        id: plain.id || plain._id?.toString?.() || plain._id,
        name: plain.name,
        role: role?.name || profile.role,
        capabilitySet: Array.from(new Set([...(plain.capabilities || []), ...((profile as any).permissions || profile.capabilities || [])])).slice(0, 12),
        tools: enrichedTools,
        _skillIds: Array.from(new Set((plain.skills || []).map((item: any) => String(item || '').trim()).filter(Boolean))),
        exposed: profile.exposed === true,
        isActive: plain.isActive === true,
      };
    });

    const filtered = targetAgentId
      ? mapped.filter((item) => String(item.id || '').trim() === targetAgentId)
      : mapped.filter((item) => includeHidden || item.exposed);
    const visibleAgents = filtered.slice(0, limit);
    const skillIds = Array.from(new Set(visibleAgents.flatMap((item) => item._skillIds || [])));
    const skills = skillIds.length
      ? await this.skillModel.find({ id: { $in: skillIds } }).select({ id: 1, name: 1, description: 1 }).lean().exec()
      : [];
    const skillMap = new Map<string, { id: string; name: string; description: string }>();
    for (const skill of skills as any[]) {
      const skillId = String(skill?.id || '').trim();
      if (!skillId) {
        continue;
      }
      skillMap.set(skillId, {
        id: skillId,
        name: String(skill?.name || '').trim(),
        description: String(skill?.description || '').trim(),
      });
    }
    const identifyMap = await this.memoService.getFirstMemoContentMapByKind(
      visibleAgents.map((item) => String(item.id || '').trim()),
      'identity',
    );
    const runtimeStatusMap = await this.getAgentRuntimeStatusMap(visibleAgents.map((item) => String(item.id || '').trim()));
    const agentsWithIdentify = visibleAgents.map((item) => {
      const skillsWithMetadata = (item._skillIds || []).map((skillId: string) => {
        const matched = skillMap.get(skillId);
        if (matched) {
          return matched;
        }
        return {
          id: skillId,
          name: skillId,
          description: '',
        };
      });

      return {
        id: item.id,
        name: item.name,
        role: item.role,
        capabilitySet: item.capabilitySet,
        tools: item.tools,
        skills: skillsWithMetadata,
        exposed: item.exposed,
        isActive: item.isActive,
        identify: identifyMap.get(String(item.id || '').trim()) || '',
        runtimeStatus: runtimeStatusMap.get(String(item.id || '').trim()) || buildIdleAgentRuntimeStatus(String(item.id || '').trim()),
      };
    });

    return {
      total: mapped.length,
      visible: agentsWithIdentify.length,
      includeHidden,
      ...(targetAgentId ? { agentId: targetAgentId } : {}),
      agents: agentsWithIdentify,
      fetchedAt: new Date().toISOString(),
    };
  }
  private async getAgentRuntimeStatusMap(agentIds: string[]): Promise<Map<string, ReturnType<typeof buildIdleAgentRuntimeStatus>>> {
    const normalizedIds = Array.from(new Set((agentIds || []).map((item) => String(item || '').trim()).filter(Boolean)));
    const map = new Map<string, ReturnType<typeof buildIdleAgentRuntimeStatus>>();
    for (const agentId of normalizedIds) {
      map.set(agentId, buildIdleAgentRuntimeStatus(agentId));
    }

    if (!normalizedIds.length || !this.redisService?.isReady?.()) {
      return map;
    }

    try {
      await this.redisService.sadd(AGENT_TASK_RUNTIME_STATUS_INDEX_KEY, normalizedIds);
      await Promise.all(
        normalizedIds.map(async (agentId) => {
          const raw = await this.redisService.get(buildAgentRuntimeStatusKey(agentId));
          const parsed = parseAgentRuntimeStatus(raw);
          if (parsed) {
            map.set(agentId, parsed);
          }
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || 'unknown');
      this.logger.warn(`[agent_runtime_status] failed to read runtime status for list-agents: ${message}`);
    }

    return map;
  }
  private async getRoleMapByIds(roleIds: string[]): Promise<Map<string, { name: string; code: string; permissions: string[] }>> {
    const uniqueRoleIds = Array.from(new Set((roleIds || []).map((item) => String(item || '').trim()).filter(Boolean)));
    const map = new Map<string, { name: string; code: string; permissions: string[] }>();
    if (!uniqueRoleIds.length) {
      return map;
    }

    const rows = await this.agentRoleModel
      .find({ id: { $in: uniqueRoleIds } })
      .select({ id: 1, code: 1, name: 1, capabilities: 1, permissions: 1, permissionsManual: 1, permissionsDerived: 1 })
      .lean()
      .exec() as Array<{ id: string; code: string; name?: string; capabilities?: string[]; permissions?: string[]; permissionsManual?: string[]; permissionsDerived?: string[] }>;

    for (const role of rows) {
      const roleId = String(role.id || '').trim();
      const code = String(role.code || '').trim();
      const name = String(role.name || role.code || '').trim();
      const permissions = normalizeStringArray([
        ...(role.capabilities || []),
        ...(role.permissions || []),
        ...(role.permissionsManual || []),
        ...(role.permissionsDerived || []),
      ]);
      if (roleId && code) {
        map.set(roleId, { name, code, permissions });
      }
    }

    for (const roleId of uniqueRoleIds) {
      if (!map.has(roleId)) {
        this.logger.warn(`Failed to resolve role ${roleId} in tools mcp list: role not found`);
      }
    }

    return map;
  }
}
