import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import { access, appendFile, mkdir, writeFile } from 'fs/promises';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { GatewayUserContext } from '@libs/contracts';
import { encodeUserContext, signEncodedContext } from '@libs/auth';
import { Tool, ToolDocument } from '../../../../../src/shared/schemas/tool.schema';
import { Toolkit, ToolkitDocument } from '../../../../../src/shared/schemas/toolkit.schema';
import { ToolExecution, ToolExecutionDocument } from '../../../../../src/shared/schemas/toolExecution.schema';
import { Agent, AgentDocument } from '../../../../../src/shared/schemas/agent.schema';
import { AgentProfile, AgentProfileDocument } from '../../../../../src/shared/schemas/agent-profile.schema';
import { ApiKey, ApiKeyDocument } from '../../../../../src/shared/schemas/apiKey.schema';
import { Employee, EmployeeDocument, EmployeeType } from '../../../../../src/shared/schemas/employee.schema';
import { OperationLog, OperationLogDocument } from '../../../../../src/shared/schemas/operation-log.schema';
import { ComposioService } from './composio.service';
import { WebToolsService } from './web-tools.service';
import { ModelManagementService } from '../models/model-management.service';
import { codeDocsReader } from './local-repo-docs-reader.util';
import { codeUpdatesReader } from './local-repo-updates-reader.util';
import { MemoService } from '../memos/memo.service';
import { SkillService } from '../skills/skill.service';

const DEFAULT_PROFILE = {
  role: 'general-assistant',
  tools: [],
  capabilities: [],
  exposed: false,
};

const AGENT_LIST_TOOL_ID = 'builtin.sys-mg.internal.agent-master.list-agents';
const LEGACY_AGENT_LIST_TOOL_ID = 'builtin.sys-mg.internal.agent-admin.list-agents';
const AGENT_CREATE_TOOL_ID = 'builtin.sys-mg.internal.agent-master.create-agent';
const RD_DOCS_WRITE_TOOL_ID = 'builtin.sys-mg.internal.rd-related.docs-write';

const execFileAsync = promisify(execFile);

interface ToolExecutionContext {
  teamContext?: Record<string, any>;
  taskType?: string;
  teamId?: string;
  taskId?: string;
  idempotencyKey?: string;
  actor?: {
    employeeId?: string;
    role?: string;
  };
}

interface ToolRouterQuery {
  provider?: string;
  domain?: string;
  namespace?: string;
  resource?: string;
  action?: string;
  capability?: string;
  limit?: number;
}

interface ToolGovernancePolicy {
  timeoutMs: number;
  maxRetries: number;
  rateLimitPerMinute: number;
  circuitFailureThreshold: number;
  circuitOpenMs: number;
  idempotencyTtlMs: number;
}

interface CircuitState {
  failures: number;
  openUntil: number;
  lastFailureAt: number;
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
  private readonly orchestrationBaseUrl = process.env.LEGACY_SERVICE_URL || 'http://localhost:3001/api';
  private readonly backendBaseUrl = process.env.LEGACY_SERVICE_URL || 'http://localhost:3001/api';
  private readonly agentsBaseUrl = process.env.AGENTS_SERVICE_URL || 'http://localhost:3002/api';
  private readonly contextSecret = process.env.INTERNAL_CONTEXT_SECRET || 'internal-context-secret';
  private readonly rateLimitHits = new Map<string, number[]>();
  private readonly circuitBreakers = new Map<string, CircuitState>();

  constructor(
    @InjectModel(Tool.name) private toolModel: Model<ToolDocument>,
    @InjectModel(Toolkit.name) private toolkitModel: Model<ToolkitDocument>,
    @InjectModel(ToolExecution.name) private executionModel: Model<ToolExecutionDocument>,
    @InjectModel(Agent.name) private agentModel: Model<AgentDocument>,
    @InjectModel(AgentProfile.name) private agentProfileModel: Model<AgentProfileDocument>,
    @InjectModel(ApiKey.name) private apiKeyModel: Model<ApiKeyDocument>,
    @InjectModel(Employee.name) private employeeModel: Model<EmployeeDocument>,
    @InjectModel(OperationLog.name) private operationLogModel: Model<OperationLogDocument>,
    private composioService: ComposioService,
    private webToolsService: WebToolsService,
    private modelManagementService: ModelManagementService,
    private memoService: MemoService,
    private skillService: SkillService,
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

  private getGovernancePolicy(tool: Tool): ToolGovernancePolicy {
    const config = (tool.config || {}) as Record<string, any>;
    const governance = (config.governance || {}) as Record<string, any>;
    return {
      timeoutMs: this.parsePositiveInt(
        governance.timeoutMs ?? process.env.AGENTS_TOOL_TIMEOUT_MS,
        30000,
      ),
      maxRetries: this.parsePositiveInt(
        governance.maxRetries ?? process.env.AGENTS_TOOL_RETRY_MAX,
        1,
      ),
      rateLimitPerMinute: this.parsePositiveInt(
        governance.rateLimitPerMinute ?? process.env.AGENTS_TOOL_RATE_LIMIT_PER_MIN,
        120,
      ),
      circuitFailureThreshold: this.parsePositiveInt(
        governance.circuitFailureThreshold ?? process.env.AGENTS_TOOL_CIRCUIT_FAILURE_THRESHOLD,
        5,
      ),
      circuitOpenMs: this.parsePositiveInt(
        governance.circuitOpenMs ?? process.env.AGENTS_TOOL_CIRCUIT_OPEN_MS,
        60000,
      ),
      idempotencyTtlMs: this.parsePositiveInt(
        governance.idempotencyTtlMs ?? process.env.AGENTS_TOOL_IDEMPOTENCY_TTL_MS,
        300000,
      ),
    };
  }

  private getIdempotencyKey(parameters: any, executionContext?: ToolExecutionContext): string | undefined {
    const fromContext = String(executionContext?.idempotencyKey || '').trim();
    if (fromContext) return fromContext;
    const fromParams = String(parameters?.idempotencyKey || parameters?.__idempotencyKey || '').trim();
    if (fromParams) return fromParams;
    return undefined;
  }

  private enforceRateLimit(toolId: string, agentId: string, policy: ToolGovernancePolicy): void {
    const key = `${toolId}:${agentId}`;
    const now = Date.now();
    const windowStart = now - 60_000;
    const hits = (this.rateLimitHits.get(key) || []).filter((ts) => ts >= windowStart);
    if (hits.length >= policy.rateLimitPerMinute) {
      throw new Error(`rate limit exceeded for ${toolId}`);
    }
    hits.push(now);
    this.rateLimitHits.set(key, hits);
  }

  private ensureCircuitClosed(toolId: string): void {
    const circuit = this.circuitBreakers.get(toolId);
    if (!circuit) return;
    if (circuit.openUntil > Date.now()) {
      throw new Error(`circuit open for ${toolId}`);
    }
  }

  private recordCircuitSuccess(toolId: string): void {
    this.circuitBreakers.delete(toolId);
  }

  private recordCircuitFailure(toolId: string, policy: ToolGovernancePolicy): void {
    const current = this.circuitBreakers.get(toolId) || { failures: 0, openUntil: 0, lastFailureAt: 0 };
    const failures = current.failures + 1;
    const now = Date.now();
    const openUntil = failures >= policy.circuitFailureThreshold ? now + policy.circuitOpenMs : 0;
    this.circuitBreakers.set(toolId, {
      failures,
      openUntil,
      lastFailureAt: now,
    });
  }

  private async executeWithTimeout<T>(task: () => Promise<T>, timeoutMs: number): Promise<T> {
    return await Promise.race([
      task(),
      new Promise<T>((_, reject) => {
        setTimeout(() => reject(new Error(`execution timeout after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private normalizeErrorToCode(error: unknown): string {
    return this.normalizeToolError(error).code;
  }

  private isRetryableError(error: unknown): boolean {
    const code = this.normalizeErrorToCode(error);
    return code === 'TOOL_TIMEOUT' || code === 'TOOL_EXECUTION_FAILED' || code === 'TOOL_RATE_LIMITED';
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
    const builtinTools = [
      {
        id: 'builtin.web-retrieval.internal.web-search.exa',
        name: 'Web Search Exa',
        description: 'Search web information via Exa (auto + highlights compact)',
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
        id: 'composio.web-retrieval.mcp.web-search.serp',
        name: 'Web Search SERP',
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
        id: 'builtin.web-retrieval.internal.web-fetch.fetch',
        name: 'Web Fetch',
        description: 'Fetch webpage content by URL and return clean text',
        type: 'web_search' as const,
        category: 'Information Retrieval',
        requiredPermissions: [{ id: 'basic_web', name: 'Basic Web Access', level: 'basic' }],
        tokenCost: 8,
        implementation: {
          type: 'built_in' as const,
          parameters: { url: 'string', maxChars: 'number', timeoutMs: 'number' },
        },
      },
      {
        id: 'builtin.data-analysis.internal.content-analysis.extract',
        name: 'Content Extract',
        description: 'Extract clean text, key bullets and numeric rows from raw html or text',
        type: 'data_analysis' as const,
        category: 'Information Retrieval',
        requiredPermissions: [{ id: 'basic_web', name: 'Basic Web Access', level: 'basic' }],
        tokenCost: 6,
        implementation: {
          type: 'built_in' as const,
          parameters: { content: 'string', maxBullets: 'number', maxNumericRows: 'number' },
        },
      },
      {
        id: 'composio.communication.mcp.slack.send-message',
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
        id: 'composio.communication.mcp.gmail.send-email',
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
        id: 'builtin.sys-mg.internal.rd-related.repo-read',
        name: 'Repo Read',
        description: 'Execute read-only bash commands to read local repository files (git log, cat, ls, grep)',
        prompt:
          '你拥有 builtin.sys-mg.internal.rd-related.repo-read 工具，可执行只读 bash 命令（如 git log、cat、ls、grep 等）来读取本地仓库文件。当你需要了解代码或文档内容时，请优先使用 builtin.sys-mg.internal.rd-related.repo-read 直接读取。',
        type: 'data_analysis' as const,
        category: 'Engineering Intelligence',
        requiredPermissions: [{ id: 'repo_read', name: 'Repository Read', level: 'basic' }],
        tokenCost: 2,
        implementation: {
          type: 'built_in' as const,
          parameters: {
            command: 'string',
          },
        },
      },
      {
        id: 'builtin.sys-mg.internal.rd-related.docs-read',
        name: 'Code Docs Reader',
        description: 'Read raw documentation files from docs/ directory',
        prompt:
          '当用户询问"当前系统实现了哪些核心功能/系统能力清单/docs里实现了什么"时，优先级如下：1) 优先使用 builtin.sys-mg.internal.rd-related.repo-read 执行 "git log"、"ls docs/"、"cat docs/..."、"grep ..." 等命令自行读取；2) 其次调用 builtin.sys-mg.internal.rd-related.docs-read 读取文档。若 builtin.sys-mg.internal.rd-related.docs-read 返回 0 命中或 fallback 信号，必须自动重试（放宽 focus 或不传 focus），仍失败再切换 builtin.sys-mg.internal.rd-related.repo-read 直接列目录并读取文档；不要向用户发起二选一确认。必须基于实际读取的内容回答，不得臆测。',
        type: 'data_analysis' as const,
        category: 'Engineering Intelligence',
        requiredPermissions: [{ id: 'repo_docs_read', name: 'Repository Docs Read', level: 'basic' }],
        tokenCost: 3,
        implementation: {
          type: 'built_in' as const,
          parameters: {
            focus: 'string',
            maxFiles: 'number',
          },
        },
      },
      {
        id: RD_DOCS_WRITE_TOOL_ID,
        name: 'Code Docs Writer',
        description: 'Write markdown docs into docs/ directory with strict path and extension guard',
        prompt:
          '当你需要新增或更新研发文档时，调用 builtin.sys-mg.internal.rd-related.docs-write；仅写 docs/** 下的 .md 文件，优先使用 create/update/append 明确意图，避免覆盖不相关内容。',
        type: 'data_analysis' as const,
        category: 'Engineering Intelligence',
        requiredPermissions: [{ id: 'repo_docs_write', name: 'Repository Docs Write', level: 'admin' }],
        tokenCost: 4,
        implementation: {
          type: 'built_in' as const,
          parameters: {
            filePath: 'string',
            content: 'string',
            mode: 'string',
            overwrite: 'boolean',
          },
        },
      },
      {
        id: 'builtin.sys-mg.internal.rd-related.updates-read',
        name: 'Code Updates Reader',
        description: 'Read raw git commit history from repository',
        prompt:
          '当用户询问"最近24小时/最近一天系统主要更新"时，优先级如下：1) 优先使用 builtin.sys-mg.internal.rd-related.repo-read 执行 "git log --since=..." 等命令自行读取提交记录；2) 其次调用 builtin.sys-mg.internal.rd-related.updates-read。必须基于实际提交内容回答，不得臆测。',
        type: 'data_analysis' as const,
        category: 'Engineering Intelligence',
        requiredPermissions: [{ id: 'repo_git_read', name: 'Repository Git Read', level: 'basic' }],
        tokenCost: 3,
        implementation: {
          type: 'built_in' as const,
          parameters: {
            hours: 'number',
            limit: 'number',
          },
        },
      },
      {
        id: AGENT_LIST_TOOL_ID,
        name: 'Agents MCP List',
        description: 'List current agents, roles, and capability summaries from MCP visibility rules',
        prompt:
          '当用户询问“系统里有哪些agents/当前有哪些agent/agent列表”时，请优先调用 builtin.sys-mg.internal.agent-master.list-agents 工具获取实时名单，再基于工具结果回答。',
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
        id: AGENT_CREATE_TOOL_ID,
        name: 'Agents MCP Create Agent',
        description: 'Create a new agent via MCP with provider default api-key fallback',
        type: 'data_analysis' as const,
        category: 'System Intelligence',
        requiredPermissions: [{ id: 'agent_registry_write', name: 'Agent Registry Write', level: 'admin' }],
        tokenCost: 6,
        implementation: {
          type: 'built_in' as const,
          parameters: {
            name: 'string',
            roleId: 'string',
            description: 'string',
            systemPrompt: 'string',
            model: 'object',
            modelId: 'string',
            provider: 'string',
            apiKeyId: 'string',
            capabilities: 'string[]',
            tools: 'string[]',
            permissions: 'string[]',
            learningAbility: 'number',
            isActive: 'boolean',
          },
        },
      },
      {
        id: 'builtin.sys-mg.mcp.model-admin.list-models',
        name: 'Model MCP List Models',
        description: 'List models currently available in system registry',
        prompt:
          '当用户询问“系统里有哪些模型/当前有哪些模型/模型列表”时，请优先调用 builtin.sys-mg.mcp.model-admin.list-models 获取实时模型清单，再回答。',
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
        id: 'builtin.sys-mg.mcp.model-admin.add-model',
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
        id: 'builtin.sys-mg.internal.memory.search-memo',
        name: 'Memo MCP Search',
        description: 'Search agent memo memory with progressive loading summaries',
        prompt: '在处理任务时，优先调用 builtin.sys-mg.internal.memory.search-memo 检索相关历史备忘录。',
        type: 'data_analysis' as const,
        category: 'Memory',
        requiredPermissions: [{ id: 'memo_read', name: 'Agent Memo Read', level: 'basic' }],
        tokenCost: 2,
        implementation: {
          type: 'built_in' as const,
          parameters: {
            query: 'string',
            category: 'string',
            memoType: 'string',
            limit: 'number',
            detail: 'boolean',
          },
        },
      },
      {
        id: 'builtin.sys-mg.internal.memory.append-memo',
        name: 'Memo MCP Append',
        description: 'Append or create memo entries for long-term memory',
        prompt:
          '当形成关键结论或后续动作时，调用 builtin.sys-mg.internal.memory.append-memo 追加到目标Agent备忘录。必须显式传 targetAgentId（或 agentId）写入目标对象；topic 必须 memoType=knowledge；achievement/criticism 必须 memoType=standard 且按追加模式写入，已有内容前先插入分割线“—”再追加新记录，禁止覆盖历史。',
        type: 'data_analysis' as const,
        category: 'Memory',
        requiredPermissions: [{ id: 'memo_write', name: 'Agent Memo Write', level: 'basic' }],
        tokenCost: 3,
        implementation: {
          type: 'built_in' as const,
          parameters: {
            title: 'string',
            content: 'string',
            category: 'string',
            memoType: 'string',
            memoKind: 'string',
            targetAgentId: 'string',
            memoId: 'string',
            taskId: 'string',
            topic: 'string',
            tags: 'string[]',
          },
        },
      },
      {
        id: 'builtin.sys-mg.mcp.skill-master.list-skills',
        name: 'Skill MCP List Skills',
        description: 'List system skills with optional title fuzzy search',
        type: 'data_analysis' as const,
        category: 'Skill',
        requiredPermissions: [{ id: 'skill_read', name: 'Skill Read', level: 'basic' }],
        tokenCost: 2,
        implementation: {
          type: 'built_in' as const,
          parameters: {
            title: 'string',
            status: 'string',
            category: 'string',
            includeMetadata: 'boolean',
            limit: 'number',
            page: 'number',
          },
        },
      },
      {
        id: 'builtin.sys-mg.mcp.skill-master.create-skill',
        name: 'Skill MCP Create Skill',
        description: 'Create a new skill in system skill library',
        type: 'api_call' as const,
        category: 'Skill',
        requiredPermissions: [{ id: 'skill_write', name: 'Skill Write', level: 'intermediate' }],
        tokenCost: 4,
        implementation: {
          type: 'built_in' as const,
          parameters: {
            title: 'string',
            name: 'string',
            description: 'string',
            category: 'string',
            tags: 'string[]',
            sourceType: 'string',
            sourceUrl: 'string',
            provider: 'string',
            version: 'string',
            status: 'string',
            confidenceScore: 'number',
            metadata: 'object',
            content: 'string',
            contentType: 'string',
          },
        },
      },
      {
        id: 'builtin.sys-mg.mcp.audit.list-human-operation-log',
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
      {
        id: 'builtin.sys-mg.mcp.orchestration.create-plan',
        name: 'Orchestration Create Plan',
        description: 'Create orchestration plan from prompt in meeting workflow',
        type: 'api_call' as const,
        category: 'Orchestration',
        requiredPermissions: [{ id: 'orchestration_write', name: 'Orchestration Write', level: 'intermediate' }],
        tokenCost: 6,
        implementation: {
          type: 'built_in' as const,
          parameters: {
            prompt: 'string',
            title: 'string',
            mode: 'string',
            plannerAgentId: 'string',
            autoRun: 'boolean',
          },
        },
      },
      {
        id: 'builtin.sys-mg.mcp.orchestration.update-plan',
        name: 'Orchestration Update Plan',
        description: 'Update orchestration plan in meeting workflow',
        type: 'api_call' as const,
        category: 'Orchestration',
        requiredPermissions: [{ id: 'orchestration_write', name: 'Orchestration Write', level: 'intermediate' }],
        tokenCost: 4,
        implementation: {
          type: 'built_in' as const,
          parameters: {
            planId: 'string',
            title: 'string',
            prompt: 'string',
            mode: 'string',
            plannerAgentId: 'string',
            metadata: 'object',
          },
        },
      },
      {
        id: 'builtin.sys-mg.mcp.orchestration.run-plan',
        name: 'Orchestration Run Plan',
        description: 'Run an orchestration plan in meeting workflow',
        type: 'api_call' as const,
        category: 'Orchestration',
        requiredPermissions: [{ id: 'orchestration_write', name: 'Orchestration Write', level: 'intermediate' }],
        tokenCost: 4,
        implementation: {
          type: 'built_in' as const,
          parameters: {
            planId: 'string',
            continueOnFailure: 'boolean',
            confirm: 'boolean',
          },
        },
      },
      {
        id: 'builtin.sys-mg.mcp.orchestration.get-plan',
        name: 'Orchestration Get Plan',
        description: 'Get orchestration plan details',
        type: 'api_call' as const,
        category: 'Orchestration',
        requiredPermissions: [{ id: 'orchestration_read', name: 'Orchestration Read', level: 'basic' }],
        tokenCost: 3,
        implementation: {
          type: 'built_in' as const,
          parameters: {
            planId: 'string',
          },
        },
      },
      {
        id: 'builtin.sys-mg.mcp.orchestration.list-plans',
        name: 'Orchestration List Plans',
        description: 'List orchestration plans',
        type: 'api_call' as const,
        category: 'Orchestration',
        requiredPermissions: [{ id: 'orchestration_read', name: 'Orchestration Read', level: 'basic' }],
        tokenCost: 2,
        implementation: {
          type: 'built_in' as const,
          parameters: {},
        },
      },
      {
        id: 'builtin.sys-mg.mcp.orchestration.reassign-task',
        name: 'Orchestration Reassign Task',
        description: 'Reassign orchestration task executor',
        type: 'api_call' as const,
        category: 'Orchestration',
        requiredPermissions: [{ id: 'orchestration_write', name: 'Orchestration Write', level: 'intermediate' }],
        tokenCost: 4,
        implementation: {
          type: 'built_in' as const,
          parameters: {
            taskId: 'string',
            executorType: 'string',
            executorId: 'string',
            reason: 'string',
            confirm: 'boolean',
          },
        },
      },
      {
        id: 'builtin.sys-mg.mcp.orchestration.complete-human-task',
        name: 'Orchestration Complete Human Task',
        description: 'Mark waiting human task as completed',
        type: 'api_call' as const,
        category: 'Orchestration',
        requiredPermissions: [{ id: 'orchestration_write', name: 'Orchestration Write', level: 'intermediate' }],
        tokenCost: 4,
        implementation: {
          type: 'built_in' as const,
          parameters: {
            taskId: 'string',
            summary: 'string',
            output: 'string',
            confirm: 'boolean',
          },
        },
      },
      {
        id: 'builtin.sys-mg.mcp.orchestration.create-schedule',
        name: 'Orchestration Create Schedule',
        description: 'Create orchestration scheduler plan in meeting workflow',
        type: 'api_call' as const,
        category: 'Orchestration',
        requiredPermissions: [{ id: 'orchestration_write', name: 'Orchestration Write', level: 'intermediate' }],
        tokenCost: 6,
        implementation: {
          type: 'built_in' as const,
          parameters: {
            planId: 'string',
            scheduleType: 'string',
            expression: 'string',
            intervalMs: 'number',
            timezone: 'string',
            enabled: 'boolean',
          },
        },
      },
      {
        id: 'builtin.sys-mg.mcp.orchestration.update-schedule',
        name: 'Orchestration Update Schedule',
        description: 'Update orchestration scheduler plan in meeting workflow',
        type: 'api_call' as const,
        category: 'Orchestration',
        requiredPermissions: [{ id: 'orchestration_write', name: 'Orchestration Write', level: 'intermediate' }],
        tokenCost: 5,
        implementation: {
          type: 'built_in' as const,
          parameters: {
            scheduleId: 'string',
            scheduleType: 'string',
            expression: 'string',
            intervalMs: 'number',
            timezone: 'string',
            enabled: 'boolean',
          },
        },
      },
      {
        id: 'builtin.sys-mg.mcp.orchestration.debug-task',
        name: 'Orchestration Debug Task',
        description: 'Debug-run a single orchestration task with optional draft edits',
        type: 'api_call' as const,
        category: 'Orchestration',
        requiredPermissions: [{ id: 'orchestration_write', name: 'Orchestration Write', level: 'intermediate' }],
        tokenCost: 5,
        implementation: {
          type: 'built_in' as const,
          parameters: {
            taskId: 'string',
            title: 'string',
            description: 'string',
            resetResult: 'boolean',
          },
        },
      },
      {
        id: 'builtin.sys-mg.mcp.meeting.list-meetings',
        name: 'Meeting MCP List',
        description: 'List current meetings',
        type: 'data_analysis' as const,
        category: 'Meeting',
        requiredPermissions: [{ id: 'meeting_read', name: 'Meeting Read', level: 'basic' }],
        tokenCost: 2,
        implementation: {
          type: 'built_in' as const,
          parameters: {
            status: 'string',
            limit: 'number',
          },
        },
      },
      {
        id: 'builtin.sys-mg.mcp.meeting.send-message',
        name: 'Meeting MCP Send Message',
        description: 'Send a message to a specific meeting',
        type: 'api_call' as const,
        category: 'Meeting',
        requiredPermissions: [{ id: 'meeting_write', name: 'Meeting Write', level: 'basic' }],
        tokenCost: 3,
        implementation: {
          type: 'built_in' as const,
          parameters: {
            meetingId: 'string',
            content: 'string',
            type: 'string',
          },
        },
      },
      {
        id: 'builtin.sys-mg.mcp.meeting.update-status',
        name: 'Meeting MCP Update Status',
        description: 'Update meeting status (start/end/pause/resume)',
        type: 'api_call' as const,
        category: 'Meeting',
        requiredPermissions: [{ id: 'meeting_write', name: 'Meeting Write', level: 'intermediate' }],
        tokenCost: 4,
        implementation: {
          type: 'built_in' as const,
          parameters: {
            meetingId: 'string',
            action: 'string',
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

    const deprecatedToolIds = [
      'code-docs-mcp',
      'code-docs-reader',
      'code-updates-mcp',
      'code-updates-reader',
      'websearch',
      'webfetch',
      'content_extract',
      'slack',
      'gmail',
      'repo-read',
      'gh-repo-docs-reader-mcp',
      'gh-repo-updates-mcp',
      'local-repo-docs-reader',
      'local-repo-updates-reader',
      'agents_mcp_list',
      'model_mcp_list_models',
      'model_mcp_search_latest',
      'model_mcp_add_model',
      'memo_mcp_search',
      'memo_mcp_append',
      'human_operation_log_mcp_list',
      'orchestration_create_plan',
      'orchestration_update_plan',
      'orchestration_run_plan',
      'orchestration_get_plan',
      'orchestration_list_plans',
      'orchestration_reassign_task',
      'orchestration_complete_human_task',
      'orchestration_create_schedule',
      'orchestration_update_schedule',
      'orchestration_debug_task',
    ];

    await this.toolModel.deleteMany({ id: { $in: virtualToolIds } }).exec();
    await this.toolModel.deleteMany({ id: { $in: deprecatedToolIds } }).exec();

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
    const governance = this.getGovernancePolicy(tool);
    const idempotencyKey = this.getIdempotencyKey(parameters, executionContext);

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

    this.enforceRateLimit(resolvedCanonicalToolId, agentId, governance);
    this.ensureCircuitClosed(resolvedCanonicalToolId);

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
          rawResult = await this.executeWithTimeout(
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
          await this.sleep(Math.min(1000 * attempt, 3000));
        }
      }

      execution.result = this.normalizeToolResult(rawResult, traceId);
      execution.status = 'completed';
      execution.executionTime = Date.now() - execution.timestamp.getTime();
      await execution.save();
      this.recordCircuitSuccess(resolvedCanonicalToolId);
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
      this.recordCircuitFailure(resolvedCanonicalToolId, governance);
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
        return this.executeRepoRead(parameters);
      case AGENT_LIST_TOOL_ID:
      case LEGACY_AGENT_LIST_TOOL_ID:
        return this.getAgentsMcpList(parameters);
      case AGENT_CREATE_TOOL_ID:
        return this.createAgentByMcp(parameters);
      case 'builtin.sys-mg.internal.rd-related.docs-read':
        return this.getCodeDocsReader(parameters);
      case RD_DOCS_WRITE_TOOL_ID:
        return this.executeDocsWrite(parameters);
      case 'builtin.sys-mg.internal.rd-related.updates-read':
        return this.getCodeUpdatesReader(parameters);
      case 'builtin.sys-mg.mcp.model-admin.list-models':
        return this.listSystemModels(parameters);
      case 'builtin.sys-mg.mcp.model-admin.add-model':
        return this.addModelToSystem(parameters);
      case 'builtin.sys-mg.mcp.audit.list-human-operation-log':
        return this.listHumanOperationLogs(parameters, agentId);
      case 'builtin.sys-mg.internal.memory.search-memo':
        return this.searchMemoMemory(parameters, agentId);
      case 'builtin.sys-mg.internal.memory.append-memo':
        return this.appendMemoMemory(parameters, agentId, executionContext);
      case 'builtin.sys-mg.mcp.skill-master.list-skills':
        return this.listSkillsByTitle(parameters);
      case 'builtin.sys-mg.mcp.skill-master.create-skill':
        return this.createSkillByMcp(parameters);
      case 'builtin.sys-mg.mcp.orchestration.create-plan':
        return this.createOrchestrationPlan(parameters, agentId, executionContext);
      case 'builtin.sys-mg.mcp.orchestration.update-plan':
        return this.updateOrchestrationPlan(parameters, agentId, executionContext);
      case 'builtin.sys-mg.mcp.orchestration.run-plan':
        return this.runOrchestrationPlan(parameters, agentId, executionContext);
      case 'builtin.sys-mg.mcp.orchestration.get-plan':
        return this.getOrchestrationPlan(parameters, agentId, executionContext);
      case 'builtin.sys-mg.mcp.orchestration.list-plans':
        return this.listOrchestrationPlans(parameters, agentId, executionContext);
      case 'builtin.sys-mg.mcp.orchestration.reassign-task':
        return this.reassignOrchestrationTask(parameters, agentId, executionContext);
      case 'builtin.sys-mg.mcp.orchestration.complete-human-task':
        return this.completeOrchestrationHumanTask(parameters, agentId, executionContext);
      case 'builtin.sys-mg.mcp.orchestration.create-schedule':
        return this.createOrchestrationSchedule(parameters, agentId, executionContext);
      case 'builtin.sys-mg.mcp.orchestration.update-schedule':
        return this.updateOrchestrationSchedule(parameters, agentId, executionContext);
      case 'builtin.sys-mg.mcp.orchestration.debug-task':
        return this.debugOrchestrationTask(parameters, agentId, executionContext);
      case 'builtin.sys-mg.mcp.meeting.list-meetings':
        return this.listMeetings(parameters, agentId, executionContext);
      case 'builtin.sys-mg.mcp.meeting.send-message':
        return this.sendMeetingMessage(parameters, agentId, executionContext);
      case 'builtin.sys-mg.mcp.meeting.update-status':
        return this.updateMeetingStatus(parameters, agentId, executionContext);
      default:
        throw new Error(`Tool implementation not found: ${tool.id}`);
    }
  }

  private getImplementedToolIds(): string[] {
    return [
      'builtin.web-retrieval.internal.web-search.exa',
      'composio.web-retrieval.mcp.web-search.serp',
      'builtin.web-retrieval.internal.web-fetch.fetch',
      'builtin.data-analysis.internal.content-analysis.extract',
      'composio.communication.mcp.slack.send-message',
      'composio.communication.mcp.gmail.send-email',
      'builtin.sys-mg.internal.rd-related.repo-read',
      AGENT_LIST_TOOL_ID,
      LEGACY_AGENT_LIST_TOOL_ID,
      AGENT_CREATE_TOOL_ID,
      'builtin.sys-mg.internal.rd-related.docs-read',
      RD_DOCS_WRITE_TOOL_ID,
      'builtin.sys-mg.internal.rd-related.updates-read',
      'builtin.sys-mg.mcp.model-admin.list-models',
      'builtin.sys-mg.mcp.model-admin.add-model',
      'builtin.sys-mg.mcp.audit.list-human-operation-log',
      'builtin.sys-mg.internal.memory.search-memo',
      'builtin.sys-mg.internal.memory.append-memo',
      'builtin.sys-mg.mcp.skill-master.list-skills',
      'builtin.sys-mg.mcp.skill-master.create-skill',
      'builtin.sys-mg.mcp.orchestration.create-plan',
      'builtin.sys-mg.mcp.orchestration.update-plan',
      'builtin.sys-mg.mcp.orchestration.run-plan',
      'builtin.sys-mg.mcp.orchestration.get-plan',
      'builtin.sys-mg.mcp.orchestration.list-plans',
      'builtin.sys-mg.mcp.orchestration.reassign-task',
      'builtin.sys-mg.mcp.orchestration.complete-human-task',
      'builtin.sys-mg.mcp.orchestration.create-schedule',
      'builtin.sys-mg.mcp.orchestration.update-schedule',
      'builtin.sys-mg.mcp.orchestration.debug-task',
      'builtin.sys-mg.mcp.meeting.list-meetings',
      'builtin.sys-mg.mcp.meeting.send-message',
      'builtin.sys-mg.mcp.meeting.update-status',
    ];
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

  private buildSignedHeaders(): Record<string, string> {
    const now = Date.now();
    const context: GatewayUserContext = {
      employeeId: 'agents-service',
      role: 'system',
      issuedAt: now,
      expiresAt: now + 60 * 1000,
    };
    const encoded = encodeUserContext(context);
    const signature = signEncodedContext(encoded, this.contextSecret);
    return {
      'x-user-context': encoded,
      'x-user-signature': signature,
      'content-type': 'application/json',
    };
  }

  private resolveMeetingContext(executionContext?: ToolExecutionContext): {
    meetingId?: string;
    initiatorId?: string;
    taskType?: string;
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
    };
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

  private async callOrchestrationApi(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH',
    endpoint: string,
    body: any,
  ): Promise<any> {
    const url = `${this.orchestrationBaseUrl}/orchestration${endpoint}`;
    const headers = this.buildSignedHeaders();
    try {
      const response = await axios.request({
        method,
        url,
        headers,
        data: body,
        timeout: Number(process.env.AGENTS_EXEC_TIMEOUT_MS || 120000),
      });
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const statusText = error.response?.statusText;
        const responseSummary = this.summarizeApiErrorBody(error.response?.data);
        this.logger.error(
          `Orchestration API request failed: ${method} ${endpoint}, status=${status || 'unknown'}${
            statusText ? ` ${statusText}` : ''
          }, response=${responseSummary}`,
        );
        throw new Error(
          `orchestration_api_request_failed: ${method} ${endpoint} returned ${status || 'unknown'}; response=${responseSummary}`,
        );
      }
      throw error;
    }
  }

  private summarizeApiErrorBody(body: unknown): string {
    if (body === undefined || body === null) {
      return 'empty';
    }
    const MAX_LEN = 800;
    let text: string;
    if (typeof body === 'string') {
      text = body;
    } else {
      try {
        text = JSON.stringify(body);
      } catch {
        text = String(body);
      }
    }
    return text.length > MAX_LEN ? `${text.slice(0, MAX_LEN)}...` : text;
  }

  private async callMeetingApi(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    endpoint: string,
    body?: any,
  ): Promise<any> {
    const url = `${this.backendBaseUrl}/meetings${endpoint}`;
    const headers = this.buildSignedHeaders();
    const response = await axios.request({
      method,
      url,
      headers,
      data: body,
      timeout: Number(process.env.AGENTS_EXEC_TIMEOUT_MS || 120000),
    });
    return response.data;
  }

  private async callAgentsApi(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    endpoint: string,
    body?: any,
  ): Promise<any> {
    const url = `${this.agentsBaseUrl}${endpoint}`;
    const headers = this.buildSignedHeaders();
    try {
      const response = await axios.request({
        method,
        url,
        headers,
        data: body,
        timeout: Number(process.env.AGENTS_EXEC_TIMEOUT_MS || 120000),
      });
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const statusText = error.response?.statusText;
        const responseSummary = this.summarizeApiErrorBody(error.response?.data);
        this.logger.error(
          `Agents API request failed: ${method} ${endpoint}, status=${status || 'unknown'}${
            statusText ? ` ${statusText}` : ''
          }, response=${responseSummary}`,
        );
        throw new Error(
          `agents_api_request_failed: ${method} ${endpoint} returned ${status || 'unknown'}; response=${responseSummary}`,
        );
      }
      throw error;
    }
  }

  private async createOrchestrationPlan(
    params: {
      prompt?: string;
      title?: string;
      mode?: 'sequential' | 'parallel' | 'hybrid';
      plannerAgentId?: string;
      autoRun?: boolean;
    },
    agentId?: string,
    executionContext?: ToolExecutionContext,
  ): Promise<any> {
    const meeting = this.assertMeetingContext(executionContext);
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
    };
    const result = await this.callOrchestrationApi('POST', '/plans/from-prompt', payload);
    return {
      action: 'create_plan',
      meetingId: meeting.meetingId,
      initiatorAgentId: agentId,
      result,
    };
  }

  private async runOrchestrationPlan(
    params: { planId?: string; continueOnFailure?: boolean; confirm?: boolean },
    agentId?: string,
    executionContext?: ToolExecutionContext,
  ): Promise<any> {
    const meeting = this.assertMeetingContext(executionContext);
    if (!params?.planId?.trim()) {
      throw new Error('orchestration_run_plan requires planId');
    }
    this.requireConfirm(params, 'orchestration_run_plan');
    const result = await this.callOrchestrationApi(
      'POST',
      `/plans/${params.planId.trim()}/run`,
      { continueOnFailure: params.continueOnFailure === true },
    );
    return {
      action: 'run_plan',
      meetingId: meeting.meetingId,
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
    const meeting = this.assertMeetingContext(executionContext);
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

    const result = await this.callOrchestrationApi('PATCH', `/plans/${planId}`, payload);
    return {
      action: 'update_plan',
      meetingId: meeting.meetingId,
      initiatorAgentId: agentId,
      result,
    };
  }

  private async getOrchestrationPlan(
    params: { planId?: string },
    agentId?: string,
    executionContext?: ToolExecutionContext,
  ): Promise<any> {
    const meeting = this.assertMeetingContext(executionContext);
    if (!params?.planId?.trim()) {
      throw new Error('orchestration_get_plan requires planId');
    }
    const result = await this.callOrchestrationApi('GET', `/plans/${params.planId.trim()}`, undefined);
    return {
      action: 'get_plan',
      meetingId: meeting.meetingId,
      initiatorAgentId: agentId,
      result,
    };
  }

  private async listOrchestrationPlans(
    params: Record<string, never>,
    agentId?: string,
    executionContext?: ToolExecutionContext,
  ): Promise<any> {
    const meeting = this.assertMeetingContext(executionContext);
    const result = await this.callOrchestrationApi('GET', '/plans', undefined);
    return {
      action: 'list_plans',
      meetingId: meeting.meetingId,
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
    const meeting = this.assertMeetingContext(executionContext);
    if (!params?.taskId?.trim()) {
      throw new Error('orchestration_reassign_task requires taskId');
    }
    if (!params?.executorType) {
      throw new Error('orchestration_reassign_task requires executorType');
    }
    this.requireConfirm(params, 'orchestration_reassign_task');
    const result = await this.callOrchestrationApi(
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
      meetingId: meeting.meetingId,
      initiatorAgentId: agentId,
      result,
    };
  }

  private async completeOrchestrationHumanTask(
    params: { taskId?: string; summary?: string; output?: string; confirm?: boolean },
    agentId?: string,
    executionContext?: ToolExecutionContext,
  ): Promise<any> {
    const meeting = this.assertMeetingContext(executionContext);
    if (!params?.taskId?.trim()) {
      throw new Error('orchestration_complete_human_task requires taskId');
    }
    this.requireConfirm(params, 'orchestration_complete_human_task');
    const result = await this.callOrchestrationApi(
      'POST',
      `/tasks/${params.taskId.trim()}/complete-human`,
      {
        summary: params.summary,
        output: params.output,
      },
    );
    return {
      action: 'complete_human_task',
      meetingId: meeting.meetingId,
      initiatorAgentId: agentId,
      result,
    };
  }

  private async getOrchestrationPlanForSchedule(planId: string): Promise<any> {
    const normalizedPlanId = String(planId || '').trim();
    if (!normalizedPlanId) {
      throw new Error('planId is required');
    }
    const plan = await this.callOrchestrationApi('GET', `/plans/${normalizedPlanId}`, undefined);
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
    const meeting = this.assertMeetingContext(executionContext);
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

    const result = await this.callOrchestrationApi('POST', '/schedules', payload);
    return {
      action: 'create_schedule',
      meetingId: meeting.meetingId,
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
    const meeting = this.assertMeetingContext(executionContext);
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

    const result = await this.callOrchestrationApi('PUT', `/schedules/${scheduleId}`, payload);
    return {
      action: 'update_schedule',
      meetingId: meeting.meetingId,
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
    const meeting = this.assertMeetingContext(executionContext);
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

    const result = await this.callOrchestrationApi('POST', `/tasks/${taskId}/debug-run`, payload);
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
      meetingId: meeting.meetingId,
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

  private toModelDisplayName(model: string): string {
    return model
      .split('-')
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
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

    const result = await this.modelManagementService.addModelToSystem({
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
      ? await this.modelManagementService.getModelsByProvider(provider)
      : await this.modelManagementService.getAvailableModels();

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

  private async listSkillsByTitle(params: {
    title?: string;
    search?: string;
    status?: string;
    category?: string;
    includeMetadata?: boolean;
    limit?: number;
    page?: number;
  }): Promise<any> {
    const title = String(params?.title || '').trim();
    const search = String(params?.search || title).trim();
    const status = String(params?.status || '').trim();
    const category = String(params?.category || '').trim();
    const includeMetadata = params?.includeMetadata === true;
    const page = Math.max(1, Math.min(Number(params?.page || 1), 1000));
    const pageSize = Math.max(1, Math.min(Number(params?.limit || 20), 100));

    const result = await this.skillService.getSkillsPaged({
      status: (status || undefined) as any,
      category: category || undefined,
      search: search || undefined,
      page,
      pageSize,
    }, {
      includeMetadata,
    });

    return {
      total: result.total,
      page: result.page,
      limit: result.pageSize,
      totalPages: result.totalPages,
      keyword: search || undefined,
      status: status || undefined,
      category: category || undefined,
      items: result.items.map((skill: any) => ({
        id: skill.id,
        title: skill.name,
        name: skill.name,
        description: skill.description,
        category: skill.category,
        status: skill.status,
        tags: Array.isArray(skill.tags) ? skill.tags : [],
        provider: skill.provider,
        version: skill.version,
        confidenceScore: skill.confidenceScore,
        metadata: includeMetadata ? (skill.metadata || {}) : undefined,
        updatedAt: skill.updatedAt,
      })),
      fetchedAt: new Date().toISOString(),
    };
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
    const name = String(params?.title || params?.name || '').trim();
    if (!name) {
      throw new Error('skill_master_create_skill requires title or name');
    }
    const description = String(params?.description || '').trim();
    if (!description) {
      throw new Error('skill_master_create_skill requires description');
    }

    const tags = Array.isArray(params?.tags)
      ? params.tags.map((tag) => String(tag || '').trim()).filter(Boolean)
      : [];

    const created = await this.skillService.createSkill({
      name,
      description,
      category: params?.category,
      tags,
      sourceType: params?.sourceType as any,
      sourceUrl: params?.sourceUrl,
      provider: params?.provider,
      version: params?.version,
      status: params?.status as any,
      confidenceScore: params?.confidenceScore,
      discoveredBy: 'SkillMasterMCP',
      metadata: params?.metadata,
      content: params?.content,
      contentType: params?.contentType,
    });

    return {
      created: true,
      skill: {
        id: (created as any).id,
        title: (created as any).name,
        name: (created as any).name,
        description: (created as any).description,
        category: (created as any).category,
        status: (created as any).status,
        tags: Array.isArray((created as any).tags) ? (created as any).tags : [],
        provider: (created as any).provider,
        version: (created as any).version,
        confidenceScore: (created as any).confidenceScore,
        createdAt: (created as any).createdAt,
      },
      createdAt: new Date().toISOString(),
    };
  }

  private parseDateOrThrow(raw?: string, fieldName?: string): Date | undefined {
    if (!raw) return undefined;
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`Invalid ${fieldName || 'date'} format`);
    }
    return parsed;
  }

  private async getBoundHumanByAssistant(agentId: string): Promise<{ id: string; name?: string }> {
    if (!agentId) {
      throw new Error('human_operation_log_mcp_list requires assistant agentId');
    }

    const humanEmployees = await this.employeeModel
      .find({
        type: EmployeeType.HUMAN,
        exclusiveAssistantAgentId: agentId,
      })
      .select({ id: 1, name: 1 })
      .lean()
      .exec();

    if (humanEmployees.length === 0) {
      throw new Error('Current assistant is not bound to any human employee');
    }
    if (humanEmployees.length > 1) {
      throw new Error('Current assistant is bound to multiple humans, access denied');
    }

    const [human] = humanEmployees;
    if (!human?.id) {
      throw new Error('Bound human employee data is incomplete');
    }

    return {
      id: human.id,
      name: human.name,
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

    const headers = this.buildSignedHeaders();
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

    const agent = (await this.callAgentsApi('POST', '/agents', payload)) || {};
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
    const maxFiles = Math.max(1, Math.min(Number(params?.maxFiles || 20), 50));
    const workspaceRoot = await this.resolveWorkspaceRoot();
    const result = codeDocsReader.read({
      focus: params?.focus,
      maxFiles,
      workspaceRoot,
    });

    if (result.error) {
      return {
        focus: params?.focus || 'all',
        workspaceRoot,
        totalDocs: result.totalFiles,
        returnedFiles: 0,
        files: [],
        error: result.error,
        errorType: result.errorType || result.error.split(':')[0],
        matchMode: result.matchMode || 'none',
        focusMatchedCount: result.focusMatchedCount || 0,
        suggestions: result.suggestions || [],
        fallbackApplied: result.fallbackApplied || false,
        retryCount: result.retryCount || 0,
        attemptedKeywords: result.attemptedKeywords || [],
        troubleshooting: [
          'Check if AGENT_WORKSPACE_ROOT environment variable is set correctly',
          'Verify the docs/ directory exists in the workspace root',
          'Ensure the agent service has been restarted after setting environment variables',
        ],
        generatedAt: new Date().toISOString(),
      };
    }

    return {
      focus: params?.focus || 'all',
      workspaceRoot,
      totalDocs: result.totalFiles,
      returnedFiles: result.files.length,
      matchMode: result.matchMode || 'all',
      focusMatchedCount: result.focusMatchedCount ?? result.files.length,
      suggestions: result.suggestions || [],
      fallbackApplied: result.fallbackApplied || false,
      retryCount: result.retryCount || 0,
      attemptedKeywords: result.attemptedKeywords || [],
      files: result.files.map(f => ({
        path: f.path,
        lastModified: f.lastModified,
        content: f.content,
      })),
      generatedAt: new Date().toISOString(),
    };
  }

  private async getCodeUpdatesReader(params: {
    hours?: number;
    limit?: number;
  }): Promise<any> {
    const hours = Math.max(1, Math.min(Number(params?.hours || 24), 168));
    const limit = Math.max(1, Math.min(Number(params?.limit || 20), 50));
    const workspaceRoot = await this.resolveWorkspaceRoot();

    const result = codeUpdatesReader.read({ hours, limit, workspaceRoot });

    if (result.error) {
      return {
        hours,
        limit,
        workspaceRoot,
        totalCommits: result.totalCommits,
        commits: [],
        error: result.error,
        errorType: result.error.split(':')[0],
        troubleshooting: [
          'Verify AGENT_WORKSPACE_ROOT points to a valid git repository',
          'Ensure the directory contains a .git folder',
          'Check if git is installed and accessible',
        ],
        generatedAt: new Date().toISOString(),
      };
    }

    return {
      hours,
      limit,
      workspaceRoot,
      totalCommits: result.totalCommits,
      commits: result.commits,
      generatedAt: new Date().toISOString(),
    };
  }

  private async executeDocsWrite(params: {
    filePath?: string;
    content?: string;
    mode?: 'create' | 'update' | 'append';
    overwrite?: boolean;
  }): Promise<any> {
    const workspaceRoot = await this.resolveWorkspaceRoot();
    const rawFilePath = String(params?.filePath || '').trim();
    const content = String(params?.content || '');
    const requestedMode = String(params?.mode || 'create').trim().toLowerCase();
    const overwrite = params?.overwrite === true;

    if (!rawFilePath) {
      throw new Error('docs_write requires filePath');
    }

    if (!content.trim()) {
      throw new Error('docs_write requires content');
    }

    if (path.isAbsolute(rawFilePath)) {
      throw new Error('docs_write filePath must be relative path under docs/');
    }

    const normalizedRelPath = path.posix
      .normalize(rawFilePath.replace(/\\/g, '/'))
      .replace(/^\.\//, '');

    if (normalizedRelPath.includes('..')) {
      throw new Error('docs_write does not allow path traversal');
    }

    if (!normalizedRelPath.startsWith('docs/')) {
      throw new Error('docs_write only supports docs/** paths');
    }

    if (!normalizedRelPath.endsWith('.md')) {
      throw new Error('docs_write only supports .md files');
    }

    if (!['create', 'update', 'append'].includes(requestedMode)) {
      throw new Error('docs_write mode must be one of: create, update, append');
    }

    const docsRoot = path.resolve(workspaceRoot, 'docs');
    const targetPath = path.resolve(workspaceRoot, normalizedRelPath);
    if (!(targetPath === docsRoot || targetPath.startsWith(`${docsRoot}${path.sep}`))) {
      throw new Error('docs_write target path is outside docs directory');
    }

    const existedBefore = await this.fileExists(targetPath);
    if (requestedMode === 'create' && existedBefore && !overwrite) {
      throw new Error('docs_write create mode conflict: file exists, set overwrite=true to replace it');
    }
    if (requestedMode === 'update' && !existedBefore) {
      throw new Error('docs_write update mode requires an existing file');
    }
    if (requestedMode === 'append' && !existedBefore) {
      throw new Error('docs_write append mode requires an existing file');
    }

    const parentDir = path.dirname(targetPath);
    await mkdir(parentDir, { recursive: true });

    if (requestedMode === 'append') {
      await appendFile(targetPath, content, 'utf8');
    } else {
      await writeFile(targetPath, content, 'utf8');
    }

    return {
      success: true,
      toolId: RD_DOCS_WRITE_TOOL_ID,
      workspaceRoot,
      filePath: normalizedRelPath,
      mode: requestedMode,
      overwrite,
      existedBefore,
      bytesWritten: Buffer.byteLength(content, 'utf8'),
      writtenAt: new Date().toISOString(),
    };
  }

  private async executeRepoRead(params: { command: string }): Promise<any> {
    const allowedCommands = ['git log', 'git show', 'git diff', 'cat', 'ls', 'grep', 'head', 'tail', 'find'];
    const command = (params.command || '').trim();
    const workspaceRoot = await this.resolveWorkspaceRoot();

    if (!command) {
      return { 
        error: 'MISSING_COMMAND: No command provided',
        command: '',
        workspaceRoot,
        troubleshooting: ['Provide a valid command parameter, e.g., "git log --oneline -10" or "ls docs/"'],
      };
    }

    const isAllowed = allowedCommands.some(cmd => 
      command.toLowerCase().startsWith(cmd.toLowerCase())
    );

    if (!isAllowed) {
      return { 
        error: `COMMAND_NOT_ALLOWED: "${command}" is not permitted`,
        command,
        workspaceRoot,
        allowedCommands,
        troubleshooting: [`Only read-only commands are allowed: ${allowedCommands.join(', ')}`],
      };
    }

    try {
      const { stdout, stderr } = await execFileAsync(command, {
        cwd: workspaceRoot,
        maxBuffer: 5 * 1024 * 1024,
      });

      const output = stdout || stderr;
      
      if (!output.trim()) {
        return {
          command,
          workspaceRoot,
          output: '',
          success: true,
          message: 'Command executed successfully but returned no output',
        };
      }

      return {
        command,
        workspaceRoot,
        output,
        success: true,
      };
    } catch (error: any) {
      return {
        command,
        workspaceRoot,
        output: '',
        success: false,
        error: `COMMAND_FAILED: ${error.message}`,
        errorDetails: error.stderr || error.stdout,
        troubleshooting: [
          'Check if the command syntax is correct',
          'Verify the file or directory exists',
          'Ensure you have read permissions',
          `Working directory: ${workspaceRoot}`,
        ],
      };
    }
  }

  private async resolveWorkspaceRoot(): Promise<string> {
    const envWorkspaceRoot = process.env.AGENT_WORKSPACE_ROOT;
    if (envWorkspaceRoot) {
      if (await this.fileExists(path.join(envWorkspaceRoot, 'README.md'))) {
        return envWorkspaceRoot;
      }
    }

    const candidates = [
      process.cwd(),
      path.resolve(process.cwd(), '..'),
      path.resolve(process.cwd(), '../..'),
      path.resolve(__dirname, '../../../../../../'),
    ];

    for (const candidate of candidates) {
      if ((await this.fileExists(path.join(candidate, 'README.md'))) && (await this.fileExists(path.join(candidate, 'docs')))) {
        return candidate;
      }
    }

    return process.cwd();
  }

  private async fileExists(target: string): Promise<boolean> {
    try {
      await access(target);
      return true;
    } catch {
      return false;
    }
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
    const queryParams = new URLSearchParams();
    if (params?.status) {
      queryParams.append('status', params.status);
    }
    if (params?.limit) {
      queryParams.append('limit', String(params.limit));
    }

    const endpoint = queryParams.toString() ? `?${queryParams.toString()}` : '';
    const result = await this.callMeetingApi('GET', endpoint);

    return {
      action: 'list_meetings',
      total: result?.length || 0,
      meetings: result,
      fetchedAt: new Date().toISOString(),
    };
  }

  private async sendMeetingMessage(
    params: { meetingId?: string; content?: string; type?: string },
    agentId?: string,
    executionContext?: ToolExecutionContext,
  ): Promise<any> {
    if (!params?.meetingId?.trim()) {
      throw new Error('meeting_send_message requires meetingId');
    }
    if (!params?.content?.trim()) {
      throw new Error('meeting_send_message requires content');
    }

    const meetingContext = this.resolveMeetingContext(executionContext);
    const meetingId = params.meetingId.trim();
    const sendAsAgent = Boolean(agentId && meetingContext.meetingId && meetingContext.meetingId === meetingId);

    const payload = {
      senderId: sendAsAgent ? agentId : 'system',
      senderType: sendAsAgent ? 'agent' : 'system',
      content: params.content.trim(),
      type: params.type || 'opinion',
    };

    const result = await this.callMeetingApi('POST', `/${meetingId}/messages`, payload);

    return {
      action: 'send_message',
      meetingId,
      senderId: payload.senderId,
      message: result,
      sentAt: new Date().toISOString(),
    };
  }

  private async updateMeetingStatus(
    params: { meetingId?: string; action?: string },
    _agentId?: string,
    _executionContext?: ToolExecutionContext,
  ): Promise<any> {
    if (!params?.meetingId?.trim()) {
      throw new Error('meeting_update_status requires meetingId');
    }
    if (!params?.action?.trim()) {
      throw new Error('meeting_update_status requires action');
    }

    const action = params.action.trim().toLowerCase();
    const validActions = ['start', 'end', 'pause', 'resume'];
    if (!validActions.includes(action)) {
      throw new Error(`Invalid action: ${action}. Must be one of: ${validActions.join(', ')}`);
    }

    const result = await this.callMeetingApi('POST', `/${params.meetingId.trim()}/${action}`);

    return {
      action: 'update_status',
      meetingId: params.meetingId,
      previousStatus: result?.previousStatus,
      newStatus: result?.status || action,
      updatedAt: new Date().toISOString(),
    };
  }
}
