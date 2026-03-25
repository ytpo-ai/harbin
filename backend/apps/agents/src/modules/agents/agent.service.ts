import { Injectable, NotFoundException, Logger, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, isValidObjectId } from 'mongoose';
import { Agent, AgentDocument } from '@agent/schemas/agent.schema';
import { AgentProfile, AgentProfileDocument } from '@agent/schemas/agent-profile.schema';
import { Skill, SkillDocument } from '../../schemas/agent-skill.schema';
import { ModelService } from '../models/model.service';
import { Task, AIModel } from '../../../../../src/shared/types';
import { MemoEventBusService } from '../memos/memo-event-bus.service';
import { AgentMcpProfileService } from './agent-mcp-profile.service';
import { AgentRoleService } from './agent-role.service';
import { AgentExecutorService } from './agent-executor.service';
import { AGENT_PROMPTS, AgentPromptTemplate } from '../prompt-registry/agent-prompt-catalog';
import {
  normalizeToolIds,
  normalizeToolId,
  uniqueStrings,
} from './agent.constants';
import { AgentRoleTier, getTierByAgentRoleCode, normalizeAgentRoleTier } from '../../../../../src/shared/role-tier';

// Re-export shared types for backward compatibility
export {
  AgentContext,
  ExecuteTaskResult,
  AgentMcpToolSummary,
  AgentMcpProfile,
  AgentBusinessRole,
  AgentToolPermissionSet,
  AgentMcpMapProfile,
} from './agent.types';

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    @InjectModel(Agent.name) private agentModel: Model<AgentDocument>,
    @InjectModel(AgentProfile.name) private agentProfileModel: Model<AgentProfileDocument>,
    @InjectModel(Skill.name) private skillModel: Model<SkillDocument>,
    private readonly modelService: ModelService,
    private readonly memoEventBus: MemoEventBusService,
    private readonly agentMcpProfileService: AgentMcpProfileService,
    private readonly agentRoleService: AgentRoleService,
    private readonly agentExecutorService: AgentExecutorService,
  ) {}

  // ---- CRUD ----

  async createAgent(agentData: Omit<Agent, 'id' | 'createdAt' | 'updatedAt'>): Promise<Agent> {
    if (!agentData.name?.trim()) {
      throw new BadRequestException('Agent name is required');
    }
    if (!agentData.roleId?.trim()) {
      throw new BadRequestException('roleId is required');
    }
    if (!agentData.model?.id || !agentData.model?.name || !agentData.model?.provider || !agentData.model?.model) {
      throw new BadRequestException('Valid model configuration is required');
    }

    const role = await this.agentRoleService.assertRoleExists(agentData.roleId);
    const tier = this.resolveAgentTierOrThrow(agentData.tier, role?.code, role?.tier);

    const createAgentDefaultSystemPrompt = this.renderAgentPrompt(AGENT_PROMPTS.createAgentDefaultSystemPrompt, {
      agentName: agentData.name,
    });

    const normalizedData: Omit<Agent, 'id' | 'createdAt' | 'updatedAt'> = {
      ...agentData,
      roleId: agentData.roleId.trim(),
      tier,
      description: agentData.description?.trim() || `${agentData.name} Agent`,
      systemPrompt: agentData.systemPrompt?.trim() || createAgentDefaultSystemPrompt,
      model: {
        ...agentData.model,
        maxTokens: agentData.model.maxTokens || 4096,
        temperature: agentData.model.temperature ?? 0.7,
      },
      capabilities: agentData.capabilities || [],
      config: this.normalizeAgentConfig(agentData.config),
      tools: agentData.tools || [],
      skills: this.normalizeSkillIds(agentData.skills || []),
      permissions: agentData.permissions || [],
      promptTemplateRef: this.normalizePromptTemplateRef((agentData as any).promptTemplateRef),
      personality: agentData.personality || {
        workEthic: 80,
        creativity: 75,
        leadership: 70,
        teamwork: 80,
      },
      learningAbility: agentData.learningAbility ?? 80,
      isActive: agentData.isActive ?? true,
    };

    normalizedData.tools = await this.agentRoleService.ensureToolsWithinRolePermissionWhitelist(
      normalizedData.roleId,
      normalizedData.tools || [],
      'create',
    );
    await this.ensureSkillsExist(normalizedData.skills || []);
    normalizedData.permissions = await this.agentRoleService.inheritRoleProfilePermissions(normalizedData.roleId, normalizedData.permissions || []);

    try {
      const modelConfig: AIModel = {
        id: normalizedData.model.id,
        name: normalizedData.model.name,
        provider: normalizedData.model.provider as AIModel['provider'],
        model: normalizedData.model.model,
        maxTokens: normalizedData.model.maxTokens || 4096,
        temperature: normalizedData.model.temperature ?? 0.7,
        topP: normalizedData.model.topP,
        reasoning: normalizedData.model.reasoning,
      };
      this.modelService.ensureProvider(modelConfig);
      this.logger.log(`Agent ${normalizedData.name} using model: ${modelConfig.name} (${modelConfig.id})`);

      const newAgent = new this.agentModel(normalizedData);
      return await newAgent.save();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create agent';
      this.logger.error(`Create agent failed: ${message}`);
      throw new BadRequestException(message);
    }
  }

  async getAgent(agentId: string): Promise<Agent | null> {
    return this.agentModel.findOne(this.buildAgentLookupQuery(agentId)).exec();
  }

  async getAgentByName(name: string): Promise<Agent | null> {
    return this.agentModel.findOne({ name }).exec();
  }

  async getAllAgents(): Promise<Agent[]> {
    return this.agentModel.find().exec();
  }

  async getActiveAgents(): Promise<Agent[]> {
    return this.agentModel.find({ isActive: true }).exec();
  }

  async updateAgent(agentId: string, updates: Partial<Agent>): Promise<Agent | null> {
    const existingAgent = await this.getAgent(agentId);
    if (!existingAgent) {
      throw new NotFoundException(`Agent not found: ${agentId}`);
    }

    const normalizedUpdates: any = {
      ...updates,
      updatedAt: new Date(),
    };

    const hasConfigField = Object.prototype.hasOwnProperty.call(updates, 'config');
    if (hasConfigField) {
      normalizedUpdates.config = this.normalizeAgentConfig(updates.config);
    }

    const hasRoleIdField = Object.prototype.hasOwnProperty.call(updates, 'roleId');
    if (hasRoleIdField) {
      const normalizedRoleId = typeof updates.roleId === 'string' ? updates.roleId.trim() : '';
      if (!normalizedRoleId) {
        throw new BadRequestException('roleId is required');
      }
      normalizedUpdates.roleId = normalizedRoleId;
    } else if (!(existingAgent.roleId || '').trim()) {
      throw new BadRequestException('roleId is required');
    }

    const targetRoleId = hasRoleIdField ? normalizedUpdates.roleId : String(existingAgent.roleId || '').trim();
    const hasTierField = Object.prototype.hasOwnProperty.call(updates, 'tier');

    const targetRole = hasRoleIdField
      ? await this.agentRoleService.assertRoleExists(targetRoleId)
      : await this.agentRoleService.getRoleById(targetRoleId);

    if (!targetRole) {
      throw new BadRequestException(`Invalid roleId: ${targetRoleId}`);
    }

    if (hasRoleIdField || hasTierField) {
      normalizedUpdates.tier = this.resolveAgentTierOrThrow(
        hasTierField ? updates.tier : existingAgent.tier,
        targetRole.code,
        targetRole.tier,
        true,
      );
    }

    const hasToolsField = Object.prototype.hasOwnProperty.call(updates, 'tools');
    if (hasToolsField || hasRoleIdField) {
      const candidateTools = hasToolsField
        ? Array.isArray(updates.tools)
          ? updates.tools
          : []
        : Array.isArray(existingAgent.tools)
          ? existingAgent.tools
          : [];
      normalizedUpdates.tools = await this.agentRoleService.ensureToolsWithinRolePermissionWhitelist(
        targetRoleId,
        candidateTools,
        'update',
      );
    }

    const hasApiKeyIdField = Object.prototype.hasOwnProperty.call(updates, 'apiKeyId');
    if (hasApiKeyIdField) {
      const normalizedApiKeyId = typeof updates.apiKeyId === 'string' ? updates.apiKeyId.trim() : '';

      if (normalizedApiKeyId) {
        normalizedUpdates.apiKeyId = normalizedApiKeyId;
      } else {
        delete normalizedUpdates.apiKeyId;
        normalizedUpdates.$unset = {
          ...(normalizedUpdates.$unset || {}),
          apiKeyId: 1,
        };
      }
    }

    const hasPromptTemplateRefField = Object.prototype.hasOwnProperty.call(updates, 'promptTemplateRef');
    if (hasPromptTemplateRefField) {
      const normalizedPromptTemplateRef = this.normalizePromptTemplateRef((updates as any).promptTemplateRef);
      if (normalizedPromptTemplateRef) {
        normalizedUpdates.promptTemplateRef = normalizedPromptTemplateRef;
      } else {
        delete normalizedUpdates.promptTemplateRef;
        normalizedUpdates.$unset = {
          ...(normalizedUpdates.$unset || {}),
          promptTemplateRef: 1,
        };
      }
    }

    if (hasRoleIdField || hasToolsField || Object.prototype.hasOwnProperty.call(updates, 'permissions')) {
      const basePermissions = Object.prototype.hasOwnProperty.call(updates, 'permissions')
        ? Array.isArray(updates.permissions)
          ? updates.permissions
          : []
        : Array.isArray(existingAgent.permissions)
          ? existingAgent.permissions
          : [];
      normalizedUpdates.permissions = await this.agentRoleService.inheritRoleProfilePermissions(targetRoleId, basePermissions);
    }

    const hasSkillsField = Object.prototype.hasOwnProperty.call(updates, 'skills');
    if (hasSkillsField) {
      const normalizedSkills = this.normalizeSkillIds(Array.isArray(updates.skills) ? updates.skills : []);
      await this.ensureSkillsExist(normalizedSkills);
      normalizedUpdates.skills = normalizedSkills;
    }

    const updated = await this.agentModel.findByIdAndUpdate(
      (existingAgent as any)._id,
      normalizedUpdates,
      { new: true },
    ).exec();
    if (updated) {
      const runtimeAgentId = updated.id || (updated as any)._id?.toString?.() || agentId;
      this.memoEventBus.emit({
        name: 'agent.updated',
        agentId: runtimeAgentId,
        memoKinds: ['identity'],
      });
    }
    return updated;
  }

  async deleteAgent(agentId: string): Promise<boolean> {
    const existingAgent = await this.getAgent(agentId);
    if (!existingAgent) {
      return false;
    }
    const result = await this.agentModel.deleteOne({ _id: (existingAgent as any)._id }).exec();
    return Boolean(result.deletedCount && result.deletedCount > 0);
  }

  async getAgentCapabilities(agentId: string): Promise<string[]> {
    const agent = await this.getAgent(agentId);
    return agent?.capabilities || [];
  }

  async isAgentAvailable(agentId: string): Promise<boolean> {
    const agent = await this.getAgent(agentId);
    return agent?.isActive || false;
  }

  // ---- migration ----

  async migrateAllToolIdsToCanonical(): Promise<{
    profilesScanned: number;
    profilesUpdated: number;
    agentsScanned: number;
    agentsUpdated: number;
  }> {
    const profiles = await this.agentProfileModel.find().select({ _id: 1, tools: 1 }).lean().exec();
    let profilesUpdated = 0;
    for (const profile of profiles as any[]) {
      const originalTools = Array.isArray(profile.tools) ? profile.tools : [];
      const normalized = normalizeToolIds(originalTools);
      if (JSON.stringify(originalTools) === JSON.stringify(normalized)) {
        continue;
      }
      await this.agentProfileModel.updateOne({ _id: profile._id }, { $set: { tools: normalized } }).exec();
      profilesUpdated += 1;
    }

    const agents = await this.agentModel.find().select({ _id: 1, tools: 1 }).lean().exec();
    let agentsUpdated = 0;
    for (const agent of agents as any[]) {
      const originalTools = Array.isArray(agent.tools) ? agent.tools : [];
      const normalized = normalizeToolIds(originalTools);
      if (JSON.stringify(originalTools) === JSON.stringify(normalized)) {
        continue;
      }
      await this.agentModel.updateOne({ _id: agent._id }, { $set: { tools: normalized } }).exec();
      agentsUpdated += 1;
    }

    return {
      profilesScanned: profiles.length,
      profilesUpdated,
      agentsScanned: agents.length,
      agentsUpdated,
    };
  }

  // ---- facade: delegate to AgentTaskExecutorService ----

  async executeTask(agentId: string, task: Task, context?: any): Promise<string> {
    const agent = await this.getAgent(agentId);
    if (!agent) {
      throw new NotFoundException(`Agent not found: ${agentId}`);
    }
    return this.agentExecutorService.executeTask(agent, agentId, task, context);
  }

  async executeTaskDetailed(agentId: string, task: Task, context?: any): Promise<import('./agent.types').ExecuteTaskResult> {
    const agent = await this.getAgent(agentId);
    if (!agent) {
      throw new NotFoundException(`Agent not found: ${agentId}`);
    }
    return this.agentExecutorService.executeTaskDetailed(agent, agentId, task, context);
  }

  async executeTaskWithStreaming(
    agentId: string,
    task: Task,
    onToken: (token: string) => void,
    context?: any,
  ): Promise<import('./agent.types').ExecuteTaskResult> {
    const agent = await this.getAgent(agentId);
    if (!agent) {
      throw new NotFoundException(`Agent not found: ${agentId}`);
    }
    return this.agentExecutorService.executeTaskWithStreaming(agent, agentId, task, onToken, context);
  }

  async testAgentConnection(
    agentId: string,
    options?: { model?: AIModel; apiKeyId?: string },
  ) {
    const agent = await this.getAgent(agentId);
    if (!agent) {
      return {
        success: false,
        error: 'Agent not found',
        timestamp: new Date().toISOString(),
      };
    }
    return this.agentExecutorService.testAgentConnection(agent, options);
  }

  async cancelRuntimeRun(runId: string, reason?: string): Promise<void> {
    return this.agentExecutorService.cancelRuntimeRun(runId, reason);
  }

  async cancelOpenCodeSession(
    sessionId: string,
    runtime?: { endpoint?: string; authEnable?: boolean },
  ): Promise<boolean> {
    return this.agentExecutorService.cancelOpenCodeSession(sessionId, runtime);
  }

  // ---- facade: delegate to AgentRoleService ----

  async getAvailableRoles(options?: { status?: 'active' | 'inactive' }) {
    return this.agentRoleService.getAvailableRoles(options);
  }

  async getRoleById(roleId: string) {
    return this.agentRoleService.getRoleById(roleId);
  }

  async createRole(
    input: {
      code: string;
      name: string;
      description?: string;
      capabilities?: string[];
      tools?: string[];
      promptTemplate?: string;
      status?: 'active' | 'inactive';
      tier?: AgentRoleTier;
    },
  ) {
    return this.agentRoleService.createRole(input);
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
      status?: 'active' | 'inactive';
      tier?: AgentRoleTier;
    },
  ) {
    return this.agentRoleService.updateRole(roleId, updates);
  }

  async deleteRole(roleId: string) {
    return this.agentRoleService.deleteRole(roleId);
  }

  async getAgentsMcpMap() {
    return this.agentMcpProfileService.getAgentsMcpMap();
  }

  async getMcpAgents(options?: { includeHidden?: boolean }) {
    const agents = await this.getAllAgents();
    return this.agentRoleService.getMcpAgents(agents, options);
  }

  async getMcpAgent(agentId: string, options?: { includeHidden?: boolean }) {
    const agent = await this.getAgent(agentId);
    if (!agent) {
      throw new NotFoundException(`Agent not found: ${agentId}`);
    }
    return this.agentRoleService.getMcpAgent(agent, options);
  }

  async getToolPermissionSets() {
    return this.agentRoleService.getToolPermissionSets();
  }

  async upsertToolPermissionSet(
    roleCode: string,
    updates: Partial<Pick<import('./agent.types').AgentMcpMapProfile, 'tools' | 'permissions' | 'capabilities' | 'exposed' | 'description'>>,
  ) {
    return this.agentRoleService.upsertToolPermissionSet(roleCode, updates);
  }

  // ---- facade: delegate to AgentMcpProfileService ----

  async getMcpProfiles(): Promise<AgentProfile[]> {
    return this.agentMcpProfileService.getMcpProfiles();
  }

  async getMcpProfile(roleCode: string): Promise<AgentProfile | null> {
    return this.agentMcpProfileService.getMcpProfile(roleCode);
  }

  async upsertMcpProfile(roleCode: string, updates: Partial<import('./agent.types').AgentMcpMapProfile>): Promise<AgentProfile> {
    return this.agentMcpProfileService.upsertMcpProfile(roleCode, updates);
  }

  // ---- private helpers ----

  private buildAgentLookupQuery(agentIdentifier: string): Record<string, unknown> {
    const normalizedIdentifier = String(agentIdentifier || '').trim();
    if (!normalizedIdentifier) {
      return { id: '__missing_agent_identifier__' };
    }
    if (isValidObjectId(normalizedIdentifier)) {
      return {
        $or: [{ _id: normalizedIdentifier }, { id: normalizedIdentifier }],
      };
    }
    return { id: normalizedIdentifier };
  }

  private normalizeAgentConfig(config: unknown): Record<string, unknown> {
    if (config === undefined || config === null) {
      return {};
    }

    if (typeof config !== 'object' || Array.isArray(config)) {
      throw new BadRequestException('config must be a JSON object');
    }

    return { ...(config as Record<string, unknown>) };
  }

  private normalizePromptTemplateRef(input: unknown): { scene: string; role: string } | undefined {
    if (input === undefined || input === null) {
      return undefined;
    }
    if (typeof input !== 'object' || Array.isArray(input)) {
      throw new BadRequestException('promptTemplateRef must be an object with scene and role');
    }

    const scene = String((input as any).scene || '').trim();
    const role = String((input as any).role || '').trim();
    if (!scene || !role) {
      throw new BadRequestException('promptTemplateRef requires non-empty scene and role');
    }

    return { scene, role };
  }

  private normalizeSkillIds(skillIds: string[]): string[] {
    return uniqueStrings(skillIds || []);
  }

  private resolveAgentTierOrThrow(
    requestedTier: unknown,
    roleCode?: string,
    roleTier?: unknown,
    allowTierCoercion = false,
  ): AgentRoleTier {
    const normalizedRequestedTier = normalizeAgentRoleTier(requestedTier);
    if (requestedTier !== undefined && !normalizedRequestedTier) {
      throw new BadRequestException('tier must be one of leadership, operations, temporary');
    }

    const mappedTier = normalizeAgentRoleTier(roleTier) || getTierByAgentRoleCode(roleCode);
    const resolvedTier = normalizedRequestedTier || mappedTier;

    if (normalizedRequestedTier && normalizedRequestedTier !== mappedTier) {
      if (allowTierCoercion) {
        this.logger.warn(
          `coerce tier for role ${String(roleCode || '').trim() || 'unknown'}: requested ${normalizedRequestedTier}, applied ${mappedTier}`,
        );
        return mappedTier;
      }
      throw new BadRequestException(
        `tier mismatch for role ${String(roleCode || '').trim() || 'unknown'}: expected ${mappedTier}, got ${normalizedRequestedTier}`,
      );
    }

    return resolvedTier;
  }

  private async ensureSkillsExist(skillIds: string[]): Promise<void> {
    const normalizedSkillIds = this.normalizeSkillIds(skillIds);
    if (!normalizedSkillIds.length) return;

    const skills = await this.skillModel.find({ id: { $in: normalizedSkillIds } }).select({ id: 1 }).lean().exec();
    const existingIds = new Set((skills || []).map((item: any) => String(item.id || '').trim()).filter(Boolean));
    const missing = normalizedSkillIds.filter((skillId) => !existingIds.has(skillId));
    if (missing.length) {
      throw new BadRequestException(`Invalid skills: ${missing.join(', ')}`);
    }
  }

  private renderAgentPrompt<TPayload>(
    template: AgentPromptTemplate<TPayload>,
    payload?: TPayload,
  ): string {
    const buildDefaultContent = template.buildDefaultContent as unknown as (input?: TPayload) => string;
    return buildDefaultContent(payload);
  }
}
