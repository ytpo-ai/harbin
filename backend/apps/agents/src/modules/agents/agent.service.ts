import { Injectable, NotFoundException, Logger, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, isValidObjectId } from 'mongoose';
import { Agent, AgentDocument } from '../../../../../src/shared/schemas/agent.schema';
import { AgentProfile, AgentProfileDocument } from '../../../../../src/shared/schemas/agent-profile.schema';
import { Skill, SkillDocument } from '../../schemas/agent-skill.schema';
import { ModelService } from '../models/model.service';
import { ApiKeyService } from '../../../../../src/modules/api-keys/api-key.service';
import { Task, ChatMessage, AIModel } from '../../../../../src/shared/types';
import { ToolService } from '../tools/tool.service';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import { AVAILABLE_MODELS } from '../../../../../src/config/models';
import { MemoService } from '../memos/memo.service';
import { MemoEventBusService } from '../memos/memo-event-bus.service';
import { RuntimeOrchestratorService, RuntimeRunContext } from '../runtime/runtime-orchestrator.service';
import { RuntimeEiSyncService } from '../runtime/runtime-ei-sync.service';
import { OpenCodeExecutionService } from '../opencode/opencode-execution.service';
import { RedisService } from '@libs/infra';
import { AgentExecutionService } from './agent-execution.service';
import { AgentOrchestrationIntentService } from './agent-orchestration-intent.service';
import { AgentOpenCodePolicyService } from './agent-opencode-policy.service';
import { AgentMcpProfileService } from './agent-mcp-profile.service';

export interface AgentContext {
  task: Task;
  teamContext?: any;
  opencodeRuntime?: {
    endpoint?: string;
    endpointRef?: string;
    authEnable?: boolean;
  };
  runtimeLifecycle?: {
    onStarted?: (input: { runId: string; sessionId?: string; traceId: string }) => void | Promise<void>;
    onOpenCodeSession?: (input: { sessionId: string; endpoint?: string; authEnable: boolean }) => void | Promise<void>;
  };
  actor?: {
    employeeId?: string;
    role?: string;
  };
  approval?: {
    approved?: boolean;
    approvalId?: string;
    approverId?: string;
    reason?: string;
  };
  previousMessages: ChatMessage[];
  workingMemory: Map<string, any>;
}

export interface ExecuteTaskResult {
  response: string;
  runId: string;
  sessionId?: string;
}

export interface AgentMcpToolSummary {
  id: string;
  name: string;
  description: string;
  type?: string;
  category?: string;
}

export interface AgentMcpProfile {
  id: string;
  name: string;
  description: string;
  roleId?: string;
  role: string;
  capabilitySet: string[];
  toolSet: AgentMcpToolSummary[];
  exposed: boolean;
  mapKey: string;
}

interface AgentBusinessRole {
  id: string;
  code: string;
  name: string;
  description?: string;
  status: 'active' | 'inactive';
  capabilities?: string[];
  tools?: string[];
  promptTemplate?: string;
}

export interface AgentToolPermissionSet {
  roleId?: string;
  roleCode: string;
  roleName: string;
  roleStatus: 'active' | 'inactive' | 'unknown';
  tools: string[];
  permissions: string[];
  permissionsManual?: string[];
  permissionsDerived?: string[];
  capabilities?: string[];
  exposed: boolean;
  description?: string;
}

export interface AgentMcpMapProfile {
  role: string;
  tools: string[];
  permissions: string[];
  permissionsManual?: string[];
  permissionsDerived?: string[];
  capabilities?: string[];
  exposed: boolean;
  description?: string;
}

interface EnabledAgentSkillContext {
  id: string;
  name: string;
  description: string;
  tags: string[];
  proficiencyLevel: 'beginner' | 'intermediate' | 'advanced' | 'expert';
}

const SKILL_CONTENT_MAX_INJECT_LENGTH = Math.max(500, Number(process.env.SKILL_CONTENT_MAX_INJECT_LENGTH || 4000));

const MODEL_MANAGEMENT_AGENT_NAME = 'Model Management Agent';
const MODEL_MANAGEMENT_ROLE_ID = 'system-model-management-role';
const MODEL_LIST_TOOL_ID = 'builtin.sys-mg.mcp.model-admin.list-models';
const MODEL_ADD_TOOL_ID = 'builtin.sys-mg.mcp.model-admin.add-model';
const MODEL_MANAGEMENT_AGENT_TOOLS = [MODEL_LIST_TOOL_ID, MODEL_ADD_TOOL_ID];
const CODE_DOCS_READER_TOOL_ID = 'builtin.sys-mg.internal.rd-related.docs-read';
const CODE_UPDATES_READER_TOOL_ID = 'builtin.sys-mg.internal.rd-related.updates-read';
const REPO_READ_TOOL_ID = 'builtin.sys-mg.internal.rd-related.repo-read';
const MEMO_MCP_SEARCH_TOOL_ID = 'builtin.sys-mg.internal.memory.search-memo';
const MEMO_MCP_APPEND_TOOL_ID = 'builtin.sys-mg.internal.memory.append-memo';
const ORCHESTRATION_TOOL_IDS = {
  createPlan: 'builtin.sys-mg.mcp.orchestration.create-plan',
  updatePlan: 'builtin.sys-mg.mcp.orchestration.update-plan',
  runPlan: 'builtin.sys-mg.mcp.orchestration.run-plan',
  getPlan: 'builtin.sys-mg.mcp.orchestration.get-plan',
  listPlans: 'builtin.sys-mg.mcp.orchestration.list-plans',
  reassignTask: 'builtin.sys-mg.mcp.orchestration.reassign-task',
  completeHumanTask: 'builtin.sys-mg.mcp.orchestration.complete-human-task',
  createSchedule: 'builtin.sys-mg.mcp.orchestration.create-schedule',
  updateSchedule: 'builtin.sys-mg.mcp.orchestration.update-schedule',
  debugTask: 'builtin.sys-mg.mcp.orchestration.debug-task',
} as const;
const REQUIREMENT_TOOL_IDS = {
  list: 'builtin.sys-mg.mcp.requirement.list',
  get: 'builtin.sys-mg.mcp.requirement.get',
  create: 'builtin.sys-mg.mcp.requirement.create',
  updateStatus: 'builtin.sys-mg.mcp.requirement.update-status',
  assign: 'builtin.sys-mg.mcp.requirement.assign',
  comment: 'builtin.sys-mg.mcp.requirement.comment',
  syncGithub: 'builtin.sys-mg.mcp.requirement.sync-github',
  board: 'builtin.sys-mg.mcp.requirement.board',
} as const;
const LEGACY_TOOL_ID_ALIASES: Record<string, string> = {
  'mcp.orchestration.createPlan': ORCHESTRATION_TOOL_IDS.createPlan,
  'mcp.orchestration.updatePlan': ORCHESTRATION_TOOL_IDS.updatePlan,
  'mcp.orchestration.runPlan': ORCHESTRATION_TOOL_IDS.runPlan,
  'mcp.orchestration.getPlan': ORCHESTRATION_TOOL_IDS.getPlan,
  'mcp.orchestration.listPlans': ORCHESTRATION_TOOL_IDS.listPlans,
  'mcp.orchestration.reassignTask': ORCHESTRATION_TOOL_IDS.reassignTask,
  'mcp.orchestration.completeHumanTask': ORCHESTRATION_TOOL_IDS.completeHumanTask,
  'mcp.orchestration.createSchedule': ORCHESTRATION_TOOL_IDS.createSchedule,
  'mcp.orchestration.updateSchedule': ORCHESTRATION_TOOL_IDS.updateSchedule,
  'mcp.orchestration.debugTask': ORCHESTRATION_TOOL_IDS.debugTask,
  'mcp.model.list': MODEL_LIST_TOOL_ID,
  'mcp.model.add': MODEL_ADD_TOOL_ID,
  'mcp.humanOperationLog.list': 'builtin.sys-mg.mcp.audit.list-human-operation-log',
  'builtin.sys-mg.mcp.humanOperationLog.list': 'builtin.sys-mg.mcp.audit.list-human-operation-log',
  'internal.agents.list': 'builtin.sys-mg.internal.agent-master.list-agents',
  'internal.content.extract': 'builtin.data-analysis.internal.content-analysis.extract',
  'internal.web.search': 'builtin.web-retrieval.internal.web-search.exa',
  'internal.web.fetch': 'builtin.web-retrieval.internal.web-fetch.fetch',
};
const DEFAULT_MAX_TOOL_ROUNDS = 30;
const AGENT_ENABLED_SKILL_CACHE_TTL_SECONDS = Math.max(60, Number(process.env.AGENT_ENABLED_SKILL_CACHE_TTL_SECONDS || 300));
const MODEL_MANAGEMENT_AGENT_PROMPT =
  '你是系统内置模型管理Agent。你的职责是维护系统模型库。若用户询问“系统里有哪些模型/当前模型列表”，必须先调用 builtin.sys-mg.mcp.model-admin.list-models 再回答；若用户要求新增模型，必须先确认关键参数（provider/model/id/name/maxTokens），仅当用户明确确认后才调用 builtin.sys-mg.mcp.model-admin.add-model。未确认时严禁写入系统；不得编造模型参数。若需要调用工具，必须只输出且完整闭合标签：<tool_call>{"tool":"tool_id","parameters":{}}</tool_call>。';

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  private readonly legacyBaseUrl = (process.env.LEGACY_SERVICE_URL || 'http://localhost:3001/api').replace(/\/$/, '');
  private readonly roleRequestTimeoutMs = Number(process.env.AGENT_ROLE_REQUEST_TIMEOUT_MS || 8000);

  constructor(
    @InjectModel(Agent.name) private agentModel: Model<AgentDocument>,
    @InjectModel(AgentProfile.name) private agentProfileModel: Model<AgentProfileDocument>,
    @InjectModel(Skill.name) private skillModel: Model<SkillDocument>,
    private readonly modelService: ModelService,
    private readonly apiKeyService: ApiKeyService,
    private readonly toolService: ToolService,
    private readonly memoService: MemoService,
    private readonly memoEventBus: MemoEventBusService,
    private readonly runtimeOrchestrator: RuntimeOrchestratorService,
    private readonly runtimeEiSyncService: RuntimeEiSyncService,
    private readonly openCodeExecutionService: OpenCodeExecutionService,
    private readonly redisService: RedisService,
    private readonly agentExecutionService: AgentExecutionService,
    private readonly agentOrchestrationIntentService: AgentOrchestrationIntentService,
    private readonly agentOpenCodePolicyService: AgentOpenCodePolicyService,
    private readonly agentMcpProfileService: AgentMcpProfileService,
  ) {}

  async seedMcpProfileSeeds(): Promise<void> {
    await this.agentMcpProfileService.ensureMcpProfileSeeds();
  }

  async seedModelManagementAgent(): Promise<void> {
    await this.ensureModelManagementAgent();
  }

  async seedAgentSystemData(): Promise<void> {
    await this.seedMcpProfileSeeds();
    await this.seedModelManagementAgent();
  }

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

    await this.assertRoleExists(agentData.roleId);

    const normalizedData: Omit<Agent, 'id' | 'createdAt' | 'updatedAt'> = {
      ...agentData,
      roleId: agentData.roleId.trim(),
      description: agentData.description?.trim() || `${agentData.name} Agent`,
      systemPrompt: agentData.systemPrompt?.trim() || `You are ${agentData.name}, a helpful AI assistant.`,
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
      personality: agentData.personality || {
        workEthic: 80,
        creativity: 75,
        leadership: 70,
        teamwork: 80,
      },
      learningAbility: agentData.learningAbility ?? 80,
      isActive: agentData.isActive ?? true,
    };

    normalizedData.tools = await this.ensureToolsWithinRolePermissionWhitelist(
      normalizedData.roleId,
      normalizedData.tools || [],
      'create',
    );
    await this.ensureSkillsExist(normalizedData.skills || []);
    normalizedData.permissions = await this.inheritRoleProfilePermissions(normalizedData.roleId, normalizedData.permissions || []);

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
      await this.assertRoleExists(normalizedRoleId);
      normalizedUpdates.roleId = normalizedRoleId;
    } else if (!(existingAgent.roleId || '').trim()) {
      throw new BadRequestException('roleId is required');
    }

    const targetRoleId = hasRoleIdField ? normalizedUpdates.roleId : String(existingAgent.roleId || '').trim();

    const hasToolsField = Object.prototype.hasOwnProperty.call(updates, 'tools');
    if (hasToolsField || hasRoleIdField) {
      const candidateTools = hasToolsField
        ? Array.isArray(updates.tools)
          ? updates.tools
          : []
        : Array.isArray(existingAgent.tools)
          ? existingAgent.tools
          : [];
      normalizedUpdates.tools = await this.ensureToolsWithinRolePermissionWhitelist(
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

    if (hasRoleIdField || hasToolsField || Object.prototype.hasOwnProperty.call(updates, 'permissions')) {
      const basePermissions = Object.prototype.hasOwnProperty.call(updates, 'permissions')
        ? Array.isArray(updates.permissions)
          ? updates.permissions
          : []
        : Array.isArray(existingAgent.permissions)
          ? existingAgent.permissions
          : [];
      normalizedUpdates.permissions = await this.inheritRoleProfilePermissions(targetRoleId, basePermissions);
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
      { new: true }
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

  private async ensureToolsWithinRolePermissionWhitelist(
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
    const whitelist = new Set(this.normalizeToolIds(profile.tools || []));
    const normalizedTools = this.normalizeToolIds(tools || []);
    const invalid = normalizedTools.filter((toolId) => !whitelist.has(toolId));

    if (invalid.length > 0) {
      throw new BadRequestException(
        `Invalid tools for role ${role.code} on ${action}: ${invalid.join(', ')}. ` +
          'Agent.tools must be a subset of the role tool permission set.',
      );
    }

    return normalizedTools;
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

  private async assertOpenCodeExecutionGate(agent: Agent): Promise<void> {
    const executionConfig = this.agentOpenCodePolicyService.parseOpenCodeExecutionConfig(agent.config);
    if (!executionConfig) {
      return;
    }

    const role = await this.assertRoleExists(agent.roleId);
    this.agentOpenCodePolicyService.assertOpenCodeExecutionGate(agent, String(role.code || '').trim(), executionConfig);
  }

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
      const normalizedTools = this.normalizeToolIds(originalTools);
      if (JSON.stringify(originalTools) === JSON.stringify(normalizedTools)) {
        continue;
      }
      await this.agentProfileModel.updateOne({ _id: profile._id }, { $set: { tools: normalizedTools } }).exec();
      profilesUpdated += 1;
    }

    const agents = await this.agentModel.find().select({ _id: 1, tools: 1 }).lean().exec();
    let agentsUpdated = 0;
    for (const agent of agents as any[]) {
      const originalTools = Array.isArray(agent.tools) ? agent.tools : [];
      const normalizedTools = this.normalizeToolIds(originalTools);
      if (JSON.stringify(originalTools) === JSON.stringify(normalizedTools)) {
        continue;
      }
      await this.agentModel.updateOne({ _id: agent._id }, { $set: { tools: normalizedTools } }).exec();
      agentsUpdated += 1;
    }

    return {
      profilesScanned: profiles.length,
      profilesUpdated,
      agentsScanned: agents.length,
      agentsUpdated,
    };
  }

  async deleteAgent(agentId: string): Promise<boolean> {
    const existingAgent = await this.getAgent(agentId);
    if (!existingAgent) {
      return false;
    }
    const result = await this.agentModel.deleteOne({ _id: (existingAgent as any)._id }).exec();
    return Boolean(result.deletedCount && result.deletedCount > 0);
  }

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

  async testAgentConnection(
    agentId: string,
    options?: { model?: AIModel; apiKeyId?: string },
  ): Promise<{
    success: boolean;
    agent?: string;
    model?: string;
    response?: string;
    responseLength?: number;
    duration?: string;
    error?: string;
    note?: string;
    keySource?: 'custom' | 'system';
    timestamp: string;
  }> {
    const agent = await this.getAgent(agentId);
    if (!agent) {
      return {
        success: false,
        error: 'Agent not found',
        timestamp: new Date().toISOString(),
      };
    }

    const modelConfig: AIModel = {
      id: options?.model?.id || agent.model.id,
      name: options?.model?.name || agent.model.name,
      provider: (options?.model?.provider || agent.model.provider) as AIModel['provider'],
      model: options?.model?.model || agent.model.model,
      maxTokens: options?.model?.maxTokens || agent.model.maxTokens || 4096,
      temperature: options?.model?.temperature ?? agent.model.temperature ?? 0.7,
      topP: options?.model?.topP ?? agent.model.topP,
      reasoning: options?.model?.reasoning ?? agent.model.reasoning,
    };

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: agent.systemPrompt || 'You are a helpful AI assistant.',
        timestamp: new Date(),
      },
      {
        role: 'user',
        content: '请回复: Agent Connected to AI Model Successfully',
        timestamp: new Date(),
      },
    ];

    const runModelTest = async (customApiKey?: string) => {
      this.modelService.registerProvider(modelConfig, customApiKey);
      const startTime = Date.now();
      const response = await Promise.race([
        this.modelService.chat(modelConfig.id, messages, {
          temperature: modelConfig.temperature ?? 0.7,
          maxTokens: 128,
        }),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error('模型测试超时（20s）')), 20000),
        ),
      ]);
      return {
        response,
        duration: `${Date.now() - startTime}ms`,
      };
    };

    const isModelNotFoundError = (message: string): boolean => {
      const lower = (message || '').toLowerCase();
      return (
        (lower.includes('not_found_error') && lower.includes('model')) ||
        lower.includes('not found the model') ||
        lower.includes('model not found') ||
        lower === 'not found' ||
        lower.includes('not found (alibaba endpoint=')
      );
    };

    const isAuthError = (message: string): boolean => {
      const lower = (message || '').toLowerCase();
      return lower.includes('401') || lower.includes('invalid authentication') || lower.includes('unauthorized');
    };

    const normalizeProvider = (provider?: string): string => {
      const value = (provider || '').trim().toLowerCase();
      if (value === 'kimi') return 'moonshot';
      if (value === 'claude') return 'anthropic';
      return value;
    };

    // By default, model test uses system env key (e.g. OPENAI_API_KEY).
    // Only use custom key when apiKeyId is explicitly provided.
    const keyId = options?.apiKeyId?.trim() || undefined;

    try {
      if (keyId) {
        const selectedApiKey = await this.apiKeyService.getApiKey(keyId);
        if (!selectedApiKey) {
          return {
            success: false,
            agent: agent.name,
            model: modelConfig.name,
            error: '所选API Key不存在，请重新选择',
            keySource: 'custom',
            timestamp: new Date().toISOString(),
          };
        }

        if (normalizeProvider(selectedApiKey.provider) !== normalizeProvider(modelConfig.provider)) {
          return {
            success: false,
            agent: agent.name,
            model: modelConfig.name,
            error: `所选API Key提供商(${selectedApiKey.provider})与模型提供商(${modelConfig.provider})不匹配`,
            keySource: 'custom',
            timestamp: new Date().toISOString(),
          };
        }

        const customApiKey = await this.apiKeyService.getDecryptedKey(keyId);
        if (!customApiKey) {
          return {
            success: false,
            agent: agent.name,
            model: modelConfig.name,
            error: 'Agent绑定的API Key无效或已失效，请重新选择API Key',
            keySource: 'custom',
            timestamp: new Date().toISOString(),
          };
        }

        try {
          const result = await runModelTest(customApiKey);
          await this.apiKeyService.recordUsage(keyId);
          return {
            success: true,
            agent: agent.name,
            model: modelConfig.name,
            response: result.response,
            responseLength: result.response.length,
            duration: result.duration,
            keySource: 'custom',
            timestamp: new Date().toISOString(),
          };
        } catch (customError) {
          const customMessage = customError instanceof Error ? customError.message : 'Unknown error';
          this.logger.error(`Agent ${agent.name} model test failed with custom key: ${customMessage}`);

          if (isModelNotFoundError(customMessage)) {
            return {
              success: false,
              agent: agent.name,
              model: modelConfig.name,
              error: `当前模型在提供商侧不可用，请切换模型后重试。详细信息：${customMessage}`,
              keySource: 'custom',
              timestamp: new Date().toISOString(),
            };
          }

          if (isAuthError(customMessage)) {
            return {
              success: false,
              agent: agent.name,
              model: modelConfig.name,
              error: `自定义API Key鉴权失败，请检查该Key是否有效/可用。详细信息：${customMessage}`,
              keySource: 'custom',
              timestamp: new Date().toISOString(),
            };
          }

          try {
            const fallbackResult = await runModelTest(undefined);
            return {
              success: true,
              agent: agent.name,
              model: modelConfig.name,
              response: fallbackResult.response,
              responseLength: fallbackResult.response.length,
              duration: fallbackResult.duration,
              keySource: 'system',
              note: `自定义API Key测试失败，已使用系统默认Key回退成功：${customMessage}`,
              timestamp: new Date().toISOString(),
            };
          } catch (fallbackError) {
            const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : 'Unknown error';
            this.logger.error(`Agent ${agent.name} model fallback test failed: ${fallbackMessage}`);
            return {
              success: false,
              agent: agent.name,
              model: modelConfig.name,
              error: `自定义API Key失败: ${customMessage}; 系统默认Key失败: ${fallbackMessage}`,
              keySource: 'custom',
              timestamp: new Date().toISOString(),
            };
          }
        }
      }

      const result = await runModelTest(undefined);
      return {
        success: true,
        agent: agent.name,
        model: modelConfig.name,
        response: result.response,
        responseLength: result.response.length,
        duration: result.duration,
        keySource: 'system',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Agent ${agent.name} model test failed: ${message}`);
      return {
        success: false,
        agent: agent.name,
        model: modelConfig.name,
        error: message,
        keySource: keyId ? 'custom' : 'system',
        timestamp: new Date().toISOString(),
      };
    }
  }

  async executeTask(agentId: string, task: Task, context?: Partial<AgentContext>): Promise<string> {
    const detailed = await this.executeTaskDetailed(agentId, task, context);
    return detailed.response;
  }

  async executeTaskDetailed(
    agentId: string,
    task: Task,
    context?: Partial<AgentContext>,
  ): Promise<ExecuteTaskResult> {
    const agent = await this.getAgent(agentId);
    if (!agent) {
      throw new NotFoundException(`Agent not found: ${agentId}`);
    }

    await this.assertOpenCodeExecutionGate(agent);

    const taskStartAt = Date.now();
    const taskId = this.ensureTaskRuntime(task);
    const runtimeAgentId = this.agentExecutionService.resolveRuntimeAgentId(agent as any, agentId);
    this.logger.log(
      `[task_start] agent=${agent.name} agentId=${runtimeAgentId} taskId=${taskId} title="${this.compactLogText(task.title)}" type=${task.type} priority=${task.priority} modelId=${agent.model?.id || 'unknown'} provider=${agent.model?.provider || 'unknown'} hasCustomApiKey=${Boolean(agent.apiKeyId)}`,
    );

    await this.runMemoOperation('task_start_upsert_todo', taskId, async () => {
      await this.memoService.upsertTaskTodo(agent.id || agentId, {
        id: taskId,
        title: task.title,
        description: task.description,
        status: 'running',
        sourceType: 'orchestration_task',
      });
    });
    await this.runMemoOperation('task_start_record_behavior', taskId, async () => {
      await this.memoService.recordBehavior({
        agentId: agent.id || agentId,
        event: 'task_start',
        taskId,
        title: `Task start: ${task.title}`,
        details: `taskType=${task.type}, priority=${task.priority}, description=${task.description}`,
        tags: [task.type, task.priority, 'task_start'],
      });
    });

    this.logger.log(
      `[task_context] taskId=${taskId} previousMessages=${task.messages?.length || 0} hasTeamContext=${Boolean(context?.teamContext)}`,
    );

    const agentContext: AgentContext = {
      task,
      previousMessages: task.messages || [],
      workingMemory: new Map(),
      teamContext: context?.teamContext,
      ...context,
    };

    const enabledSkills = await this.getEnabledSkillsForAgent(agent, agentId);
    this.logger.log(
      `[task_skills] taskId=${taskId} enabledSkills=${enabledSkills.length} skillNames=${enabledSkills.map((item) => item.name).join('|') || 'none'}`,
    );
    const messages = await this.buildMessages(agent, task, agentContext, enabledSkills);
    this.logger.log(`[task_messages] taskId=${taskId} compiledMessages=${messages.length}`);

    const openCodeExecutionConfig = this.agentOpenCodePolicyService.parseOpenCodeExecutionConfig(agent.config);
    const role = await this.getRoleById(agent.roleId);
    const roleCode = role?.code ? String(role.code).trim() : undefined;
    const executionChannel: 'native' | 'opencode' = openCodeExecutionConfig ? 'opencode' : 'native';
    const executionData: Record<string, unknown> = {
      modelProvider: agent.model?.provider,
      modelId: agent.model?.id,
      modelName: agent.model?.name,
      model: agent.model?.model,
      openCode: {
        enabled: Boolean(openCodeExecutionConfig),
        strictExecution: Boolean(openCodeExecutionConfig),
        projectDirectory: openCodeExecutionConfig?.projectDirectory,
        endpoint: openCodeExecutionConfig?.endpoint,
        endpointRef: openCodeExecutionConfig?.endpointRef,
        authEnable: openCodeExecutionConfig?.authEnable,
        modelPolicy: openCodeExecutionConfig?.modelPolicy,
      },
    };

    const runtimeContext = await this.agentExecutionService.startRuntimeExecution({
      runtimeAgentId,
      agentName: agent.name,
      task,
      messages,
      mode: 'detailed',
      roleCode,
      executionChannel,
      executionData,
      teamContext: context?.teamContext,
    });

    await context?.runtimeLifecycle?.onStarted?.({
      runId: runtimeContext.runId,
      sessionId: runtimeContext.sessionId,
      traceId: runtimeContext.traceId,
    });

    await this.agentExecutionService.appendSystemMessagesToSession(runtimeContext, messages, agent.id || agentId);

    try {
      await this.agentOpenCodePolicyService.applyAgentBudgetGate(agent, runtimeAgentId, task, runtimeContext, context);
      let response = '';

      // 确保模型已注册 - 类型转换
      const modelConfig = this.agentExecutionService.buildModelConfig(agent.model as any);

      // 获取自定义API Key（如果配置了）
      const customApiKey = await this.resolveCustomApiKey(agent, taskId, 'task');

      if (openCodeExecutionConfig) {
        const sessionConfig: Record<string, unknown> = {
          metadata: {
            taskId,
            agentId: runtimeAgentId,
            source: 'agents-runtime',
          },
        };
        if (openCodeExecutionConfig.projectDirectory) {
          sessionConfig.directory = openCodeExecutionConfig.projectDirectory;
          sessionConfig.projectPath = openCodeExecutionConfig.projectDirectory;
        }

        const resolvedOpenCodeRuntime = this.resolveOpenCodeRuntimeOptions(openCodeExecutionConfig, context?.opencodeRuntime);
        this.logResolvedOpenCodeRuntime(taskId, 'detailed', resolvedOpenCodeRuntime);

        const openCodeResult = await this.openCodeExecutionService.executeWithRuntimeBridge({
          runtimeContext,
          agentId: runtimeAgentId,
          taskId,
          taskPrompt: this.resolveLatestUserContent(task, messages),
          title: task.title,
          sessionConfig,
          model: {
            providerID: modelConfig.provider,
            modelID: modelConfig.model,
          },
          runtime: {
            baseUrl: resolvedOpenCodeRuntime.baseUrl,
            authEnable: resolvedOpenCodeRuntime.authEnable,
            requestTimeoutMs: openCodeExecutionConfig.requestTimeoutMs,
          },
        });

        response = openCodeResult.response;
      } else {
        // 注册provider（使用自定义key或默认key）
        this.modelService.ensureProviderWithKey(modelConfig, customApiKey);

        response = await this.executeWithToolCalling(
          agent,
          task,
          messages,
          modelConfig,
          runtimeContext,
          {
            teamContext: context?.teamContext,
            actor: context?.actor,
            taskType: task.type,
            teamId: task.teamId,
          },
        );
      }

      this.logger.log(
        `[task_success] agent=${agent.name} taskId=${taskId} responseLength=${response.length} durationMs=${Date.now() - taskStartAt}`,
      );

      await this.runMemoOperation('task_complete_record_behavior', taskId, async () => {
        await this.memoService.recordBehavior({
          agentId: agent.id || agentId,
          event: 'task_complete',
          taskId,
          title: `Task complete: ${task.title}`,
          details: this.buildTaskResultMemo(response),
          tags: [task.type, 'task_complete'],
        });
      });
      await this.runMemoOperation('task_complete_todo', taskId, async () => {
        await this.memoService.completeTaskTodo(agent.id || agentId, taskId, 'Task finished by agent runtime', 'success');
      });
      this.memoEventBus.emit({
        name: 'task.completed',
        agentId: agent.id || agentId,
        memoKinds: ['history', 'todo', 'draft'],
        taskId,
        summary: this.compactLogText(response, 240),
      });

      // 更新任务消息历史
      task.messages.push({
        role: 'assistant',
        content: response,
        timestamp: new Date(),
        metadata: {
          agentId: agent.id,
          agentName: agent.name,
          usedSkillIds: enabledSkills.map((item) => item.id),
          usedSkillNames: enabledSkills.map((item) => item.name),
          usedSkills: enabledSkills.map((item) => ({
            id: item.id,
            name: item.name,
            proficiencyLevel: item.proficiencyLevel,
          })),
        },
      });

      await this.agentExecutionService.completeRuntimeExecution(runtimeContext, runtimeAgentId, taskId, response);
      await this.runtimeEiSyncService.scheduleRunSync(runtimeContext.runId);

      return {
        response,
        runId: runtimeContext.runId,
        sessionId: runtimeContext.sessionId,
      };
    } catch (error) {
      const logError = this.toLogError(error);
      this.logger.error(
        `[task_failed] agent=${agent.name} taskId=${taskId} durationMs=${Date.now() - taskStartAt} error=${logError.message}`,
        logError.stack,
      );
      await this.runMemoOperation('task_failed_record_behavior', taskId, async () => {
        await this.memoService.recordBehavior({
          agentId: agent.id || agentId,
          event: 'task_failed',
          taskId,
          title: `Task failed: ${task.title}`,
          details: error instanceof Error ? error.message : String(error || 'Unknown error'),
          tags: [task.type, 'task_failed'],
        });
      });
      const normalizedError = logError.message.toLowerCase();
      const controlInterrupted =
        normalizedError.includes('cancelled') ||
        normalizedError.includes('paused') ||
        normalizedError.includes('already completed');
      await this.runMemoOperation('task_failed_todo', taskId, async () => {
        await this.memoService.completeTaskTodo(
          agent.id || agentId,
          taskId,
          controlInterrupted ? 'Task interrupted before completion' : logError.message,
          controlInterrupted ? 'cancelled' : 'failed',
        );
      });
      if (!controlInterrupted) {
        await this.agentExecutionService.failRuntimeExecution(runtimeContext, runtimeAgentId, taskId, logError.message);
        await this.runtimeEiSyncService.scheduleRunSync(runtimeContext.runId);
      }
      throw error;
    } finally {
      await this.agentExecutionService.releaseRuntimeExecution(runtimeContext);
    }
  }

  async executeTaskWithStreaming(
    agentId: string,
    task: Task,
    onToken: (token: string) => void,
    context?: Partial<AgentContext>
  ): Promise<ExecuteTaskResult> {
    const agent = await this.getAgent(agentId);
    if (!agent) {
      throw new NotFoundException(`Agent not found: ${agentId}`);
    }

    await this.assertOpenCodeExecutionGate(agent);

    const taskStartAt = Date.now();
    const taskId = this.ensureTaskRuntime(task);
    const runtimeAgentId = this.agentExecutionService.resolveRuntimeAgentId(agent as any, agentId);
    this.logger.log(
      `[stream_task_start] agent=${agent.name} agentId=${runtimeAgentId} taskId=${taskId} title="${this.compactLogText(task.title)}" modelId=${agent.model?.id || 'unknown'} provider=${agent.model?.provider || 'unknown'}`,
    );

    const agentContext: AgentContext = {
      task,
      previousMessages: task.messages || [],
      workingMemory: new Map(),
      teamContext: context?.teamContext,
      ...context,
    };

    const enabledSkills = await this.getEnabledSkillsForAgent(agent, agentId);
    const messages = await this.buildMessages(agent, task, agentContext, enabledSkills);

    const openCodeExecutionConfig = this.agentOpenCodePolicyService.parseOpenCodeExecutionConfig(agent.config);
    const role = await this.getRoleById(agent.roleId);
    const roleCode = role?.code ? String(role.code).trim() : undefined;
    const executionChannel: 'native' | 'opencode' = openCodeExecutionConfig ? 'opencode' : 'native';
    const executionData: Record<string, unknown> = {
      mode: 'streaming',
      modelProvider: agent.model?.provider,
      modelId: agent.model?.id,
      modelName: agent.model?.name,
      model: agent.model?.model,
      openCode: {
        enabled: Boolean(openCodeExecutionConfig),
        strictExecution: Boolean(openCodeExecutionConfig),
        projectDirectory: openCodeExecutionConfig?.projectDirectory,
        endpoint: openCodeExecutionConfig?.endpoint,
        endpointRef: openCodeExecutionConfig?.endpointRef,
        authEnable: openCodeExecutionConfig?.authEnable,
        modelPolicy: openCodeExecutionConfig?.modelPolicy,
      },
    };

    const runtimeContext = await this.agentExecutionService.startRuntimeExecution({
      runtimeAgentId,
      agentName: agent.name,
      task,
      messages,
      mode: 'streaming',
      roleCode,
      executionChannel,
      executionData,
      teamContext: context?.teamContext,
    });

    await context?.runtimeLifecycle?.onStarted?.({
      runId: runtimeContext.runId,
      sessionId: runtimeContext.sessionId,
      traceId: runtimeContext.traceId,
    });

    await this.agentExecutionService.appendSystemMessagesToSession(runtimeContext, messages, agent.id || agentId);

    let fullResponse = '';
    let tokenChunks = 0;
    let streamSequence = 1;
    let runtimeInterrupted = false;
    try {
      await this.agentOpenCodePolicyService.applyAgentBudgetGate(agent, runtimeAgentId, task, runtimeContext, context);
      await this.runtimeOrchestrator.assertRunnable(runtimeContext.runId);
      if (openCodeExecutionConfig) {
        const resolvedOpenCodeRuntime = this.resolveOpenCodeRuntimeOptions(openCodeExecutionConfig, context?.opencodeRuntime);
        this.logResolvedOpenCodeRuntime(taskId, 'streaming', resolvedOpenCodeRuntime);

        const sessionConfig: Record<string, unknown> = {
          metadata: {
            taskId,
            agentId: runtimeAgentId,
            source: 'agents-runtime',
            mode: 'streaming',
          },
        };
        if (openCodeExecutionConfig.projectDirectory) {
          sessionConfig.directory = openCodeExecutionConfig.projectDirectory;
          sessionConfig.projectPath = openCodeExecutionConfig.projectDirectory;
        }

        const openCodeResult = await this.openCodeExecutionService.executeWithRuntimeBridge({
          runtimeContext,
          agentId: runtimeAgentId,
          taskId,
          taskPrompt: this.resolveLatestUserContent(task, messages),
          title: task.title,
          sessionConfig,
          model: {
            providerID: agent.model.provider,
            modelID: agent.model.model,
          },
          runtime: {
            baseUrl: resolvedOpenCodeRuntime.baseUrl,
            authEnable: resolvedOpenCodeRuntime.authEnable,
            requestTimeoutMs: openCodeExecutionConfig.requestTimeoutMs,
          },
          onDelta: async (delta) => {
            if (!delta) return;
            tokenChunks += 1;
            fullResponse += delta;
            onToken(delta);
          },
          onSessionReady: async (sessionId) => {
            await context?.runtimeLifecycle?.onOpenCodeSession?.({
              sessionId,
              endpoint: resolvedOpenCodeRuntime.baseUrl,
              authEnable: resolvedOpenCodeRuntime.authEnable,
            });
          },
        });

        if (!fullResponse && openCodeResult.response) {
          fullResponse = openCodeResult.response;
          tokenChunks += 1;
          onToken(openCodeResult.response);
        }
      } else {
        // 获取自定义API Key（如果配置了）
        const customApiKey = await this.resolveCustomApiKey(agent, taskId, 'stream_task');

        // 确保provider已注册（使用自定义key或默认key）
        const modelConfig = this.agentExecutionService.buildModelConfig(agent.model as any);
        this.modelService.ensureProviderWithKey(modelConfig, customApiKey);

        await this.modelService.streamingChat(
          agent.model.id,
          messages,
          (token) => {
            if (runtimeInterrupted) {
              throw new Error('Runtime run interrupted');
            }
            fullResponse += token;
            tokenChunks += 1;
            onToken(token);
            if (tokenChunks % 20 === 0) {
              void this.runtimeOrchestrator.assertRunnable(runtimeContext.runId).catch(() => {
                runtimeInterrupted = true;
              });
            }
            void this.runtimeOrchestrator
              .recordLlmDelta({
                runId: runtimeContext.runId,
                agentId: runtimeAgentId,
                messageId: runtimeContext.userMessageId,
                traceId: runtimeContext.traceId,
                sequence: streamSequence++,
                delta: token,
                sessionId: runtimeContext.sessionId,
                taskId,
              })
              .catch((eventError) => {
                const eventMessage = eventError instanceof Error ? eventError.message : String(eventError || 'unknown');
                this.logger.warn(`[stream_llm_delta_event_failed] taskId=${taskId} error=${eventMessage}`);
              });
          },
          {
            temperature: agent.model.temperature,
            maxTokens: agent.model.maxTokens,
          }
        );
      }

      await this.agentExecutionService.completeRuntimeExecution(runtimeContext, runtimeAgentId, taskId, fullResponse);
      await this.runtimeEiSyncService.scheduleRunSync(runtimeContext.runId);
    } catch (error) {
      const logError = this.toLogError(error);
      this.logger.error(
        `[stream_task_failed] agent=${agent.name} taskId=${taskId} durationMs=${Date.now() - taskStartAt} tokenChunks=${tokenChunks} error=${logError.message}`,
        logError.stack,
      );
      const normalizedError = logError.message.toLowerCase();
      const controlInterrupted =
        normalizedError.includes('cancelled') ||
        normalizedError.includes('paused') ||
        normalizedError.includes('already completed');
      if (!controlInterrupted) {
        await this.agentExecutionService.failRuntimeExecution(runtimeContext, runtimeAgentId, taskId, logError.message);
        await this.runtimeEiSyncService.scheduleRunSync(runtimeContext.runId);
      }
      throw error;
    } finally {
      await this.agentExecutionService.releaseRuntimeExecution(runtimeContext);
    }

    this.logger.log(
      `[stream_task_success] agent=${agent.name} taskId=${taskId} durationMs=${Date.now() - taskStartAt} tokenChunks=${tokenChunks} responseLength=${fullResponse.length}`,
    );

    // 更新任务消息历史
    task.messages.push({
      role: 'assistant',
      content: fullResponse,
      timestamp: new Date(),
      metadata: {
        agentId: agent.id,
        agentName: agent.name,
        usedSkillIds: enabledSkills.map((item) => item.id),
        usedSkillNames: enabledSkills.map((item) => item.name),
        usedSkills: enabledSkills.map((item) => ({
          id: item.id,
          name: item.name,
          proficiencyLevel: item.proficiencyLevel,
        })),
      },
    });

    return {
      response: fullResponse,
      runId: runtimeContext.runId,
      sessionId: runtimeContext.sessionId,
    };
  }

  async cancelRuntimeRun(runId: string, reason?: string): Promise<void> {
    if (!String(runId || '').trim()) {
      return;
    }
    await this.runtimeOrchestrator.cancelRunWithActor(runId, {
      actorId: 'agent-task-worker',
      actorType: 'system',
      reason: reason || 'user_cancel',
    });
  }

  async cancelOpenCodeSession(
    sessionId: string,
    runtime?: {
      endpoint?: string;
      authEnable?: boolean;
    },
  ): Promise<boolean> {
    if (!String(sessionId || '').trim()) {
      return false;
    }

    return this.openCodeExecutionService.cancelSession(sessionId, {
      baseUrl: runtime?.endpoint,
      authEnable: runtime?.authEnable,
    });
  }

  private resolveOpenCodeRuntimeOptions(
    executionConfig: {
      endpoint?: string;
      endpointRef?: string;
      authEnable: boolean;
    },
    runtime?: {
      endpoint?: string;
      endpointRef?: string;
      authEnable?: boolean;
    },
  ): {
    baseUrl?: string;
    authEnable: boolean;
    source: 'agent_config_endpoint' | 'agent_config_endpoint_ref' | 'runtime_endpoint' | 'runtime_endpoint_ref' | 'env_default';
  } {
    const endpoint = String(executionConfig.endpoint || '').trim();
    if (endpoint) {
      return {
        baseUrl: endpoint,
        authEnable: executionConfig.authEnable,
        source: 'agent_config_endpoint',
      };
    }

    const endpointRef = String(executionConfig.endpointRef || '').trim();
    if (endpointRef) {
      return {
        baseUrl: endpointRef,
        authEnable: executionConfig.authEnable,
        source: 'agent_config_endpoint_ref',
      };
    }

    const runtimeEndpoint = String(runtime?.endpoint || '').trim();
    if (runtimeEndpoint) {
      return {
        baseUrl: runtimeEndpoint,
        authEnable: runtime?.authEnable ?? executionConfig.authEnable,
        source: 'runtime_endpoint',
      };
    }

    const runtimeEndpointRef = String(runtime?.endpointRef || '').trim();
    if (runtimeEndpointRef) {
      return {
        baseUrl: runtimeEndpointRef,
        authEnable: runtime?.authEnable ?? executionConfig.authEnable,
        source: 'runtime_endpoint_ref',
      };
    }

    return {
      baseUrl: undefined,
      authEnable: executionConfig.authEnable,
      source: 'env_default',
    };
  }

  private logResolvedOpenCodeRuntime(
    taskId: string,
    mode: 'detailed' | 'streaming',
    runtime: {
      baseUrl?: string;
      authEnable: boolean;
      source: 'agent_config_endpoint' | 'agent_config_endpoint_ref' | 'runtime_endpoint' | 'runtime_endpoint_ref' | 'env_default';
    },
  ): void {
    this.logger.log(
      `[opencode_runtime_resolved] taskId=${taskId} mode=${mode} source=${runtime.source} baseUrl=${runtime.baseUrl || 'env'} authEnable=${runtime.authEnable}`,
    );
  }

  private async buildMessages(
    agent: Agent,
    task: Task,
    context: AgentContext,
    enabledSkills: EnabledAgentSkillContext[],
  ): Promise<ChatMessage[]> {
    const messages: ChatMessage[] = [];

    // 系统提示
    messages.push({
      role: 'system',
      content: agent.systemPrompt,
      timestamp: new Date(),
    });

    // 任务上下文（去重：若 description 已存在于 user 消息中则不重复注入）
    const descAlreadyInHistory =
      task.description &&
      task.description.length > 50 &&
      context.previousMessages.some(
        (msg) =>
          msg.role === 'user' &&
          typeof msg.content === 'string' &&
          msg.content.includes(task.description.slice(0, 100)),
      );
    messages.push({
      role: 'system',
      content: descAlreadyInHistory
        ? `任务信息:\n标题: ${task.title}\n类型: ${task.type}\n优先级: ${task.priority}`
        : `任务信息:\n标题: ${task.title}\n描述: ${task.description}\n类型: ${task.type}\n优先级: ${task.priority}`,
      timestamp: new Date(),
    });

    // 团队上下文
    if (context.teamContext) {
      messages.push({
        role: 'system',
        content: `团队上下文: ${JSON.stringify(context.teamContext)}`,
        timestamp: new Date(),
      });
    }

    if (enabledSkills.length > 0) {
      const skillLines = enabledSkills
        .map(
          (skill) =>
            `- ${skill.name} (id=${skill.id}, proficiency=${skill.proficiencyLevel}) | description=${skill.description} | tags=${(skill.tags || []).join(', ') || 'N/A'}`,
        )
        .join('\n');

      messages.push({
        role: 'system',
        content:
          `Enabled Skills for this agent:\n${skillLines}\n\n` +
          '请优先基于以上已启用技能的能力边界来拆解与执行任务，并在输出中体现对应技能的方法论。',
        timestamp: new Date(),
      });

      // 渐进式激活：对匹配当前任务的 skill 按需加载 content 并注入 prompt
      for (const skill of enabledSkills) {
        if (this.shouldActivateSkillContent(skill, task)) {
          try {
            const skillDoc = await this.skillModel
              .findOne({ id: skill.id }, { content: 1, contentSize: 1 })
              .lean()
              .exec();
            const rawContent = (skillDoc as any)?.content;
            if (rawContent && typeof rawContent === 'string' && rawContent.trim()) {
              const content =
                rawContent.length > SKILL_CONTENT_MAX_INJECT_LENGTH
                  ? rawContent.slice(0, SKILL_CONTENT_MAX_INJECT_LENGTH) +
                    '\n\n[... 内容已截断，可通过工具查询完整版本]'
                  : rawContent;
              messages.push({
                role: 'system',
                content: `【激活技能方法论 - ${skill.name}】\n\n${content}`,
                timestamp: new Date(),
              });
              this.logger.log(
                `[skill_activated] skill=${skill.name} id=${skill.id} contentSize=${rawContent.length} taskType=${task.type}`,
              );
            }
          } catch (err: any) {
            this.logger.warn(
              `[skill_content_load_failed] skill=${skill.id} error=${err?.message || err}`,
            );
          }
        }
      }
    }

    const allowedToolIds = await this.getAllowedToolIds(agent);
    const assignedTools = await this.toolService.getToolsByIds(allowedToolIds);
    if (assignedTools.length > 0) {
      const toolSpecs = assignedTools.map((tool) => ({
        id: (tool as any).canonicalId || this.normalizeToolId((tool as any).id),
        name: tool.name,
        description: tool.description,
        parameters: tool.implementation?.parameters || {},
      }));

      messages.push({
        role: 'system',
        content: `你可以调用以下工具（仅限这些）:\n${JSON.stringify(toolSpecs)}\n\n当你需要调用工具时，必须只输出以下格式，不要添加任何额外文本:\n<tool_call>{"tool":"tool_id","parameters":{}}</tool_call>\n\n工具结果会作为系统消息返回给你，收到后继续完成最终回答。`,
        timestamp: new Date(),
      });

      messages.push({
        role: 'system',
        content: `当你工作时，优先考虑使用已有工具来解决问题，当你使用工具前，务必先确定自己足够的权限，当你需要某个工具而你没有该工具时，你可以询问是否可以给添加工具。\n`,
        timestamp: new Date(),
      });

      const toolPromptMessages = this.buildToolPromptMessages(assignedTools);
      for (const promptContent of toolPromptMessages) {
        messages.push({
          role: 'system',
          content: promptContent,
          timestamp: new Date(),
        });
      }
    }

    const memoryContext = await this.memoService.getTaskMemoryContext(
      agent.id || '',
      `${task.title}\n${task.description}\n${task.messages?.slice(-1)[0]?.content || ''}`,
    );
    if (memoryContext) {
      messages.push({
        role: 'system',
        content:
          `以下是从备忘录中按需检索到的相关记忆（渐进加载摘要）:\n${memoryContext}\n\n` +
          '请优先参考这些记忆，并在必要时调用 builtin.sys-mg.internal.memory.search-memo 获取更完整上下文；若有新结论可调用 builtin.sys-mg.internal.memory.append-memo 追加沉淀。',
        timestamp: new Date(),
      });
    }

    const identityMemos = await this.memoService.getIdentityMemos(agent.id || '');
    if (identityMemos.length > 0) {
      const identityContent = identityMemos
        .map((memo) => {
          const content = String(memo.content || '');
          const topic = memo.payload?.topic ? String(memo.payload.topic) : '';
          return `## ${memo.title}${topic ? ` (${topic})` : ''}\n\n${content}`;
        })
        .join('\n\n---\n\n');
      messages.push({
        role: 'system',
        content: `【身份与职责】以下是你的身份定义，请始终以此为准：\n\n${identityContent}`,
        timestamp: new Date(),
      });
    }

    // 历史消息
    messages.push(...context.previousMessages);

    return messages;
  }

  private buildToolPromptMessages(
    assignedTools: Array<{
      id?: string;
      canonicalId?: string;
      prompt?: string;
    }>,
  ): string[] {
    const seen = new Set<string>();
    return assignedTools
      .map((tool) => {
        const toolId = String(tool.canonicalId || tool.id || '').trim();
        const prompt = String(tool.prompt || '').trim();
        return { toolId, prompt };
      })
      .filter((item) => item.toolId && item.prompt)
      .sort((a, b) => a.toolId.localeCompare(b.toolId))
      .map((item) => `工具使用策略（${item.toolId}）:\n${item.prompt}`)
      .filter((message) => {
        if (seen.has(message)) return false;
        seen.add(message);
        return true;
      });
  }

  private async getEnabledSkillsForAgent(agent: Agent, agentId: string): Promise<EnabledAgentSkillContext[]> {
    const candidateAgentIds = this.uniqueStrings([agentId, agent.id || '']);
    if (!candidateAgentIds.length) {
      return [];
    }

    for (const candidateAgentId of candidateAgentIds) {
      const cached = await this.redisService.get(this.agentEnabledSkillCacheKey(candidateAgentId));
      if (!cached) continue;
      try {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed?.items)) {
          return parsed.items as EnabledAgentSkillContext[];
        }
      } catch {
        // ignore cache parse error and fallback to DB
      }
    }

    const agentSkillIds = this.uniqueStrings((agent.skills || []).filter(Boolean));
    if (!agentSkillIds.length) {
      return [];
    }

    const skills = await this.skillModel
      .find({ id: { $in: agentSkillIds }, status: { $in: ['active', 'experimental'] } })
      .exec();

    const contexts: EnabledAgentSkillContext[] = skills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      tags: skill.tags || [],
      proficiencyLevel: 'beginner',
    }));

    const payload = JSON.stringify({
      agentIds: candidateAgentIds,
      items: contexts,
      updatedAt: new Date().toISOString(),
    });
    await Promise.all(
      candidateAgentIds.map((candidateAgentId) =>
        this.redisService.set(
          this.agentEnabledSkillCacheKey(candidateAgentId),
          payload,
          AGENT_ENABLED_SKILL_CACHE_TTL_SECONDS,
        ),
      ),
    );

    return contexts;
  }

  private agentEnabledSkillCacheKey(agentId: string): string {
    return `agent:enabled-skills:${agentId}`;
  }

  /**
   * Determine whether a skill's full content should be loaded and injected into
   * the prompt for the current task. This keeps the default behaviour lightweight
   * (summary-only) while activating the full methodology document when the task
   * context signals a match.
   */
  private shouldActivateSkillContent(
    skill: EnabledAgentSkillContext,
    task: Task,
  ): boolean {
    const taskText = `${task.title || ''} ${task.description || ''} ${task.type || ''}`.toLowerCase();
    const tags = (skill.tags || []).map((t) => t.toLowerCase());

    // Rule 1: task.type directly matches a skill tag
    if (task.type && tags.some((tag) => tag.includes(task.type!))) {
      return true;
    }

    // Rule 2: planning-type tasks + skill has planning/orchestration/guard tags
    if (task.type === 'planning') {
      const planningSignals = ['planning', 'orchestration', 'guard', 'planner'];
      if (tags.some((tag) => planningSignals.some((s) => tag.includes(s)))) {
        return true;
      }
    }

    // Rule 3: skill name or tags appear as keywords in task text (need >= 2 hits)
    const skillSignals = [skill.name.toLowerCase(), ...tags];
    let hitCount = 0;
    for (const signal of skillSignals) {
      const words = signal.split(/[\s\-_]+/).filter((w) => w.length >= 3);
      if (words.some((word) => taskText.includes(word))) {
        hitCount++;
      }
      if (hitCount >= 2) return true;
    }

    return false;
  }

  private async executeWithToolCalling(
    agent: Agent,
    task: Task,
    initialMessages: ChatMessage[],
    modelConfig: AIModel,
    runtimeContext?: RuntimeRunContext,
    executionContext?: {
      teamContext?: any;
      actor?: {
        employeeId?: string;
        role?: string;
      };
      taskType?: string;
      teamId?: string;
    },
  ): Promise<string> {
    const maxToolRounds = this.getMaxToolRounds();
    const messages = [...initialMessages];
    const assignedToolIds = new Set(await this.getAllowedToolIds(agent));
    const agentRuntimeId = agent.id || (agent as any)._id?.toString?.() || '';
    const executedToolIds = new Set<string>();

    const deterministicModelManagementResult = await this.tryHandleModelManagementDeterministically(
      agent,
      task,
      messages,
      assignedToolIds,
      agentRuntimeId,
    );
    if (deterministicModelManagementResult) {
      return deterministicModelManagementResult;
    }

    const forcedOrchestrationAction = this.agentOrchestrationIntentService.extractForcedOrchestrationAction(
      task,
      messages,
      assignedToolIds,
      executionContext,
    );
    if (!forcedOrchestrationAction && this.agentOrchestrationIntentService.hasMeetingOrchestrationIntent(task, messages, executionContext)) {
      const hasAnyOrchestrationTool = this.agentOrchestrationIntentService.hasAnyOrchestrationTool(assignedToolIds);
      if (!hasAnyOrchestrationTool) {
        return '我识别到你希望执行计划编排，但当前这个 Agent 未分配 builtin.sys-mg.mcp.orchestration.* 工具。请在 Agent 管理中为其绑定对应 MCP Profile 工具后重试。';
      }
    }
    if (forcedOrchestrationAction) {
      this.logger.log(
        `Forced tool call triggered: ${forcedOrchestrationAction.tool} (agent=${agent.name}, reason=${forcedOrchestrationAction.reason})`,
      );
      try {
        const execution = await this.toolService.executeTool(
          forcedOrchestrationAction.tool,
          agentRuntimeId,
          forcedOrchestrationAction.parameters,
          task.id,
          executionContext,
        );
        return this.agentOrchestrationIntentService.formatForcedOrchestrationAnswer(
          forcedOrchestrationAction.tool,
          this.extractToolResultPayload(execution),
          forcedOrchestrationAction.parameters,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown error';
        this.logger.warn(`Forced tool call ${forcedOrchestrationAction.tool} failed: ${message}`);
        return `我已识别到你希望执行计划编排，并尝试调用 ${forcedOrchestrationAction.tool}，但执行失败（${message}）。请补充必要参数（如 planId/taskId）后重试。`;
      }
    }

    for (let round = 0; round <= maxToolRounds; round++) {
      if (runtimeContext) {
        await this.runtimeOrchestrator.assertRunnable(runtimeContext.runId);
      }
      let response: string;
      const roundStartAt = Date.now();
      this.logger.log(
        `[tool_round_start] agent=${agent.name} taskId=${task.id} round=${round + 1}/${maxToolRounds + 1} messageCount=${messages.length} modelId=${modelConfig.id}`,
      );
      try {
        response = await this.modelService.chat(modelConfig.id, messages, {
          temperature: modelConfig.temperature,
          maxTokens: modelConfig.maxTokens,
        });
        this.logger.log(
          `[tool_round_response] agent=${agent.name} taskId=${task.id} round=${round + 1} durationMs=${Date.now() - roundStartAt} responseLength=${response.length}`,
        );
      } catch (error) {
        if (this.isModelTimeoutError(error)) {
          this.logger.warn(
            `[tool_round_timeout] agent=${agent.name} taskId=${task.id} round=${round + 1} durationMs=${Date.now() - roundStartAt}`,
          );
          return '当前模型请求超时（上游响应过慢）。请稍后重试，或将问题拆小后再试。';
        }
        throw error;
      }

      const toolCall = this.extractToolCall(response);
      if (!toolCall) {
        if (this.shouldForceModelManagementGrounding(agent, task, messages, response, executedToolIds)) {
          messages.push({
            role: 'system',
            content:
                '你正在处理模型管理请求。禁止在未调用并拿到工具结果时声称“已添加成功/已完成添加”。请立即调用 builtin.sys-mg.mcp.model-admin.add-model 执行写入，并调用 builtin.sys-mg.mcp.model-admin.list-models 验证后再回答。若工具失败，请明确说明失败原因。',
            timestamp: new Date(),
          });
          continue;
        }
        return this.stripToolCallMarkup(response);
      }

      messages.push({
        role: 'assistant',
        content: response,
        timestamp: new Date(),
      });

      const normalizedToolId = this.normalizeToolId(toolCall.tool);
      if (!assignedToolIds.has(normalizedToolId)) {
        this.logger.warn(
          `[tool_denied] agent=${agent.name} taskId=${task.id} round=${round + 1} tool=${normalizedToolId}`,
        );
        messages.push({
          role: 'system',
          content: `工具调用被拒绝: agent 未分配工具 ${normalizedToolId}。请在已授权工具内重新尝试，或直接给出不依赖该工具的回答。`,
          timestamp: new Date(),
        });
        continue;
      }

      const toolCallId = `toolcall-${uuidv4()}`;
      let runtimeToolPartId: string | undefined;
      try {
        if (runtimeContext) {
          runtimeToolPartId = await this.runtimeOrchestrator.recordToolPending({
            runId: runtimeContext.runId,
            agentId: agentRuntimeId,
            taskId: task.id,
            toolId: normalizedToolId,
            toolName: toolCall.tool,
            toolCallId,
            input: toolCall.parameters,
            traceId: runtimeContext.traceId,
            sequence: round + 1,
            messageId: runtimeContext.userMessageId,
          });
          await this.runtimeOrchestrator.recordToolRunning({
            runId: runtimeContext.runId,
            agentId: agentRuntimeId,
            taskId: task.id,
            toolId: normalizedToolId,
            toolName: toolCall.tool,
            toolCallId,
            input: toolCall.parameters,
            traceId: runtimeContext.traceId,
            sequence: round + 1,
            messageId: runtimeContext.userMessageId,
            partId: runtimeToolPartId,
          });
        }

        this.logger.log(
          `[tool_execute_start] agent=${agent.name} taskId=${task.id} round=${round + 1} tool=${normalizedToolId} parameters=${this.compactLogText(JSON.stringify(toolCall.parameters || {}), 240)}`,
        );
        const execution = await this.toolService.executeTool(
          normalizedToolId,
          agentRuntimeId,
          toolCall.parameters,
          task.id,
          executionContext,
        );
        executedToolIds.add(normalizedToolId);
        const toolResultPayload = this.extractToolResultPayload(execution);
        this.logger.log(
          `[tool_execute_success] agent=${agent.name} taskId=${task.id} round=${round + 1} tool=${normalizedToolId} resultKeys=${Object.keys(toolResultPayload || {}).join('|') || 'none'}`,
        );

        if (runtimeContext) {
          await this.runtimeOrchestrator.recordToolCompleted({
            runId: runtimeContext.runId,
            agentId: agentRuntimeId,
            taskId: task.id,
            toolId: normalizedToolId,
            toolName: toolCall.tool,
            toolCallId,
            input: toolCall.parameters,
            output: toolResultPayload,
            traceId: runtimeContext.traceId,
            sequence: round + 1,
            messageId: runtimeContext.userMessageId,
            partId: runtimeToolPartId,
          });
        }

        messages.push({
          role: 'system',
          content: `工具 ${normalizedToolId} 调用结果: ${JSON.stringify(toolResultPayload || {})}`,
          timestamp: new Date(),
        });
      } catch (error) {
        const logError = this.toLogError(error);
        this.logger.error(
          `[tool_execute_failed] agent=${agent.name} taskId=${task.id} round=${round + 1} tool=${normalizedToolId} error=${logError.message}`,
          logError.stack,
        );

        if (runtimeContext) {
          await this.runtimeOrchestrator.recordToolFailed({
            runId: runtimeContext.runId,
            agentId: agentRuntimeId,
            taskId: task.id,
            toolId: normalizedToolId,
            toolName: toolCall.tool,
            toolCallId,
            input: toolCall.parameters,
            error: logError.message,
            traceId: runtimeContext.traceId,
            sequence: round + 1,
            messageId: runtimeContext.userMessageId,
            partId: runtimeToolPartId,
          });
        }

        const message = logError.message;
        messages.push({
          role: 'system',
          content: `工具 ${normalizedToolId} 调用失败: ${message}。请根据现有信息继续回答。`,
          timestamp: new Date(),
        });
      }
    }

    return '工具调用轮次已达上限，请精简调用后重试。';
  }

  private getMaxToolRounds(): number {
    const configuredRounds = Number(process.env.MAX_TOOL_ROUNDS);
    if (Number.isFinite(configuredRounds) && configuredRounds > 0) {
      return Math.floor(configuredRounds);
    }
    return DEFAULT_MAX_TOOL_ROUNDS;
  }

  private parseToolCallPayload(payload: string): { tool: string; parameters: any } | null {
    const cleaned = payload.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
    const candidates = [cleaned];

    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      candidates.push(cleaned.slice(firstBrace, lastBrace + 1).trim());
    }

    for (const candidate of candidates) {
      if (!candidate) continue;
      try {
        const parsed = JSON.parse(candidate);
        if (!parsed || typeof parsed !== 'object' || typeof parsed.tool !== 'string') {
          continue;
        }

        return {
          tool: parsed.tool,
          parameters: parsed.parameters && typeof parsed.parameters === 'object' ? parsed.parameters : {},
        };
      } catch {
        continue;
      }
    }

    return null;
  }

  private extractToolCall(response: string): { tool: string; parameters: any } | null {
    const closedTagMatch = response.match(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/i);
    if (closedTagMatch) {
      return this.parseToolCallPayload(closedTagMatch[1]);
    }

    const openTagOnlyMatch = response.match(/<tool_call>\s*([\s\S]*)$/i);
    if (openTagOnlyMatch) {
      return this.parseToolCallPayload(openTagOnlyMatch[1]);
    }

    if (response.includes('"tool"') && response.includes('"parameters"')) {
      return this.parseToolCallPayload(response);
    }

    return null;
  }

  private stripToolCallMarkup(content: string): string {
    const withoutClosedBlocks = content.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '');
    const withoutDanglingBlocks = withoutClosedBlocks.replace(/<tool_call>\s*[\s\S]*$/gi, '');
    return withoutDanglingBlocks.trim();
  }

  private isModelTimeoutError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error || '');
    const lower = message.toLowerCase();
    return (
      lower.includes('request timed out') ||
      lower.includes('timeout') ||
      lower.includes('etimedout') ||
      lower.includes('abort')
    );
  }

  private toLogError(error: unknown): { message: string; stack?: string } {
    if (error instanceof Error) {
      return {
        message: this.compactLogText(error.message, 500),
        stack: error.stack,
      };
    }

    return {
      message: this.compactLogText(String(error || 'Unknown error'), 500),
    };
  }

  private ensureTaskRuntime(task: Task): string {
    const existingTaskId = typeof task?.id === 'string' ? task.id.trim() : '';
    if (existingTaskId) {
      if (!Array.isArray(task.messages)) {
        task.messages = [];
      }
      return existingTaskId;
    }

    const generatedTaskId = `task-${uuidv4()}`;
    task.id = generatedTaskId;
    if (!Array.isArray(task.messages)) {
      task.messages = [];
    }
    this.logger.warn(`[task_id_missing] generatedTaskId=${generatedTaskId} title="${this.compactLogText(task.title)}"`);
    return generatedTaskId;
  }

  private async runMemoOperation(label: string, taskId: string, operation: () => Promise<void>): Promise<void> {
    const startedAt = Date.now();
    try {
      await Promise.race([
        operation(),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error(`memo operation timeout: ${label}`)), 5000),
        ),
      ]);
      this.logger.log(`[memo_op_success] taskId=${taskId} label=${label} durationMs=${Date.now() - startedAt}`);
    } catch (error) {
      const logError = this.toLogError(error);
      this.logger.warn(
        `[memo_op_failed] taskId=${taskId} label=${label} durationMs=${Date.now() - startedAt} error=${logError.message}`,
      );
    }
  }

  private compactLogText(input: string | undefined, maxLength = 120): string {
    const normalized = String(input || '')
      .replace(/\s+/g, ' ')
      .replace(/[\r\n\t]+/g, ' ')
      .trim();
    if (!normalized) {
      return 'N/A';
    }
    if (normalized.length <= maxLength) {
      return normalized;
    }
    return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
  }

  private normalizeToolId(toolId: string): string {
    const normalized = String(toolId || '').trim();
    if (!normalized) {
      return '';
    }
    return LEGACY_TOOL_ID_ALIASES[normalized] || normalized;
  }

  private normalizeToolIds(toolIds: string[]): string[] {
    return this.uniqueStrings(toolIds || []).map((toolId) => this.normalizeToolId(toolId));
  }

  private normalizeSkillIds(skillIds: string[]): string[] {
    return this.uniqueStrings(skillIds || []);
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

  private extractToolResultPayload(execution: any): any {
    const result = execution?.result;
    if (result && typeof result === 'object' && 'data' in result) {
      return result.data;
    }
    return result || {};
  }

  private async resolveCustomApiKey(
    agent: { apiKeyId?: string; name: string },
    taskId: string,
    logPrefix: 'task' | 'stream_task',
  ): Promise<string | undefined> {
    if (!agent.apiKeyId) {
      return undefined;
    }

    const customApiKey = await this.apiKeyService.getDecryptedKey(agent.apiKeyId);
    if (customApiKey) {
      this.logger.log(`[${logPrefix}_api_key] taskId=${taskId} agent=${agent.name} source=custom`);
      await this.apiKeyService.recordUsage(agent.apiKeyId);
      return customApiKey;
    }

    this.logger.warn(`[${logPrefix}_api_key] taskId=${taskId} agent=${agent.name} customApiKeyNotAvailable fallback=system`);
    return undefined;
  }

  private resolveLatestUserContent(task: Task, messages: ChatMessage[]): string {
    const latestUserMessage = [...(task.messages || []), ...(messages || [])]
      .reverse()
      .find((item) => item?.role === 'user' && typeof item.content === 'string' && item.content.trim().length > 0)?.content;

    return latestUserMessage || task.description || task.title || '';
  }

  private shouldForceModelManagementGrounding(
    agent: Agent,
    task: Task,
    messages: ChatMessage[],
    response: string,
    executedToolIds: Set<string>,
  ): boolean {
    if (agent.name !== MODEL_MANAGEMENT_AGENT_NAME) {
      return false;
    }

    const latestUserContent = [...(task.messages || []), ...messages]
      .reverse()
      .find((item) => item?.role === 'user' && typeof item.content === 'string' && item.content.trim().length > 0)?.content || '';

    const userText = latestUserContent.toLowerCase();
    const modelResponse = (response || '').toLowerCase();

    const claimsAddSuccess =
      modelResponse.includes('已添加') ||
      modelResponse.includes('添加完成') ||
      modelResponse.includes('发起了添加') ||
      modelResponse.includes('开始添加') ||
      modelResponse.includes('已经完成') ||
      modelResponse.includes('successfully added') ||
      modelResponse.includes('already added');

    const asksAddStatus =
      userText.includes('添加好了吗') ||
      userText.includes('加好了吗') ||
      userText.includes('添加成功') ||
      userText.includes('added') ||
      userText.includes('add done');

    const confirmsAddAction =
      userText === '是的' ||
      userText === '好的' ||
      userText === '确认' ||
      userText === '确认添加' ||
      userText.includes('需要添加') ||
      userText.includes('请添加') ||
      userText.includes('开始添加') ||
      userText.includes('添加到系统') ||
      userText.includes('add to system') ||
      userText.includes('yes, add') ||
      userText.includes('yes add');

    const addExecuted = executedToolIds.has(MODEL_ADD_TOOL_ID);
    const listExecuted = executedToolIds.has(MODEL_LIST_TOOL_ID);

    if (claimsAddSuccess && (!addExecuted || !listExecuted)) {
      return true;
    }

    if (confirmsAddAction && !addExecuted) {
      return true;
    }

    if (asksAddStatus && !listExecuted) {
      return true;
    }

    return false;
  }

  private async tryHandleModelManagementDeterministically(
    agent: Agent,
    task: Task,
    messages: ChatMessage[],
    assignedToolIds: Set<string>,
    agentRuntimeId: string,
  ): Promise<string | null> {
    if (agent.name !== MODEL_MANAGEMENT_AGENT_NAME) {
      return null;
    }

    const latestUser = [...(task.messages || []), ...messages]
      .reverse()
      .find((item) => item?.role === 'user' && typeof item.content === 'string' && item.content.trim().length > 0)?.content;
    const latestUserText = String(latestUser || '').trim().toLowerCase();
    if (!latestUserText) {
      return null;
    }

    const isConfirmAdd =
      ['是的', '好的', '确认', '确认添加'].includes(latestUserText) ||
      latestUserText.includes('需要添加') ||
      latestUserText.includes('请添加') ||
      latestUserText.includes('添加到系统') ||
      latestUserText.includes('yes add') ||
      latestUserText.includes('yes, add');

    const asksAddStatus = latestUserText.includes('添加好了吗') || latestUserText.includes('加好了吗');

    if (!isConfirmAdd && !asksAddStatus) {
      return null;
    }

    const targets = this.extractRequestedModelsFromConversation(task, messages);
    if (!targets.length) {
      return '我已收到添加请求，但没有识别到明确的模型 ID（例如 gpt-5.3-codex）。请提供要添加的模型 ID，我将立即执行并回传结果。';
    }

    if (asksAddStatus && assignedToolIds.has(MODEL_LIST_TOOL_ID)) {
      try {
        const listExecution = await this.toolService.executeTool(
          MODEL_LIST_TOOL_ID,
          agentRuntimeId,
          { limit: 500 },
          task.id,
        );
        const listPayload = this.extractToolResultPayload(listExecution);
        const list = Array.isArray(listPayload?.models) ? listPayload.models : [];
        const existingIds = new Set(
          list
            .map((item: any) => String(item?.id || item?.model || '').trim().toLowerCase())
            .filter(Boolean),
        );
        const exists = targets.filter((item) => existingIds.has(item));
        const missing = targets.filter((item) => !existingIds.has(item));
        if (!missing.length) {
          return `已确认：目标模型已在系统中。
已存在：${exists.join('、')}`;
        }
        return `核验结果：部分模型尚未添加完成。
已存在：${exists.join('、') || '无'}
缺失：${missing.join('、')}`;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown error';
        return `我尝试核验模型状态，但查询失败：${message}`;
      }
    }

    if (!isConfirmAdd || !assignedToolIds.has(MODEL_ADD_TOOL_ID)) {
      return null;
    }

    const addResults: Array<{ model: string; created: boolean; message: string }> = [];
    for (const model of targets) {
      const provider = this.inferProviderFromModelId(model);
      try {
        const addExecution = await this.toolService.executeTool(
          MODEL_ADD_TOOL_ID,
          agentRuntimeId,
          {
            provider,
            model,
            name: this.toModelDisplayName(model),
          },
          task.id,
        );

        const addPayload = this.extractToolResultPayload(addExecution);

        addResults.push({
          model,
          created: Boolean(addPayload?.created),
          message: String(addPayload?.message || ''),
        });
      } catch (error) {
        addResults.push({
          model,
          created: false,
          message: error instanceof Error ? error.message : 'unknown error',
        });
      }
    }

    if (!assignedToolIds.has(MODEL_LIST_TOOL_ID)) {
      const lines = addResults.map((item) => `- ${item.model}: ${item.created ? '已添加' : `失败（${item.message}）`}`);
      return `已执行模型添加请求，结果如下：\n${lines.join('\n')}`;
    }

    try {
      const listExecution = await this.toolService.executeTool(
        MODEL_LIST_TOOL_ID,
        agentRuntimeId,
        { limit: 500 },
        task.id,
      );
      const listPayload = this.extractToolResultPayload(listExecution);
      const list = Array.isArray(listPayload?.models) ? listPayload.models : [];
      const existingIds = new Set(
        list
          .map((item: any) => String(item?.id || item?.model || '').trim().toLowerCase())
          .filter(Boolean),
      );
      const verified = targets.filter((item) => existingIds.has(item));
      const unverified = targets.filter((item) => !existingIds.has(item));
      return `已执行添加并完成核验。
添加结果：${addResults.map((item) => `${item.model}:${item.created ? 'created' : 'failed'}`).join('，')}
核验存在：${verified.join('、') || '无'}
核验缺失：${unverified.join('、') || '无'}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      return `已执行模型添加，但列表核验失败：${message}`;
    }
  }

  private extractRequestedModelsFromConversation(task: Task, messages: ChatMessage[]): string[] {
    const collector = [
      task.title || '',
      task.description || '',
      ...(task.messages || []).map((item) => item?.content || ''),
      ...messages.map((item) => item?.content || ''),
    ]
      .map((item) => String(item || ''))
      .join('\n');

    const regex = /(gpt-[a-z0-9.\-]+|o1[a-z0-9.\-]*|claude-[a-z0-9.\-]+|gemini-[a-z0-9.\-]+|deepseek-[a-z0-9.\-]+|qwen[a-z0-9.\-]*|llama-[a-z0-9.\-]+|kimi-[a-z0-9.\-]+|moonshot-[a-z0-9.\-]+|mistral-[a-z0-9.\-]+|grok-[a-z0-9.\-]+)/gi;
    const matches = collector.match(regex) || [];
    return Array.from(new Set(matches.map((item) => item.trim().toLowerCase())));
  }

  private inferProviderFromModelId(modelId: string): string {
    const value = String(modelId || '').toLowerCase();
    if (value.startsWith('gpt-') || value.startsWith('o1')) return 'openai';
    if (value.startsWith('claude-')) return 'anthropic';
    if (value.startsWith('gemini-')) return 'google';
    if (value.startsWith('deepseek-')) return 'deepseek';
    if (value.startsWith('qwen')) return 'alibaba';
    if (value.startsWith('llama-')) return 'meta';
    if (value.startsWith('kimi-') || value.startsWith('moonshot-')) return 'moonshot';
    if (value.startsWith('mistral-')) return 'mistral';
    if (value.startsWith('grok-')) return 'xai';
    return 'custom';
  }

  private toModelDisplayName(model: string): string {
    return String(model || '')
      .split('-')
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  private async getAllowedToolIds(agent: Agent): Promise<string[]> {
    const role = await this.getRoleById(agent.roleId);
    const profile = await this.agentMcpProfileService.getMcpProfileByRoleCode(role?.code);
    const merged = this
      .uniqueStrings(agent.tools || [], profile.tools || [], [MEMO_MCP_SEARCH_TOOL_ID, MEMO_MCP_APPEND_TOOL_ID])
      .map((toolId) => this.normalizeToolId(toolId));
    if (this.isCtoAgent(agent)) {
      return this.uniqueStrings(merged, [REPO_READ_TOOL_ID, CODE_DOCS_READER_TOOL_ID, CODE_UPDATES_READER_TOOL_ID]);
    }
    return merged;
  }

  private buildTaskResultMemo(response: string): string {
    const normalized = String(response || '').replace(/\s+/g, ' ').trim();
    if (normalized.length <= 800) return normalized;
    return `${normalized.slice(0, 797)}...`;
  }

  private isCtoAgent(agent: Agent): boolean {
    const signal = `${agent.name || ''} ${agent.roleId || ''} ${agent.description || ''}`.toLowerCase();
    return [
      'cto',
      'chief-technology-officer',
      'technical-architect',
      'sarah kim',
      '首席技术官',
    ].some((keyword) => signal.includes(keyword.toLowerCase()));
  }

  async getAgentCapabilities(agentId: string): Promise<string[]> {
    const agent = await this.getAgent(agentId);
    return agent?.capabilities || [];
  }

  async getAvailableRoles(options?: { status?: 'active' | 'inactive' }): Promise<AgentBusinessRole[]> {
    const params: Record<string, string> = {};
    if (options?.status) {
      params.status = options.status;
    }

    try {
      const response = await axios.get(`${this.legacyBaseUrl}/roles`, {
        params,
        timeout: this.roleRequestTimeoutMs,
      });
      return Array.isArray(response.data) ? response.data : [];
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch roles from legacy HR service';
      this.logger.warn(`Fetch roles failed: ${message}`);
      throw new BadRequestException('Failed to fetch roles from HR service');
    }
  }

  async getRoleById(roleId: string): Promise<AgentBusinessRole | null> {
    const normalizedRoleId = String(roleId || '').trim();
    if (!normalizedRoleId) {
      return null;
    }

    try {
      const response = await axios.get(`${this.legacyBaseUrl}/roles/${encodeURIComponent(normalizedRoleId)}`, {
        timeout: this.roleRequestTimeoutMs,
      });
      return response.data || null;
    } catch (error: any) {
      if (error?.response?.status === 404) {
        return null;
      }
      const message = error instanceof Error ? error.message : 'Failed to fetch role from legacy HR service';
      this.logger.warn(`Fetch role by id failed: ${message}`);
      throw new BadRequestException('Failed to validate role with HR service');
    }
  }

  async getAgentsMcpMap(): Promise<Record<string, AgentMcpMapProfile>> {
    return this.agentMcpProfileService.getAgentsMcpMap();
  }

  async getMcpAgents(options?: { includeHidden?: boolean }): Promise<{
    total: number;
    visible: number;
    agents: AgentMcpProfile[];
  }> {
    const includeHidden = options?.includeHidden === true;
    const agents = await this.getAllAgents();
    const normalizedAgents = agents.map((agent) => this.normalizeAgentEntity(agent));
    const roleMap = await this.getRoleMapByIds(normalizedAgents.map((agent) => agent.roleId));
    const mapped = await this.agentMcpProfileService.buildAgentMcpProfiles(normalizedAgents, roleMap as any);
    const visibleAgents = mapped.filter((item) => includeHidden || item.exposed);

    return {
      total: mapped.length,
      visible: visibleAgents.length,
      agents: visibleAgents,
    };
  }

  async getMcpAgent(agentId: string, options?: { includeHidden?: boolean }): Promise<AgentMcpProfile> {
    const includeHidden = options?.includeHidden === true;
    const agent = await this.getAgent(agentId);
    if (!agent) {
      throw new NotFoundException(`Agent not found: ${agentId}`);
    }

    const normalized = this.normalizeAgentEntity(agent);
    const role = await this.getRoleById(normalized.roleId);
    const profile = await this.agentMcpProfileService.buildSingleAgentMcpProfile(normalized, (role || undefined) as any);

    if (!includeHidden && !profile.exposed) {
      throw new NotFoundException(`MCP profile is not exposed for agent: ${agentId}`);
    }

    return profile;
  }

  async isAgentAvailable(agentId: string): Promise<boolean> {
    const agent = await this.getAgent(agentId);
    return agent?.isActive || false;
  }

  private normalizeAgentEntity(agent: any): Agent {
    const plain = agent?.toObject ? agent.toObject() : agent;
    const id = plain?.id || plain?._id?.toString?.() || plain?._id;
    return {
      ...plain,
      id,
    } as Agent;
  }

  private async assertRoleExists(roleId: string): Promise<AgentBusinessRole> {
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

  private async inheritRoleProfilePermissions(roleId: string, currentPermissions: string[]): Promise<string[]> {
    const role = await this.assertRoleExists(roleId);
    const profile = await this.agentMcpProfileService.getMcpProfileByRoleCode(role.code);
    return this.uniqueStrings(currentPermissions || [], profile.permissions || profile.capabilities || []);
  }

  private async getRoleMapByIds(roleIds: string[]): Promise<Map<string, AgentBusinessRole>> {
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

  private uniqueStrings(...groups: string[][]): string[] {
    const merged = groups.flat().map((item) => String(item || '').trim()).filter(Boolean);
    return Array.from(new Set(merged));
  }

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

  async getMcpProfiles(): Promise<AgentProfile[]> {
    return this.agentMcpProfileService.getMcpProfiles();
  }

  async getMcpProfile(roleCode: string): Promise<AgentProfile | null> {
    return this.agentMcpProfileService.getMcpProfile(roleCode);
  }

  async upsertMcpProfile(
    roleCode: string,
    updates: Partial<AgentMcpMapProfile>,
  ): Promise<AgentProfile> {
    return this.agentMcpProfileService.upsertMcpProfile(roleCode, updates);
  }

  private pickDefaultModel(): AIModel {
    const preferredIds = ['gpt-4o-mini', 'gpt-4o', 'claude-sonnet-4-6', 'gemini-1.5-flash'];
    for (const modelId of preferredIds) {
      const found = AVAILABLE_MODELS.find((model) => model.id === modelId);
      if (found) return found;
    }
    return AVAILABLE_MODELS[0];
  }

  private async ensureModelManagementAgent(): Promise<void> {
    try {
      const existing = await this.agentModel.findOne({ name: MODEL_MANAGEMENT_AGENT_NAME }).exec();

      if (existing) {
        await this.agentModel
          .updateOne(
            { _id: existing._id },
            {
              $addToSet: {
                tools: { $each: MODEL_MANAGEMENT_AGENT_TOOLS },
                capabilities: {
                  $each: ['model_discovery', 'model_registry_management', 'internet_research'],
                },
              },
              $set: {
                isActive: true,
                roleId: MODEL_MANAGEMENT_ROLE_ID,
                description: '系统内置模型管理Agent，可联网检索最新模型并添加到系统模型列表。',
                systemPrompt: MODEL_MANAGEMENT_AGENT_PROMPT,
              },
            },
          )
          .exec();
        return;
      }

      const model = this.pickDefaultModel();
      const document = new this.agentModel({
        name: MODEL_MANAGEMENT_AGENT_NAME,
        roleId: MODEL_MANAGEMENT_ROLE_ID,
        description: '系统内置模型管理Agent，可联网检索最新模型并添加到系统模型列表。',
        model: {
          id: model.id,
          name: model.name,
          provider: model.provider,
          model: model.model,
          maxTokens: model.maxTokens || 8192,
          temperature: model.temperature ?? 0.2,
          topP: model.topP,
          reasoning: model.reasoning,
        },
        capabilities: ['model_discovery', 'model_registry_management', 'internet_research'],
        systemPrompt: MODEL_MANAGEMENT_AGENT_PROMPT,
        isActive: true,
        tools: ['builtin.web-retrieval.internal.web-search.exa', ...MODEL_MANAGEMENT_AGENT_TOOLS],
        permissions: ['model_registry_read', 'model_registry_write'],
        personality: {
          workEthic: 90,
          creativity: 70,
          leadership: 60,
          teamwork: 85,
        },
        learningAbility: 88,
      });

      await document.save();
      this.logger.log(`Bootstrapped system agent: ${MODEL_MANAGEMENT_AGENT_NAME}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to bootstrap model management agent';
      this.logger.warn(`Model management agent bootstrap skipped: ${message}`);
    }
  }

}
