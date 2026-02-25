import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Agent, AgentDocument } from '../../shared/schemas/agent.schema';
import { ModelService } from '../models/model.service';
import { ApiKeyService } from '../api-keys/api-key.service';
import { Task, ChatMessage, AIModel } from '../../shared/types';
import { v4 as uuidv4 } from 'uuid';

export interface AgentContext {
  task: Task;
  teamContext?: any;
  previousMessages: ChatMessage[];
  workingMemory: Map<string, any>;
}

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    @InjectModel(Agent.name) private agentModel: Model<AgentDocument>,
    private readonly modelService: ModelService,
    private readonly apiKeyService: ApiKeyService
  ) {}

  async createAgent(agentData: Omit<Agent, 'id' | 'createdAt' | 'updatedAt'>): Promise<Agent> {
    // 自动注册Agent使用的模型
    if (agentData.model) {
      const modelConfig: AIModel = {
        id: agentData.model.id,
        name: agentData.model.name,
        provider: agentData.model.provider as AIModel['provider'],
        model: agentData.model.model,
        maxTokens: agentData.model.maxTokens || 4096,
        temperature: agentData.model.temperature || 0.7,
        topP: agentData.model.topP
      };
      this.modelService.ensureProvider(modelConfig);
      this.logger.log(`Agent ${agentData.name} using model: ${modelConfig.name} (${modelConfig.id})`);
    }
    
    const newAgent = new this.agentModel(agentData);
    return newAgent.save();
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
    return this.agentModel.findByIdAndUpdate(
      agentId, 
      { ...updates, updatedAt: new Date() }, 
      { new: true }
    ).exec();
  }

  async deleteAgent(agentId: string): Promise<boolean> {
    const result = await this.agentModel.findByIdAndDelete(agentId).exec();
    return !!result;
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

    const messages = this.buildMessages(agent, task, agentContext);
    
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
      
      const response = await this.modelService.chat(modelConfig.id, messages, {
        temperature: modelConfig.temperature,
        maxTokens: modelConfig.maxTokens,
      });

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

    const messages = this.buildMessages(agent, task, agentContext);
    
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

  private buildMessages(agent: Agent, task: Task, context: AgentContext): ChatMessage[] {
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

    // 历史消息
    messages.push(...context.previousMessages);

    return messages;
  }

  async getAgentCapabilities(agentId: string): Promise<string[]> {
    const agent = await this.getAgent(agentId);
    return agent?.capabilities || [];
  }

  async isAgentAvailable(agentId: string): Promise<boolean> {
    const agent = await this.getAgent(agentId);
    return agent?.isActive || false;
  }
}