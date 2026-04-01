import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { Tool, ToolDocument } from '../../schemas/tool.schema';
import { Toolkit, ToolkitDocument } from '../../schemas/toolkit.schema';
import { ToolExecution, ToolExecutionDocument } from '../../schemas/tool-execution.schema';
import { BUILTIN_TOOLS, IMPLEMENTED_TOOL_IDS } from './builtin-tool-catalog';
import { DEPRECATED_TOOL_IDS, VIRTUAL_TOOL_IDS } from './builtin-tool-definitions';
import { buildBuiltinToolMetadata, getToolkitDisplayName, inferExecutionChannel, inferNamespaceFromToolId, inferProviderFromToolId, inferResourceAndAction, inferToolkitAuthStrategy, inferToolkitFromToolId, inferToolkitIdFromToolId, normalizeStringArray, parseToolIdentity } from './tool-identity.util';

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

export interface ToolInputContract {
  toolId: string;
  schema: Record<string, unknown>;
}

@Injectable()
export class ToolRegistryService {
  private readonly logger = new Logger(ToolRegistryService.name);

  constructor(
    @InjectModel(Tool.name) private readonly toolModel: Model<ToolDocument>,
    @InjectModel(Toolkit.name) private readonly toolkitModel: Model<ToolkitDocument>,
    @InjectModel(ToolExecution.name) private readonly executionModel: Model<ToolExecutionDocument>,
  ) {}

  async seedBuiltinTools(mode: 'sync' | 'append' = 'sync'): Promise<void> {
    await this.initializeBuiltinTools(mode);
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
      authStrategy: toolkit.authStrategy || inferToolkitAuthStrategy(toolkit.provider, toolkit.namespace),
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
            authStrategy: inferToolkitAuthStrategy(toolkitData.provider, toolkitData.namespace, toolkitData.toolkit),
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
      const identity = parseToolIdentity(toolId);
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
        name: getToolkitDisplayName(toolkit.toolkit),
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
  private toToolView(tool: Tool) {
    const base = (tool as any)?.toObject ? (tool as any).toObject() : tool;
    const toolId = tool.canonicalId || tool.id;
    const identity = parseToolIdentity(toolId);
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
      const identity = parseToolIdentity(toolId);
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
      const metadata = buildBuiltinToolMetadata(toolData);
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
          toolkit: inferToolkitFromToolId(metadata.canonicalId),
          name: getToolkitDisplayName(inferToolkitFromToolId(metadata.canonicalId)),
          description: `Toolkit for ${metadata.namespace}/${inferToolkitFromToolId(metadata.canonicalId)} (${metadata.provider})`,
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
              terminal: (toolData as any).terminal ?? false,
              authFree: (toolData as any).authFree ?? false,
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
        toolkit: inferToolkitFromToolId(metadata.canonicalId),
        name: getToolkitDisplayName(inferToolkitFromToolId(metadata.canonicalId)),
        description: `Toolkit for ${metadata.namespace}/${inferToolkitFromToolId(metadata.canonicalId)} (${metadata.provider})`,
      });
    }

    if (mode === 'sync') {
      await this.alignStoredToolMetadata();
    }
    await this.syncToolkitsFromTools(mode);

    const implementedToolIds = new Set(IMPLEMENTED_TOOL_IDS);
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
        const identity = parseToolIdentity(toolId);
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
        enabled: { $ne: false },
        $or: [{ id: { $in: normalizedToolIds } }, { canonicalId: { $in: normalizedToolIds } }],
      })
      .exec();
  }
  async createTool(toolData: Omit<Tool, 'id' | 'createdAt' | 'updatedAt'>): Promise<Tool> {
    const canonicalId = toolData.canonicalId || `internal.custom.${uuidv4().slice(0, 8)}`;
    const identity = parseToolIdentity(canonicalId);
    const provider = toolData.provider || identity.provider;
    const executionChannel = toolData.executionChannel || identity.executionChannel;
    const namespace = toolData.namespace || identity.namespace;
    const { resource, action } = inferResourceAndAction(canonicalId);
    const newTool = new this.toolModel({
      ...toolData,
      id: uuidv4(),
      canonicalId,
      provider,
      executionChannel,
      namespace,
      resource: toolData.resource || resource,
      action: toolData.action || action,
      toolkitId: toolData.toolkitId || inferToolkitIdFromToolId(canonicalId),
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

  private normalizeToolInputSchema(inputSchema?: any, implParams?: any): Record<string, unknown> {
    const schemaCandidate = this.toJsonSchemaObject(inputSchema);
    if (schemaCandidate) {
      return schemaCandidate;
    }
    return this.toJsonSchemaObject(implParams) || {};
  }

  private toJsonSchemaObject(raw: any): Record<string, unknown> | null {
    if (!raw || typeof raw !== 'object') return null;
    if (raw.type === 'object' && raw.properties && typeof raw.properties === 'object') {
      return raw as Record<string, unknown>;
    }
    if (typeof raw === 'object' && !Array.isArray(raw)) {
      return {
        type: 'object',
        properties: Object.entries(raw).reduce(
          (acc, [key, value]) => {
            if (!value || typeof value !== 'object') return acc;
            const descriptor = value as any;
            acc[key] = {
              type: descriptor.type || (Array.isArray(descriptor.enum) ? 'string' : 'string'),
              description: descriptor.description,
              enum: descriptor.enum,
            };
            return acc;
          },
          {} as Record<string, unknown>,
        ),
      };
    }
    return null;
  }

}
