import { Injectable, NotFoundException, Logger, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Agent, AgentDocument } from '../../../../../src/shared/schemas/agent.schema';
import { AgentProfile, AgentProfileDocument } from '../../../../../src/shared/schemas/agent-profile.schema';
import { ModelService } from '../../../../../src/modules/models/model.service';
import { ApiKeyService } from '../../../../../src/modules/api-keys/api-key.service';
import { Task, ChatMessage, AIModel } from '../../../../../src/shared/types';
import { ToolService } from '../tools/tool.service';
import { v4 as uuidv4 } from 'uuid';

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

const DEFAULT_MCP_PROFILE: AgentMcpMapProfile = {
  role: 'general-assistant',
  tools: [],
  capabilities: [],
  exposed: false,
  description: 'No MCP profile found for this agent type',
};

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
    agentType: 'ai-system-builtin',
    role: 'system-builtin-agent',
    tools: ['websearch', 'webfetch', 'content_extract', 'agents_mcp_list'],
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
    private readonly modelService: ModelService,
    private readonly apiKeyService: ApiKeyService,
    private readonly toolService: ToolService,
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

    this.logger.log(`Agent ${agent.name} executing task: ${task.title}`);

    const agentContext: AgentContext = {
      task,
      previousMessages: task.messages || [],
      workingMemory: new Map(),
      teamContext: context?.teamContext,
      ...context,
    };

    const messages = await this.buildMessages(agent, task, agentContext);

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
          this.logger.log(`Using custom API key for agent ${agent.name}`);
          // 记录API Key使用情况
          await this.apiKeyService.recordUsage(agent.apiKeyId);
        }
      }

      // 注册provider（使用自定义key或默认key）
      this.modelService.ensureProviderWithKey(modelConfig, customApiKey);

      const response = await this.executeWithToolCalling(agent, task, messages, modelConfig);

      this.logger.log(`Agent ${agent.name} completed task, response length: ${response.length}`);

      // 更新任务消息历史
      task.messages.push({
        role: 'assistant',
        content: response,
        timestamp: new Date(),
        metadata: { agentId: agent.id, agentName: agent.name },
      });

      return response;
    } catch (error) {
      this.logger.error(`Agent ${agent.name} failed to execute task: ${error.message}`);
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

    const agentContext: AgentContext = {
      task,
      previousMessages: task.messages || [],
      workingMemory: new Map(),
      teamContext: context?.teamContext,
      ...context,
    };

    const messages = await this.buildMessages(agent, task, agentContext);

    // 获取自定义API Key（如果配置了）
    let customApiKey: string | undefined;
    if (agent.apiKeyId) {
      customApiKey = await this.apiKeyService.getDecryptedKey(agent.apiKeyId);
      if (customApiKey) {
        this.logger.log(`Using custom API key for agent ${agent.name} (streaming)`);
        await this.apiKeyService.recordUsage(agent.apiKeyId);
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
    await this.modelService.streamingChat(
      agent.model.id,
      messages,
      (token) => {
        fullResponse += token;
        onToken(token);
      },
      {
        temperature: agent.model.temperature,
        maxTokens: agent.model.maxTokens,
      }
    );

    // 更新任务消息历史
    task.messages.push({
      role: 'assistant',
      content: fullResponse,
      timestamp: new Date(),
      metadata: { agentId: agent.id },
    });
  }

  private async buildMessages(agent: Agent, task: Task, context: AgentContext): Promise<ChatMessage[]> {
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

    // 历史消息
    messages.push(...context.previousMessages);

    return messages;
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

    for (let round = 0; round <= maxToolRounds; round++) {
      const response = await this.modelService.chat(modelConfig.id, messages, {
        temperature: modelConfig.temperature,
        maxTokens: modelConfig.maxTokens,
      });

      const toolCall = this.extractToolCall(response);
      if (!toolCall) {
        return this.stripToolCallMarkup(response);
      }

      messages.push({
        role: 'assistant',
        content: response,
        timestamp: new Date(),
      });

      if (!assignedToolIds.has(toolCall.tool)) {
        messages.push({
          role: 'system',
          content: `工具调用被拒绝: agent 未分配工具 ${toolCall.tool}。请在已授权工具内重新尝试，或直接给出不依赖该工具的回答。`,
          timestamp: new Date(),
        });
        continue;
      }

      try {
        const execution = await this.toolService.executeTool(
          toolCall.tool,
          agent.id || (agent as any)._id?.toString?.() || '',
          toolCall.parameters,
          task.id,
        );

        messages.push({
          role: 'system',
          content: `工具 ${toolCall.tool} 调用结果: ${JSON.stringify(execution.result || {})}`,
          timestamp: new Date(),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown tool execution error';
        messages.push({
          role: 'system',
          content: `工具 ${toolCall.tool} 调用失败: ${message}。请根据现有信息继续回答。`,
          timestamp: new Date(),
        });
      }
    }

    return '工具调用轮次已达上限，请精简调用后重试。';
  }

  private extractToolCall(response: string): { tool: string; parameters: any } | null {
    const match = response.match(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/i);
    if (!match) return null;

    const rawPayload = match[1].trim();
    const cleaned = rawPayload.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();

    try {
      const parsed = JSON.parse(cleaned);
      if (!parsed?.tool || typeof parsed.tool !== 'string') {
        return null;
      }

      return {
        tool: parsed.tool,
        parameters: parsed.parameters || {},
      };
    } catch {
      return null;
    }
  }

  private stripToolCallMarkup(content: string): string {
    return content.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '').trim();
  }

  private async getAllowedToolIds(agent: Agent): Promise<string[]> {
    const profile = await this.getMcpProfileByAgentType((agent.type || '').trim());
    return this.uniqueStrings(agent.tools || [], profile.tools || []);
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

      await this.agentProfileModel.deleteMany({ agentType: { $nin: activeTypes } }).exec();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to seed MCP profiles';
      this.logger.warn(`MCP profile seed skipped: ${message}`);
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
  }
}
