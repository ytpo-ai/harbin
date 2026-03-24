import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { Tool, ToolDocument } from '../../schemas/tool.schema';
import { ToolExecution, ToolExecutionDocument } from '../../schemas/tool-execution.schema';
import { Agent, AgentDocument } from '@agent/schemas/agent.schema';
import { AgentProfile, AgentProfileDocument } from '@agent/schemas/agent-profile.schema';
import { AgentRole, AgentRoleDocument } from '../../schemas/agent-role.schema';
import { getTierByAgentRoleCode, normalizeAgentRoleTier } from '../../../../../src/shared/role-tier';
import { ToolExecutionContext } from './tool-execution-context.type';
import { ToolGovernanceService } from './tool-governance.service';
import { ToolRegistryService } from './tool-registry.service';
import { ToolExecutionDispatcherService } from './tool-execution-dispatcher.service';
import { inferExecutionChannel, isSystemManagementTool, normalizeStringArray } from './tool-identity.util';

interface NormalizedToolError {
  code: string;
  message: string;
  retryable: boolean;
}

@Injectable()
export class ToolExecutionService {
  private readonly logger = new Logger(ToolExecutionService.name);
  private readonly rolePermissionCacheTtlMs = Math.max(30_000, Number(process.env.TOOL_ROLE_PERMISSION_CACHE_TTL_MS || 300_000));
  private readonly rolePermissionCache = new Map<string, { roleCode?: string; permissions: string[]; expiresAt: number }>();

  constructor(
    @InjectModel(Tool.name) private readonly toolModel: Model<ToolDocument>,
    @InjectModel(ToolExecution.name) private readonly executionModel: Model<ToolExecutionDocument>,
    @InjectModel(Agent.name) private readonly agentModel: Model<AgentDocument>,
    @InjectModel(AgentProfile.name) private readonly agentProfileModel: Model<AgentProfileDocument>,
    @InjectModel(AgentRole.name) private readonly agentRoleModel: Model<AgentRoleDocument>,
    private readonly toolGovernanceService: ToolGovernanceService,
    private readonly dispatcher: ToolExecutionDispatcherService,
    private readonly registry: ToolRegistryService,
  ) {}

  private normalizeErrorToCode(error: unknown): string {
    return this.normalizeToolError(error).code;
  }
  private isRetryableError(error: unknown): boolean {
    const code = this.normalizeErrorToCode(error);
    return this.toolGovernanceService.isRetryableCode(code);
  }
  async executeTool(
    toolId: string,
    agentId: string,
    parameters: any,
    taskId?: string,
    executionContext?: ToolExecutionContext,
  ): Promise<ToolExecution> {
    const tool = await this.registry.getTool(toolId);
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

    const executionChannel = inferExecutionChannel(resolvedCanonicalToolId);

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
              this.dispatcher.executeToolImplementation(tool, parameters, agentId, {
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
    if (agentTier === 'temporary' && isSystemManagementTool(resolvedToolId)) {
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
      result.permissions = normalizeStringArray((role as any)?.capabilities || []);
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
        const profilePermissions = normalizeStringArray([
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
  }}
