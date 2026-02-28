import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { Tool, ToolDocument } from '../../../../../src/shared/schemas/tool.schema';
import { ToolExecution, ToolExecutionDocument } from '../../../../../src/shared/schemas/toolExecution.schema';
import { Agent, AgentDocument } from '../../../../../src/shared/schemas/agent.schema';
import { AgentProfile, AgentProfileDocument } from '../../../../../src/shared/schemas/agent-profile.schema';
import { ComposioService } from './composio.service';

const DEFAULT_PROFILE = {
  role: 'general-assistant',
  tools: [],
  capabilities: [],
  exposed: false,
};

@Injectable()
export class ToolService {
  private readonly logger = new Logger(ToolService.name);

  constructor(
    @InjectModel(Tool.name) private toolModel: Model<ToolDocument>,
    @InjectModel(ToolExecution.name) private executionModel: Model<ToolExecutionDocument>,
    @InjectModel(Agent.name) private agentModel: Model<AgentDocument>,
    @InjectModel(AgentProfile.name) private agentProfileModel: Model<AgentProfileDocument>,
    private composioService: ComposioService,
  ) {
    void this.initializeBuiltinTools();
  }

  private async initializeBuiltinTools() {
    const builtinTools = [
      {
        id: 'websearch',
        name: 'Web Search',
        description: 'Search web information via Composio SERPAPI',
        type: 'web_search' as const,
        category: 'Information Retrieval',
        requiredPermissions: [{ id: 'basic_web', name: 'Basic Web Access', level: 'basic' }],
        tokenCost: 10,
        implementation: {
          type: 'built_in' as const,
          parameters: { query: 'string', maxResults: 'number' },
        },
      },
      {
        id: 'slack',
        name: 'Slack',
        description: 'Send Slack messages via Composio',
        type: 'api_call' as const,
        category: 'Communication',
        requiredPermissions: [{ id: 'slack_send', name: 'Slack Message Permission', level: 'intermediate' }],
        tokenCost: 15,
        implementation: {
          type: 'built_in' as const,
          parameters: { channel: 'string', text: 'string' },
        },
      },
      {
        id: 'gmail',
        name: 'Gmail',
        description: 'Send or draft email via Composio',
        type: 'api_call' as const,
        category: 'Communication',
        requiredPermissions: [{ id: 'gmail_send', name: 'Gmail Permission', level: 'intermediate' }],
        tokenCost: 20,
        implementation: {
          type: 'built_in' as const,
          parameters: { to: 'string', subject: 'string', body: 'string', action: 'string' },
        },
      },
      {
        id: 'agents_mcp_list',
        name: 'Agents MCP List',
        description: 'List current agents, roles, and capability summaries from MCP visibility rules',
        type: 'data_analysis' as const,
        category: 'System Intelligence',
        requiredPermissions: [{ id: 'data_access', name: 'Agent Registry Read', level: 'basic' }],
        tokenCost: 3,
        implementation: {
          type: 'built_in' as const,
          parameters: { includeHidden: 'boolean', limit: 'number' },
        },
      },
    ];

    const virtualToolIds = [
      'web_search',
      'code_execution',
      'file_read',
      'file_write',
      'data_analysis',
      'video_editing',
      'api_call',
    ];

    await this.toolModel.deleteMany({ id: { $in: virtualToolIds } }).exec();

    for (const toolData of builtinTools) {
      const existingTool = await this.toolModel.findOne({ id: toolData.id }).exec();
      if (!existingTool) {
        const tool = new this.toolModel(toolData);
        await tool.save();
        this.logger.log(`已注册内置工具: ${toolData.name}`);
      }
    }
  }

  async getAllTools(): Promise<Tool[]> {
    return this.toolModel.find().sort({ category: 1, name: 1 }).exec();
  }

  async getTool(toolId: string): Promise<Tool | null> {
    return this.toolModel.findOne({ id: toolId }).exec();
  }

  async getToolsByIds(toolIds: string[]): Promise<Tool[]> {
    if (!toolIds.length) return [];
    return this.toolModel.find({ id: { $in: toolIds }, enabled: true }).exec();
  }

  async createTool(toolData: Omit<Tool, 'id' | 'createdAt' | 'updatedAt'>): Promise<Tool> {
    const newTool = new this.toolModel({
      ...toolData,
      id: uuidv4(),
    });
    return newTool.save();
  }

  async updateTool(toolId: string, updates: Partial<Tool>): Promise<Tool | null> {
    return this.toolModel
      .findOneAndUpdate({ id: toolId }, { ...updates, updatedAt: new Date() }, { new: true })
      .exec();
  }

  async deleteTool(toolId: string): Promise<boolean> {
    const result = await this.toolModel.findOneAndDelete({ id: toolId }).exec();
    return !!result;
  }

  async executeTool(toolId: string, agentId: string, parameters: any, taskId?: string): Promise<ToolExecution> {
    const tool = await this.getTool(toolId);
    if (!tool) {
      throw new Error(`Tool not found: ${toolId}`);
    }
    if (!tool.enabled) {
      throw new Error(`Tool is disabled: ${toolId}`);
    }

    const execution = new this.executionModel({
      id: uuidv4(),
      toolId,
      agentId,
      taskId,
      parameters,
      status: 'executing',
      tokenCost: tool.tokenCost || 0,
    });
    await execution.save();

    try {
      const result = await this.executeToolImplementation(tool, parameters, agentId);
      execution.result = result;
      execution.status = 'completed';
      execution.executionTime = Date.now() - execution.timestamp.getTime();
      await execution.save();
      return execution;
    } catch (error) {
      execution.status = 'failed';
      execution.error = error instanceof Error ? error.message : 'Unknown error';
      execution.executionTime = Date.now() - execution.timestamp.getTime();
      await execution.save();
      throw error;
    }
  }

  private async executeToolImplementation(tool: Tool, parameters: any, agentId?: string): Promise<any> {
    switch (tool.id) {
      case 'websearch':
        return this.performWebSearch(parameters, agentId);
      case 'slack':
        return this.sendSlackMessage(parameters, agentId);
      case 'gmail':
        return this.sendGmail(parameters, agentId);
      case 'agents_mcp_list':
        return this.getAgentsMcpList(parameters);
      default:
        throw new Error(`Tool implementation not found: ${tool.id}`);
    }
  }

  private async getAgentsMcpList(params: { includeHidden?: boolean; limit?: number }): Promise<any> {
    const includeHidden = params?.includeHidden === true;
    const limit = Math.max(1, Math.min(Number(params?.limit || 20), 100));
    const agents = await this.agentModel.find().exec();
    const agentTypes = Array.from(new Set(agents.map((agent: any) => String(agent.type || '').trim()).filter(Boolean)));
    const profiles = await this.agentProfileModel.find({ agentType: { $in: agentTypes } }).exec();
    const profileMap = new Map<string, AgentProfile>();
    for (const profile of profiles) {
      profileMap.set(profile.agentType, profile);
    }

    const mapped = agents.map((agent) => {
      const plain = agent?.toObject ? agent.toObject() : agent;
      const type = (plain.type || '').trim();
      const profile = profileMap.get(type) || DEFAULT_PROFILE;
      return {
        id: plain.id || plain._id?.toString?.() || plain._id,
        name: plain.name,
        type: plain.type,
        role: plain.role || profile.role,
        capabilitySet: Array.from(new Set([...(plain.capabilities || []), ...(profile.capabilities || [])])).slice(0, 12),
        exposed: profile.exposed === true,
        isActive: plain.isActive === true,
      };
    });

    const visibleAgents = mapped.filter((item) => includeHidden || item.exposed).slice(0, limit);

    return {
      total: mapped.length,
      visible: visibleAgents.length,
      includeHidden,
      agents: visibleAgents,
      fetchedAt: new Date().toISOString(),
    };
  }

  private async performWebSearch(params: { query: string; maxResults?: number }, userId?: string): Promise<any> {
    if (!params?.query) {
      throw new Error('websearch requires parameter: query');
    }

    const result = await this.composioService.webSearch(params.query, params.maxResults || 10, userId);
    if (!result.successful) {
      throw new Error(result.error || 'Composio websearch failed');
    }

    const raw = result.data || {};
    const rows = raw?.organic || raw?.results?.organic_results || raw?.results || [];
    const organicResults = Array.isArray(rows) ? rows : [];

    return {
      query: params.query,
      provider: 'composio/serpapi',
      results: organicResults.map((item: any) => ({
        title: item.title,
        url: item.link,
        snippet: item.snippet,
        date: item.date,
      })),
      totalResults: organicResults.length,
      raw,
    };
  }

  private async sendSlackMessage(params: { channel: string; text: string }, userId?: string): Promise<any> {
    if (!params?.channel || !params?.text) {
      throw new Error('slack requires parameters: channel, text');
    }

    const result = await this.composioService.slackSendMessage(params.channel, params.text, userId);
    if (!result.successful) {
      throw new Error(result.error || 'Composio slack send failed');
    }

    return {
      provider: 'composio/slack',
      status: 'sent',
      channel: params.channel,
      text: params.text,
      raw: result.data,
    };
  }

  private async sendGmail(
    params: { to: string; subject: string; body: string; action?: 'draft' | 'send' },
    userId?: string,
  ): Promise<any> {
    if (!params?.to || !params?.subject || !params?.body) {
      throw new Error('gmail requires parameters: to, subject, body');
    }

    const action = params.action || 'send';
    const result = await this.composioService.gmailSendEmail(
      params.to,
      params.subject,
      params.body,
      action,
      userId,
    );

    if (!result.successful) {
      throw new Error(result.error || 'Composio gmail send failed');
    }

    return {
      provider: 'composio/gmail',
      status: action === 'draft' ? 'drafted' : 'sent',
      to: params.to,
      subject: params.subject,
      action,
      raw: result.data,
    };
  }

  async getToolExecutions(agentId?: string, toolId?: string): Promise<ToolExecution[]> {
    const filter: any = {};
    if (agentId) filter.agentId = agentId;
    if (toolId) filter.toolId = toolId;
    return this.executionModel.find(filter).sort({ timestamp: -1 }).exec();
  }

  async getToolExecutionStats(): Promise<any> {
    return this.executionModel
      .aggregate([
        {
          $group: {
            _id: '$toolId',
            totalExecutions: { $sum: 1 },
            totalCost: { $sum: '$tokenCost' },
            avgExecutionTime: { $avg: '$executionTime' },
            successRate: { $avg: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
          },
        },
      ])
      .exec();
  }
}
