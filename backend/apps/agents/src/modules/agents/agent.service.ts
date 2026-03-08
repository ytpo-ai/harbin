import { Injectable, NotFoundException, Logger, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Agent, AgentDocument } from '../../../../../src/shared/schemas/agent.schema';
import { AgentProfile, AgentProfileDocument } from '../../../../../src/shared/schemas/agent-profile.schema';
import { AgentSkill, AgentSkillDocument } from '../../schemas/agent-skill.schema';
import { Skill, SkillDocument } from '../../schemas/skill.schema';
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

export interface AgentContext {
  task: Task;
  teamContext?: any;
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
  type: string;
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
  status: 'active' | 'inactive';
  capabilities?: string[];
  tools?: string[];
  promptTemplate?: string;
}

export interface AgentMcpMapProfile {
  role: string;
  tools: string[];
  capabilities: string[];
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

const DEFAULT_MCP_PROFILE: AgentMcpMapProfile = {
  role: 'general-assistant',
  tools: [],
  capabilities: [],
  exposed: false,
  description: 'No MCP profile found for this agent type',
};

const MODEL_MANAGEMENT_AGENT_NAME = 'Model Management Agent';
const MODEL_MANAGEMENT_ROLE_ID = 'system-model-management-role';
const MODEL_MANAGEMENT_AGENT_TOOLS = ['mcp.model.list', 'mcp.model.searchLatest', 'mcp.model.add'];
const CODE_DOCS_MCP_TOOL_ID = 'mcp.docs.summary';
const CODE_UPDATES_MCP_TOOL_ID = 'mcp.updates.summary';
const CODE_DOCS_READER_TOOL_ID = 'internal.docs.read';
const CODE_UPDATES_READER_TOOL_ID = 'internal.updates.read';
const REPO_READ_TOOL_ID = 'internal.repo.read';
const MEMO_MCP_SEARCH_TOOL_ID = 'internal.memo.search';
const MEMO_MCP_APPEND_TOOL_ID = 'internal.memo.append';
const MODEL_MANAGEMENT_AGENT_PROMPT =
  '你是系统内置模型管理Agent。你的职责是维护系统模型库。若用户询问“系统里有哪些模型/当前模型列表”，必须先调用 mcp.model.list 再回答；若用户要求搜索最新模型，处理流程必须严格遵循: 1) 先调用 mcp.model.searchLatest 获取候选模型与来源 2) 先向用户返回候选结果摘要并询问“是否需要添加到系统” 3) 仅当用户明确确认“需要添加/确认添加”后，才调用 mcp.model.add。未确认时严禁写入系统；不得编造模型参数或来源。若需要调用工具，必须只输出且完整闭合标签：<tool_call>{"tool":"tool_id","parameters":{}}</tool_call>。';

const MCP_PROFILE_SEEDS: Omit<AgentProfile, 'createdAt' | 'updatedAt'>[] = [
  {
    agentType: 'ai-executive',
    role: 'executive-lead',
    tools: [
      'internal.web.search',
      'internal.web.fetch',
      'internal.content.extract',
      'internal.agents.list',
      'mcp.orchestration.createPlan',
      'mcp.orchestration.runPlan',
      'mcp.orchestration.getPlan',
      'mcp.orchestration.listPlans',
      'mcp.orchestration.reassignTask',
      'mcp.orchestration.completeHumanTask',
    ],
    capabilities: ['strategy_planning', 'decision_making', 'stakeholder_communication', 'resource_governance'],
    exposed: true,
    description: '负责战略规划、关键决策与跨团队协同。',
  },
  {
    agentType: 'ai-management-assistant',
    role: 'management-assistant',
    tools: [
      'internal.web.search',
      'internal.web.fetch',
      'internal.content.extract',
      'internal.agents.list',
      'mcp.orchestration.createPlan',
      'mcp.orchestration.runPlan',
      'mcp.orchestration.getPlan',
      'mcp.orchestration.listPlans',
    ],
    capabilities: ['schedule_management', 'meeting_followup', 'information_synthesis'],
    exposed: true,
    description: '负责高管日程管理、会议纪要与事项跟进。',
  },
  {
    agentType: 'ai-technical-expert',
    role: 'technical-architect',
    tools: ['internal.web.search', 'internal.web.fetch', 'internal.content.extract', 'internal.agents.list'],
    capabilities: ['system_design', 'technical_planning', 'risk_assessment'],
    exposed: true,
    description: '负责技术架构、方案评审与技术风险控制。',
  },
  {
    agentType: 'ai-fullstack-engineer',
    role: 'fullstack-engineer',
    tools: ['internal.web.search', 'internal.web.fetch', 'internal.content.extract'],
    capabilities: ['frontend_implementation', 'backend_implementation', 'integration_testing'],
    exposed: true,
    description: '负责前后端实现、联调测试与工程交付。',
  },
  {
    agentType: 'ai-devops-engineer',
    role: 'devops-engineer',
    tools: ['internal.web.search', 'internal.web.fetch', 'internal.content.extract'],
    capabilities: ['deployment_automation', 'monitoring_alerting', 'incident_response'],
    exposed: true,
    description: '负责部署发布、监控告警与系统稳定性保障。',
  },
  {
    agentType: 'ai-data-analyst',
    role: 'data-analyst',
    tools: ['internal.web.search', 'internal.web.fetch', 'internal.content.extract'],
    capabilities: ['data_analysis', 'insight_generation', 'reporting'],
    exposed: true,
    description: '负责数据分析、结论提炼与报告输出。',
  },
  {
    agentType: 'ai-product-manager',
    role: 'product-manager',
    tools: [
      'internal.web.search',
      'internal.web.fetch',
      'mcp.orchestration.createPlan',
      'mcp.orchestration.runPlan',
      'mcp.orchestration.getPlan',
      'mcp.orchestration.listPlans',
    ],
    capabilities: ['requirement_planning', 'roadmap_management', 'cross_team_alignment'],
    exposed: true,
    description: '负责产品规划、优先级管理与跨团队推进。',
  },
  {
    agentType: 'ai-hr',
    role: 'human-resources-manager',
    tools: ['internal.web.search'],
    capabilities: ['talent_acquisition', 'performance_management', 'organization_development'],
    exposed: true,
    description: '负责招聘、绩效管理与组织人才发展。',
  },
  {
    agentType: 'ai-admin-assistant',
    role: 'administrative-assistant',
    tools: ['internal.web.search', 'internal.web.fetch'],
    capabilities: ['administrative_coordination', 'meeting_support', 'document_management'],
    exposed: true,
    description: '负责行政事务、会议支持与流程协同。',
  },
  {
    agentType: 'ai-marketing-expert',
    role: 'marketing-strategist',
    tools: ['internal.web.search', 'internal.web.fetch', 'internal.content.extract'],
    capabilities: ['campaign_planning', 'brand_communication', 'growth_optimization'],
    exposed: true,
    description: '负责市场策略、活动策划与增长转化。',
  },
  {
    agentType: 'ai-human-exclusive-assistant',
    role: 'human-exclusive-assistant',
    tools: ['internal.web.search', 'internal.web.fetch', 'internal.content.extract', 'mcp.humanOperationLog.list'],
    capabilities: ['personal_schedule_management', 'task_followup', 'communication_drafting'],
    exposed: true,
    description: '面向人类用户的专属助理，负责个人事务协同与执行跟进。',
  },
  {
    agentType: 'ai-system-builtin',
    role: 'system-builtin-agent',
    tools: [
      'internal.web.search',
      'internal.web.fetch',
      'internal.content.extract',
      'internal.agents.list',
      'mcp.model.list',
      'mcp.model.searchLatest',
      'mcp.model.add',
      'mcp.orchestration.createPlan',
      'mcp.orchestration.runPlan',
      'mcp.orchestration.getPlan',
      'mcp.orchestration.listPlans',
      'mcp.orchestration.reassignTask',
      'mcp.orchestration.completeHumanTask',
    ],
    capabilities: ['system_coordination', 'workflow_orchestration', 'platform_safeguard'],
    exposed: true,
    description: '系统内置类型，用于平台默认流程与系统任务协同。',
  },
  {
    agentType: 'ai-meeting-assistant',
    role: 'meeting-assistant',
    tools: [
      'mcp.meeting.list',
      'mcp.meeting.sendMessage',
      'mcp.meeting.updateStatus',
    ],
    capabilities: ['meeting_monitoring', 'inactivity_warning', 'automatic_meeting_end'],
    exposed: true,
    description: '会议助理，负责监控进行中的会议，在会议长时间未活动时发送提醒并自动结束会议。',
  },
];

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  private readonly legacyBaseUrl = (process.env.LEGACY_SERVICE_URL || 'http://localhost:3001/api').replace(/\/$/, '');
  private readonly roleRequestTimeoutMs = Number(process.env.AGENT_ROLE_REQUEST_TIMEOUT_MS || 8000);

  constructor(
    @InjectModel(Agent.name) private agentModel: Model<AgentDocument>,
    @InjectModel(AgentProfile.name) private agentProfileModel: Model<AgentProfileDocument>,
    @InjectModel(AgentSkill.name) private agentSkillModel: Model<AgentSkillDocument>,
    @InjectModel(Skill.name) private skillModel: Model<SkillDocument>,
    private readonly modelService: ModelService,
    private readonly apiKeyService: ApiKeyService,
    private readonly toolService: ToolService,
    private readonly memoService: MemoService,
    private readonly memoEventBus: MemoEventBusService,
    private readonly runtimeOrchestrator: RuntimeOrchestratorService,
  ) {
    void this.bootstrapMcpProfilesAndAgentTypes();
  }

  async createAgent(agentData: Omit<Agent, 'id' | 'createdAt' | 'updatedAt'>): Promise<Agent> {
    if (!agentData.name?.trim()) {
      throw new BadRequestException('Agent name is required');
    }
    if (!agentData.type?.trim()) {
      throw new BadRequestException('Agent type is required');
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
      tools: agentData.tools || [],
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

    normalizedData.tools = await this.ensureToolsWithinMcpProfileWhitelist(
      normalizedData.type,
      normalizedData.tools || [],
      'create',
    );

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
    return this.agentModel.findById(agentId).exec();
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
    const existingAgent = await this.agentModel.findById(agentId).exec();
    if (!existingAgent) {
      throw new NotFoundException(`Agent not found: ${agentId}`);
    }

    const normalizedUpdates: any = {
      ...updates,
      updatedAt: new Date(),
    };

    const hasTypeField = Object.prototype.hasOwnProperty.call(updates, 'type');
    if (hasTypeField) {
      const normalizedType = typeof updates.type === 'string' ? updates.type.trim() : '';
      if (!normalizedType) {
        throw new BadRequestException('Agent type cannot be empty');
      }
      normalizedUpdates.type = normalizedType;
    }

    const targetType = hasTypeField
      ? normalizedUpdates.type
      : (existingAgent.type || '').trim();

    const hasToolsField = Object.prototype.hasOwnProperty.call(updates, 'tools');
    if (hasToolsField || hasTypeField) {
      const candidateTools = hasToolsField
        ? Array.isArray(updates.tools)
          ? updates.tools
          : []
        : Array.isArray(existingAgent.tools)
          ? existingAgent.tools
          : [];
      normalizedUpdates.tools = await this.ensureToolsWithinMcpProfileWhitelist(
        targetType,
        candidateTools,
        'update',
      );
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

    const updated = await this.agentModel.findByIdAndUpdate(
      agentId,
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

  private async ensureToolsWithinMcpProfileWhitelist(
    agentType: string,
    tools: string[],
    action: 'create' | 'update',
  ): Promise<string[]> {
    const normalizedType = (agentType || '').trim();
    if (!normalizedType) {
      throw new BadRequestException('Agent type is required before assigning tools');
    }

    const profile = await this.getMcpProfileByAgentType(normalizedType);
    const whitelist = new Set(this.normalizeToolIds(profile.tools || []));
    const normalizedTools = this.normalizeToolIds(tools || []);
    const invalid = normalizedTools.filter((toolId) => !whitelist.has(toolId));

    if (invalid.length > 0) {
      throw new BadRequestException(
        `Invalid tools for agent type ${normalizedType} on ${action}: ${invalid.join(', ')}. ` +
          'Agent.tools must be a subset of MCP Profile.tools.',
      );
    }

    return normalizedTools;
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
    const result = await this.agentModel.findByIdAndDelete(agentId).exec();
    return !!result;
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
      this.modelService.ensureProviderWithKey(modelConfig, customApiKey);
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
        lower.includes('model not found')
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

    const taskStartAt = Date.now();
    const taskId = this.ensureTaskRuntime(task);
    const runtimeAgentId = agent.id || (agent as any)._id?.toString?.() || agentId;
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

    const runtimeContext = await this.runtimeOrchestrator.startRun({
      agentId: runtimeAgentId,
      agentName: agent.name,
      taskId,
      sessionId: typeof context?.teamContext?.sessionId === 'string' ? context.teamContext.sessionId : undefined,
      taskTitle: task.title,
      taskDescription: task.description,
      userContent: this.resolveLatestUserContent(task, messages),
      metadata: {
        taskType: task.type,
        taskPriority: task.priority,
        ...(context?.teamContext?.meetingId
          ? {
              meetingContext: {
                meetingId: context.teamContext.meetingId,
                agendaId: context.teamContext.agendaId,
                latestSummary: context.teamContext.latestSummary,
              },
            }
          : {}),
      },
    });

    if (runtimeContext.sessionId) {
      const systemMessages = messages
        .filter((msg) => msg.role === 'system')
        .map((msg) => ({
          role: 'system' as const,
          content: msg.content,
          metadata: { source: 'buildMessages', agentId: agent.id },
        }));
      if (systemMessages.length > 0) {
        await this.runtimeOrchestrator.appendSystemMessagesToSession(runtimeContext.sessionId, systemMessages);
      }
    }

    try {
      // 确保模型已注册 - 类型转换
      const modelConfig: AIModel = {
        id: agent.model.id,
        name: agent.model.name,
        provider: agent.model.provider as AIModel['provider'],
        model: agent.model.model,
        maxTokens: agent.model.maxTokens || 4096,
        temperature: agent.model.temperature || 0.7,
        topP: agent.model.topP,
        reasoning: agent.model.reasoning,
      };

      // 获取自定义API Key（如果配置了）
      let customApiKey: string | undefined;
      if (agent.apiKeyId) {
        customApiKey = await this.apiKeyService.getDecryptedKey(agent.apiKeyId);
        if (customApiKey) {
          this.logger.log(`[task_api_key] taskId=${taskId} agent=${agent.name} source=custom`);
          // 记录API Key使用情况
          await this.apiKeyService.recordUsage(agent.apiKeyId);
        } else {
          this.logger.warn(`[task_api_key] taskId=${taskId} agent=${agent.name} customApiKeyNotAvailable fallback=system`);
        }
      }

      // 注册provider（使用自定义key或默认key）
      this.modelService.ensureProviderWithKey(modelConfig, customApiKey);

      const response = await this.executeWithToolCalling(
        agent,
        task,
        messages,
        modelConfig,
        runtimeContext,
        {
          teamContext: context?.teamContext,
          taskType: task.type,
          teamId: task.teamId,
        },
      );

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

      await this.runtimeOrchestrator.completeRun({
        runId: runtimeContext.runId,
        agentId: runtimeAgentId,
        sessionId: runtimeContext.sessionId,
        taskId,
        assistantContent: response,
        traceId: runtimeContext.traceId,
      });

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
        await this.runtimeOrchestrator.failRun({
          runId: runtimeContext.runId,
          agentId: runtimeAgentId,
          sessionId: runtimeContext.sessionId,
          taskId,
          error: logError.message,
          traceId: runtimeContext.traceId,
        });
      }
      throw error;
    } finally {
      await this.runtimeOrchestrator.releaseRun(runtimeContext);
    }
  }

  async executeTaskWithStreaming(
    agentId: string,
    task: Task,
    onToken: (token: string) => void,
    context?: Partial<AgentContext>
  ): Promise<void> {
    const agent = await this.getAgent(agentId);
    if (!agent) {
      throw new NotFoundException(`Agent not found: ${agentId}`);
    }

    const taskStartAt = Date.now();
    const taskId = this.ensureTaskRuntime(task);
    const runtimeAgentId = agent.id || (agent as any)._id?.toString?.() || agentId;
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

    const runtimeContext = await this.runtimeOrchestrator.startRun({
      agentId: runtimeAgentId,
      agentName: agent.name,
      taskId,
      sessionId: typeof context?.teamContext?.sessionId === 'string' ? context.teamContext.sessionId : undefined,
      taskTitle: task.title,
      taskDescription: task.description,
      userContent: this.resolveLatestUserContent(task, messages),
      metadata: {
        taskType: task.type,
        taskPriority: task.priority,
        mode: 'streaming',
      },
    });

    if (runtimeContext.sessionId) {
      const systemMessages = messages
        .filter((msg) => msg.role === 'system')
        .map((msg) => ({
          role: 'system' as const,
          content: msg.content,
          metadata: { source: 'buildMessages', agentId: agent.id },
        }));
      if (systemMessages.length > 0) {
        await this.runtimeOrchestrator.appendSystemMessagesToSession(runtimeContext.sessionId, systemMessages);
      }
    }

    // 获取自定义API Key（如果配置了）
    let customApiKey: string | undefined;
    if (agent.apiKeyId) {
      customApiKey = await this.apiKeyService.getDecryptedKey(agent.apiKeyId);
      if (customApiKey) {
        this.logger.log(`[stream_task_api_key] taskId=${taskId} agent=${agent.name} source=custom`);
        await this.apiKeyService.recordUsage(agent.apiKeyId);
      } else {
        this.logger.warn(`[stream_task_api_key] taskId=${taskId} agent=${agent.name} customApiKeyNotAvailable fallback=system`);
      }
    }

    // 确保provider已注册（使用自定义key或默认key）
    const modelConfig: AIModel = {
      id: agent.model.id,
      name: agent.model.name,
      provider: agent.model.provider as AIModel['provider'],
      model: agent.model.model,
      maxTokens: agent.model.maxTokens || 4096,
      temperature: agent.model.temperature || 0.7,
      topP: agent.model.topP,
      reasoning: agent.model.reasoning,
    };
    this.modelService.ensureProviderWithKey(modelConfig, customApiKey);

    let fullResponse = '';
    let tokenChunks = 0;
    let streamSequence = 1;
    let runtimeInterrupted = false;
    try {
      await this.runtimeOrchestrator.assertRunnable(runtimeContext.runId);
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

      await this.runtimeOrchestrator.completeRun({
        runId: runtimeContext.runId,
        agentId: runtimeAgentId,
        sessionId: runtimeContext.sessionId,
        taskId,
        assistantContent: fullResponse,
        traceId: runtimeContext.traceId,
      });
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
        await this.runtimeOrchestrator.failRun({
          runId: runtimeContext.runId,
          agentId: runtimeAgentId,
          sessionId: runtimeContext.sessionId,
          taskId,
          error: logError.message,
          traceId: runtimeContext.traceId,
        });
      }
      throw error;
    } finally {
      await this.runtimeOrchestrator.releaseRun(runtimeContext);
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

    // 任务上下文
    messages.push({
      role: 'system',
      content: `任务信息:\n标题: ${task.title}\n描述: ${task.description}\n类型: ${task.type}\n优先级: ${task.priority}`,
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
    }

    if (allowedToolIds.includes('internal.agents.list')) {
      messages.push({
        role: 'system',
        content:
          '当用户询问“系统里有哪些agents/当前有哪些agent/agent列表”时，请优先调用 internal.agents.list 工具获取实时名单，再基于工具结果回答。',
        timestamp: new Date(),
      });
    }

    if (allowedToolIds.includes('mcp.model.list')) {
      messages.push({
        role: 'system',
        content:
          '当用户询问“系统里有哪些模型/当前有哪些模型/模型列表”时，请优先调用 mcp.model.list 获取实时模型清单，再回答。',
        timestamp: new Date(),
      });
    }

    if (allowedToolIds.includes('mcp.model.searchLatest') && allowedToolIds.includes('mcp.model.add')) {
      messages.push({
        role: 'system',
        content:
          '当用户要求“搜索最新模型并加入系统”时，请按顺序调用 mcp.model.searchLatest 与 mcp.model.add；必须先返回候选并询问“是否需要添加到系统”，仅在用户明确确认后才允许入库。',
        timestamp: new Date(),
      });
    }

    if (allowedToolIds.includes(CODE_DOCS_MCP_TOOL_ID)) {
      messages.push({
        role: 'system',
        content:
          '当用户询问“当前系统实现了哪些核心功能/系统能力清单/docs里实现了什么”时，请优先调用 mcp.docs.summary 并基于其 evidence 路径回答；若工具返回 unknownBoundary，必须明确告知未知范围，不得臆测。',
        timestamp: new Date(),
      });
    }

    if (allowedToolIds.includes(CODE_UPDATES_MCP_TOOL_ID)) {
      messages.push({
        role: 'system',
        content:
          '当用户询问"最近24小时/最近一天系统主要更新"时，请优先调用 mcp.updates.summary 并基于提交证据回答；若工具返回 unknownBoundary，必须明确告知未知范围，不得臆测。',
        timestamp: new Date(),
      });
    }

    if (allowedToolIds.includes(CODE_DOCS_READER_TOOL_ID)) {
      messages.push({
        role: 'system',
        content:
          '当用户询问"当前系统实现了哪些核心功能/系统能力清单/docs里实现了什么"时，优先级如下：1) 优先使用 internal.repo.read 执行 "git log"、"ls docs/"、"cat docs/..."、"grep ..." 等命令自行读取；2) 其次调用 internal.docs.read 读取文档；3) 最后才调用 mcp.docs.summary 获取摘要。若 internal.docs.read 返回 0 命中或 fallback 信号，必须自动重试（放宽 focus 或不传 focus），仍失败再切换 internal.repo.read 直接列目录并读取文档；不要向用户发起二选一确认。必须基于实际读取的内容回答，不得臆测。',
        timestamp: new Date(),
      });
    }

    if (allowedToolIds.includes(CODE_UPDATES_READER_TOOL_ID)) {
      messages.push({
        role: 'system',
        content:
          '当用户询问"最近24小时/最近一天系统主要更新"时，优先级如下：1) 优先使用 internal.repo.read 执行 "git log --since=..." 等命令自行读取提交记录；2) 其次调用 internal.updates.read；3) 最后才调用 mcp.updates.summary。必须基于实际提交内容回答，不得臆测。',
        timestamp: new Date(),
      });
    }

    if (allowedToolIds.includes(REPO_READ_TOOL_ID)) {
      messages.push({
        role: 'system',
        content:
          '你拥有 internal.repo.read 工具，可执行只读 bash 命令（如 git log、cat、ls、grep 等）来读取本地仓库文件。当你需要了解代码或文档内容时，请优先使用 internal.repo.read 直接读取。',
        timestamp: new Date(),
      });
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
          '请优先参考这些记忆，并在必要时调用 internal.memo.search 获取更完整上下文；若有新结论可调用 internal.memo.append 追加沉淀。',
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

    if (allowedToolIds.includes(MEMO_MCP_SEARCH_TOOL_ID) && allowedToolIds.includes(MEMO_MCP_APPEND_TOOL_ID)) {
      messages.push({
        role: 'system',
        content:
          '在处理任务时，优先调用 internal.memo.search 检索相关历史备忘录；当形成关键结论或后续动作时，调用 internal.memo.append 将知识、行为或TODO追加到备忘录。',
        timestamp: new Date(),
      });
    }

    // 历史消息
    messages.push(...context.previousMessages);

    return messages;
  }

  private async getEnabledSkillsForAgent(agent: Agent, agentId: string): Promise<EnabledAgentSkillContext[]> {
    const candidateAgentIds = this.uniqueStrings([agentId, agent.id || '']);
    if (!candidateAgentIds.length) {
      return [];
    }

    const assignments = await this.agentSkillModel
      .find({ agentId: { $in: candidateAgentIds }, enabled: true })
      .exec();
    if (!assignments.length) {
      return [];
    }

    const skillIds = this.uniqueStrings(assignments.map((item) => item.skillId));
    const skills = await this.skillModel
      .find({ id: { $in: skillIds }, status: { $in: ['active', 'experimental'] } })
      .exec();
    const skillMap = new Map<string, Skill>();
    for (const skill of skills) {
      skillMap.set(skill.id, skill as unknown as Skill);
    }

    const contexts: EnabledAgentSkillContext[] = [];
    for (const assignment of assignments) {
      const skill = skillMap.get(assignment.skillId);
      if (!skill) continue;
      contexts.push({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        tags: skill.tags || [],
        proficiencyLevel: assignment.proficiencyLevel,
      });
    }
    return contexts;
  }

  private async executeWithToolCalling(
    agent: Agent,
    task: Task,
    initialMessages: ChatMessage[],
    modelConfig: AIModel,
    runtimeContext?: RuntimeRunContext,
    executionContext?: { teamContext?: any; taskType?: string; teamId?: string },
  ): Promise<string> {
    const maxToolRounds = 3;
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

    const forcedDocsQuery = this.extractForcedCodeDocsQuery(task, messages);
    if (forcedDocsQuery && assignedToolIds.has(CODE_DOCS_MCP_TOOL_ID)) {
      this.logger.log(`Forced tool call triggered: ${CODE_DOCS_MCP_TOOL_ID} (agent=${agent.name})`);
      try {
        const execution = await this.toolService.executeTool(
          CODE_DOCS_MCP_TOOL_ID,
          agentRuntimeId,
          {
            query: forcedDocsQuery,
            focus: 'core_features',
            maxFeatures: 8,
            maxEvidencePerFeature: 3,
          },
          task.id,
          executionContext,
        );
        return this.formatCodeDocsMcpAnswer(this.extractToolResultPayload(execution));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown error';
        this.logger.warn(`Forced tool call ${CODE_DOCS_MCP_TOOL_ID} failed: ${message}`);
        return `我尝试通过 ${CODE_DOCS_MCP_TOOL_ID} 读取 docs 进行核心功能盘点，但调用失败（${message}）。当前无法提供可靠清单，请稍后重试。`;
      }
    }

    const forcedUpdatesHours = this.extractForcedCodeUpdatesWindowHours(task, messages);
    if (forcedUpdatesHours && assignedToolIds.has(CODE_UPDATES_MCP_TOOL_ID)) {
      this.logger.log(`Forced tool call triggered: ${CODE_UPDATES_MCP_TOOL_ID} (agent=${agent.name}, hours=${forcedUpdatesHours})`);
      try {
        const execution = await this.toolService.executeTool(
          CODE_UPDATES_MCP_TOOL_ID,
          agentRuntimeId,
          {
            hours: forcedUpdatesHours,
            limit: 10,
            includeFiles: true,
            minSeverity: 'medium',
          },
          task.id,
          executionContext,
        );
        return this.formatCodeUpdatesMcpAnswer(this.extractToolResultPayload(execution), forcedUpdatesHours);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown error';
        this.logger.warn(`Forced tool call ${CODE_UPDATES_MCP_TOOL_ID} failed: ${message}`);
        return `我尝试通过 ${CODE_UPDATES_MCP_TOOL_ID} 汇总最近更新，但调用失败（${message}）。当前无法提供可靠更新清单，请稍后重试。`;
      }
    }

    const forcedOrchestrationAction = this.extractForcedOrchestrationAction(
      task,
      messages,
      assignedToolIds,
      executionContext,
    );
    if (!forcedOrchestrationAction && this.hasMeetingOrchestrationIntent(task, messages, executionContext)) {
      const hasAnyOrchestrationTool = [
        'mcp.orchestration.createPlan',
        'mcp.orchestration.runPlan',
        'mcp.orchestration.getPlan',
        'mcp.orchestration.listPlans',
        'mcp.orchestration.reassignTask',
        'mcp.orchestration.completeHumanTask',
      ].some((toolId) => assignedToolIds.has(toolId));
      if (!hasAnyOrchestrationTool) {
        return '我识别到你希望执行计划编排，但当前这个 Agent 未分配 mcp.orchestration.* 工具。请在 Agent 管理中为其绑定对应 MCP Profile 工具后重试。';
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
        return this.formatForcedOrchestrationAnswer(
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
              '你正在处理模型管理请求。禁止在未调用并拿到工具结果时声称“已添加成功/已完成添加”。请立即调用 mcp.model.add 执行写入，并调用 mcp.model.list 验证后再回答。若工具失败，请明确说明失败原因。',
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
            toolCallId,
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
            toolCallId,
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
            toolCallId,
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
    return String(toolId || '').trim();
  }

  private normalizeToolIds(toolIds: string[]): string[] {
    return this.uniqueStrings(toolIds || []).map((toolId) => this.normalizeToolId(toolId));
  }

  private extractToolResultPayload(execution: any): any {
    const result = execution?.result;
    if (result && typeof result === 'object' && 'data' in result) {
      return result.data;
    }
    return result || {};
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

    const searchingAndAdding =
      userText.includes('搜索并添加') ||
      userText.includes('search and add');

    const addExecuted = executedToolIds.has('mcp.model.add');
    const listExecuted = executedToolIds.has('mcp.model.list');
    const searchExecuted = executedToolIds.has('mcp.model.searchLatest');

    if (claimsAddSuccess && (!addExecuted || !listExecuted)) {
      return true;
    }

    if (confirmsAddAction && !addExecuted) {
      return true;
    }

    if (searchingAndAdding && !searchExecuted) {
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

    if (asksAddStatus && assignedToolIds.has('mcp.model.list')) {
      try {
        const listExecution = await this.toolService.executeTool(
          'mcp.model.list',
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

    if (!isConfirmAdd || !assignedToolIds.has('mcp.model.add')) {
      return null;
    }

    const addResults: Array<{ model: string; created: boolean; message: string }> = [];
    for (const model of targets) {
      const provider = this.inferProviderFromModelId(model);
      try {
        const addExecution = await this.toolService.executeTool(
          'mcp.model.add',
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

    if (!assignedToolIds.has('mcp.model.list')) {
      const lines = addResults.map((item) => `- ${item.model}: ${item.created ? '已添加' : `失败（${item.message}）`}`);
      return `已执行模型添加请求，结果如下：\n${lines.join('\n')}`;
    }

    try {
      const listExecution = await this.toolService.executeTool(
        'mcp.model.list',
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

  private extractForcedCodeDocsQuery(task: Task, messages: ChatMessage[]): string | null {
    const latestUserMessage = [...(task.messages || []), ...(messages || [])]
      .reverse()
      .find((item) => item?.role === 'user' && typeof item.content === 'string' && item.content.trim().length > 0)?.content;

    const querySource = `${task.title || ''}\n${task.description || ''}\n${latestUserMessage || ''}`.toLowerCase();
    const patterns = [
      '当前系统实现了哪些核心功能',
      '系统实现了哪些核心功能',
      '核心功能',
      '系统能力清单',
      'docs里实现了什么',
      'docs 实现了什么',
      'what core features',
      'implemented core features',
      'system capabilities',
    ];

    const matched = patterns.some((pattern) => querySource.includes(pattern.toLowerCase()));
    if (!matched) {
      return null;
    }

    return latestUserMessage || task.title || '当前系统实现了哪些核心功能';
  }

  private extractForcedCodeUpdatesWindowHours(task: Task, messages: ChatMessage[]): number | null {
    const latestUserMessage = [...(task.messages || []), ...(messages || [])]
      .reverse()
      .find((item) => item?.role === 'user' && typeof item.content === 'string' && item.content.trim().length > 0)?.content;

    const querySource = `${task.title || ''}\n${task.description || ''}\n${latestUserMessage || ''}`.toLowerCase();
    const patterns = [
      '最近24小时',
      '24小时',
      '最近一天',
      'today update',
      'last 24 hours',
      'recent updates',
      '主要更新',
      '更新总结',
    ];

    const matched = patterns.some((pattern) => querySource.includes(pattern.toLowerCase()));
    if (!matched) {
      return null;
    }

    const hourMatch = querySource.match(/(\d{1,3})\s*(小时|h|hours?)/i);
    if (hourMatch) {
      const parsed = Number(hourMatch[1]);
      if (Number.isFinite(parsed)) {
        return Math.max(1, Math.min(Math.floor(parsed), 168));
      }
    }

    return 24;
  }

  private extractForcedOrchestrationAction(
    task: Task,
    messages: ChatMessage[],
    assignedToolIds: Set<string>,
    executionContext?: { teamContext?: any; taskType?: string; teamId?: string },
  ):
    | {
        tool:
          | 'mcp.orchestration.createPlan'
          | 'mcp.orchestration.runPlan'
          | 'mcp.orchestration.getPlan'
          | 'mcp.orchestration.listPlans'
          | 'mcp.orchestration.reassignTask'
          | 'mcp.orchestration.completeHumanTask';
        parameters: Record<string, any>;
        reason: string;
      }
    | null {
    const meetingLike =
      task.type === 'discussion' ||
      executionContext?.taskType === 'discussion' ||
      Boolean(executionContext?.teamContext?.meetingId);
    if (!meetingLike) {
      return null;
    }

    const latestUserMessage = [...(task.messages || []), ...(messages || [])]
      .reverse()
      .find((item) => item?.role === 'user' && typeof item.content === 'string' && item.content.trim().length > 0)?.content;
    const latestUser = this.normalizeMeetingUserInstruction(latestUserMessage);
    if (!latestUser) {
      return null;
    }
    const lower = latestUser.toLowerCase();

    const planId = this.extractEntityIdFromText(latestUser, 'plan');
    const taskId = this.extractEntityIdFromText(latestUser, 'task');
    const recoveredPlanId = this.extractRecentPlanIdFromConversation(task, messages);
    const shortRunConfirmIntent = this.isShortRunConfirmIntent(lower);

    const includesAny = (patterns: string[]) => patterns.some((item) => lower.includes(item.toLowerCase()));

    if (
      assignedToolIds.has('mcp.orchestration.createPlan') &&
      includesAny(['创建计划', '生成计划', '拆解计划', '编排计划', 'create plan', 'mcp.orchestration.createPlan'])
    ) {
      return {
        tool: 'mcp.orchestration.createPlan',
        parameters: {
          prompt: latestUser,
          title: task.title || '会议编排计划',
          mode: 'hybrid',
          autoRun: false,
        },
        reason: 'meeting_orchestration_create',
      };
    }

    if (
      assignedToolIds.has('mcp.orchestration.runPlan') &&
      (includesAny(['执行计划', '运行计划', '开始执行计划', 'run plan', 'mcp.orchestration.runPlan']) || shortRunConfirmIntent)
    ) {
      const selectedPlanId = planId || recoveredPlanId;
      if (!selectedPlanId) {
        if (!assignedToolIds.has('mcp.orchestration.listPlans')) {
          return null;
        }
        return {
          tool: 'mcp.orchestration.listPlans',
          parameters: {},
          reason: 'meeting_orchestration_run_missing_planid_fallback_list',
        };
      }
      return {
        tool: 'mcp.orchestration.runPlan',
        parameters: {
          planId: selectedPlanId,
          continueOnFailure: true,
          confirm: true,
        },
        reason: shortRunConfirmIntent && !planId ? 'meeting_orchestration_run_short_confirm' : 'meeting_orchestration_run',
      };
    }

    if (
      assignedToolIds.has('mcp.orchestration.getPlan') &&
      includesAny(['查看计划', '计划详情', '查询计划', 'get plan', 'mcp.orchestration.getPlan'])
    ) {
      if (!planId) {
        return null;
      }
      return {
        tool: 'mcp.orchestration.getPlan',
        parameters: {
          planId,
        },
        reason: 'meeting_orchestration_get',
      };
    }

    if (
      assignedToolIds.has('mcp.orchestration.listPlans') &&
      includesAny(['计划列表', '所有计划', 'list plans', 'mcp.orchestration.listPlans'])
    ) {
      return {
        tool: 'mcp.orchestration.listPlans',
        parameters: {},
        reason: 'meeting_orchestration_list',
      };
    }

    if (
      assignedToolIds.has('mcp.orchestration.reassignTask') &&
      includesAny(['改派任务', '重新分配任务', 'reassign task', 'mcp.orchestration.reassignTask'])
    ) {
      if (!taskId) {
        return null;
      }
      return {
        tool: 'mcp.orchestration.reassignTask',
        parameters: {
          taskId,
          executorType: 'agent',
          reason: '会议中触发改派',
          confirm: true,
        },
        reason: 'meeting_orchestration_reassign',
      };
    }

    if (
      assignedToolIds.has('mcp.orchestration.completeHumanTask') &&
      includesAny(['人工完成任务', '完成人工任务', 'complete human task', 'mcp.orchestration.completeHumanTask'])
    ) {
      if (!taskId) {
        return null;
      }
      return {
        tool: 'mcp.orchestration.completeHumanTask',
        parameters: {
          taskId,
          summary: '会议中确认人工任务完成',
          output: latestUser,
          confirm: true,
        },
        reason: 'meeting_orchestration_complete_human',
      };
    }

    return null;
  }

  private hasMeetingOrchestrationIntent(
    task: Task,
    messages: ChatMessage[],
    executionContext?: { teamContext?: any; taskType?: string; teamId?: string },
  ): boolean {
    const meetingLike =
      task.type === 'discussion' ||
      executionContext?.taskType === 'discussion' ||
      Boolean(executionContext?.teamContext?.meetingId);
    if (!meetingLike) {
      return false;
    }
    const latestUserMessage = [...(task.messages || []), ...(messages || [])]
      .reverse()
      .find((item) => item?.role === 'user' && typeof item.content === 'string' && item.content.trim().length > 0)?.content;
    const lower = this.normalizeMeetingUserInstruction(latestUserMessage).toLowerCase();
    if (!lower) {
      return false;
    }
    return [
      '创建计划',
      '生成计划',
      '编排计划',
      '执行计划',
      '运行计划',
      '计划详情',
      '计划列表',
      '改派任务',
      '人工完成任务',
      'create plan',
      'run plan',
      '执行',
      '继续',
      '开始',
      'orchestration_',
    ].some((item) => lower.includes(item));
  }

  private isShortRunConfirmIntent(latestUserLower: string): boolean {
    const normalized = String(latestUserLower || '').trim();
    return ['执行', '继续', '开始', 'run', 'go', 'ok执行', '确认执行'].includes(normalized);
  }

  private normalizeMeetingUserInstruction(content: unknown): string {
    const raw = String(content || '').trim();
    if (!raw) {
      return '';
    }

    const wrapped = raw.match(/\[新消息\][^:：]*[:：]\s*([\s\S]*?)(?:\n\n请对此做出回应。?)?$/i);
    if (wrapped?.[1]) {
      return wrapped[1].trim();
    }

    return raw;
  }

  private extractRecentPlanIdFromConversation(task: Task, messages: ChatMessage[]): string | null {
    const source = [
      ...(task.messages || []),
      ...(messages || []),
    ]
      .map((item) => String(item?.content || ''))
      .reverse();

    for (const text of source) {
      const explicit = text.match(/planId\s*[:=]\s*([a-zA-Z0-9_-]{6,64})/i);
      if (explicit?.[1]) {
        return explicit[1];
      }
      const objectId = text.match(/\b[a-f0-9]{24}\b/i);
      if (objectId?.[0] && /plan|计划/i.test(text)) {
        return objectId[0];
      }
    }

    return null;
  }

  private extractEntityIdFromText(input: string, entity: 'plan' | 'task'): string | null {
    const text = String(input || '');
    const explicit = text.match(new RegExp(`${entity}\\s*[_-]?id\\s*[:：]\\s*([a-zA-Z0-9_-]{6,64})`, 'i'));
    if (explicit?.[1]) {
      return explicit[1];
    }
    const objectId = text.match(/\b[a-f0-9]{24}\b/i);
    if (objectId?.[0]) {
      return objectId[0];
    }
    return null;
  }

  private formatForcedOrchestrationAnswer(
    tool: string,
    result: any,
    parameters: Record<string, any>,
  ): string {
    const payload = result?.result || result || {};
    if (tool === 'mcp.orchestration.createPlan') {
      const planId = payload?.id || payload?._id || payload?.planId || 'unknown';
      const taskCount = Array.isArray(payload?.tasks) ? payload.tasks.length : 0;
      return `已触发计划创建，planId=${planId}，任务数=${taskCount}。如需继续执行，请回复“执行计划 planId:${planId}”。`;
    }
    if (tool === 'mcp.orchestration.runPlan') {
      return `已触发计划执行（planId=${parameters.planId}，continueOnFailure=${parameters.continueOnFailure === true ? 'true' : 'false'}）。可继续让我查询执行进度。`;
    }
    if (tool === 'mcp.orchestration.getPlan') {
      const status = payload?.status || 'unknown';
      const tasks = Array.isArray(payload?.tasks) ? payload.tasks : [];
      const completed = tasks.filter((item: any) => item?.status === 'completed').length;
      const failed = tasks.filter((item: any) => item?.status === 'failed').length;
      const waitingHuman = tasks.filter((item: any) => item?.status === 'waiting_human').length;
      return `计划状态：${status}。任务统计：completed=${completed}，failed=${failed}，waiting_human=${waitingHuman}，total=${tasks.length}。`;
    }
    if (tool === 'mcp.orchestration.listPlans') {
      const plans = Array.isArray(payload) ? payload : Array.isArray(payload?.plans) ? payload.plans : [];
      return `已查询计划列表，当前可见计划数量=${plans.length}。如需执行请提供 planId（例如：执行计划 planId:xxx）。`;
    }
    if (tool === 'mcp.orchestration.reassignTask') {
      return `已提交任务改派请求（taskId=${parameters.taskId}）。`;
    }
    if (tool === 'mcp.orchestration.completeHumanTask') {
      return `已提交人工任务完成回填（taskId=${parameters.taskId}）。`;
    }
    return `已执行编排工具 ${tool}。`;
  }

  private formatCodeDocsMcpAnswer(result: any): string {
    const features = Array.isArray(result?.coreFeatures) ? result.coreFeatures : [];
    const unknownBoundary = Array.isArray(result?.unknownBoundary) ? result.unknownBoundary : [];

    if (!features.length) {
      const boundary = unknownBoundary.length
        ? unknownBoundary.map((item: string, idx: number) => `${idx + 1}. ${item}`).join('\n')
        : '1. 当前 docs 未检索到可确认的核心功能描述。';
      return `基于仓库 docs 的盘点结果，目前没有检索到可确认的核心功能清单。\n\n已知/未知边界：\n${boundary}`;
    }

    const featureLines = features.map((feature: any, index: number) => {
      const evidence = Array.isArray(feature?.evidence) ? feature.evidence : [];
      const evidenceText = evidence.length
        ? evidence
            .map((item: any) => {
              const p = item?.path || 'unknown';
              const l = Number(item?.line || 0);
              return l > 0 ? `${p}:${l}` : p;
            })
            .join('，')
        : '无';
      return `${index + 1}. ${feature?.name || '未命名功能'}：${feature?.summary || '暂无摘要'}（依据：${evidenceText}）`;
    });

    const boundaryBlock = unknownBoundary.length
      ? `\n\n已知/未知边界：\n${unknownBoundary.map((item: string, idx: number) => `${idx + 1}. ${item}`).join('\n')}`
      : '';

    return `基于仓库 docs 的盘点，当前系统已实现的核心功能如下：\n\n${featureLines.join('\n')}${boundaryBlock}`;
  }

  private formatCodeUpdatesMcpAnswer(result: any, hours: number): string {
    const updates = Array.isArray(result?.majorUpdates) ? result.majorUpdates : [];
    const commits = Array.isArray(result?.commits) ? result.commits : [];
    const unknownBoundary = Array.isArray(result?.unknownBoundary) ? result.unknownBoundary : [];

    if (!updates.length) {
      const boundary = unknownBoundary.length
        ? unknownBoundary.map((item: string, idx: number) => `${idx + 1}. ${item}`).join('\n')
        : '1. 指定时间窗口内未检索到可确认的更新记录。';
      return `基于最近 ${hours} 小时的仓库提交记录，当前没有检索到可确认的主要更新。\n\n已知/未知边界：\n${boundary}`;
    }

    const updateLines = updates.map((item: any, index: number) => {
      const modules = Array.isArray(item?.impactedModules) ? item.impactedModules.join('、') : 'unknown';
      const commitHashes = Array.isArray(item?.commits)
        ? item.commits.map((hash: string) => String(hash).slice(0, 7)).join('，')
        : 'unknown';
      const whatChanged = Array.isArray(item?.whatChanged)
        ? item.whatChanged.slice(0, 3).map((part: string) => `- ${part}`).join('；')
        : '- 常规更新';
      const whyItMatters = item?.whyItMatters || '提升系统稳定性与可维护性。';
      const evidenceFiles = Array.isArray(item?.evidenceFiles) ? item.evidenceFiles.slice(0, 3).join('，') : '无';
      return `${index + 1}. ${item?.title || '未命名更新'}\n   变更内容：${whatChanged}\n   业务价值：${whyItMatters}\n   影响模块：${modules}\n   证据提交：${commitHashes}\n   证据文件：${evidenceFiles}`;
    });

    const recentEvidence = commits
      .slice(0, 5)
      .map((commit: any, idx: number) => {
        const short = commit?.shortHash || String(commit?.hash || '').slice(0, 7);
        const at = commit?.committedAt || 'unknown-time';
        const subject = commit?.subject || 'no-subject';
        return `${idx + 1}. ${short} | ${at} | ${subject}`;
      })
      .join('\n');

    const boundaryBlock = unknownBoundary.length
      ? `\n\n已知/未知边界：\n${unknownBoundary.map((item: string, idx: number) => `${idx + 1}. ${item}`).join('\n')}`
      : '';

    return `基于最近 ${hours} 小时的仓库提交记录，系统主要更新如下：\n\n${updateLines.join('\n')}\n\n提交证据：\n${recentEvidence}${boundaryBlock}`;
  }

  private async getAllowedToolIds(agent: Agent): Promise<string[]> {
    const profile = await this.getMcpProfileByAgentType((agent.type || '').trim());
    const merged = this
      .uniqueStrings(agent.tools || [], profile.tools || [], [MEMO_MCP_SEARCH_TOOL_ID, MEMO_MCP_APPEND_TOOL_ID])
      .map((toolId) => this.normalizeToolId(toolId));
    if (this.isCtoAgent(agent)) {
      return this.uniqueStrings(merged, [CODE_DOCS_MCP_TOOL_ID, CODE_UPDATES_MCP_TOOL_ID]);
    }
    return merged.filter((toolId) => toolId !== CODE_DOCS_MCP_TOOL_ID && toolId !== CODE_UPDATES_MCP_TOOL_ID);
  }

  private buildTaskResultMemo(response: string): string {
    const normalized = String(response || '').replace(/\s+/g, ' ').trim();
    if (normalized.length <= 800) return normalized;
    return `${normalized.slice(0, 797)}...`;
  }

  private isCtoAgent(agent: Agent): boolean {
    const signal = `${agent.name || ''} ${agent.type || ''} ${agent.description || ''}`.toLowerCase();
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
      const response = await axios.get(`${this.legacyBaseUrl}/hr/roles`, {
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
      const response = await axios.get(`${this.legacyBaseUrl}/hr/roles/${encodeURIComponent(normalizedRoleId)}`, {
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
    const profiles = await this.agentProfileModel.find().exec();
    const record: Record<string, AgentMcpMapProfile> = {};
    for (const profile of profiles) {
      record[profile.agentType] = {
        role: profile.role,
        tools: this.normalizeToolIds(profile.tools || []),
        capabilities: profile.capabilities || [],
        exposed: profile.exposed === true,
        description: profile.description || '',
      };
    }
    return record;
  }

  async getMcpAgents(options?: { includeHidden?: boolean }): Promise<{
    total: number;
    visible: number;
    agents: AgentMcpProfile[];
  }> {
    const includeHidden = options?.includeHidden === true;
    const agents = await this.getAllAgents();
    const normalizedAgents = agents.map((agent) => this.normalizeAgentEntity(agent));
    const profileMap = await this.getMcpProfilesByAgentTypes(normalizedAgents.map((agent) => (agent.type || '').trim()));
    const toolMap = await this.buildToolSummaryMap(normalizedAgents, profileMap);
    const roleMap = await this.getRoleMapByIds(normalizedAgents.map((agent) => agent.roleId));

    const mapped = normalizedAgents.map((agent) => {
      const mapKey = (agent.type || '').trim();
      const profile = profileMap.get(mapKey) || DEFAULT_MCP_PROFILE;
      const role = roleMap.get(agent.roleId);
      return this.toMcpProfile(agent, profile, mapKey, toolMap, role);
    });
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
    const mapKey = (normalized.type || '').trim();
    const mapProfile = await this.getMcpProfileByAgentType(mapKey);
    const toolMap = await this.buildToolSummaryMap([normalized], new Map([[mapKey, mapProfile]]));
    const role = await this.getRoleById(normalized.roleId);
    const profile = this.toMcpProfile(normalized, mapProfile, mapKey, toolMap, role || undefined);

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

  private async buildToolSummaryMap(
    agents: Agent[],
    profileMap: Map<string, AgentMcpMapProfile>,
  ): Promise<Map<string, AgentMcpToolSummary>> {
    const mergedIds = this.uniqueStrings(
      ...agents.map((agent) => {
        const mapProfile = profileMap.get((agent.type || '').trim()) || DEFAULT_MCP_PROFILE;
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
    role?: AgentBusinessRole,
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
      type: agent.type,
      description: agent.description || profile.description || '',
      roleId: agent.roleId,
      role: role?.name || role?.code || profile.role,
      capabilitySet: this.uniqueStrings(agent.capabilities || [], profile.capabilities || []),
      toolSet,
      exposed: profile.exposed === true,
      mapKey: mapKey || 'default',
    };
  }

  async getMcpProfiles(): Promise<AgentProfile[]> {
    const profiles = await this.agentProfileModel.find().sort({ agentType: 1 }).exec();
    return profiles.map((profile) => {
      const plain = profile?.toObject ? profile.toObject() : profile;
      return {
        ...plain,
        tools: this.normalizeToolIds(plain.tools || []),
      } as AgentProfile;
    });
  }

  async getMcpProfile(agentType: string): Promise<AgentProfile | null> {
    const profile = await this.agentProfileModel.findOne({ agentType: agentType.trim() }).exec();
    if (!profile) return null;
    const plain = profile?.toObject ? profile.toObject() : profile;
    return {
      ...plain,
      tools: this.normalizeToolIds(plain.tools || []),
    } as AgentProfile;
  }

  async upsertMcpProfile(
    agentType: string,
    updates: Partial<AgentMcpMapProfile>,
  ): Promise<AgentProfile> {
    const normalizedType = agentType.trim();
    if (!normalizedType) {
      throw new BadRequestException('agentType is required');
    }

    const payload: Partial<AgentProfile> = {
      role: updates.role || DEFAULT_MCP_PROFILE.role,
      tools: this.normalizeToolIds(updates.tools || []),
      capabilities: updates.capabilities || [],
      exposed: updates.exposed === true,
      description: updates.description || '',
    };

    return this.agentProfileModel
      .findOneAndUpdate({ agentType: normalizedType }, { ...payload, agentType: normalizedType }, { new: true, upsert: true })
      .exec();
  }

  private async getMcpProfilesByAgentTypes(agentTypes: string[]): Promise<Map<string, AgentMcpMapProfile>> {
    const uniqueTypes = Array.from(new Set(agentTypes.map((item) => item.trim()).filter(Boolean)));
    if (!uniqueTypes.length) {
      return new Map();
    }

    const profiles = await this.agentProfileModel.find({ agentType: { $in: uniqueTypes } }).exec();
    const map = new Map<string, AgentMcpMapProfile>();
    for (const profile of profiles) {
      map.set(profile.agentType, {
        role: profile.role,
        tools: this.normalizeToolIds(profile.tools || []),
        capabilities: profile.capabilities || [],
        exposed: profile.exposed === true,
        description: profile.description || '',
      });
    }
    return map;
  }

  private async getMcpProfileByAgentType(agentType: string): Promise<AgentMcpMapProfile> {
    if (!agentType) return DEFAULT_MCP_PROFILE;
    const profile = await this.agentProfileModel.findOne({ agentType }).exec();
    if (!profile) {
      return DEFAULT_MCP_PROFILE;
    }
    return {
      role: profile.role,
      tools: this.normalizeToolIds(profile.tools || []),
      capabilities: profile.capabilities || [],
      exposed: profile.exposed === true,
      description: profile.description || '',
    };
  }

  private async ensureMcpProfileSeeds(): Promise<void> {
    try {
      const activeTypes = MCP_PROFILE_SEEDS.map((seed) => seed.agentType);
      for (const seed of MCP_PROFILE_SEEDS) {
        const normalizedSeedTools = this.normalizeToolIds(seed.tools || []);
        await this.agentProfileModel
          .updateOne(
            { agentType: seed.agentType },
            {
              $setOnInsert: {
                role: seed.role,
                tools: normalizedSeedTools,
                capabilities: seed.capabilities,
                exposed: seed.exposed,
                description: seed.description || '',
              },
              $set: {
                role: seed.role,
                exposed: seed.exposed,
                description: seed.description || '',
              },
              $addToSet: {
                tools: { $each: normalizedSeedTools },
                capabilities: { $each: seed.capabilities || [] },
              },
            },
            { upsert: true },
          )
          .exec();
      }

      await this.agentProfileModel
        .updateOne(
          { agentType: 'ai-human-exclusive-assistant' },
          {
            $addToSet: {
              tools: 'mcp.humanOperationLog.list',
            },
          },
        )
        .exec();
      // 移除删除操作：禁止后端重启时删除用户自定义的 agent profile
      // await this.agentProfileModel.deleteMany({ agentType: { $nin: activeTypes } }).exec();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to seed MCP profiles';
      this.logger.warn(`MCP profile seed skipped: ${message}`);
    }
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
                type: 'ai-system-builtin',
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
        type: 'ai-system-builtin',
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
        tools: ['internal.web.search', ...MODEL_MANAGEMENT_AGENT_TOOLS],
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

  private async migrateAllAgentsToSystemBuiltin(): Promise<void> {
    try {
      await this.agentModel
        .updateMany(
          { type: { $ne: 'ai-system-builtin' } },
          {
            $set: {
              type: 'ai-system-builtin',
            },
            $currentDate: { updatedAt: true },
          },
        )
        .exec();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to migrate agent types';
      this.logger.warn(`Agent type migration skipped: ${message}`);
    }
  }

  private async bootstrapMcpProfilesAndAgentTypes(): Promise<void> {
    await this.ensureMcpProfileSeeds();
    // 移除强制迁移：禁止后端重启时将用户自定义 agent 重置为系统内置
    // await this.migrateAllAgentsToSystemBuiltin();
    await this.ensureModelManagementAgent();
  }
}
