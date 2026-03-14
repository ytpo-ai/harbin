import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import { Tool, ToolDocument } from '../../../../../src/shared/schemas/tool.schema';
import { Toolkit, ToolkitDocument } from '../../../../../src/shared/schemas/toolkit.schema';
import { ToolExecution, ToolExecutionDocument } from '../../../../../src/shared/schemas/toolExecution.schema';
import { Agent, AgentDocument } from '../../../../../src/shared/schemas/agent.schema';
import { AgentProfile, AgentProfileDocument } from '../../../../../src/shared/schemas/agent-profile.schema';
import { ApiKey, ApiKeyDocument } from '../../../../../src/shared/schemas/apiKey.schema';
import { ComposioService } from './composio.service';
import { WebToolsService } from './web-tools.service';
import { ModelManagementService } from '../models/model-management.service';
import { MemoService } from '../memos/memo.service';
import { InternalApiClient } from './internal-api-client.service';
import { ToolGovernanceService } from './tool-governance.service';
import { OrchestrationToolHandler } from './orchestration-tool-handler.service';
import { RequirementToolHandler } from './requirement-tool-handler.service';
import { RepoToolHandler } from './repo-tool-handler.service';
import { ModelToolHandler } from './model-tool-handler.service';
import { SkillToolHandler } from './skill-tool-handler.service';
import { AuditToolHandler } from './audit-tool-handler.service';
import { MeetingToolHandler } from './meeting-tool-handler.service';
import { ToolExecutionContext } from './tool-execution-context.type';
import {
  AGENT_CREATE_TOOL_ID,
  AGENT_LIST_TOOL_ID,
  DEPRECATED_TOOL_IDS,
  LEGACY_AGENT_LIST_TOOL_ID,
  RD_DOCS_WRITE_TOOL_ID,
  VIRTUAL_TOOL_IDS,
} from './builtin-tool-definitions';
import { BUILTIN_TOOLS, IMPLEMENTED_TOOL_IDS } from './builtin-tool-catalog';

const DEFAULT_PROFILE = {
  role: 'general-assistant',
  tools: [],
  capabilities: [],
  exposed: false,
};

interface ToolRouterQuery {
  provider?: string;
  domain?: string;
  namespace?: string;
  resource?: string;
  action?: string;
  capability?: string;
  limit?: number;
}

interface ToolRegistryQuery {
  provider?: string;
  executionChannel?: string;
  toolkitId?: string;
  namespace?: string;
  resource?: string;
  action?: string;
  category?: string;
  capability?: string;
  enabled?: string | boolean;
}

interface ToolkitRegistryQuery {
  provider?: string;
  namespace?: string;
  status?: string;
}

interface NormalizedToolError {
  code: string;
  message: string;
  retryable: boolean;
}

interface ParsedToolIdentity {
  provider: string;
  executionChannel: string;
  namespace: string;
  toolkit: string;
  toolkitId: string;
  resource: string;
  action: string;
}

@Injectable()
export class ToolService {
  private readonly logger = new Logger(ToolService.name);
  private readonly backendBaseUrl = process.env.LEGACY_SERVICE_URL || 'http://localhost:3001/api';

  constructor(
    @InjectModel(Tool.name) private toolModel: Model<ToolDocument>,
    @InjectModel(Toolkit.name) private toolkitModel: Model<ToolkitDocument>,
    @InjectModel(ToolExecution.name) private executionModel: Model<ToolExecutionDocument>,
    @InjectModel(Agent.name) private agentModel: Model<AgentDocument>,
    @InjectModel(AgentProfile.name) private agentProfileModel: Model<AgentProfileDocument>,
    @InjectModel(ApiKey.name) private apiKeyModel: Model<ApiKeyDocument>,
    private composioService: ComposioService,
    private webToolsService: WebToolsService,
    private modelManagementService: ModelManagementService,
    private memoService: MemoService,
    private internalApiClient: InternalApiClient,
    private toolGovernanceService: ToolGovernanceService,
    private orchestrationToolHandler: OrchestrationToolHandler,
    private requirementToolHandler: RequirementToolHandler,
    private repoToolHandler: RepoToolHandler,
    private modelToolHandler: ModelToolHandler,
    private skillToolHandler: SkillToolHandler,
    private auditToolHandler: AuditToolHandler,
    private meetingToolHandler: MeetingToolHandler,
  ) {}

  async seedBuiltinTools(): Promise<void> {
    await this.initializeBuiltinTools();
  }

  private inferProviderFromToolId(toolId: string): string {
    return this.parseToolIdentity(toolId).provider;
  }

  private parseToolIdentity(toolId: string): ParsedToolIdentity {
    const parts = String(toolId || '').split('.').filter(Boolean);
    if (!parts.length) {
      return {
        provider: 'builtin',
        executionChannel: 'internal',
        namespace: 'other',
        toolkit: 'generic',
        toolkitId: 'builtin.other.internal.generic',
        resource: 'generic',
        action: 'execute',
      };
    }

    if ((parts[0] === 'builtin' || parts[0] === 'composio') && parts.length >= 5 && ['mcp', 'internal'].includes(parts[2])) {
      const provider = parts[0];
      const namespace = parts[1] || 'other';
      const executionChannel = parts[2] || 'internal';
      const toolkit = parts[3] || 'generic';
      const action = parts.slice(4).join('.') || 'execute';
      return {
        provider,
        executionChannel,
        namespace,
        toolkit,
        toolkitId: `${provider}.${namespace}.${executionChannel}.${toolkit}`,
        resource: toolkit,
        action,
      };
    }

    if (parts[0] === 'builtin' || parts[0] === 'composio') {
      const provider = parts[0];
      const executionChannel = parts[1] || (provider === 'composio' ? 'mcp' : 'internal');
      const namespace = parts[2] || 'other';
      const toolkit = parts[2] || 'generic';
      const resource = parts[2] || 'generic';
      const action = parts.slice(3).join('.') || 'execute';
      return {
        provider,
        executionChannel,
        namespace,
        toolkit,
        toolkitId: `${provider}.${namespace}.${executionChannel}.${toolkit}`,
        resource,
        action,
      };
    }

    if (parts[0] === 'gh') {
      const provider = 'builtin';
      const executionChannel = 'mcp';
      const namespace = 'sys-mg';
      const toolkit = 'rd-related';
      const action = parts.slice(1).join('.') || 'execute';
      return {
        provider,
        executionChannel,
        namespace,
        toolkit,
        toolkitId: `${provider}.${namespace}.${executionChannel}.${toolkit}`,
        resource: toolkit,
        action,
      };
    }

    const provider = parts[0] === 'composio' ? 'composio' : 'builtin';
    const executionChannel = parts[0] === 'internal' ? 'internal' : parts[1] || 'internal';
    const namespace = parts[2] || parts[1] || parts[0] || 'other';
    const toolkit = parts[3] || namespace;
    const action = parts.slice(4).join('.') || parts.slice(3).join('.') || 'execute';
    return {
      provider,
      executionChannel,
      namespace,
      toolkit,
      toolkitId: `${provider}.${namespace}.${executionChannel}.${toolkit}`,
      resource: toolkit,
      action,
    };
  }

  private inferExecutionChannel(toolId: string): string {
    return this.parseToolIdentity(toolId).executionChannel;
  }

  private inferNamespaceFromToolId(toolId: string): string {
    return this.parseToolIdentity(toolId).namespace;
  }

  private inferToolkitFromToolId(toolId: string): string {
    return this.parseToolIdentity(toolId).toolkit;
  }

  private inferToolkitIdFromToolId(toolId: string): string {
    return this.parseToolIdentity(toolId).toolkitId;
  }

  private inferResourceAndAction(toolId: string): { resource: string; action: string } {
    const parsed = this.parseToolIdentity(toolId);
    return { resource: parsed.resource, action: parsed.action };
  }

  private getToolkitDisplayName(toolkit: string): string {
    if (toolkit === 'rd-related') return 'RD Toolkit';
    return toolkit
      .split('-')
      .filter(Boolean)
      .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
      .join(' ');
  }

  private buildBuiltinToolMetadata(toolData: {
    id: string;
    category: string;
    implementation?: { parameters?: Record<string, unknown> };
  }) {
    const canonicalId = toolData.id;
    const identity = this.parseToolIdentity(canonicalId);
    const provider = identity.provider;
    const executionChannel = identity.executionChannel;
    const namespace = identity.namespace;
    const { resource, action } = this.inferResourceAndAction(canonicalId);
    return {
      canonicalId,
      provider,
      executionChannel,
      toolkitId: identity.toolkitId,
      namespace,
      resource,
      action,
      capabilitySet: [toolData.category.toLowerCase().replace(/\s+/g, '_')],
      tags: [namespace, provider, executionChannel, identity.toolkit],
      status: 'active' as const,
      deprecated: false,
      aliases: canonicalId === toolData.id ? [] : [toolData.id],
      inputSchema: toolData.implementation?.parameters || {},
      outputSchema: {},
    };
  }

  private inferToolkitAuthStrategy(provider: string, namespace: string, toolkit?: string): 'oauth2' | 'apiKey' | 'none' {
    if (provider === 'composio' && ['gmail', 'slack', 'github'].includes(toolkit || namespace)) return 'oauth2';
    if (provider === 'builtin') return 'none';
    return 'apiKey';
  }

  private buildToolkitView(toolkit: Toolkit) {
    const base = (toolkit as any)?.toObject ? (toolkit as any).toObject() : toolkit;
    return {
      ...base,
      id: toolkit.id,
      provider: toolkit.provider,
      namespace: toolkit.namespace,
      status: toolkit.status || 'active',
      version: toolkit.version || 'v1',
      authStrategy: toolkit.authStrategy || this.inferToolkitAuthStrategy(toolkit.provider, toolkit.namespace),
    };
  }

  private async upsertToolkit(toolkitData: {
    id: string;
    provider: string;
    executionChannel?: string;
    namespace: string;
    toolkit?: string;
    name: string;
    description?: string;
  }): Promise<void> {
    await this.toolkitModel
      .updateOne(
        { id: toolkitData.id },
        {
          $set: {
            provider: toolkitData.provider,
            executionChannel: toolkitData.executionChannel,
            namespace: toolkitData.namespace,
            name: toolkitData.name,
            description: toolkitData.description || '',
            version: 'v1',
            status: 'active',
            authStrategy: this.inferToolkitAuthStrategy(toolkitData.provider, toolkitData.namespace, toolkitData.toolkit),
            metadata: {
              source: 'tool-registry',
              toolkit: toolkitData.toolkit || '',
            },
          },
          $setOnInsert: {
            id: toolkitData.id,
          },
        },
        { upsert: true },
      )
      .exec();
  }

  private async syncToolkitsFromTools(): Promise<void> {
    const tools = await this.toolModel
      .find({ enabled: { $ne: false } })
      .select({ id: 1, canonicalId: 1 })
      .lean()
      .exec();
    const toolkitMap = new Map<string, { id: string; provider: string; executionChannel: string; namespace: string; toolkit: string }>();
    for (const tool of tools as any[]) {
      const toolId = String(tool.canonicalId || tool.id || '').trim();
      const identity = this.parseToolIdentity(toolId);
      const provider = identity.provider;
      const executionChannel = identity.executionChannel;
      const namespace = identity.namespace;
      const toolkit = identity.toolkit;
      const toolkitId = identity.toolkitId;
      if (!toolkitId || !provider || !namespace) continue;
      toolkitMap.set(toolkitId, { id: toolkitId, provider, executionChannel, namespace, toolkit });
    }

    for (const toolkit of toolkitMap.values()) {
      await this.upsertToolkit({
        id: toolkit.id,
        provider: toolkit.provider,
        executionChannel: toolkit.executionChannel,
        namespace: toolkit.namespace,
        toolkit: toolkit.toolkit,
        name: this.getToolkitDisplayName(toolkit.toolkit),
        description: `Toolkit for ${toolkit.namespace}/${toolkit.toolkit} (${toolkit.provider})`,
      });
    }

    const activeToolkitIds = Array.from(toolkitMap.keys());
    await this.toolkitModel
      .updateMany(
        activeToolkitIds.length ? { id: { $nin: activeToolkitIds } } : {},
        { $set: { status: 'deprecated' } },
      )
      .exec();
  }

  private normalizeBooleanQuery(value?: string | boolean): boolean | undefined {
    if (typeof value === 'boolean') return value;
    if (typeof value !== 'string') return undefined;
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
    return undefined;
  }

  private parsePositiveInt(raw: unknown, fallback: number): number {
    const num = Number(raw);
    if (!Number.isFinite(num) || num <= 0) return fallback;
    return Math.floor(num);
  }

  private normalizeErrorToCode(error: unknown): string {
    return this.normalizeToolError(error).code;
  }

  private isRetryableError(error: unknown): boolean {
    const code = this.normalizeErrorToCode(error);
    return this.toolGovernanceService.isRetryableCode(code);
  }

  private toToolView(tool: Tool) {
    const base = (tool as any)?.toObject ? (tool as any).toObject() : tool;
    const toolId = tool.canonicalId || tool.id;
    const identity = this.parseToolIdentity(toolId);
    const provider = identity.provider;
    const executionChannel = identity.executionChannel;
    const namespace = identity.namespace;
    return {
      ...base,
      legacyToolId: tool.id,
      toolId,
      provider,
      executionChannel,
      namespace,
      toolkitId: identity.toolkitId,
      capabilitySet: tool.capabilitySet || [],
      status: tool.status || 'active',
    };
  }

  private async alignStoredToolMetadata(): Promise<void> {
    const tools = await this.toolModel
      .find()
      .select({ id: 1, canonicalId: 1, provider: 1, executionChannel: 1, namespace: 1, toolkitId: 1, resource: 1, action: 1 })
      .lean()
      .exec();

    for (const tool of tools as any[]) {
      const toolId = String(tool.canonicalId || tool.id || '').trim();
      if (!toolId) continue;
      const identity = this.parseToolIdentity(toolId);
      const update: Record<string, unknown> = {};
      if (String(tool.provider || '') !== identity.provider) update.provider = identity.provider;
      if (String(tool.executionChannel || '') !== identity.executionChannel) update.executionChannel = identity.executionChannel;
      if (String(tool.namespace || '') !== identity.namespace) update.namespace = identity.namespace;
      if (String(tool.toolkitId || '') !== identity.toolkitId) update.toolkitId = identity.toolkitId;
      if (String(tool.resource || '') !== identity.resource) update.resource = identity.resource;
      if (String(tool.action || '') !== identity.action) update.action = identity.action;
      if (!Object.keys(update).length) continue;
      await this.toolModel.updateOne({ _id: (tool as any)._id }, { $set: update }).exec();
    }
  }

  private toExecutionView(execution: ToolExecution) {
    const base = (execution as any)?.toObject ? (execution as any).toObject() : execution;
    const legacyToolId = String(base.toolId || '');
    const resolvedToolId = String(base.resolvedToolId || legacyToolId);
    return {
      ...base,
      legacyToolId,
      toolId: resolvedToolId,
      resolvedToolId,
      requestedToolId: base.requestedToolId || resolvedToolId,
      traceId: base.traceId || base.id,
    };
  }

  private async initializeBuiltinTools() {
    const builtinTools = BUILTIN_TOOLS;

    await this.toolModel.deleteMany({ id: { $in: VIRTUAL_TOOL_IDS } }).exec();
    await this.toolModel.deleteMany({ id: { $in: DEPRECATED_TOOL_IDS } }).exec();

    for (const toolData of builtinTools) {
      const metadata = this.buildBuiltinToolMetadata(toolData);
      const existingTool = await this.toolModel.findOne({ id: toolData.id }).exec();
      if (!existingTool) {
        const tool = new this.toolModel({
          ...toolData,
          ...metadata,
        });
        await tool.save();
        await this.upsertToolkit({
          id: metadata.toolkitId,
          provider: metadata.provider,
          executionChannel: metadata.executionChannel,
          namespace: metadata.namespace,
          toolkit: this.inferToolkitFromToolId(metadata.canonicalId),
          name: this.getToolkitDisplayName(this.inferToolkitFromToolId(metadata.canonicalId)),
          description: `Toolkit for ${metadata.namespace}/${this.inferToolkitFromToolId(metadata.canonicalId)} (${metadata.provider})`,
        });
        this.logger.log(`已注册内置工具: ${toolData.name}`);
        continue;
      }

      await this.toolModel
        .updateOne(
          { id: toolData.id },
          {
            $set: {
              ...metadata,
              name: toolData.name,
              description: toolData.description,
              prompt: toolData.prompt,
              type: toolData.type,
              category: toolData.category,
              requiredPermissions: toolData.requiredPermissions,
              tokenCost: toolData.tokenCost,
              implementation: toolData.implementation,
            },
          },
        )
        .exec();

      await this.upsertToolkit({
        id: metadata.toolkitId,
        provider: metadata.provider,
        executionChannel: metadata.executionChannel,
        namespace: metadata.namespace,
        toolkit: this.inferToolkitFromToolId(metadata.canonicalId),
        name: this.getToolkitDisplayName(this.inferToolkitFromToolId(metadata.canonicalId)),
        description: `Toolkit for ${metadata.namespace}/${this.inferToolkitFromToolId(metadata.canonicalId)} (${metadata.provider})`,
      });
    }

    await this.alignStoredToolMetadata();
    await this.syncToolkitsFromTools();

    const implementedToolIds = new Set(this.getImplementedToolIds());
    const missingImplementations = builtinTools
      .map((tool) => tool.id)
      .filter((toolId) => !implementedToolIds.has(toolId));
    if (missingImplementations.length) {
      this.logger.error(`Builtin tools missing implementation: ${missingImplementations.join(', ')}`);
    }

    const persistedBuiltIns = await this.toolModel
      .find({ 'implementation.type': 'built_in' })
      .select({ id: 1, _id: 0 })
      .lean()
      .exec();
    const unresolvedPersisted = persistedBuiltIns
      .map((tool) => String((tool as any).id || '').trim())
      .filter(Boolean)
      .filter((toolId) => !implementedToolIds.has(toolId));
    if (unresolvedPersisted.length) {
      this.logger.warn(`Persisted built-in tools without implementation: ${unresolvedPersisted.join(', ')}`);
    }

  }

  async getAllTools(): Promise<Tool[]> {
    return this.toolModel.find().sort({ category: 1, name: 1 }).exec();
  }

  async getAllToolsView(): Promise<any[]> {
    const tools = await this.getAllTools();
    return tools.map((tool) => this.toToolView(tool));
  }

  async getToolkits(query: ToolkitRegistryQuery = {}): Promise<any[]> {
    const provider = String(query.provider || '').trim().toLowerCase();
    const namespace = String(query.namespace || '').trim().toLowerCase();
    const status = String(query.status || '').trim().toLowerCase();
    const rows = await this.toolkitModel.find().sort({ provider: 1, namespace: 1 }).exec();
    return rows
      .map((toolkit) => this.buildToolkitView(toolkit))
      .filter((toolkit) => !provider || String(toolkit.provider).toLowerCase() === provider)
      .filter((toolkit) => !namespace || String(toolkit.namespace).toLowerCase() === namespace)
      .filter((toolkit) => !status || String(toolkit.status).toLowerCase() === status);
  }

  async getToolkit(id: string): Promise<any | null> {
    const toolkit = await this.toolkitModel.findOne({ id: String(id || '').trim() }).exec();
    if (!toolkit) return null;
    return this.buildToolkitView(toolkit);
  }

  async getToolRegistry(query: ToolRegistryQuery): Promise<
    Array<{
      legacyToolId: string;
      toolId: string;
      name: string;
      description: string;
      prompt?: string;
      category: string;
      provider: string;
      executionChannel?: string;
      toolkitId?: string;
      namespace: string;
      resource?: string;
      action?: string;
      enabled: boolean;
      type: Tool['type'];
      requiredPermissions: Tool['requiredPermissions'];
      capabilitySet: string[];
      tokenCost?: number;
    }>
  > {
    const tools = await this.getAllTools();
    const providerFilter = String(query.provider || '').trim().toLowerCase();
    const executionChannelFilter = String(query.executionChannel || '').trim().toLowerCase();
    const toolkitIdFilter = String(query.toolkitId || '').trim().toLowerCase();
    const namespaceFilter = String(query.namespace || '').trim().toLowerCase();
    const resourceFilter = String(query.resource || '').trim().toLowerCase();
    const actionFilter = String(query.action || '').trim().toLowerCase();
    const categoryFilter = String(query.category || '').trim().toLowerCase();
    const capabilityFilter = String(query.capability || '').trim().toLowerCase();
    const enabledFilter = this.normalizeBooleanQuery(query.enabled);

    return tools
      .map((tool) => {
        const toolId = tool.canonicalId || tool.id;
        const identity = this.parseToolIdentity(toolId);
        return {
          legacyToolId: tool.id,
          toolId,
          name: tool.name,
          description: tool.description,
          prompt: typeof tool.prompt === 'string' ? tool.prompt : undefined,
          category: tool.category,
          provider: identity.provider,
          executionChannel: identity.executionChannel,
          toolkitId: identity.toolkitId,
          namespace: identity.namespace,
          resource: tool.resource || identity.resource,
          action: tool.action || identity.action,
          enabled: tool.enabled !== false,
          type: tool.type,
          requiredPermissions: tool.requiredPermissions || [],
          capabilitySet: tool.capabilitySet || [],
          tokenCost: tool.tokenCost,
        };
      })
      .filter((tool) => !providerFilter || tool.provider === providerFilter)
      .filter((tool) => !executionChannelFilter || tool.executionChannel === executionChannelFilter)
      .filter((tool) => !toolkitIdFilter || (tool.toolkitId || '').toLowerCase() === toolkitIdFilter)
      .filter((tool) => !namespaceFilter || tool.namespace === namespaceFilter)
      .filter((tool) => !resourceFilter || (tool.resource || '').toLowerCase() === resourceFilter)
      .filter((tool) => !actionFilter || (tool.action || '').toLowerCase() === actionFilter)
      .filter((tool) => !categoryFilter || tool.category.toLowerCase() === categoryFilter)
      .filter((tool) =>
        !capabilityFilter || tool.capabilitySet.some((capability) => capability.toLowerCase() === capabilityFilter),
      )
      .filter((tool) => enabledFilter === undefined || tool.enabled === enabledFilter)
      .sort((a, b) => a.toolId.localeCompare(b.toolId));
  }

  async getTopKToolRoutes(query: ToolRouterQuery): Promise<
    Array<{
      toolId: string;
      provider: string;
      namespace: string;
      action?: string;
      score: number;
      reason: string;
    }>
  > {
    const namespace = String(query.namespace || query.domain || '').trim();
    const limit = Math.min(this.parsePositiveInt(query.limit, 5), 20);
    const tools = await this.getToolRegistry({
      provider: query.provider,
      namespace: namespace || undefined,
      resource: query.resource,
      action: query.action,
      capability: query.capability,
      enabled: true,
    });

    const metricRows = await this.executionModel
      .aggregate([
        {
          $match: {
            timestamp: {
              $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
            },
          },
        },
        {
          $group: {
            _id: { $ifNull: ['$resolvedToolId', '$toolId'] },
            total: { $sum: 1 },
            successRate: { $avg: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
            avgExecutionTime: { $avg: '$executionTime' },
          },
        },
      ])
      .exec();

    const metricMap = new Map<string, { total: number; successRate: number; avgExecutionTime: number }>();
    for (const row of metricRows) {
      metricMap.set(String((row as any)._id || ''), {
        total: Number((row as any).total || 0),
        successRate: Number((row as any).successRate || 0),
        avgExecutionTime: Number((row as any).avgExecutionTime || 0),
      });
    }

    const ranked = tools
      .map((tool) => {
        const metrics = metricMap.get(tool.toolId) || { total: 0, successRate: 0.9, avgExecutionTime: 1000 };
        const successScore = Math.max(0, Math.min(60, metrics.successRate * 60));
        const latencyScore = Math.max(0, 20 - Math.min(metrics.avgExecutionTime, 10000) / 500);
        const volumeScore = Math.min(10, Math.log10(metrics.total + 1) * 5);
        const costPenalty = Math.min(10, Math.max(0, Number(tool.tokenCost || 0) / 5));
        const score = Number((successScore + latencyScore + volumeScore - costPenalty).toFixed(2));
        return {
          tool,
          score,
          reason: `success=${(metrics.successRate * 100).toFixed(1)}%, latency=${Math.round(metrics.avgExecutionTime)}ms, volume=${metrics.total}`,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((item) => ({
        toolId: item.tool.toolId,
        provider: item.tool.provider,
        namespace: item.tool.namespace,
        action: item.tool.action,
        score: item.score,
        reason: item.reason,
      }));

    return ranked;
  }

  async getTool(toolId: string): Promise<Tool | null> {
    return this.toolModel
      .findOne({
        $or: [{ id: toolId }, { canonicalId: toolId }],
      })
      .exec();
  }

  async getToolView(toolId: string): Promise<any | null> {
    const tool = await this.getTool(toolId);
    if (!tool) return null;
    return this.toToolView(tool);
  }

  async getToolsByIds(toolIds: string[]): Promise<Tool[]> {
    if (!toolIds.length) return [];
    const normalizedToolIds = Array.from(new Set(toolIds.map((item) => String(item || '').trim()).filter(Boolean)));
    return this.toolModel
      .find({
        enabled: true,
        $or: [{ id: { $in: normalizedToolIds } }, { canonicalId: { $in: normalizedToolIds } }],
      })
      .exec();
  }

  async createTool(toolData: Omit<Tool, 'id' | 'createdAt' | 'updatedAt'>): Promise<Tool> {
    const canonicalId = toolData.canonicalId || `internal.custom.${uuidv4().slice(0, 8)}`;
    const identity = this.parseToolIdentity(canonicalId);
    const provider = toolData.provider || identity.provider;
    const executionChannel = toolData.executionChannel || identity.executionChannel;
    const namespace = toolData.namespace || identity.namespace;
    const { resource, action } = this.inferResourceAndAction(canonicalId);
    const newTool = new this.toolModel({
      ...toolData,
      id: uuidv4(),
      canonicalId,
      provider,
      executionChannel,
      namespace,
      resource: toolData.resource || resource,
      action: toolData.action || action,
      toolkitId: toolData.toolkitId || this.inferToolkitIdFromToolId(canonicalId),
      status: toolData.status || 'active',
      aliases: toolData.aliases || [],
      inputSchema: toolData.inputSchema || toolData.implementation?.parameters || {},
      outputSchema: toolData.outputSchema || {},
    });
    return newTool.save();
  }

  async updateTool(toolId: string, updates: Partial<Tool>): Promise<Tool | null> {
    return this.toolModel
      .findOneAndUpdate({ $or: [{ id: toolId }, { canonicalId: toolId }] }, { ...updates, updatedAt: new Date() }, { new: true })
      .exec();
  }

  async deleteTool(toolId: string): Promise<boolean> {
    const result = await this.toolModel.findOneAndDelete({ $or: [{ id: toolId }, { canonicalId: toolId }] }).exec();
    return !!result;
  }

  async executeTool(
    toolId: string,
    agentId: string,
    parameters: any,
    taskId?: string,
    executionContext?: ToolExecutionContext,
  ): Promise<ToolExecution> {
    const tool = await this.getTool(toolId);
    if (!tool) {
      throw new Error(`Tool not found: ${toolId}`);
    }
    if (!tool.enabled) {
      throw new Error(`Tool is disabled: ${toolId}`);
    }

    const resolvedCanonicalToolId = tool.canonicalId || tool.id;
    const traceId = uuidv4();
    const governance = this.toolGovernanceService.getGovernancePolicy((tool.config || {}) as Record<string, any>);
    const idempotencyKey = this.toolGovernanceService.getIdempotencyKey(parameters, executionContext);

    if (idempotencyKey) {
      const idempotentCutoff = new Date(Date.now() - governance.idempotencyTtlMs);
      const existing = await this.executionModel
        .findOne({
          agentId,
          toolId: resolvedCanonicalToolId,
          idempotencyKey,
          status: 'completed',
          timestamp: { $gte: idempotentCutoff },
        })
        .sort({ timestamp: -1 })
        .exec();
      if (existing) {
        return existing;
      }
    }

    this.toolGovernanceService.enforceRateLimit(resolvedCanonicalToolId, agentId, governance);
    this.toolGovernanceService.ensureCircuitClosed(resolvedCanonicalToolId);

    const executionChannel = this.inferExecutionChannel(resolvedCanonicalToolId);

    const execution = new this.executionModel({
      id: uuidv4(),
      traceId,
      requestedToolId: toolId,
      resolvedToolId: resolvedCanonicalToolId,
      executionChannel,
      toolId: resolvedCanonicalToolId,
      agentId,
      taskId,
      idempotencyKey,
      parameters,
      status: 'executing',
      tokenCost: tool.tokenCost || 0,
      retryCount: 0,
    });
    await execution.save();

    try {
      this.authorizeToolExecution(tool, agentId);
      this.validateToolInput(parameters);

      let attempt = 0;
      let rawResult: any;
      const maxRetries = Math.min(governance.maxRetries, 5);

      while (attempt <= maxRetries) {
        try {
          rawResult = await this.toolGovernanceService.executeWithTimeout(
            () =>
              this.executeToolImplementation(tool, parameters, agentId, {
                ...(executionContext || {}),
                taskId: taskId || executionContext?.taskId,
                idempotencyKey,
              }),
            governance.timeoutMs,
          );
          execution.retryCount = attempt;
          break;
        } catch (error) {
          const shouldRetry = attempt < maxRetries && this.isRetryableError(error);
          if (!shouldRetry) {
            throw error;
          }
          attempt += 1;
          execution.retryCount = attempt;
          await this.toolGovernanceService.sleep(Math.min(1000 * attempt, 3000));
        }
      }

      execution.result = this.normalizeToolResult(rawResult, traceId);
      execution.status = 'completed';
      execution.executionTime = Date.now() - execution.timestamp.getTime();
      await execution.save();
      this.toolGovernanceService.recordCircuitSuccess(resolvedCanonicalToolId);
      return execution;
    } catch (error) {
      execution.status = 'failed';
      const normalizedError = this.normalizeToolError(error);
      execution.error = normalizedError.message;
      execution.errorCode = normalizedError.code;
      execution.result = {
        success: false,
        error: normalizedError,
        traceId,
      };
      execution.executionTime = Date.now() - execution.timestamp.getTime();
      await execution.save();
      this.toolGovernanceService.recordCircuitFailure(resolvedCanonicalToolId, governance);
      throw error;
    }
  }

  private authorizeToolExecution(tool: Tool, agentId: string): void {
    if (!tool.enabled) {
      throw new Error('Tool is disabled');
    }
    if (!agentId?.trim()) {
      throw new Error('Missing agentId in tool execution');
    }
  }

  private validateToolInput(parameters: any): void {
    if (parameters === undefined || parameters === null) {
      throw new Error('Missing tool parameters');
    }
  }

  private normalizeToolResult(rawResult: any, traceId: string) {
    return {
      success: true,
      traceId,
      data: rawResult,
    };
  }

  private normalizeToolError(error: unknown): NormalizedToolError {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const code = this.inferExecutionErrorCode(error);
    return {
      code,
      message,
      retryable: code === 'TOOL_TIMEOUT' || code === 'TOOL_EXECUTION_FAILED',
    };
  }

  private inferExecutionErrorCode(error: unknown): string {
    const message = String((error as any)?.message || '').toLowerCase();
    if (!message) return 'TOOL_EXECUTION_FAILED';
    if (message.includes('timeout')) return 'TOOL_TIMEOUT';
    if (message.includes('not found')) return 'TOOL_NOT_FOUND';
    if (message.includes('disabled')) return 'TOOL_DISABLED';
    if (message.includes('rate limit')) return 'TOOL_RATE_LIMITED';
    if (message.includes('circuit open')) return 'TOOL_CIRCUIT_OPEN';
    if (message.includes('requires confirm=true')) return 'TOOL_CONFIRM_REQUIRED';
    if (message.includes('missing organization context')) return 'TOOL_CONTEXT_MISSING';
    return 'TOOL_EXECUTION_FAILED';
  }

  private async executeToolImplementation(
    tool: Tool,
    parameters: any,
    agentId?: string,
    executionContext?: ToolExecutionContext,
  ): Promise<any> {
    switch (tool.id) {
      case 'builtin.web-retrieval.internal.web-search.exa':
        return this.webToolsService.performWebSearchExa(parameters);
      case 'composio.web-retrieval.mcp.web-search.serp':
        return this.webToolsService.performWebSearchSerp(parameters, agentId);
      case 'builtin.web-retrieval.internal.web-fetch.fetch':
        return this.webToolsService.performWebFetch(parameters);
      case 'builtin.data-analysis.internal.content-analysis.extract':
        return this.webToolsService.performContentExtract(parameters);
      case 'composio.communication.mcp.slack.send-message':
        return this.sendSlackMessage(parameters, agentId);
      case 'composio.communication.mcp.gmail.send-email':
        return this.sendGmail(parameters, agentId);
      case 'builtin.sys-mg.internal.rd-related.repo-read':
        return this.repoToolHandler.executeRepoRead(parameters);
      case AGENT_LIST_TOOL_ID:
      case LEGACY_AGENT_LIST_TOOL_ID:
        return this.getAgentsMcpList(parameters);
      case AGENT_CREATE_TOOL_ID:
        return this.createAgentByMcp(parameters);
      case 'builtin.sys-mg.internal.rd-related.docs-read':
        return this.repoToolHandler.getCodeDocsReader(parameters);
      case RD_DOCS_WRITE_TOOL_ID:
        return this.repoToolHandler.executeDocsWrite(parameters);
      case 'builtin.sys-mg.internal.rd-related.updates-read':
        return this.repoToolHandler.getCodeUpdatesReader(parameters);
      case 'builtin.sys-mg.mcp.rd-intelligence.engineering-statistics-run':
        return this.runEngineeringStatistics(parameters);
      case 'builtin.sys-mg.mcp.model-admin.list-models':
        return this.modelToolHandler.listSystemModels(parameters);
      case 'builtin.sys-mg.mcp.model-admin.add-model':
        return this.modelToolHandler.addModelToSystem(parameters);
      case 'builtin.sys-mg.mcp.audit.list-human-operation-log':
        return this.auditToolHandler.listHumanOperationLogs(parameters, agentId);
      case 'builtin.sys-mg.internal.memory.search-memo':
        return this.searchMemoMemory(parameters, agentId);
      case 'builtin.sys-mg.internal.memory.append-memo':
        return this.appendMemoMemory(parameters, agentId, executionContext);
      case 'builtin.sys-mg.mcp.skill-master.list-skills':
        return this.skillToolHandler.listSkillsByTitle(parameters);
      case 'builtin.sys-mg.mcp.skill-master.create-skill':
        return this.skillToolHandler.createSkillByMcp(parameters);
      case 'builtin.sys-mg.mcp.orchestration.create-plan':
        return this.orchestrationToolHandler.createOrchestrationPlan(parameters, agentId, executionContext);
      case 'builtin.sys-mg.mcp.orchestration.update-plan':
        return this.orchestrationToolHandler.updateOrchestrationPlan(parameters, agentId, executionContext);
      case 'builtin.sys-mg.mcp.orchestration.run-plan':
        return this.orchestrationToolHandler.runOrchestrationPlan(parameters, agentId, executionContext);
      case 'builtin.sys-mg.mcp.orchestration.get-plan':
        return this.orchestrationToolHandler.getOrchestrationPlan(parameters, agentId, executionContext);
      case 'builtin.sys-mg.mcp.orchestration.list-plans':
        return this.orchestrationToolHandler.listOrchestrationPlans(agentId, executionContext);
      case 'builtin.sys-mg.mcp.orchestration.reassign-task':
        return this.orchestrationToolHandler.reassignOrchestrationTask(parameters, agentId, executionContext);
      case 'builtin.sys-mg.mcp.orchestration.complete-human-task':
        return this.orchestrationToolHandler.completeOrchestrationHumanTask(parameters, agentId, executionContext);
      case 'builtin.sys-mg.mcp.orchestration.create-schedule':
        return this.orchestrationToolHandler.createOrchestrationSchedule(parameters, agentId, executionContext);
      case 'builtin.sys-mg.mcp.orchestration.update-schedule':
        return this.orchestrationToolHandler.updateOrchestrationSchedule(parameters, agentId, executionContext);
      case 'builtin.sys-mg.mcp.orchestration.debug-task':
        return this.orchestrationToolHandler.debugOrchestrationTask(parameters, agentId, executionContext);
      case 'builtin.sys-mg.mcp.requirement.list':
        return this.requirementToolHandler.listRequirements(parameters, agentId, executionContext);
      case 'builtin.sys-mg.mcp.requirement.get':
        return this.requirementToolHandler.getRequirement(parameters, agentId, executionContext);
      case 'builtin.sys-mg.mcp.requirement.create':
        return this.requirementToolHandler.createRequirement(parameters, agentId, executionContext);
      case 'builtin.sys-mg.mcp.requirement.update-status':
        return this.requirementToolHandler.updateRequirementStatus(parameters, agentId, executionContext);
      case 'builtin.sys-mg.mcp.requirement.assign':
        return this.requirementToolHandler.assignRequirement(parameters, agentId, executionContext);
      case 'builtin.sys-mg.mcp.requirement.comment':
        return this.requirementToolHandler.commentRequirement(parameters, agentId, executionContext);
      case 'builtin.sys-mg.mcp.requirement.sync-github':
        return this.requirementToolHandler.syncRequirementGithub(parameters, agentId);
      case 'builtin.sys-mg.mcp.requirement.board':
        return this.requirementToolHandler.getRequirementBoard(agentId);
      case 'builtin.sys-mg.mcp.meeting.list-meetings':
        return this.meetingToolHandler.listMeetings(parameters);
      case 'builtin.sys-mg.mcp.meeting.send-message':
        return this.meetingToolHandler.sendMeetingMessage(parameters, agentId, executionContext);
      case 'builtin.sys-mg.mcp.meeting.update-status':
        return this.meetingToolHandler.updateMeetingStatus(parameters);
      default:
        throw new Error(`Tool implementation not found: ${tool.id}`);
    }
  }

  private getImplementedToolIds(): string[] {
    return IMPLEMENTED_TOOL_IDS;
  }

  private async searchMemoMemory(
    params: { query?: string; memoType?: 'knowledge' | 'standard'; limit?: number; detail?: boolean },
    agentId?: string,
  ): Promise<any> {
    if (!agentId) {
      throw new Error('memo_mcp_search requires agentId');
    }

    const query = params?.query?.trim() || '';
    const memories = await this.memoService.searchMemos(agentId, query, {
      memoType: params?.memoType,
      limit: params?.limit,
      progressive: true,
      detail: params?.detail === true,
    });

    return {
      agentId,
      query,
      total: memories.length,
      memories,
      fetchedAt: new Date().toISOString(),
    };
  }

  private async appendMemoMemory(
    params: {
      targetAgentId?: string;
      agentId?: string;
      memoId?: string;
      title?: string;
      content?: string;
      memoKind?: 'identity' | 'todo' | 'topic' | 'history' | 'draft' | 'custom' | 'evaluation' | 'achievement' | 'criticism';
      memoType?: 'knowledge' | 'standard';
      taskId?: string;
      topic?: string;
      tags?: string[];
    },
    agentId?: string,
    executionContext?: ToolExecutionContext,
  ): Promise<any> {
    if (!agentId) {
      throw new Error('memo_mcp_append requires agentId');
    }
    if (!params?.content?.trim()) {
      throw new Error('memo_mcp_append requires content');
    }

    const resolvedTargetAgentId = String(params.targetAgentId || params.agentId || '').trim() || agentId;
    const requestedKind = params.memoKind;
    const requestedType = params.memoType;

    if ((requestedKind === 'achievement' || requestedKind === 'criticism') && !String(params.targetAgentId || params.agentId || '').trim()) {
      throw new Error('memo_mcp_append requires targetAgentId for achievement/criticism');
    }

    if (requestedType === 'standard' && !requestedKind) {
      throw new Error('memo_mcp_append requires memoKind when memoType=standard');
    }

    if (requestedKind === 'topic' && requestedType && requestedType !== 'knowledge') {
      throw new Error('memo_mcp_append requires memoType=knowledge when memoKind=topic');
    }

    if ((requestedKind === 'achievement' || requestedKind === 'criticism') && requestedType && requestedType !== 'standard') {
      throw new Error(`memo_mcp_append requires memoType=standard when memoKind=${requestedKind}`);
    }

    const actor = this.resolveMemoActorContext(executionContext);

    if (params.memoId) {
      const existing = await this.memoService.getMemoById(params.memoId);
      if (existing.agentId !== resolvedTargetAgentId) {
        throw new Error('memo_mcp_append memoId owner mismatch with targetAgentId');
      }
      const useDivider = existing.memoKind === 'achievement' || existing.memoKind === 'criticism';
      const existingContent = String(existing.content || '').trim();
      const nextContent = params.content.trim();
      const updated = await this.memoService.updateMemo(existing.id, {
        content: useDivider
          ? existingContent
            ? `${existingContent}\n\n—\n\n${nextContent}`
            : nextContent
          : `${existing.content}\n\n${nextContent}`,
        tags: Array.from(new Set([...(existing.tags || []), ...((params.tags || []).filter(Boolean))])),
      },
      {
        actor,
        skipRolePermissionCheck: true,
      });
      return {
        action: 'updated',
        memo: updated,
      };
    }

    const created = await this.memoService.createMemo({
      agentId: resolvedTargetAgentId,
      title: params.title?.trim() || 'Runtime memo',
      content: params.content.trim(),
      memoKind: params.memoKind,
      memoType: params.memoType || 'knowledge',
      payload: {
        taskId: params.taskId,
        topic: params.topic || 'runtime',
      },
      tags: params.tags || [],
      source: 'memo_mcp_append',
    },
    {
      actor,
      skipRolePermissionCheck: true,
    });

    return {
      action: 'created',
      memo: created,
    };
  }

  private resolveMemoActorContext(
    executionContext?: ToolExecutionContext,
  ): {
    employeeId?: string;
    role?: string;
  } | undefined {
    const teamContext = executionContext?.teamContext || {};
    const employeeId = String(
      executionContext?.actor?.employeeId ||
        teamContext.employeeId ||
        teamContext.initiatorId ||
        teamContext.triggeredBy ||
        teamContext.userId ||
        '',
    ).trim();
    const role = String(
      executionContext?.actor?.role ||
        teamContext.role ||
        teamContext.actorRole ||
        teamContext.initiatorRole ||
        teamContext.userRole ||
        '',
    ).trim();

    if (!employeeId && !role) {
      return undefined;
    }

    return {
      ...(employeeId ? { employeeId } : {}),
      ...(role ? { role } : {}),
    };
  }

  private resolveMeetingContext(executionContext?: ToolExecutionContext): {
    meetingId?: string;
    initiatorId?: string;
    taskType?: string;
    organizationId?: string;
    executionAgentId?: string;
  } {
    const teamContext = executionContext?.teamContext || {};
    return {
      meetingId:
        (typeof teamContext.meetingId === 'string' && teamContext.meetingId) ||
        (typeof executionContext?.teamId === 'string' && executionContext.teamId) ||
        undefined,
      initiatorId:
        (typeof teamContext.initiatorId === 'string' && teamContext.initiatorId) ||
        (typeof teamContext.triggeredBy === 'string' && teamContext.triggeredBy) ||
        undefined,
      taskType:
        executionContext?.taskType ||
        (typeof teamContext.meetingType === 'string' ? 'discussion' : undefined),
      organizationId:
        (typeof teamContext.organizationId === 'string' && teamContext.organizationId) ||
        (typeof teamContext.orgId === 'string' && teamContext.orgId) ||
        undefined,
      executionAgentId:
        (typeof teamContext.agentId === 'string' && teamContext.agentId) ||
        undefined,
    };
  }

  private assertExecutionContext(
    executionContext: ToolExecutionContext | undefined,
    options: {
      allowMeeting: boolean;
      allowAutonomous: boolean;
      fallbackAgentId?: string;
    },
  ): {
    mode: 'meeting' | 'autonomous';
    meetingId?: string;
    initiatorId?: string;
    organizationId?: string;
    agentId?: string;
  } {
    const context = this.resolveMeetingContext(executionContext);
    const meetingLike = context.taskType === 'discussion' || Boolean(context.meetingId);
    if (meetingLike && options.allowMeeting) {
      return {
        mode: 'meeting',
        meetingId: context.meetingId || 'unknown-meeting',
        initiatorId: context.initiatorId,
      };
    }

    const agentId = context.executionAgentId || options.fallbackAgentId;
    if (options.allowAutonomous && context.organizationId && agentId) {
      return {
        mode: 'autonomous',
        organizationId: context.organizationId,
        agentId,
        initiatorId: context.initiatorId,
      };
    }

    if (options.allowMeeting && options.allowAutonomous) {
      throw new Error('This tool requires meeting context OR autonomous context (organizationId + agentId)');
    }
    if (options.allowMeeting) {
      throw new Error('This tool is only available in meeting context');
    }
    throw new Error('This tool requires autonomous context (organizationId + agentId)');
  }

  private assertMeetingContext(executionContext?: ToolExecutionContext): {
    meetingId: string;
    initiatorId?: string;
  } {
    const context = this.resolveMeetingContext(executionContext);
    const meetingLike = context.taskType === 'discussion' || Boolean(context.meetingId);
    if (!meetingLike) {
      throw new Error('This orchestration MCP tool is only available in meeting context');
    }
    return {
      meetingId: context.meetingId || 'unknown-meeting',
      initiatorId: context.initiatorId,
    };
  }

  private requireConfirm(params: any, action: string): void {
    if (params?.confirm === true) {
      return;
    }
    throw new Error(`${action} requires confirm=true`);
  }

  private async runEngineeringStatistics(params: {
    receiverId?: string;
    scope?: 'all' | 'docs' | 'frontend' | 'backend';
    tokenMode?: 'estimate' | 'exact';
    projectIds?: string[];
    triggeredBy?: string;
  }): Promise<any> {
    const payload = {
      receiverId: params?.receiverId || undefined,
      scope: params?.scope || 'all',
      tokenMode: params?.tokenMode || 'estimate',
      projectIds: Array.isArray(params?.projectIds)
        ? params.projectIds.map((item) => String(item || '').trim()).filter(Boolean)
        : undefined,
      triggeredBy: params?.triggeredBy || 'agent-mcp',
    };

    const response = await this.internalApiClient.postEngineeringStatistics(payload);

    return {
      action: 'engineering_statistics_run',
      snapshot: response,
      fetchedAt: new Date().toISOString(),
    };
  }

  private buildRequirementQuery(params: {
    status?: string;
    assigneeAgentId?: string;
    localProjectId?: string;
    search?: string;
    limit?: number;
  }): string {
    const query = new URLSearchParams();
    if (params?.status) query.append('status', String(params.status).trim());
    if (params?.assigneeAgentId) query.append('assigneeAgentId', String(params.assigneeAgentId).trim());
    if (params?.localProjectId) query.append('localProjectId', String(params.localProjectId).trim());
    if (params?.search) query.append('search', String(params.search).trim());
    if (params?.limit !== undefined) {
      const limit = Math.max(1, Math.min(Number(params.limit || 50), 200));
      query.append('limit', String(limit));
    }
    const text = query.toString();
    return text ? `?${text}` : '';
  }

  private async listRequirements(
    params: {
      status?: string;
      assigneeAgentId?: string;
      localProjectId?: string;
      search?: string;
      limit?: number;
    },
    agentId?: string,
    executionContext?: ToolExecutionContext,
  ): Promise<any> {
    const query = this.buildRequirementQuery(params || {});
    const result = await this.internalApiClient.callEiApi('GET', `/requirements${query}`);
    return {
      action: 'requirement_list',
      initiatorAgentId: agentId,
      organizationId: (executionContext?.teamContext || {}).organizationId,
      total: Array.isArray(result) ? result.length : 0,
      requirements: result,
      fetchedAt: new Date().toISOString(),
    };
  }

  private async getRequirement(
    params: { requirementId?: string },
    agentId?: string,
    executionContext?: ToolExecutionContext,
  ): Promise<any> {
    const requirementId = String(params?.requirementId || '').trim();
    if (!requirementId) {
      throw new Error('requirement_get requires requirementId');
    }
    const result = await this.internalApiClient.callEiApi('GET', `/requirements/${encodeURIComponent(requirementId)}`);
    return {
      action: 'requirement_get',
      initiatorAgentId: agentId,
      organizationId: (executionContext?.teamContext || {}).organizationId,
      requirement: result,
    };
  }

  private async createRequirement(
    params: {
      title?: string;
      description?: string;
      priority?: 'low' | 'medium' | 'high' | 'critical';
      labels?: string[];
      createdById?: string;
      createdByName?: string;
      createdByType?: 'human' | 'agent' | 'system';
      localProjectId?: string;
    },
    agentId?: string,
    executionContext?: ToolExecutionContext,
  ): Promise<any> {
    const title = String(params?.title || '').trim();
    if (!title) {
      throw new Error('requirement_create requires title');
    }
    const result = await this.internalApiClient.callEiApi('POST', '/requirements', {
      title,
      description: String(params?.description || '').trim(),
      priority: params?.priority,
      labels: Array.isArray(params?.labels) ? params.labels : undefined,
      createdById: String(params?.createdById || executionContext?.actor?.employeeId || agentId || '').trim() || undefined,
      createdByName: String(params?.createdByName || '').trim() || undefined,
      createdByType: params?.createdByType || 'agent',
      localProjectId: String(params?.localProjectId || '').trim() || undefined,
    });
    return {
      action: 'requirement_create',
      initiatorAgentId: agentId,
      requirement: result,
      createdAt: new Date().toISOString(),
    };
  }

  private async updateRequirementStatus(
    params: {
      requirementId?: string;
      status?: 'todo' | 'assigned' | 'in_progress' | 'review' | 'done' | 'blocked';
      changedById?: string;
      changedByName?: string;
      changedByType?: 'human' | 'agent' | 'system';
      note?: string;
    },
    agentId?: string,
    executionContext?: ToolExecutionContext,
  ): Promise<any> {
    const requirementId = String(params?.requirementId || '').trim();
    if (!requirementId) {
      throw new Error('requirement_update_status requires requirementId');
    }
    if (!params?.status) {
      throw new Error('requirement_update_status requires status');
    }
    const result = await this.internalApiClient.callEiApi('POST', `/requirements/${encodeURIComponent(requirementId)}/status`, {
      status: params.status,
      changedById: String(params?.changedById || executionContext?.actor?.employeeId || agentId || '').trim() || undefined,
      changedByName: String(params?.changedByName || '').trim() || undefined,
      changedByType: params?.changedByType || 'agent',
      note: String(params?.note || '').trim() || undefined,
    });
    return {
      action: 'requirement_update_status',
      initiatorAgentId: agentId,
      requirementId,
      status: params.status,
      requirement: result,
      updatedAt: new Date().toISOString(),
    };
  }

  private async assignRequirement(
    params: {
      requirementId?: string;
      toAgentId?: string;
      toAgentName?: string;
      assignedById?: string;
      assignedByName?: string;
      reason?: string;
    },
    agentId?: string,
    executionContext?: ToolExecutionContext,
  ): Promise<any> {
    const requirementId = String(params?.requirementId || '').trim();
    if (!requirementId) {
      throw new Error('requirement_assign requires requirementId');
    }
    const toAgentId = String(params?.toAgentId || '').trim();
    if (!toAgentId) {
      throw new Error('requirement_assign requires toAgentId');
    }
    const result = await this.internalApiClient.callEiApi('POST', `/requirements/${encodeURIComponent(requirementId)}/assign`, {
      toAgentId,
      toAgentName: String(params?.toAgentName || '').trim() || undefined,
      assignedById: String(params?.assignedById || executionContext?.actor?.employeeId || agentId || '').trim() || undefined,
      assignedByName: String(params?.assignedByName || '').trim() || undefined,
      reason: String(params?.reason || '').trim() || undefined,
    });
    return {
      action: 'requirement_assign',
      initiatorAgentId: agentId,
      requirementId,
      assigneeAgentId: toAgentId,
      requirement: result,
      updatedAt: new Date().toISOString(),
    };
  }

  private async commentRequirement(
    params: {
      requirementId?: string;
      content?: string;
      authorId?: string;
      authorName?: string;
      authorType?: 'human' | 'agent' | 'system';
    },
    agentId?: string,
    executionContext?: ToolExecutionContext,
  ): Promise<any> {
    const requirementId = String(params?.requirementId || '').trim();
    if (!requirementId) {
      throw new Error('requirement_comment requires requirementId');
    }
    const content = String(params?.content || '').trim();
    if (!content) {
      throw new Error('requirement_comment requires content');
    }
    const result = await this.internalApiClient.callEiApi('POST', `/requirements/${encodeURIComponent(requirementId)}/comments`, {
      content,
      authorId: String(params?.authorId || executionContext?.actor?.employeeId || agentId || '').trim() || undefined,
      authorName: String(params?.authorName || '').trim() || undefined,
      authorType: params?.authorType || 'agent',
    });
    return {
      action: 'requirement_comment',
      initiatorAgentId: agentId,
      requirementId,
      requirement: result,
      updatedAt: new Date().toISOString(),
    };
  }

  private async syncRequirementGithub(
    params: {
      requirementId?: string;
      owner?: string;
      repo?: string;
      labels?: string[];
    },
    agentId?: string,
    _executionContext?: ToolExecutionContext,
  ): Promise<any> {
    const requirementId = String(params?.requirementId || '').trim();
    if (!requirementId) {
      throw new Error('requirement_sync_github requires requirementId');
    }
    const result = await this.internalApiClient.callEiApi('POST', `/requirements/${encodeURIComponent(requirementId)}/github/sync`, {
      owner: String(params?.owner || '').trim() || undefined,
      repo: String(params?.repo || '').trim() || undefined,
      labels: Array.isArray(params?.labels) ? params.labels : undefined,
    });
    return {
      action: 'requirement_sync_github',
      initiatorAgentId: agentId,
      requirementId,
      result,
      updatedAt: new Date().toISOString(),
    };
  }

  private async getRequirementBoard(
    _params: Record<string, never>,
    agentId?: string,
    _executionContext?: ToolExecutionContext,
  ): Promise<any> {
    const result = await this.internalApiClient.callEiApi('GET', '/requirements/board');
    return {
      action: 'requirement_board',
      initiatorAgentId: agentId,
      board: result,
      fetchedAt: new Date().toISOString(),
    };
  }

  private async createOrchestrationPlan(
    params: {
      prompt?: string;
      title?: string;
      mode?: 'sequential' | 'parallel' | 'hybrid';
      plannerAgentId?: string;
      autoRun?: boolean;
      requirementId?: string;
    },
    agentId?: string,
    executionContext?: ToolExecutionContext,
  ): Promise<any> {
    const executionInfo = this.assertExecutionContext(executionContext, {
      allowMeeting: true,
      allowAutonomous: true,
      fallbackAgentId: agentId,
    });
    if (!params?.prompt?.trim()) {
      throw new Error('orchestration_create_plan requires prompt');
    }
    const prompt = params.prompt.trim();
    const promptMaxLength = 4000;
    if (prompt.length > promptMaxLength) {
      throw new Error(
        `orchestration_create_plan prompt too long: ${prompt.length} characters (max ${promptMaxLength})`,
      );
    }
    const title = params.title?.trim();
    const titleMaxLength = 200;
    if (title && title.length > titleMaxLength) {
      throw new Error(
        `orchestration_create_plan title too long: ${title.length} characters (max ${titleMaxLength})`,
      );
    }
    const validModes: Array<'sequential' | 'parallel' | 'hybrid'> = ['sequential', 'parallel', 'hybrid'];
    if (params.mode && !validModes.includes(params.mode)) {
      throw new Error(
        `orchestration_create_plan invalid mode: ${params.mode}. allowed=${validModes.join('|')}`,
      );
    }
    const payload = {
      prompt,
      title,
      mode: params.mode,
      plannerAgentId: params.plannerAgentId,
      autoRun: params.autoRun === true,
      requirementId: params.requirementId,
    };
    const result = await this.internalApiClient.callOrchestrationApi('POST', '/plans/from-prompt', payload);
    return {
      action: 'create_plan',
      contextMode: executionInfo.mode,
      meetingId: executionInfo.meetingId,
      organizationId: executionInfo.organizationId,
      initiatorAgentId: agentId,
      result,
    };
  }

  private async runOrchestrationPlan(
    params: { planId?: string; continueOnFailure?: boolean; confirm?: boolean },
    agentId?: string,
    executionContext?: ToolExecutionContext,
  ): Promise<any> {
    const executionInfo = this.assertExecutionContext(executionContext, {
      allowMeeting: true,
      allowAutonomous: true,
      fallbackAgentId: agentId,
    });
    if (!params?.planId?.trim()) {
      throw new Error('orchestration_run_plan requires planId');
    }
    this.requireConfirm(params, 'orchestration_run_plan');
    const result = await this.internalApiClient.callOrchestrationApi(
      'POST',
      `/plans/${params.planId.trim()}/run`,
      { continueOnFailure: params.continueOnFailure === true },
    );
    return {
      action: 'run_plan',
      contextMode: executionInfo.mode,
      meetingId: executionInfo.meetingId,
      organizationId: executionInfo.organizationId,
      initiatorAgentId: agentId,
      result,
    };
  }

  private async updateOrchestrationPlan(
    params: {
      planId?: string;
      title?: string;
      prompt?: string;
      mode?: 'sequential' | 'parallel' | 'hybrid';
      plannerAgentId?: string;
      metadata?: Record<string, any>;
    },
    agentId?: string,
    executionContext?: ToolExecutionContext,
  ): Promise<any> {
    const executionInfo = this.assertExecutionContext(executionContext, {
      allowMeeting: true,
      allowAutonomous: true,
      fallbackAgentId: agentId,
    });
    const planId = String(params?.planId || '').trim();
    if (!planId) {
      throw new Error('orchestration_update_plan requires planId');
    }

    const payload: Record<string, any> = {};
    const title = params?.title?.trim();
    if (title !== undefined && title.length > 0) {
      if (title.length > 200) {
        throw new Error('orchestration_update_plan title too long: max 200 characters');
      }
      payload.title = title;
    }

    const sourcePrompt = params?.prompt?.trim();
    if (sourcePrompt !== undefined && sourcePrompt.length > 0) {
      if (sourcePrompt.length > 4000) {
        throw new Error('orchestration_update_plan prompt too long: max 4000 characters');
      }
      payload.sourcePrompt = sourcePrompt;
    }

    const validModes: Array<'sequential' | 'parallel' | 'hybrid'> = ['sequential', 'parallel', 'hybrid'];
    if (params?.mode !== undefined) {
      if (!validModes.includes(params.mode)) {
        throw new Error(`orchestration_update_plan invalid mode: ${params.mode}. allowed=${validModes.join('|')}`);
      }
      payload.mode = params.mode;
    }

    if (params?.plannerAgentId !== undefined) {
      payload.plannerAgentId = String(params.plannerAgentId || '').trim();
    }

    if (params?.metadata !== undefined) {
      if (!params.metadata || typeof params.metadata !== 'object' || Array.isArray(params.metadata)) {
        throw new Error('orchestration_update_plan metadata must be an object');
      }
      payload.metadata = params.metadata;
    }

    if (!Object.keys(payload).length) {
      throw new Error('orchestration_update_plan requires at least one field to update');
    }

    const result = await this.internalApiClient.callOrchestrationApi('PATCH', `/plans/${planId}`, payload);
    return {
      action: 'update_plan',
      contextMode: executionInfo.mode,
      meetingId: executionInfo.meetingId,
      organizationId: executionInfo.organizationId,
      initiatorAgentId: agentId,
      result,
    };
  }

  private async getOrchestrationPlan(
    params: { planId?: string },
    agentId?: string,
    executionContext?: ToolExecutionContext,
  ): Promise<any> {
    const executionInfo = this.assertExecutionContext(executionContext, {
      allowMeeting: true,
      allowAutonomous: true,
      fallbackAgentId: agentId,
    });
    if (!params?.planId?.trim()) {
      throw new Error('orchestration_get_plan requires planId');
    }
    const result = await this.internalApiClient.callOrchestrationApi('GET', `/plans/${params.planId.trim()}`, undefined);
    return {
      action: 'get_plan',
      contextMode: executionInfo.mode,
      meetingId: executionInfo.meetingId,
      organizationId: executionInfo.organizationId,
      initiatorAgentId: agentId,
      result,
    };
  }

  private async listOrchestrationPlans(
    params: Record<string, never>,
    agentId?: string,
    executionContext?: ToolExecutionContext,
  ): Promise<any> {
    const executionInfo = this.assertExecutionContext(executionContext, {
      allowMeeting: true,
      allowAutonomous: true,
      fallbackAgentId: agentId,
    });
    const result = await this.internalApiClient.callOrchestrationApi('GET', '/plans', undefined);
    return {
      action: 'list_plans',
      contextMode: executionInfo.mode,
      meetingId: executionInfo.meetingId,
      organizationId: executionInfo.organizationId,
      initiatorAgentId: agentId,
      result,
    };
  }

  private async reassignOrchestrationTask(
    params: {
      taskId?: string;
      executorType?: 'agent' | 'employee' | 'unassigned';
      executorId?: string;
      reason?: string;
      confirm?: boolean;
    },
    agentId?: string,
    executionContext?: ToolExecutionContext,
  ): Promise<any> {
    const executionInfo = this.assertExecutionContext(executionContext, {
      allowMeeting: true,
      allowAutonomous: true,
      fallbackAgentId: agentId,
    });
    if (!params?.taskId?.trim()) {
      throw new Error('orchestration_reassign_task requires taskId');
    }
    if (!params?.executorType) {
      throw new Error('orchestration_reassign_task requires executorType');
    }
    this.requireConfirm(params, 'orchestration_reassign_task');
    const result = await this.internalApiClient.callOrchestrationApi(
      'POST',
      `/tasks/${params.taskId.trim()}/reassign`,
      {
        executorType: params.executorType,
        executorId: params.executorId,
        reason: params.reason,
      },
    );
    return {
      action: 'reassign_task',
      contextMode: executionInfo.mode,
      meetingId: executionInfo.meetingId,
      organizationId: executionInfo.organizationId,
      initiatorAgentId: agentId,
      result,
    };
  }

  private async completeOrchestrationHumanTask(
    params: { taskId?: string; summary?: string; output?: string; confirm?: boolean },
    agentId?: string,
    executionContext?: ToolExecutionContext,
  ): Promise<any> {
    const executionInfo = this.assertExecutionContext(executionContext, {
      allowMeeting: true,
      allowAutonomous: true,
      fallbackAgentId: agentId,
    });
    if (!params?.taskId?.trim()) {
      throw new Error('orchestration_complete_human_task requires taskId');
    }
    this.requireConfirm(params, 'orchestration_complete_human_task');
    const result = await this.internalApiClient.callOrchestrationApi(
      'POST',
      `/tasks/${params.taskId.trim()}/complete-human`,
      {
        summary: params.summary,
        output: params.output,
      },
    );
    return {
      action: 'complete_human_task',
      contextMode: executionInfo.mode,
      meetingId: executionInfo.meetingId,
      organizationId: executionInfo.organizationId,
      initiatorAgentId: agentId,
      result,
    };
  }

  private async getOrchestrationPlanForSchedule(planId: string): Promise<any> {
    const normalizedPlanId = String(planId || '').trim();
    if (!normalizedPlanId) {
      throw new Error('planId is required');
    }
    const plan = await this.internalApiClient.callOrchestrationApi('GET', `/plans/${normalizedPlanId}`, undefined);
    if (!plan || typeof plan !== 'object') {
      throw new Error('plan not found');
    }
    return plan;
  }

  private resolvePlanExecutorId(plan: any): string {
    const plannerAgentId = String(plan?.strategy?.plannerAgentId || '').trim();
    if (plannerAgentId) {
      return plannerAgentId;
    }

    const taskAssignments = Array.isArray(plan?.tasks)
      ? plan.tasks
          .map((task: any) => ({
            executorType: String(task?.assignment?.executorType || ''),
            executorId: String(task?.assignment?.executorId || '').trim(),
          }))
          .filter((assignment: any) => assignment.executorType === 'agent' && assignment.executorId)
      : [];
    if (taskAssignments.length) {
      return taskAssignments[0].executorId;
    }

    throw new Error('plan has no executable agent context, please set plannerAgentId first');
  }

  private buildScheduleConfig(params: {
    scheduleType?: 'cron' | 'interval';
    expression?: string;
    intervalMs?: number;
    timezone?: string;
  }): { type: 'cron' | 'interval'; expression?: string; intervalMs?: number; timezone?: string } {
    const scheduleType = params?.scheduleType;
    if (scheduleType !== 'cron' && scheduleType !== 'interval') {
      throw new Error('scheduleType must be cron or interval');
    }
    if (scheduleType === 'cron' && !String(params?.expression || '').trim()) {
      throw new Error('expression is required when scheduleType=cron');
    }
    if (scheduleType === 'interval') {
      const intervalMs = Number(params?.intervalMs || 0);
      if (!Number.isFinite(intervalMs) || intervalMs < 60_000) {
        throw new Error('intervalMs must be >= 60000 when scheduleType=interval');
      }
    }

    return {
      type: scheduleType,
      expression: scheduleType === 'cron' ? String(params?.expression || '').trim() : undefined,
      intervalMs: scheduleType === 'interval' ? Number(params?.intervalMs) : undefined,
      timezone: String(params?.timezone || '').trim() || undefined,
    };
  }

  private buildScheduleUpdateConfig(params: {
    scheduleType?: 'cron' | 'interval';
    expression?: string;
    intervalMs?: number;
    timezone?: string;
  }): { schedule?: { type: 'cron' | 'interval'; expression?: string; intervalMs?: number; timezone?: string } } {
    const hasSchedulePatch =
      params?.scheduleType !== undefined ||
      params?.expression !== undefined ||
      params?.intervalMs !== undefined ||
      params?.timezone !== undefined;
    if (!hasSchedulePatch) {
      return {};
    }

    return {
      schedule: this.buildScheduleConfig({
        scheduleType: params.scheduleType,
        expression: params.expression,
        intervalMs: params.intervalMs,
        timezone: params.timezone,
      }),
    };
  }

  private async createOrchestrationSchedule(
    params: {
      planId?: string;
      scheduleType?: 'cron' | 'interval';
      expression?: string;
      intervalMs?: number;
      timezone?: string;
      enabled?: boolean;
    },
    agentId?: string,
    executionContext?: ToolExecutionContext,
  ): Promise<any> {
    const executionInfo = this.assertExecutionContext(executionContext, {
      allowMeeting: true,
      allowAutonomous: true,
      fallbackAgentId: agentId,
    });
    const planId = String(params?.planId || '').trim();
    if (!planId) {
      throw new Error('orchestration_create_schedule requires planId');
    }

    const plan = await this.getOrchestrationPlanForSchedule(planId);
    const targetAgentId = this.resolvePlanExecutorId(plan);
    const planTitle = String(plan?.title || '').trim();
    const planPrompt = String(plan?.sourcePrompt || '').trim();

    const payload = {
      name: `plan-schedule:${planTitle || planId}`,
      description: `Schedule for orchestration plan ${planId}`,
      schedule: this.buildScheduleConfig({
        scheduleType: params.scheduleType,
        expression: params.expression,
        intervalMs: params.intervalMs,
        timezone: params.timezone,
      }),
      target: {
        executorType: 'agent' as const,
        executorId: targetAgentId,
      },
      input: {
        prompt: planPrompt || undefined,
        payload: {
          planId,
          source: 'mcp.orchestration.createSchedule',
        },
      },
      enabled: params?.enabled,
    };

    const result = await this.internalApiClient.callOrchestrationApi('POST', '/schedules', payload);
    return {
      action: 'create_schedule',
      contextMode: executionInfo.mode,
      meetingId: executionInfo.meetingId,
      organizationId: executionInfo.organizationId,
      initiatorAgentId: agentId,
      planId,
      result,
    };
  }

  private async updateOrchestrationSchedule(
    params: {
      scheduleId?: string;
      scheduleType?: 'cron' | 'interval';
      expression?: string;
      intervalMs?: number;
      timezone?: string;
      enabled?: boolean;
    },
    agentId?: string,
    executionContext?: ToolExecutionContext,
  ): Promise<any> {
    const executionInfo = this.assertExecutionContext(executionContext, {
      allowMeeting: true,
      allowAutonomous: true,
      fallbackAgentId: agentId,
    });
    const scheduleId = String(params?.scheduleId || '').trim();
    if (!scheduleId) {
      throw new Error('orchestration_update_schedule requires scheduleId');
    }

    const schedulePatch = this.buildScheduleUpdateConfig({
      scheduleType: params.scheduleType,
      expression: params.expression,
      intervalMs: params.intervalMs,
      timezone: params.timezone,
    });

    const payload: Record<string, unknown> = {
      ...schedulePatch,
    };
    if (params?.enabled !== undefined) {
      payload.enabled = params.enabled === true;
    }

    if (!Object.keys(payload).length) {
      throw new Error('orchestration_update_schedule requires at least one field to update');
    }

    const result = await this.internalApiClient.callOrchestrationApi('PUT', `/schedules/${scheduleId}`, payload);
    return {
      action: 'update_schedule',
      contextMode: executionInfo.mode,
      meetingId: executionInfo.meetingId,
      organizationId: executionInfo.organizationId,
      initiatorAgentId: agentId,
      result,
    };
  }

  private async debugOrchestrationTask(
    params: {
      taskId?: string;
      title?: string;
      description?: string;
      resetResult?: boolean;
    },
    agentId?: string,
    executionContext?: ToolExecutionContext,
  ): Promise<any> {
    const executionInfo = this.assertExecutionContext(executionContext, {
      allowMeeting: true,
      allowAutonomous: true,
      fallbackAgentId: agentId,
    });
    const taskId = String(params?.taskId || '').trim();
    if (!taskId) {
      throw new Error('orchestration_debug_task requires taskId');
    }

    const payload: Record<string, unknown> = {};
    if (params?.title !== undefined) {
      const title = String(params.title || '').trim();
      if (title.length > 200) {
        throw new Error('orchestration_debug_task title too long: max 200 characters');
      }
      payload.title = title;
    }
    if (params?.description !== undefined) {
      const description = String(params.description || '').trim();
      if (description.length > 4000) {
        throw new Error('orchestration_debug_task description too long: max 4000 characters');
      }
      payload.description = description;
    }
    if (params?.resetResult !== undefined) {
      payload.resetResult = params.resetResult === true;
    }

    const result = await this.internalApiClient.callOrchestrationApi('POST', `/tasks/${taskId}/debug-run`, payload);
    const execution = result?.execution || {};
    const task = result?.task || {};
    const recentLogs = Array.isArray(task?.runLogs) ? task.runLogs.slice(-5) : [];
    const debug = {
      status: execution?.status || task?.status || 'unknown',
      error: execution?.error || null,
      resultSnippet:
        typeof execution?.result === 'string' ? execution.result.slice(0, 800) : execution?.result ? JSON.stringify(execution.result).slice(0, 800) : null,
      recentLogs,
      suggestedNextAction:
        execution?.status === 'failed'
          ? 'Inspect error and dependency context, then retry debug with updated draft'
          : execution?.status === 'waiting_human'
            ? 'Hand off to human or complete manually via complete-human-task'
            : execution?.status === 'completed'
              ? 'Continue with downstream dependent tasks'
              : 'Review task status and decide next operation',
    };

    return {
      action: 'debug_task',
      contextMode: executionInfo.mode,
      meetingId: executionInfo.meetingId,
      organizationId: executionInfo.organizationId,
      initiatorAgentId: agentId,
      taskId,
      debug,
      result,
    };
  }

  private normalizeProvider(provider?: string): string {
    const value = String(provider || '').trim().toLowerCase();
    if (value === 'kimi') return 'moonshot';
    if (value === 'claude') return 'anthropic';
    return value;
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
    return this.modelToolHandler.addModelToSystem(params);
  }

  private async listSystemModels(params: { provider?: string; limit?: number }): Promise<any> {
    return this.modelToolHandler.listSystemModels(params);
  }

  private async listSkillsByTitle(params: {
    title?: string;
    search?: string;
    status?: string;
    category?: string;
    includeMetadata?: boolean;
    limit?: number;
    page?: number;
  }): Promise<any> {
    return this.skillToolHandler.listSkillsByTitle(params);
  }

  private async createSkillByMcp(params: {
    title?: string;
    name?: string;
    description?: string;
    category?: string;
    tags?: string[];
    sourceType?: string;
    sourceUrl?: string;
    provider?: string;
    version?: string;
    status?: string;
    confidenceScore?: number;
    metadata?: Record<string, any>;
    content?: string;
    contentType?: string;
  }): Promise<any> {
    return this.skillToolHandler.createSkillByMcp(params);
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
    return this.auditToolHandler.listHumanOperationLogs(params, agentId);
  }

  private normalizeStringArray(items?: unknown[]): string[] {
    return Array.from(
      new Set(
        (Array.isArray(items) ? items : [])
          .map((item) => String(item || '').trim())
          .filter(Boolean),
      ),
    );
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

    const headers = this.internalApiClient.buildSignedHeaders();
    const timeout = Number(process.env.AGENT_ROLE_REQUEST_TIMEOUT_MS || 8000);

    try {
      const byIdResponse = await axios.get(`${this.backendBaseUrl}/roles/${encodeURIComponent(normalized)}`, {
        headers,
        timeout,
      });
      const role = byIdResponse?.data || {};
      const id = String(role.id || '').trim();
      if (id) {
        return { roleId: id, matchedBy: 'id' };
      }
    } catch {
      // ignore and fallback to role code resolution
    }

    let roles: Array<{ id: string; code: string; name?: string }> = [];
    try {
      const rolesResponse = await axios.get(`${this.backendBaseUrl}/roles`, {
        headers,
        timeout,
        params: { status: 'active' },
      });
      roles = Array.isArray(rolesResponse?.data) ? rolesResponse.data : [];
    } catch {
      roles = [];
    }

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

  private async createAgentByMcp(params: {
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
      capabilities: this.normalizeStringArray(params?.capabilities),
      tools: this.normalizeStringArray(params?.tools),
      permissions: this.normalizeStringArray(params?.permissions),
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

  private async getAgentsMcpList(params: { includeHidden?: boolean; limit?: number }): Promise<any> {
    const includeHidden = params?.includeHidden === true;
    const limit = Math.max(1, Math.min(Number(params?.limit || 20), 100));
    const agents = await this.agentModel.find().exec();
    const roleIds = Array.from(new Set(agents.map((agent: any) => String(agent.roleId || '').trim()).filter(Boolean)));
    const roleMap = await this.getRoleMapByIds(roleIds);
    const roleCodes = Array.from(new Set(Array.from(roleMap.values()).map((role) => role.code).filter(Boolean)));
    const profiles = await this.agentProfileModel.find({ roleCode: { $in: roleCodes } }).exec();
    const profileMap = new Map<string, AgentProfile>();
    for (const profile of profiles) {
      profileMap.set(profile.roleCode, profile);
    }

    const mapped = agents.map((agent) => {
      const plain = agent?.toObject ? agent.toObject() : agent;
      const roleId = String(plain.roleId || '').trim();
      const role = roleMap.get(roleId);
      const profile = role?.code ? profileMap.get(role.code) || DEFAULT_PROFILE : DEFAULT_PROFILE;
      return {
        id: plain.id || plain._id?.toString?.() || plain._id,
        name: plain.name,
        role: role?.name || profile.role,
        capabilitySet: Array.from(new Set([...(plain.capabilities || []), ...(profile.capabilities || [])])).slice(0, 12),
        exposed: profile.exposed === true,
        isActive: plain.isActive === true,
      };
    });

    const visibleAgents = mapped.filter((item) => includeHidden || item.exposed).slice(0, limit);
    const identifyMap = await this.memoService.getFirstMemoContentMapByKind(
      visibleAgents.map((item) => String(item.id || '').trim()),
      'identity',
    );
    const agentsWithIdentify = visibleAgents.map((item) => ({
      ...item,
      identify: identifyMap.get(String(item.id || '').trim()) || '',
    }));

    return {
      total: mapped.length,
      visible: agentsWithIdentify.length,
      includeHidden,
      agents: agentsWithIdentify,
      fetchedAt: new Date().toISOString(),
    };
  }

  private async getRoleMapByIds(roleIds: string[]): Promise<Map<string, { name: string; code: string }>> {
    const uniqueRoleIds = Array.from(new Set((roleIds || []).map((item) => String(item || '').trim()).filter(Boolean)));
    const map = new Map<string, { name: string; code: string }>();
    if (!uniqueRoleIds.length) {
      return map;
    }

    await Promise.all(
      uniqueRoleIds.map(async (roleId) => {
        try {
          const response = await axios.get(`${this.backendBaseUrl}/roles/${encodeURIComponent(roleId)}`, {
            timeout: Number(process.env.AGENT_ROLE_REQUEST_TIMEOUT_MS || 8000),
          });
          const role = response.data || {};
          const code = String(role.code || '').trim();
          const name = String(role.name || role.code || '').trim();
          if (code) {
            map.set(roleId, { name, code });
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'unknown role fetch error';
          this.logger.warn(`Failed to resolve role ${roleId} in tools mcp list: ${message}`);
        }
      }),
    );

    return map;
  }

  private async getCodeDocsReader(params: {
    focus?: string;
    maxFiles?: number;
  }): Promise<any> {
    return this.repoToolHandler.getCodeDocsReader(params);
  }

  private async getCodeUpdatesReader(params: {
    hours?: number;
    limit?: number;
  }): Promise<any> {
    return this.repoToolHandler.getCodeUpdatesReader(params);
  }

  private async executeDocsWrite(params: {
    filePath?: string;
    content?: string;
    mode?: 'create' | 'update' | 'append';
    overwrite?: boolean;
  }): Promise<any> {
    return this.repoToolHandler.executeDocsWrite(params);
  }

  private async executeRepoRead(params: { command: string }): Promise<any> {
    return this.repoToolHandler.executeRepoRead(params);
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

  async getToolExecutions(agentId?: string, toolId?: string): Promise<any[]> {
    const filter: any = {};
    if (agentId) filter.agentId = agentId;
    if (toolId) {
      filter.$or = [{ toolId }, { resolvedToolId: toolId }, { requestedToolId: toolId }];
    }
    const executions = await this.executionModel.find(filter).sort({ timestamp: -1 }).exec();
    return executions.map((execution) => this.toExecutionView(execution as any));
  }

  async getToolExecutionStats(): Promise<any> {
    const rows = await this.executionModel
      .aggregate([
        {
          $group: {
            _id: { $ifNull: ['$resolvedToolId', '$toolId'] },
            totalExecutions: { $sum: 1 },
            failedExecutions: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
            totalCost: { $sum: '$tokenCost' },
            avgExecutionTime: { $avg: '$executionTime' },
            successRate: { $avg: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
          },
        },
      ])
      .exec();

    const failureRows = await this.executionModel
      .aggregate([
        {
          $match: {
            status: 'failed',
          },
        },
        {
          $group: {
            _id: {
              toolId: { $ifNull: ['$resolvedToolId', '$toolId'] },
              errorCode: { $ifNull: ['$errorCode', 'TOOL_EXECUTION_FAILED'] },
            },
            count: { $sum: 1 },
          },
        },
      ])
      .exec();

    const failureByTool = new Map<string, Array<{ errorCode: string; count: number }>>();
    for (const row of failureRows as any[]) {
      const toolId = String(row?._id?.toolId || 'unknown');
      const errorCode = String(row?._id?.errorCode || 'TOOL_EXECUTION_FAILED');
      const bucket = failureByTool.get(toolId) || [];
      bucket.push({ errorCode, count: Number(row?.count || 0) });
      failureByTool.set(toolId, bucket);
    }

    return rows.map((row) => {
      const { _id, ...rest } = row;
      const toolId = String(_id);
      const failureReasons = (failureByTool.get(toolId) || []).sort((a, b) => b.count - a.count);
      const successRate = Number((rest as any).successRate || 0);
      const avgExecutionTime = Number((rest as any).avgExecutionTime || 0);
      const totalExecutions = Number((rest as any).totalExecutions || 0);
      const healthScore = Math.max(
        0,
        Math.min(
          100,
          Math.round(successRate * 70 + Math.max(0, 20 - Math.min(avgExecutionTime, 10000) / 500) + Math.min(10, Math.log10(totalExecutions + 1) * 5)),
        ),
      );
      return {
        ...rest,
        toolId,
        failureReasons,
        healthScore,
      };
    });
  }

  private async listMeetings(
    params: { status?: string; limit?: number },
    _agentId?: string,
    _executionContext?: ToolExecutionContext,
  ): Promise<any> {
    return this.meetingToolHandler.listMeetings(params);
  }

  private async sendMeetingMessage(
    params: { meetingId?: string; content?: string; type?: string },
    agentId?: string,
    executionContext?: ToolExecutionContext,
  ): Promise<any> {
    return this.meetingToolHandler.sendMeetingMessage(params, agentId, executionContext);
  }

  private async updateMeetingStatus(
    params: { meetingId?: string; action?: string },
    _agentId?: string,
    _executionContext?: ToolExecutionContext,
  ): Promise<any> {
    return this.meetingToolHandler.updateMeetingStatus(params);
  }
}
