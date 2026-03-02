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
import { AVAILABLE_MODELS } from '../../../../../src/config/models';
import { MemoService } from '../memos/memo.service';

export interface AgentContext {
  task: Task;
  teamContext?: any;
  previousMessages: ChatMessage[];
  workingMemory: Map<string, any>;
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
  role: string;
  capabilitySet: string[];
  toolSet: AgentMcpToolSummary[];
  exposed: boolean;
  mapKey: string;
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
const MODEL_MANAGEMENT_AGENT_TOOLS = ['model_mcp_list_models', 'model_mcp_search_latest', 'model_mcp_add_model'];
const CODE_DOCS_MCP_TOOL_ID = 'code-docs-mcp';
const CODE_UPDATES_MCP_TOOL_ID = 'code-updates-mcp';
const MEMO_MCP_SEARCH_TOOL_ID = 'memo_mcp_search';
const MEMO_MCP_APPEND_TOOL_ID = 'memo_mcp_append';
const MODEL_MANAGEMENT_AGENT_PROMPT =
  '你是系统内置模型管理Agent。你的职责是维护系统模型库。若用户询问“系统里有哪些模型/当前模型列表”，必须先调用 model_mcp_list_models 再回答；若用户要求搜索最新模型，处理流程必须严格遵循: 1) 先调用 model_mcp_search_latest 获取候选模型与来源 2) 先向用户返回候选结果摘要并询问“是否需要添加到系统” 3) 仅当用户明确确认“需要添加/确认添加”后，才调用 model_mcp_add_model。未确认时严禁写入系统；不得编造模型参数或来源。若需要调用工具，必须只输出且完整闭合标签：<tool_call>{"tool":"tool_id","parameters":{}}</tool_call>。';

const MCP_PROFILE_SEEDS: Omit<AgentProfile, 'createdAt' | 'updatedAt'>[] = [
  {
    agentType: 'ai-executive',
    role: 'executive-lead',
    tools: ['websearch', 'webfetch', 'content_extract', 'agents_mcp_list'],
    capabilities: ['strategy_planning', 'decision_making', 'stakeholder_communication', 'resource_governance'],
    exposed: true,
    description: '负责战略规划、关键决策与跨团队协同。',
  },
  {
    agentType: 'ai-management-assistant',
    role: 'management-assistant',
    tools: ['websearch', 'webfetch', 'content_extract', 'agents_mcp_list'],
    capabilities: ['schedule_management', 'meeting_followup', 'information_synthesis'],
    exposed: true,
    description: '负责高管日程管理、会议纪要与事项跟进。',
  },
  {
    agentType: 'ai-technical-expert',
    role: 'technical-architect',
    tools: ['websearch', 'webfetch', 'content_extract', 'agents_mcp_list'],
    capabilities: ['system_design', 'technical_planning', 'risk_assessment'],
    exposed: true,
    description: '负责技术架构、方案评审与技术风险控制。',
  },
  {
    agentType: 'ai-fullstack-engineer',
    role: 'fullstack-engineer',
    tools: ['websearch', 'webfetch', 'content_extract'],
    capabilities: ['frontend_implementation', 'backend_implementation', 'integration_testing'],
    exposed: true,
    description: '负责前后端实现、联调测试与工程交付。',
  },
  {
    agentType: 'ai-devops-engineer',
    role: 'devops-engineer',
    tools: ['websearch', 'webfetch', 'content_extract'],
    capabilities: ['deployment_automation', 'monitoring_alerting', 'incident_response'],
    exposed: true,
    description: '负责部署发布、监控告警与系统稳定性保障。',
  },
  {
    agentType: 'ai-data-analyst',
    role: 'data-analyst',
    tools: ['websearch', 'webfetch', 'content_extract'],
    capabilities: ['data_analysis', 'insight_generation', 'reporting'],
    exposed: true,
    description: '负责数据分析、结论提炼与报告输出。',
  },
  {
    agentType: 'ai-product-manager',
    role: 'product-manager',
    tools: ['websearch', 'webfetch'],
    capabilities: ['requirement_planning', 'roadmap_management', 'cross_team_alignment'],
    exposed: true,
    description: '负责产品规划、优先级管理与跨团队推进。',
  },
  {
    agentType: 'ai-hr',
    role: 'human-resources-manager',
    tools: ['websearch'],
    capabilities: ['talent_acquisition', 'performance_management', 'organization_development'],
    exposed: true,
    description: '负责招聘、绩效管理与组织人才发展。',
  },
  {
    agentType: 'ai-admin-assistant',
    role: 'administrative-assistant',
    tools: ['websearch', 'webfetch'],
    capabilities: ['administrative_coordination', 'meeting_support', 'document_management'],
    exposed: true,
    description: '负责行政事务、会议支持与流程协同。',
  },
  {
    agentType: 'ai-marketing-expert',
    role: 'marketing-strategist',
    tools: ['websearch', 'webfetch', 'content_extract'],
    capabilities: ['campaign_planning', 'brand_communication', 'growth_optimization'],
    exposed: true,
    description: '负责市场策略、活动策划与增长转化。',
  },
  {
    agentType: 'ai-human-exclusive-assistant',
    role: 'human-exclusive-assistant',
    tools: ['websearch', 'webfetch', 'content_extract', 'human_operation_log_mcp_list'],
    capabilities: ['personal_schedule_management', 'task_followup', 'communication_drafting'],
    exposed: true,
    description: '面向人类用户的专属助理，负责个人事务协同与执行跟进。',
  },
  {
    agentType: 'ai-system-builtin',
    role: 'system-builtin-agent',
    tools: ['websearch', 'webfetch', 'content_extract', 'agents_mcp_list', 'model_mcp_list_models', 'model_mcp_search_latest', 'model_mcp_add_model'],
    capabilities: ['system_coordination', 'workflow_orchestration', 'platform_safeguard'],
    exposed: true,
    description: '系统内置类型，用于平台默认流程与系统任务协同。',
  },
];

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    @InjectModel(Agent.name) private agentModel: Model<AgentDocument>,
    @InjectModel(AgentProfile.name) private agentProfileModel: Model<AgentProfileDocument>,
    @InjectModel(AgentSkill.name) private agentSkillModel: Model<AgentSkillDocument>,
    @InjectModel(Skill.name) private skillModel: Model<SkillDocument>,
    private readonly modelService: ModelService,
    private readonly apiKeyService: ApiKeyService,
    private readonly toolService: ToolService,
    private readonly memoService: MemoService,
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
    if (!agentData.model?.id || !agentData.model?.name || !agentData.model?.provider || !agentData.model?.model) {
      throw new BadRequestException('Valid model configuration is required');
    }

    const normalizedData: Omit<Agent, 'id' | 'createdAt' | 'updatedAt'> = {
      ...agentData,
      role: agentData.role?.trim() || undefined,
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

    try {
      const modelConfig: AIModel = {
        id: normalizedData.model.id,
        name: normalizedData.model.name,
        provider: normalizedData.model.provider as AIModel['provider'],
        model: normalizedData.model.model,
        maxTokens: normalizedData.model.maxTokens || 4096,
        temperature: normalizedData.model.temperature ?? 0.7,
        topP: normalizedData.model.topP,
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

    const hasRoleField = Object.prototype.hasOwnProperty.call(updates, 'role');
    if (hasRoleField) {
      const normalizedRole = typeof updates.role === 'string' ? updates.role.trim() : '';
      if (normalizedRole) {
        normalizedUpdates.role = normalizedRole;
      } else {
        delete normalizedUpdates.role;
        normalizedUpdates.$unset = {
          ...(normalizedUpdates.$unset || {}),
          role: 1,
        };
      }
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

    return this.agentModel.findByIdAndUpdate(
      agentId,
      normalizedUpdates,
      { new: true }
    ).exec();
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

    try {
      // 确保模型已注册 - 类型转换
      const modelConfig: AIModel = {
        id: agent.model.id,
        name: agent.model.name,
        provider: agent.model.provider as AIModel['provider'],
        model: agent.model.model,
        maxTokens: agent.model.maxTokens || 4096,
        temperature: agent.model.temperature || 0.7,
        topP: agent.model.topP
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

      const response = await this.executeWithToolCalling(agent, task, messages, modelConfig);

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
        await this.memoService.completeTaskTodo(agent.id || agentId, taskId, 'Task finished by agent runtime');
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

      return response;
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
      throw error;
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
      topP: agent.model.topP
    };
    this.modelService.ensureProviderWithKey(modelConfig, customApiKey);

    let fullResponse = '';
    let tokenChunks = 0;
    try {
      await this.modelService.streamingChat(
        agent.model.id,
        messages,
        (token) => {
          fullResponse += token;
          tokenChunks += 1;
          onToken(token);
        },
        {
          temperature: agent.model.temperature,
          maxTokens: agent.model.maxTokens,
        }
      );
    } catch (error) {
      const logError = this.toLogError(error);
      this.logger.error(
        `[stream_task_failed] agent=${agent.name} taskId=${taskId} durationMs=${Date.now() - taskStartAt} tokenChunks=${tokenChunks} error=${logError.message}`,
        logError.stack,
      );
      throw error;
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
        id: tool.id,
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

    if (allowedToolIds.includes('agents_mcp_list')) {
      messages.push({
        role: 'system',
        content:
          '当用户询问“系统里有哪些agents/当前有哪些agent/agent列表”时，请优先调用 agents_mcp_list 工具获取实时名单，再基于工具结果回答。',
        timestamp: new Date(),
      });
    }

    if (allowedToolIds.includes('model_mcp_list_models')) {
      messages.push({
        role: 'system',
        content:
          '当用户询问“系统里有哪些模型/当前有哪些模型/模型列表”时，请优先调用 model_mcp_list_models 获取实时模型清单，再回答。',
        timestamp: new Date(),
      });
    }

    if (allowedToolIds.includes('model_mcp_search_latest') && allowedToolIds.includes('model_mcp_add_model')) {
      messages.push({
        role: 'system',
        content:
          '当用户要求“搜索最新模型并加入系统”时，请按顺序调用 model_mcp_search_latest 与 model_mcp_add_model；必须先返回候选并询问“是否需要添加到系统”，仅在用户明确确认后才允许入库。',
        timestamp: new Date(),
      });
    }

    if (allowedToolIds.includes(CODE_DOCS_MCP_TOOL_ID)) {
      messages.push({
        role: 'system',
        content:
          '当用户询问“当前系统实现了哪些核心功能/系统能力清单/docs里实现了什么”时，请优先调用 code-docs-mcp 并基于其 evidence 路径回答；若工具返回 unknownBoundary，必须明确告知未知范围，不得臆测。',
        timestamp: new Date(),
      });
    }

    if (allowedToolIds.includes(CODE_UPDATES_MCP_TOOL_ID)) {
      messages.push({
        role: 'system',
        content:
          '当用户询问“最近24小时/最近一天系统主要更新”时，请优先调用 code-updates-mcp 并基于提交证据回答；若工具返回 unknownBoundary，必须明确告知未知范围，不得臆测。',
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
          '请优先参考这些记忆，并在必要时调用 memo_mcp_search 获取更完整上下文；若有新结论可调用 memo_mcp_append 追加沉淀。',
        timestamp: new Date(),
      });
    }

    if (allowedToolIds.includes(MEMO_MCP_SEARCH_TOOL_ID) && allowedToolIds.includes(MEMO_MCP_APPEND_TOOL_ID)) {
      messages.push({
        role: 'system',
        content:
          '在处理任务时，优先调用 memo_mcp_search 检索相关历史备忘录；当形成关键结论或后续动作时，调用 memo_mcp_append 将知识、行为或TODO追加到备忘录。',
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
        );
        return this.formatCodeDocsMcpAnswer(execution.result || {});
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
        );
        return this.formatCodeUpdatesMcpAnswer(execution.result || {}, forcedUpdatesHours);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown error';
        this.logger.warn(`Forced tool call ${CODE_UPDATES_MCP_TOOL_ID} failed: ${message}`);
        return `我尝试通过 ${CODE_UPDATES_MCP_TOOL_ID} 汇总最近更新，但调用失败（${message}）。当前无法提供可靠更新清单，请稍后重试。`;
      }
    }

    for (let round = 0; round <= maxToolRounds; round++) {
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
              '你正在处理模型管理请求。禁止在未调用并拿到工具结果时声称“已添加成功/已完成添加”。请立即调用 model_mcp_add_model 执行写入，并调用 model_mcp_list_models 验证后再回答。若工具失败，请明确说明失败原因。',
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

      if (!assignedToolIds.has(toolCall.tool)) {
        this.logger.warn(
          `[tool_denied] agent=${agent.name} taskId=${task.id} round=${round + 1} tool=${toolCall.tool}`,
        );
        messages.push({
          role: 'system',
          content: `工具调用被拒绝: agent 未分配工具 ${toolCall.tool}。请在已授权工具内重新尝试，或直接给出不依赖该工具的回答。`,
          timestamp: new Date(),
        });
        continue;
      }

      try {
        this.logger.log(
          `[tool_execute_start] agent=${agent.name} taskId=${task.id} round=${round + 1} tool=${toolCall.tool} parameters=${this.compactLogText(JSON.stringify(toolCall.parameters || {}), 240)}`,
        );
        const execution = await this.toolService.executeTool(
          toolCall.tool,
          agentRuntimeId,
          toolCall.parameters,
          task.id,
        );
        executedToolIds.add(toolCall.tool);
        this.logger.log(
          `[tool_execute_success] agent=${agent.name} taskId=${task.id} round=${round + 1} tool=${toolCall.tool} resultKeys=${Object.keys(execution.result || {}).join('|') || 'none'}`,
        );

        messages.push({
          role: 'system',
          content: `工具 ${toolCall.tool} 调用结果: ${JSON.stringify(execution.result || {})}`,
          timestamp: new Date(),
        });
      } catch (error) {
        const logError = this.toLogError(error);
        this.logger.error(
          `[tool_execute_failed] agent=${agent.name} taskId=${task.id} round=${round + 1} tool=${toolCall.tool} error=${logError.message}`,
          logError.stack,
        );
        const message = logError.message;
        messages.push({
          role: 'system',
          content: `工具 ${toolCall.tool} 调用失败: ${message}。请根据现有信息继续回答。`,
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

    const addExecuted = executedToolIds.has('model_mcp_add_model');
    const listExecuted = executedToolIds.has('model_mcp_list_models');
    const searchExecuted = executedToolIds.has('model_mcp_search_latest');

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

    if (asksAddStatus && assignedToolIds.has('model_mcp_list_models')) {
      try {
        const listExecution = await this.toolService.executeTool(
          'model_mcp_list_models',
          agentRuntimeId,
          { limit: 500 },
          task.id,
        );
        const list = Array.isArray(listExecution?.result?.models) ? listExecution.result.models : [];
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

    if (!isConfirmAdd || !assignedToolIds.has('model_mcp_add_model')) {
      return null;
    }

    const addResults: Array<{ model: string; created: boolean; message: string }> = [];
    for (const model of targets) {
      const provider = this.inferProviderFromModelId(model);
      try {
        const addExecution = await this.toolService.executeTool(
          'model_mcp_add_model',
          agentRuntimeId,
          {
            provider,
            model,
            name: this.toModelDisplayName(model),
          },
          task.id,
        );

        addResults.push({
          model,
          created: Boolean(addExecution?.result?.created),
          message: String(addExecution?.result?.message || ''),
        });
      } catch (error) {
        addResults.push({
          model,
          created: false,
          message: error instanceof Error ? error.message : 'unknown error',
        });
      }
    }

    if (!assignedToolIds.has('model_mcp_list_models')) {
      const lines = addResults.map((item) => `- ${item.model}: ${item.created ? '已添加' : `失败（${item.message}）`}`);
      return `已执行模型添加请求，结果如下：\n${lines.join('\n')}`;
    }

    try {
      const listExecution = await this.toolService.executeTool(
        'model_mcp_list_models',
        agentRuntimeId,
        { limit: 500 },
        task.id,
      );
      const list = Array.isArray(listExecution?.result?.models) ? listExecution.result.models : [];
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
    const merged = this.uniqueStrings(agent.tools || [], profile.tools || [], [MEMO_MCP_SEARCH_TOOL_ID, MEMO_MCP_APPEND_TOOL_ID]);
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
    const signal = `${agent.name || ''} ${agent.role || ''} ${agent.type || ''} ${agent.description || ''}`.toLowerCase();
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

  async getAgentsMcpMap(): Promise<Record<string, AgentMcpMapProfile>> {
    const profiles = await this.agentProfileModel.find().exec();
    const record: Record<string, AgentMcpMapProfile> = {};
    for (const profile of profiles) {
      record[profile.agentType] = {
        role: profile.role,
        tools: profile.tools || [],
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

    const mapped = normalizedAgents.map((agent) => {
      const mapKey = (agent.type || '').trim();
      const profile = profileMap.get(mapKey) || DEFAULT_MCP_PROFILE;
      return this.toMcpProfile(agent, profile, mapKey, toolMap);
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
    const profile = this.toMcpProfile(normalized, mapProfile, mapKey, toolMap);

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
    );

    if (!mergedIds.length) {
      return new Map();
    }

    const tools = await this.toolService.getToolsByIds(mergedIds);
    const summaryMap = new Map<string, AgentMcpToolSummary>();
    for (const tool of tools as any[]) {
      summaryMap.set(tool.id, {
        id: tool.id,
        name: tool.name,
        description: tool.description,
        type: tool.type,
        category: tool.category,
      });
    }
    return summaryMap;
  }

  private toMcpProfile(
    agent: Agent,
    profile: AgentMcpMapProfile,
    mapKey: string,
    toolMap: Map<string, AgentMcpToolSummary>,
  ): AgentMcpProfile {
    const toolIds = this.uniqueStrings(agent.tools || [], profile.tools || []);
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
      role: agent.role || profile.role,
      capabilitySet: this.uniqueStrings(agent.capabilities || [], profile.capabilities || []),
      toolSet,
      exposed: profile.exposed === true,
      mapKey: mapKey || 'default',
    };
  }

  async getMcpProfiles(): Promise<AgentProfile[]> {
    return this.agentProfileModel.find().sort({ agentType: 1 }).exec();
  }

  async getMcpProfile(agentType: string): Promise<AgentProfile | null> {
    return this.agentProfileModel.findOne({ agentType: agentType.trim() }).exec();
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
      tools: updates.tools || [],
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
        tools: profile.tools || [],
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
      tools: profile.tools || [],
      capabilities: profile.capabilities || [],
      exposed: profile.exposed === true,
      description: profile.description || '',
    };
  }

  private async ensureMcpProfileSeeds(): Promise<void> {
    try {
      const activeTypes = MCP_PROFILE_SEEDS.map((seed) => seed.agentType);
      for (const seed of MCP_PROFILE_SEEDS) {
        await this.agentProfileModel
          .updateOne(
            { agentType: seed.agentType },
            {
              $setOnInsert: {
                role: seed.role,
                tools: seed.tools,
                capabilities: seed.capabilities,
                exposed: seed.exposed,
                description: seed.description || '',
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
              tools: 'human_operation_log_mcp_list',
            },
          },
        )
        .exec();

      await this.agentProfileModel.deleteMany({ agentType: { $nin: activeTypes } }).exec();
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
                role: 'model-management-specialist',
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
        role: 'model-management-specialist',
        description: '系统内置模型管理Agent，可联网检索最新模型并添加到系统模型列表。',
        model: {
          id: model.id,
          name: model.name,
          provider: model.provider,
          model: model.model,
          maxTokens: model.maxTokens || 8192,
          temperature: model.temperature ?? 0.2,
          topP: model.topP,
        },
        capabilities: ['model_discovery', 'model_registry_management', 'internet_research'],
        systemPrompt: MODEL_MANAGEMENT_AGENT_PROMPT,
        isActive: true,
        tools: ['websearch', ...MODEL_MANAGEMENT_AGENT_TOOLS],
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
    await this.migrateAllAgentsToSystemBuiltin();
    await this.ensureModelManagementAgent();
  }
}
