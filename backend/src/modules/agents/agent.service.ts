import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Agent, AgentDocument } from '../../shared/schemas/agent.schema';
import { ModelService } from '../models/model.service';
import { Task, ChatMessage } from '../../shared/types';
import { v4 as uuidv4 } from 'uuid';

export interface AgentContext {
  task: Task;
  teamContext?: any;
  previousMessages: ChatMessage[];
  workingMemory: Map<string, any>;
}

@Injectable()
export class AgentService {
  constructor(
    @InjectModel(Agent.name) private agentModel: Model<AgentDocument>,
    private readonly modelService: ModelService
  ) {}

  async createAgent(agentData: Omit<Agent, 'id' | 'createdAt' | 'updatedAt'>): Promise<Agent> {
    const newAgent = new this.agentModel(agentData);
    return newAgent.save();
  }

  async getAgent(agentId: string): Promise<Agent | null> {
    return this.agentModel.findById(agentId).exec();
  }

  async getAllAgents(): Promise<Agent[]> {
    return this.agentModel.find().exec();
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

    const agentContext: AgentContext = {
      task,
      previousMessages: task.messages || [],
      workingMemory: new Map(),
      teamContext: context?.teamContext,
      ...context,
    };

    const messages = this.buildMessages(agent, task, agentContext);
    
    const response = await this.modelService.chat(agent.model.id, messages, {
      temperature: agent.model.temperature,
      maxTokens: agent.model.maxTokens,
    });

    // 更新任务消息历史
    task.messages.push({
      role: 'assistant',
      content: response,
      timestamp: new Date(),
      metadata: { agentId: agent.id },
    });

    return response;
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