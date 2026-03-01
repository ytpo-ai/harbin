import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { Tool, ToolDocument } from '../../../../../src/shared/schemas/tool.schema';
import { ToolExecution, ToolExecutionDocument } from '../../../../../src/shared/schemas/toolExecution.schema';
import { Agent, AgentDocument } from '../../../../../src/shared/schemas/agent.schema';
import { AgentProfile, AgentProfileDocument } from '../../../../../src/shared/schemas/agent-profile.schema';
import { Employee, EmployeeDocument, EmployeeType } from '../../../../../src/shared/schemas/employee.schema';
import { OperationLog, OperationLogDocument } from '../../../../../src/shared/schemas/operation-log.schema';
import { ComposioService } from './composio.service';
import { ModelManagementService } from '../models/model-management.service';

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
    @InjectModel(Employee.name) private employeeModel: Model<EmployeeDocument>,
    @InjectModel(OperationLog.name) private operationLogModel: Model<OperationLogDocument>,
    private composioService: ComposioService,
    private modelManagementService: ModelManagementService,
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
      {
        id: 'model_mcp_list_models',
        name: 'Model MCP List Models',
        description: 'List models currently available in system registry',
        type: 'data_analysis' as const,
        category: 'Model Management',
        requiredPermissions: [{ id: 'model_registry_read', name: 'Model Registry Read', level: 'basic' }],
        tokenCost: 3,
        implementation: {
          type: 'built_in' as const,
          parameters: {
            provider: 'string',
            limit: 'number',
          },
        },
      },
      {
        id: 'model_mcp_search_latest',
        name: 'Model MCP Search Latest',
        description: 'Search latest model releases from internet and return normalized candidates',
        type: 'web_search' as const,
        category: 'Model Management',
        requiredPermissions: [{ id: 'model_registry_read', name: 'Model Registry Read', level: 'basic' }],
        tokenCost: 8,
        implementation: {
          type: 'built_in' as const,
          parameters: {
            providers: 'string[]',
            query: 'string',
            maxResultsPerQuery: 'number',
            limit: 'number',
          },
        },
      },
      {
        id: 'model_mcp_add_model',
        name: 'Model MCP Add Model',
        description: 'Add a model into system model registry with deduplication',
        type: 'data_analysis' as const,
        category: 'Model Management',
        requiredPermissions: [{ id: 'model_registry_write', name: 'Model Registry Write', level: 'admin' }],
        tokenCost: 5,
        implementation: {
          type: 'built_in' as const,
          parameters: {
            provider: 'string',
            model: 'string',
            name: 'string',
            id: 'string',
            maxTokens: 'number',
            temperature: 'number',
            topP: 'number',
          },
        },
      },
      {
        id: 'human_operation_log_mcp_list',
        name: 'Human Operation Log MCP List',
        description: 'List operation logs for the human bound to the requesting exclusive assistant',
        type: 'data_analysis' as const,
        category: 'Audit',
        requiredPermissions: [{ id: 'human_operation_log_read', name: 'Human Operation Log Read', level: 'basic' }],
        tokenCost: 4,
        implementation: {
          type: 'built_in' as const,
          parameters: {
            from: 'string',
            to: 'string',
            action: 'string',
            resourceKeyword: 'string',
            success: 'boolean',
            statusCode: 'number',
            page: 'number',
            pageSize: 'number',
          },
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
      case 'model_mcp_list_models':
        return this.listSystemModels(parameters);
      case 'model_mcp_search_latest':
        return this.searchLatestModels(parameters, agentId);
      case 'model_mcp_add_model':
        return this.addModelToSystem(parameters);
      case 'human_operation_log_mcp_list':
        return this.listHumanOperationLogs(parameters, agentId);
      default:
        throw new Error(`Tool implementation not found: ${tool.id}`);
    }
  }

  private normalizeProvider(provider?: string): string {
    const value = String(provider || '').trim().toLowerCase();
    if (value === 'kimi') return 'moonshot';
    if (value === 'claude') return 'anthropic';
    return value;
  }

  private inferProvider(text: string): string {
    const value = text.toLowerCase();
    if (value.includes('openai') || value.includes('gpt-') || /\bo1\b/.test(value)) return 'openai';
    if (value.includes('anthropic') || value.includes('claude-')) return 'anthropic';
    if (value.includes('google') || value.includes('gemini-')) return 'google';
    if (value.includes('moonshot') || value.includes('kimi-')) return 'moonshot';
    if (value.includes('deepseek')) return 'deepseek';
    if (value.includes('mistral')) return 'mistral';
    if (value.includes('meta') || value.includes('llama-')) return 'meta';
    if (value.includes('alibaba') || value.includes('qwen')) return 'alibaba';
    if (value.includes('xai') || value.includes('grok')) return 'xai';
    return 'custom';
  }

  private extractCandidateModels(text: string): Array<{ model: string; provider: string }> {
    const regex =
      /(gpt-[a-z0-9.\-]+|o1[a-z0-9.\-]*|claude-[a-z0-9.\-]+|gemini-[a-z0-9.\-]+|deepseek-[a-z0-9.\-]+|qwen[a-z0-9.\-]*|llama-[a-z0-9.\-]+|kimi-[a-z0-9.\-]+|moonshot-[a-z0-9.\-]+|mistral-[a-z0-9.\-]+|grok-[a-z0-9.\-]+)/gi;
    const matches = text.match(regex) || [];
    const unique = Array.from(new Set(matches.map((item) => item.toLowerCase())));
    return unique.map((model) => ({
      model,
      provider: this.inferProvider(model),
    }));
  }

  private toModelDisplayName(model: string): string {
    return model
      .split('-')
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  private async searchLatestModels(
    params: { providers?: string[]; query?: string; maxResultsPerQuery?: number; limit?: number },
    userId?: string,
  ): Promise<any> {
    const maxResultsPerQuery = Math.max(3, Math.min(Number(params?.maxResultsPerQuery || 10), 20));
    const limit = Math.max(1, Math.min(Number(params?.limit || 20), 100));
    const providers = (params?.providers || [])
      .map((provider) => this.normalizeProvider(provider))
      .filter(Boolean);
    const defaultProviders = ['openai', 'anthropic', 'google', 'moonshot', 'deepseek', 'mistral', 'meta', 'alibaba'];
    const providerTargets = providers.length ? providers : defaultProviders;

    const queries = params?.query?.trim()
      ? [params.query.trim()]
      : providerTargets.map(
          (provider) => `${provider} latest AI model release official announcement ${new Date().getFullYear()}`,
        );

    const settled = await Promise.allSettled(
      queries.map((query) => this.composioService.webSearch(query, maxResultsPerQuery, userId)),
    );

    const candidates: Array<{
      provider: string;
      model: string;
      name: string;
      sourceTitle: string;
      sourceUrl: string;
      snippet?: string;
      confidence: 'low' | 'medium' | 'high';
    }> = [];
    const failedQueries: Array<{ query: string; error: string }> = [];

    settled.forEach((item, index) => {
      const query = queries[index];
      if (item.status !== 'fulfilled' || !item.value?.successful) {
        failedQueries.push({
          query,
          error:
            item.status === 'fulfilled'
              ? item.value?.error || 'Search failed'
              : item.reason instanceof Error
                ? item.reason.message
                : 'Search failed',
        });
        return;
      }

      const raw = item.value?.data || {};
      const rows = raw?.organic || raw?.results?.organic_results || raw?.results || [];
      const organicResults = Array.isArray(rows) ? rows : [];

      for (const row of organicResults) {
        const title = String(row?.title || '').trim();
        const url = String(row?.link || row?.url || '').trim();
        const snippet = String(row?.snippet || '').trim();
        const joined = `${title} ${snippet}`.trim();
        if (!joined) continue;

        const extracted = this.extractCandidateModels(joined);
        for (const candidate of extracted) {
          const inferred = this.normalizeProvider(candidate.provider || this.inferProvider(`${joined} ${url}`));
          const confidence =
            url.includes('openai.com') ||
            url.includes('anthropic.com') ||
            url.includes('google.com') ||
            url.includes('deepseek.com') ||
            url.includes('moonshot.cn')
              ? 'high'
              : snippet.toLowerCase().includes('official')
                ? 'medium'
                : 'low';

          candidates.push({
            provider: inferred,
            model: candidate.model,
            name: this.toModelDisplayName(candidate.model),
            sourceTitle: title,
            sourceUrl: url,
            snippet,
            confidence,
          });
        }
      }
    });

    const dedupMap = new Map<string, (typeof candidates)[number]>();
    for (const candidate of candidates) {
      const key = `${candidate.provider}:${candidate.model}`;
      const existing = dedupMap.get(key);
      if (!existing) {
        dedupMap.set(key, candidate);
        continue;
      }
      if (existing.confidence !== 'high' && candidate.confidence === 'high') {
        dedupMap.set(key, candidate);
      }
    }

    const normalized = Array.from(dedupMap.values()).slice(0, limit);

    return {
      searchedAt: new Date().toISOString(),
      queryCount: queries.length,
      failedQueries,
      totalCandidates: normalized.length,
      candidates: normalized,
    };
  }

  private async addModelToSystem(params: {
    provider: string;
    model: string;
    name?: string;
    id?: string;
    maxTokens?: number;
    temperature?: number;
    topP?: number;
  }): Promise<any> {
    if (!params?.provider || !params?.model) {
      throw new Error('model_mcp_add_model requires parameters: provider, model');
    }

    const normalizedProvider = this.normalizeProvider(params.provider);
    const normalizedModel = String(params.model).trim().toLowerCase();
    const maxTokens = Number.isFinite(Number(params.maxTokens)) ? Number(params.maxTokens) : 8192;
    const temperature = Number.isFinite(Number(params.temperature)) ? Number(params.temperature) : 0.7;
    const topP = Number.isFinite(Number(params.topP)) ? Number(params.topP) : 1;

    const result = this.modelManagementService.addModelToSystem({
      id: params.id,
      name: params.name?.trim() || this.toModelDisplayName(normalizedModel),
      provider: normalizedProvider as any,
      model: normalizedModel,
      maxTokens,
      temperature,
      topP,
    });

    return {
      created: result.created,
      duplicateBy: result.duplicateBy || null,
      message: result.message,
      model: result.model,
      timestamp: new Date().toISOString(),
    };
  }

  private async listSystemModels(params: { provider?: string; limit?: number }): Promise<any> {
    const provider = this.normalizeProvider(params?.provider);
    const limit = Math.max(1, Math.min(Number(params?.limit || 200), 500));

    const sourceModels = provider
      ? this.modelManagementService.getModelsByProvider(provider)
      : this.modelManagementService.getAvailableModels();

    const models = sourceModels.slice(0, limit).map((model) => ({
      id: model.id,
      name: model.name,
      provider: this.normalizeProvider(model.provider),
      model: model.model,
      maxTokens: model.maxTokens,
      temperature: model.temperature,
      topP: model.topP,
    }));

    return {
      total: sourceModels.length,
      returned: models.length,
      provider: provider || 'all',
      models,
      timestamp: new Date().toISOString(),
    };
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private parseDateOrThrow(raw?: string, fieldName?: string): Date | undefined {
    if (!raw) return undefined;
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`Invalid ${fieldName || 'date'} format`);
    }
    return parsed;
  }

  private async getBoundHumanByAssistant(agentId: string): Promise<{ id: string; name?: string; organizationId: string }> {
    if (!agentId) {
      throw new Error('human_operation_log_mcp_list requires assistant agentId');
    }

    const humanEmployees = await this.employeeModel
      .find({
        type: EmployeeType.HUMAN,
        exclusiveAssistantAgentId: agentId,
      })
      .select({ id: 1, name: 1, organizationId: 1 })
      .lean()
      .exec();

    if (humanEmployees.length === 0) {
      throw new Error('Current assistant is not bound to any human employee');
    }
    if (humanEmployees.length > 1) {
      throw new Error('Current assistant is bound to multiple humans, access denied');
    }

    const [human] = humanEmployees;
    if (!human?.id || !human.organizationId) {
      throw new Error('Bound human employee data is incomplete');
    }

    return {
      id: human.id,
      name: human.name,
      organizationId: human.organizationId,
    };
  }

  private async listHumanOperationLogs(
    params: {
      from?: string;
      to?: string;
      action?: string;
      resourceKeyword?: string;
      success?: boolean;
      statusCode?: number;
      page?: number;
      pageSize?: number;
    },
    agentId?: string,
  ): Promise<any> {
    const boundHuman = await this.getBoundHumanByAssistant(agentId || '');
    const from = this.parseDateOrThrow(params?.from, 'from');
    const to = this.parseDateOrThrow(params?.to, 'to');

    if (from && to && from.getTime() > to.getTime()) {
      throw new Error('Invalid date range: from must be earlier than to');
    }

    const page = Math.max(1, Math.min(Number(params?.page || 1), 10000));
    const pageSize = Math.max(1, Math.min(Number(params?.pageSize || 20), 100));
    const skip = (page - 1) * pageSize;

    const filter: any = {
      humanEmployeeId: boundHuman.id,
      organizationId: boundHuman.organizationId,
    };

    if (params?.action?.trim()) {
      filter.action = { $regex: this.escapeRegex(params.action.trim()), $options: 'i' };
    }
    if (params?.resourceKeyword?.trim()) {
      filter.resource = { $regex: this.escapeRegex(params.resourceKeyword.trim()), $options: 'i' };
    }
    if (typeof params?.success === 'boolean') {
      filter.success = params.success;
    }

    const parsedStatusCode = Number(params?.statusCode);
    if (Number.isFinite(parsedStatusCode) && parsedStatusCode >= 100 && parsedStatusCode <= 599) {
      filter.statusCode = parsedStatusCode;
    }

    if (from || to) {
      filter.timestamp = {};
      if (from) filter.timestamp.$gte = from;
      if (to) filter.timestamp.$lte = to;
    }

    const [total, rows] = await Promise.all([
      this.operationLogModel.countDocuments(filter).exec(),
      this.operationLogModel
        .find(filter)
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(pageSize)
        .lean()
        .exec(),
    ]);

    return {
      humanEmployeeId: boundHuman.id,
      humanName: boundHuman.name || '',
      assistantAgentId: agentId,
      total,
      page,
      pageSize,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
      logs: rows.map((row) => ({
        id: row.id,
        action: row.action,
        resource: row.resource,
        httpMethod: row.httpMethod,
        statusCode: row.statusCode,
        success: row.success,
        sourceService: row.sourceService,
        durationMs: row.durationMs,
        ip: row.ip,
        userAgent: row.userAgent,
        requestId: row.requestId,
        query: row.query,
        payload: row.payload,
        responseSummary: row.responseSummary,
        timestamp: row.timestamp,
      })),
      fetchedAt: new Date().toISOString(),
    };
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
