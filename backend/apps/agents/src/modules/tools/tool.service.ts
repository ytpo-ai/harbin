import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { Tool, ToolDocument } from '../../schemas/tool.schema';
import { Toolkit, ToolkitDocument } from '../../schemas/toolkit.schema';
import { ToolExecution, ToolExecutionDocument } from '../../schemas/tool-execution.schema';
import { Agent, AgentDocument } from '@agent/schemas/agent.schema';
import { normalizeAgentRoleTier } from '../../../../../src/shared/role-tier';
import { AgentProfile, AgentProfileDocument } from '@agent/schemas/agent-profile.schema';
import { AgentRole, AgentRoleDocument } from '../../schemas/agent-role.schema';
import { ApiKey, ApiKeyDocument } from '../../../../../src/shared/schemas/api-key.schema';
import { Skill, SkillDocument } from '../../schemas/agent-skill.schema';
import { ComposioService } from './composio.service';
import { WebToolsService } from './web-tools.service';
import { ModelManagementService } from '../models/model-management.service';
import { MemoService } from '../memos/memo.service';
import { MemoWriteQueueService } from '../memos/memo-write-queue.service';
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
  permissions: [],
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

interface ToolInputContract {
  toolId: string;
  schema: Record<string, unknown>;
}

@Injectable()
export class ToolService {
  private readonly logger = new Logger(ToolService.name);
  private readonly rolePermissionCacheTtlMs = Math.max(30_000, Number(process.env.TOOL_ROLE_PERMISSION_CACHE_TTL_MS || 300_000));
  private readonly rolePermissionCache = new Map<string, { roleCode?: string; permissions: string[]; expiresAt: number }>();

  constructor(
    @InjectModel(Tool.name) private toolModel: Model<ToolDocument>,
    @InjectModel(Toolkit.name) private toolkitModel: Model<ToolkitDocument>,
    @InjectModel(ToolExecution.name) private executionModel: Model<ToolExecutionDocument>,
    @InjectModel(Agent.name) private agentModel: Model<AgentDocument>,
    @InjectModel(AgentProfile.name) private agentProfileModel: Model<AgentProfileDocument>,
    @InjectModel(AgentRole.name) private agentRoleModel: Model<AgentRoleDocument>,
    @InjectModel(ApiKey.name) private apiKeyModel: Model<ApiKeyDocument>,
    @InjectModel(Skill.name) private skillModel: Model<SkillDocument>,
    private composioService: ComposioService,
    private webToolsService: WebToolsService,
    private modelManagementService: ModelManagementService,
    private memoService: MemoService,
    private memoWriteQueue: MemoWriteQueueService,
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

  async seedBuiltinTools(mode: 'sync' | 'append' = 'sync'): Promise<void> {
    await this.initializeBuiltinTools(mode);
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

  private async syncToolkitsFromTools(mode: 'sync' | 'append' = 'sync'): Promise<void> {
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

    if (mode === 'sync') {
      const activeToolkitIds = Array.from(toolkitMap.keys());
      await this.toolkitModel
        .updateMany(
          activeToolkitIds.length ? { id: { $nin: activeToolkitIds } } : {},
          { $set: { status: 'deprecated' } },
        )
        .exec();
    }
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
      authMode: base.authMode,
      tokenJti: base.tokenJti,
      originSessionId: base.originSessionId,
    };
  }

  private async initializeBuiltinTools(mode: 'sync' | 'append' = 'sync') {
    const builtinTools = BUILTIN_TOOLS;

    if (mode === 'sync') {
      await this.toolModel.deleteMany({ id: { $in: VIRTUAL_TOOL_IDS } }).exec();
      await this.toolModel.deleteMany({ id: { $in: DEPRECATED_TOOL_IDS } }).exec();
    }

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

      if (mode === 'append') {
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

    if (mode === 'sync') {
      await this.alignStoredToolMetadata();
    }
    await this.syncToolkitsFromTools(mode);

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

  async getToolInputContract(toolId: string): Promise<ToolInputContract | null> {
    const tool = await this.getTool(toolId);
    if (!tool) return null;
    const schema = this.normalizeToolInputSchema((tool as any).inputSchema, (tool as any).implementation?.parameters);
    if (!schema) return null;
    return {
      toolId: String(tool.canonicalId || tool.id || '').trim(),
      schema,
    };
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
      authMode: executionContext?.auth?.mode,
      tokenJti: executionContext?.auth?.jti,
      originSessionId: executionContext?.originSessionId,
      parameters,
      status: 'executing',
      tokenCost: tool.tokenCost || 0,
      retryCount: 0,
    });
    await execution.save();

    try {
      await this.authorizeToolExecution(tool, agentId, executionContext);
      this.validateToolInput(parameters, (tool.inputSchema || tool.implementation?.parameters) as Record<string, unknown> | undefined);

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

  private async authorizeToolExecution(tool: Tool, agentId: string, executionContext?: ToolExecutionContext): Promise<void> {
    if (!tool.enabled) {
      throw new Error('Tool is disabled');
    }
    if (!agentId?.trim()) {
      throw new Error('Missing agentId in tool execution');
    }

    const authMode = String(executionContext?.auth?.mode || '').trim().toLowerCase();
    const normalizedAgentId = agentId.trim();
    const agentLookup: Record<string, unknown> = { id: normalizedAgentId };
    if (Types.ObjectId.isValid(normalizedAgentId)) {
      agentLookup.$or = [{ id: normalizedAgentId }, { _id: new Types.ObjectId(normalizedAgentId) }];
      delete agentLookup.id;
    }
    const agent = await this.agentModel
      .findOne(agentLookup)
      .select({ id: 1, roleId: 1, tier: 1, tools: 1, permissions: 1, isActive: 1 })
      .lean()
      .exec();

    if (!agent) {
      throw new Error(`Agent not found or inactive: ${agentId}`);
    }

    const requireActiveAgent = authMode === 'jwt';
    if (agent.isActive !== true && requireActiveAgent) {
      throw new Error(`Agent not found or inactive: ${agentId}`);
    }

    const resolvedToolId = String(tool.canonicalId || tool.id || '').trim() || String(tool.id || '').trim();
    const agentTier = normalizeAgentRoleTier((agent as any)?.tier);
    if (agentTier === 'temporary' && this.isSystemManagementTool(resolvedToolId)) {
      throw new Error(`temporary_worker_tool_violation: ${resolvedToolId}`);
    }
    const scopeSet = new Set((executionContext?.auth?.scopes || []).map((scope) => String(scope || '').trim()).filter(Boolean));
    if (scopeSet.size > 0 && !scopeSet.has('tool:execute:*') && !scopeSet.has(`tool:execute:${resolvedToolId}`)) {
      throw new Error(`Tool scope denied: ${resolvedToolId}`);
    }

    const strictPermissions = String(process.env.TOOLS_AUTH_STRICT_PERMISSIONS || 'false').trim().toLowerCase();
    const strict = strictPermissions === 'true' || strictPermissions === '1' || strictPermissions === 'yes' || strictPermissions === 'on';
    const assignedToolIds = new Set((agent.tools || []).map((item) => String(item || '').trim()).filter(Boolean));
    const enforceAssignment = strict || authMode === 'jwt' || assignedToolIds.size > 0;
    if (enforceAssignment && !assignedToolIds.has(resolvedToolId) && !assignedToolIds.has(String(tool.id || '').trim())) {
      throw new Error(`Tool not assigned: ${resolvedToolId}`);
    }

    const requiredPermissions = Array.from(
      new Set(
        (Array.isArray(tool.requiredPermissions) ? tool.requiredPermissions : [])
          .map((item) => String(item?.id || '').trim())
          .filter(Boolean),
      ),
    );
    if (requiredPermissions.length) {
      const roleBasedPermissions = await this.resolveRoleAndProfilePermissions(agent.roleId);
      const granted = new Set(
        [
          ...(agent.permissions || []),
          ...roleBasedPermissions,
          ...(executionContext?.auth?.permissions || []),
        ]
          .map((item) => String(item || '').trim())
          .filter(Boolean),
      );
      const missing = requiredPermissions.filter((permissionId) => !granted.has(permissionId));
      if (missing.length) {
        throw new Error(`Tool permission denied: missing=${missing.join(',')}`);
      }
    }
  }

  private async resolveRoleAndProfilePermissions(roleId?: string): Promise<string[]> {
    const normalizedRoleId = String(roleId || '').trim();
    if (!normalizedRoleId) {
      return [];
    }

    const now = Date.now();
    const cached = this.rolePermissionCache.get(normalizedRoleId);
    if (cached && cached.expiresAt > now) {
      return cached.permissions;
    }

    const result = {
      roleCode: undefined as string | undefined,
      permissions: [] as string[],
    };

    try {
      const role = await this.agentRoleModel
        .findOne({ id: normalizedRoleId })
        .select({ code: 1, capabilities: 1 })
        .lean()
        .exec();
      result.roleCode = String((role as any)?.code || '').trim() || undefined;
      result.permissions = this.normalizeStringArray((role as any)?.capabilities || []);
    } catch {
      result.roleCode = undefined;
      result.permissions = [];
    }

    if (result.roleCode) {
      try {
        const profile = await this.agentProfileModel
          .findOne({ roleCode: result.roleCode })
          .select({ permissions: 1, permissionsManual: 1, permissionsDerived: 1, capabilities: 1 })
          .lean()
          .exec();
        const profilePermissions = this.normalizeStringArray([
          ...((profile as any)?.permissions || []),
          ...((profile as any)?.permissionsManual || []),
          ...((profile as any)?.permissionsDerived || []),
          ...((profile as any)?.capabilities || []),
        ]);
        result.permissions = Array.from(new Set([...result.permissions, ...profilePermissions]));
      } catch {
        // ignore profile lookup errors
      }
    }

    this.rolePermissionCache.set(normalizedRoleId, {
      roleCode: result.roleCode,
      permissions: result.permissions,
      expiresAt: now + this.rolePermissionCacheTtlMs,
    });

    return result.permissions;
  }

  private validateToolInput(parameters: any, inputSchema?: Record<string, unknown>): void {
    if (parameters === undefined || parameters === null) {
      throw new Error('Missing tool parameters');
    }

    if (!inputSchema || typeof inputSchema !== 'object') {
      return;
    }

    const required = Array.isArray((inputSchema as any).required)
      ? (inputSchema as any).required.map((item: unknown) => String(item || '').trim()).filter(Boolean)
      : [];
    if (required.length) {
      for (const key of required) {
        if (!(key in parameters) || parameters[key] === undefined || parameters[key] === null) {
          throw new Error(`Invalid tool parameters: missing required field '${key}'`);
        }
      }
    }

    const properties = (inputSchema as any).properties;
    if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
      const additionalProperties = (inputSchema as any).additionalProperties;
      if (additionalProperties === false) {
        const allowed = new Set(Object.keys(properties));
        const extras = Object.keys(parameters || {}).filter((key) => !allowed.has(key));
        if (extras.length) {
          throw new Error(`Invalid tool parameters: unknown fields ${extras.join(',')}`);
        }
      }

      for (const [key, spec] of Object.entries(properties)) {
        if (!(key in parameters)) continue;
        const expectedType = String((spec as any)?.type || '').trim();
        if (!expectedType) continue;
        const value = parameters[key];
        if (value === undefined || value === null) continue;

        if (expectedType === 'string' && typeof value !== 'string') {
          throw new Error(`Invalid tool parameters: field '${key}' must be string`);
        }
        if (expectedType === 'number' && typeof value !== 'number') {
          throw new Error(`Invalid tool parameters: field '${key}' must be number`);
        }
        if (expectedType === 'integer' && (!Number.isInteger(value) || typeof value !== 'number')) {
          throw new Error(`Invalid tool parameters: field '${key}' must be integer`);
        }
        if (expectedType === 'boolean' && typeof value !== 'boolean') {
          throw new Error(`Invalid tool parameters: field '${key}' must be boolean`);
        }
        if (expectedType === 'array' && !Array.isArray(value)) {
          throw new Error(`Invalid tool parameters: field '${key}' must be array`);
        }
        if (expectedType === 'object' && (typeof value !== 'object' || Array.isArray(value))) {
          throw new Error(`Invalid tool parameters: field '${key}' must be object`);
        }
      }
    }
  }

  private normalizeToolInputSchema(inputSchema?: unknown, implementationParameters?: unknown): Record<string, unknown> | null {
    const explicit = this.toJsonSchemaObject(inputSchema);
    if (explicit) return explicit;
    const fallback = this.toJsonSchemaObject(implementationParameters);
    if (fallback) return fallback;
    return null;
  }

  private toJsonSchemaObject(raw: unknown): Record<string, unknown> | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return null;
    }

    const candidate = raw as Record<string, unknown>;
    const hasJsonSchemaShape =
      candidate.properties !== undefined ||
      candidate.required !== undefined ||
      candidate.additionalProperties !== undefined;

    if (hasJsonSchemaShape) {
      const properties =
        candidate.properties && typeof candidate.properties === 'object' && !Array.isArray(candidate.properties)
          ? (candidate.properties as Record<string, unknown>)
          : {};
      const required = Array.isArray(candidate.required)
        ? candidate.required.map((item) => String(item || '').trim()).filter(Boolean)
        : [];
      const additionalProperties =
        typeof candidate.additionalProperties === 'boolean' ? candidate.additionalProperties : true;
      return {
        type: 'object',
        properties,
        required,
        additionalProperties,
      };
    }

    const properties = Object.entries(candidate).reduce<Record<string, unknown>>((acc, [key, value]) => {
      const normalizedKey = String(key || '').trim();
      if (!normalizedKey) return acc;
      if (typeof value === 'string') {
        acc[normalizedKey] = { type: value.trim().toLowerCase() || 'string' };
        return acc;
      }
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const item = value as Record<string, unknown>;
        const type = String(item.type || '').trim().toLowerCase();
        acc[normalizedKey] = type ? { ...item, type } : { ...item };
      }
      return acc;
    }, {});

    if (!Object.keys(properties).length) {
      return null;
    }

    return {
      type: 'object',
      properties,
      required: [],
      additionalProperties: true,
    };
  }

  private normalizeToolResult(rawResult: any, traceId: string) {
    return {
      success: true,
      traceId,
      data: this.sanitizeToolOutput(rawResult),
    };
  }

  private sanitizeToolOutput(rawResult: unknown, depth = 0): unknown {
    const maxDepth = 8;
    const maxString = 12000;
    const maxArray = 200;
    const redactedPattern = /(token|secret|password|authorization|api[-_]?key)/i;

    if (depth > maxDepth) {
      return '[TRUNCATED_DEPTH]';
    }
    if (rawResult === null || rawResult === undefined) {
      return rawResult;
    }
    if (typeof rawResult === 'string') {
      return rawResult.length > maxString ? `${rawResult.slice(0, maxString)}...` : rawResult;
    }
    if (typeof rawResult === 'number' || typeof rawResult === 'boolean') {
      return rawResult;
    }
    if (Array.isArray(rawResult)) {
      return rawResult.slice(0, maxArray).map((item) => this.sanitizeToolOutput(item, depth + 1));
    }
    if (typeof rawResult === 'object') {
      const source = rawResult as Record<string, unknown>;
      const entries = Object.entries(source).slice(0, 300);
      const sanitized: Record<string, unknown> = {};
      for (const [key, value] of entries) {
        if (redactedPattern.test(key)) {
          sanitized[key] = '[REDACTED]';
          continue;
        }
        sanitized[key] = this.sanitizeToolOutput(value, depth + 1);
      }
      return sanitized;
    }
    return String(rawResult);
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
    if (message.includes('scope denied')) return 'TOOL_SCOPE_DENIED';
    if (message.includes('not assigned')) return 'TOOL_NOT_ASSIGNED';
    if (message.includes('permission denied')) return 'TOOL_PERMISSION_DENIED';
    if (message.includes('temporary_worker_tool_violation')) return 'TEMPORARY_WORKER_TOOL_VIOLATION';
    if (message.includes('invalid tool parameters')) return 'TOOL_INPUT_INVALID';
    if (message.includes('rate limit')) return 'TOOL_RATE_LIMITED';
    if (message.includes('circuit open')) return 'TOOL_CIRCUIT_OPEN';
    if (message.includes('requires confirm=true')) return 'TOOL_CONFIRM_REQUIRED';
    if (message.includes('missing organization context')) return 'TOOL_CONTEXT_MISSING';
    return 'TOOL_EXECUTION_FAILED';
  }

  private isSystemManagementTool(toolId: string): boolean {
    const normalized = String(toolId || '').trim().toLowerCase();
    if (!normalized) {
      return false;
    }
    return (
      normalized.startsWith('builtin.sys-mg.mcp.orchestration.') ||
      normalized.startsWith('builtin.sys-mg.mcp.model-admin.') ||
      normalized.startsWith('builtin.sys-mg.mcp.skill-master.') ||
      normalized.startsWith('builtin.sys-mg.mcp.audit.') ||
      normalized.startsWith('builtin.sys-mg.internal.agent-master.')
    );
  }

  private async executeToolImplementation(
    tool: Tool,
    parameters: any,
    agentId?: string,
    executionContext?: ToolExecutionContext,
  ): Promise<any> {
    const repoDispatch = this.dispatchRepoToolImplementation(tool.id, parameters);
    if (repoDispatch) {
      return repoDispatch;
    }

    const orchestrationDispatch = this.dispatchOrchestrationToolImplementation(tool.id, parameters, agentId, executionContext);
    if (orchestrationDispatch) {
      return orchestrationDispatch;
    }

    const requirementDispatch = this.dispatchRequirementToolImplementation(tool.id, parameters, agentId, executionContext);
    if (requirementDispatch) {
      return requirementDispatch;
    }

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
      case 'builtin.sys-mg.mcp.inner-message.send-internal-message':
        return this.sendInternalMessage(parameters, agentId);
      case AGENT_LIST_TOOL_ID:
      case LEGACY_AGENT_LIST_TOOL_ID:
        return this.getAgentsMcpList(parameters);
      case AGENT_CREATE_TOOL_ID:
        return this.createAgentByMcp(parameters);
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
      case 'builtin.sys-mg.mcp.meeting.list-meetings':
        return this.meetingToolHandler.listMeetings(parameters);
      case 'builtin.sys-mg.mcp.meeting.get-detail':
        return this.meetingToolHandler.getMeetingDetail(parameters);
      case 'builtin.sys-mg.mcp.meeting.send-message':
        return this.meetingToolHandler.sendMeetingMessage(parameters, agentId, executionContext);
      case 'builtin.sys-mg.mcp.meeting.update-status':
        return this.meetingToolHandler.updateMeetingStatus(parameters);
      case 'builtin.sys-mg.mcp.meeting.generate-summary':
      case 'builtin.sys-mg.mcp.meeting.save-summary':
        return this.meetingToolHandler.saveMeetingSummary(parameters, agentId);
      default:
        throw new Error(`Tool implementation not found: ${tool.id}`);
    }
  }

  private dispatchRepoToolImplementation(toolId: string, parameters: any): Promise<any> | undefined {
    switch (toolId) {
      case 'builtin.sys-mg.internal.rd-related.repo-read':
        return this.repoToolHandler.executeRepoRead(parameters);
      case 'builtin.sys-mg.internal.rd-related.docs-read':
        return this.repoToolHandler.getCodeDocsReader(parameters);
      case RD_DOCS_WRITE_TOOL_ID:
        return this.repoToolHandler.executeDocsWrite(parameters);
      case 'builtin.sys-mg.internal.rd-related.updates-read':
        return this.repoToolHandler.getCodeUpdatesReader(parameters);
      default:
        return undefined;
    }
  }

  private dispatchOrchestrationToolImplementation(
    toolId: string,
    parameters: any,
    agentId?: string,
    executionContext?: ToolExecutionContext,
  ): Promise<any> | undefined {
    switch (toolId) {
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
      default:
        return undefined;
    }
  }

  private dispatchRequirementToolImplementation(
    toolId: string,
    parameters: any,
    agentId?: string,
    executionContext?: ToolExecutionContext,
  ): Promise<any> | undefined {
    switch (toolId) {
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
      default:
        return undefined;
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
      const queued = await this.memoWriteQueue.queueUpdateMemo(existing.id, {
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
        action: 'queued_update',
        memoId: existing.id,
        requestId: queued.requestId,
      };
    }

    const queued = await this.memoWriteQueue.queueCreateMemo({
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
      action: 'queued_create',
      requestId: queued.requestId,
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
        (typeof teamContext.meetingType === 'string' ? 'meeting' : undefined),
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
    const meetingLike = context.taskType === 'meeting' || Boolean(context.meetingId);
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

  private async sendInternalMessage(
    params: {
      receiverAgentId?: string;
      title?: string;
      content?: string;
      eventType?: string;
      payload?: Record<string, unknown>;
      dedupKey?: string;
      maxAttempts?: number;
    },
    agentId?: string,
  ): Promise<any> {
    const senderAgentId = String(agentId || '').trim();
    if (!senderAgentId) {
      throw new Error('send_internal_message requires execution agentId');
    }

    const receiverAgentId = String(params?.receiverAgentId || '').trim();
    const title = String(params?.title || '').trim();
    const content = String(params?.content || '').trim();
    const eventType = String(params?.eventType || '').trim() || 'inner.direct';
    if (!receiverAgentId) {
      throw new Error('send_internal_message requires receiverAgentId');
    }
    if (!title || !content) {
      throw new Error('send_internal_message requires title and content');
    }

    const payload =
      params?.payload && typeof params.payload === 'object' && !Array.isArray(params.payload)
        ? params.payload
        : {};
    const maxAttempts = Number(params?.maxAttempts || 0);
    const response = await this.internalApiClient.callInnerMessageApi('POST', '/direct', {
      senderAgentId,
      receiverAgentId,
      eventType,
      title,
      content,
      payload,
      source: 'agent-mcp.send_internal_message',
      ...(params?.dedupKey ? { dedupKey: String(params.dedupKey).trim() } : {}),
      ...(Number.isFinite(maxAttempts) && maxAttempts > 0 ? { maxAttempts: Math.floor(maxAttempts) } : {}),
    });

    const message = response?.data || response;
    const messageId = String(message?.messageId || '').trim();
    return {
      action: 'send_internal_message',
      sent: Boolean(messageId),
      messageId,
      status: String(message?.status || 'sent').trim() || 'sent',
      senderAgentId,
      receiverAgentId,
      eventType,
      sentAt: message?.sentAt || new Date().toISOString(),
      raw: message,
    };
  }

  private normalizeProvider(provider?: string): string {
    const value = String(provider || '').trim().toLowerCase();
    if (value === 'kimi') return 'moonshot';
    if (value === 'claude') return 'anthropic';
    return value;
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
        typeof execution?.result === 'string'
          ? execution.result.slice(0, 800)
          : execution?.result
            ? JSON.stringify(execution.result).slice(0, 800)
            : null,
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

    const roleById = await this.agentRoleModel.findOne({ id: normalized }).select({ id: 1 }).lean().exec();
    if ((roleById as any)?.id) {
      return { roleId: String((roleById as any).id).trim(), matchedBy: 'id' };
    }

    const roles = await this.agentRoleModel
      .find({ status: 'active' })
      .select({ id: 1, code: 1, name: 1 })
      .sort({ updatedAt: -1 })
      .lean()
      .exec() as Array<{ id: string; code: string; name?: string }>;

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

    const toolIds = Array.from(
      new Set(
        agents
          .flatMap((agent: any) => {
            const plain = agent?.toObject ? agent.toObject() : agent;
            const role = roleMap.get(String(plain.roleId || '').trim());
            const profile = role?.code ? profileMap.get(role.code) || DEFAULT_PROFILE : DEFAULT_PROFILE;
            return [...(plain.tools || []), ...((profile as any)?.tools || [])];
          })
          .map((item) => String(item || '').trim())
          .filter(Boolean),
      ),
    );
    const tools = toolIds.length
      ? await this.toolModel
          .find({
            $or: [{ id: { $in: toolIds } }, { canonicalId: { $in: toolIds } }],
          })
          .select({ id: 1, canonicalId: 1, name: 1, description: 1, requiredPermissions: 1 })
          .lean()
          .exec()
      : [];
    const toolMap = new Map<string, any>();
    for (const tool of tools as any[]) {
      const canonicalId = String(tool.canonicalId || tool.id || '').trim();
      const id = String(tool.id || '').trim();
      if (canonicalId) {
        toolMap.set(canonicalId, tool);
      }
      if (id) {
        toolMap.set(id, tool);
      }
      for (const alias of Array.isArray(tool.aliases) ? tool.aliases : []) {
        const normalizedAlias = String(alias || '').trim();
        if (normalizedAlias) {
          toolMap.set(normalizedAlias, tool);
        }
      }
    }

    const mapped = agents.map((agent) => {
      const plain = agent?.toObject ? agent.toObject() : agent;
      const roleId = String(plain.roleId || '').trim();
      const role = roleMap.get(roleId);
      const profile = role?.code ? profileMap.get(role.code) || DEFAULT_PROFILE : DEFAULT_PROFILE;
      const grantedPermissions = new Set(
        [
          ...(plain.permissions || []),
          ...(role?.permissions || []),
          ...((profile as any)?.permissions || []),
          ...((profile as any)?.permissionsManual || []),
          ...((profile as any)?.permissionsDerived || []),
          ...((profile as any)?.capabilities || []),
        ]
          .map((item) => String(item || '').trim())
          .filter(Boolean),
      );
      const effectiveToolIds = Array.from(
        new Set(
          [...(plain.tools || []), ...((profile as any)?.tools || [])]
            .map((item) => String(item || '').trim())
            .filter(Boolean),
        ),
      );
      const enrichedTools = effectiveToolIds.map((toolId) => {
        const tool = toolMap.get(toolId);
        const resolvedToolId = String(tool?.canonicalId || tool?.id || toolId).trim();
        const permissionSlugs: string[] = Array.from(
          new Set(
            (Array.isArray(tool?.requiredPermissions) ? tool.requiredPermissions : [])
              .map((item: any) => String(item?.id || '').trim())
              .filter(Boolean),
          ),
        );

        return {
          id: resolvedToolId,
          name: String(tool?.name || resolvedToolId).trim(),
          description: String(tool?.description || '').trim(),
          permissionSlugs,
          hasPermission: permissionSlugs.every((slug) => grantedPermissions.has(slug)),
        };
      });

      return {
        id: plain.id || plain._id?.toString?.() || plain._id,
        name: plain.name,
        role: role?.name || profile.role,
        capabilitySet: Array.from(new Set([...(plain.capabilities || []), ...((profile as any).permissions || profile.capabilities || [])])).slice(0, 12),
        tools: enrichedTools,
        _skillIds: Array.from(new Set((plain.skills || []).map((item: any) => String(item || '').trim()).filter(Boolean))),
        exposed: profile.exposed === true,
        isActive: plain.isActive === true,
      };
    });

    const visibleAgents = mapped.filter((item) => includeHidden || item.exposed).slice(0, limit);
    const skillIds = Array.from(new Set(visibleAgents.flatMap((item) => item._skillIds || [])));
    const skills = skillIds.length
      ? await this.skillModel.find({ id: { $in: skillIds } }).select({ id: 1, name: 1, description: 1 }).lean().exec()
      : [];
    const skillMap = new Map<string, { id: string; name: string; description: string }>();
    for (const skill of skills as any[]) {
      const skillId = String(skill?.id || '').trim();
      if (!skillId) {
        continue;
      }
      skillMap.set(skillId, {
        id: skillId,
        name: String(skill?.name || '').trim(),
        description: String(skill?.description || '').trim(),
      });
    }
    const identifyMap = await this.memoService.getFirstMemoContentMapByKind(
      visibleAgents.map((item) => String(item.id || '').trim()),
      'identity',
    );
    const agentsWithIdentify = visibleAgents.map((item) => {
      const skillsWithMetadata = (item._skillIds || []).map((skillId: string) => {
        const matched = skillMap.get(skillId);
        if (matched) {
          return matched;
        }
        return {
          id: skillId,
          name: skillId,
          description: '',
        };
      });

      return {
        id: item.id,
        name: item.name,
        role: item.role,
        capabilitySet: item.capabilitySet,
        tools: item.tools,
        skills: skillsWithMetadata,
        exposed: item.exposed,
        isActive: item.isActive,
        identify: identifyMap.get(String(item.id || '').trim()) || '',
      };
    });

    return {
      total: mapped.length,
      visible: agentsWithIdentify.length,
      includeHidden,
      agents: agentsWithIdentify,
      fetchedAt: new Date().toISOString(),
    };
  }

  private async getRoleMapByIds(roleIds: string[]): Promise<Map<string, { name: string; code: string; permissions: string[] }>> {
    const uniqueRoleIds = Array.from(new Set((roleIds || []).map((item) => String(item || '').trim()).filter(Boolean)));
    const map = new Map<string, { name: string; code: string; permissions: string[] }>();
    if (!uniqueRoleIds.length) {
      return map;
    }

    const rows = await this.agentRoleModel
      .find({ id: { $in: uniqueRoleIds } })
      .select({ id: 1, code: 1, name: 1, capabilities: 1 })
      .lean()
      .exec() as Array<{ id: string; code: string; name?: string; capabilities?: string[] }>;

    for (const role of rows) {
      const roleId = String(role.id || '').trim();
      const code = String(role.code || '').trim();
      const name = String(role.name || role.code || '').trim();
      const permissions = this.normalizeStringArray(role.capabilities || []);
      if (roleId && code) {
        map.set(roleId, { name, code, permissions });
      }
    }

    for (const roleId of uniqueRoleIds) {
      if (!map.has(roleId)) {
        this.logger.warn(`Failed to resolve role ${roleId} in tools mcp list: role not found`);
      }
    }

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
