import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import axios, { AxiosRequestConfig } from 'axios';
import { encodeUserContext, signEncodedContext } from '@libs/auth';
import { GatewayUserContext } from '@libs/contracts';
import { randomUUID } from 'crypto';
import { Model } from 'mongoose';
import { OperationLog, OperationLogDocument } from '../../../src/shared/schemas/operation-log.schema';
import { Employee, EmployeeDocument, EmployeeType } from '../../../src/shared/schemas/employee.schema';

@Injectable()
export class GatewayProxyService {
  private readonly logger = new Logger(GatewayProxyService.name);
  private readonly agentsBaseUrl = process.env.AGENTS_SERVICE_URL || 'http://localhost:3002';
  private readonly legacyBaseUrl = process.env.LEGACY_SERVICE_URL || 'http://localhost:3001';
  private readonly engineeringIntelligenceBaseUrl =
    process.env.ENGINEERING_INTELLIGENCE_SERVICE_URL || 'http://localhost:3201';
  private readonly contextSecret = process.env.INTERNAL_CONTEXT_SECRET || 'internal-context-secret';
  private readonly sensitiveKeyPattern = /password|passwd|secret|token|authorization|cookie|api[-_]?key/i;

  constructor(
    @InjectModel(OperationLog.name) private readonly operationLogModel: Model<OperationLogDocument>,
    @InjectModel(Employee.name) private readonly employeeModel: Model<EmployeeDocument>,
  ) {}

  resolveTarget(originalUrl: string): string {
    if (originalUrl.startsWith('/api/engineering-intelligence')) {
      return this.engineeringIntelligenceBaseUrl;
    }

    if (
      originalUrl.startsWith('/api/agents') ||
      originalUrl.startsWith('/api/tools') ||
      originalUrl.startsWith('/api/skills') ||
      originalUrl.startsWith('/api/memos') ||
      originalUrl.startsWith('/api/models') ||
      originalUrl.startsWith('/api/model-management')
    ) {
      return this.agentsBaseUrl;
    }
    return this.legacyBaseUrl;
  }

  private getSourceService(originalUrl: string): 'agents' | 'legacy' {
    return this.resolveTarget(originalUrl) === this.agentsBaseUrl ? 'agents' : 'legacy';
  }

  private sanitizeForLog(input: unknown, depth = 0): unknown {
    if (input === null || input === undefined) return input;
    if (depth > 4) return '[Truncated]';

    if (Array.isArray(input)) {
      return input.slice(0, 20).map((item) => this.sanitizeForLog(item, depth + 1));
    }

    if (typeof input === 'object') {
      const result: Record<string, unknown> = {};
      Object.entries(input as Record<string, unknown>).forEach(([key, value]) => {
        if (this.sensitiveKeyPattern.test(key)) {
          result[key] = '[REDACTED]';
          return;
        }
        result[key] = this.sanitizeForLog(value, depth + 1);
      });
      return result;
    }

    if (typeof input === 'string') {
      if (input.length > 500) {
        return `${input.slice(0, 500)}...[truncated]`;
      }
      return input;
    }

    return input;
  }

  private extractIp(req: any): string | undefined {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length) {
      return forwarded.split(',')[0].trim();
    }
    return req.ip || req.socket?.remoteAddress;
  }

  private async findHumanSnapshot(employeeId: string): Promise<{ humanEmployeeId: string; organizationId: string; assistantAgentId?: string } | null> {
    const human = await this.employeeModel
      .findOne({ id: employeeId, type: EmployeeType.HUMAN })
      .select({ id: 1, organizationId: 1, exclusiveAssistantAgentId: 1 })
      .lean()
      .exec();

    if (!human?.id || !human.organizationId) {
      return null;
    }

    return {
      humanEmployeeId: human.id,
      organizationId: human.organizationId,
      assistantAgentId: human.exclusiveAssistantAgentId,
    };
  }

  private async recordOperationLog(params: {
    req: any;
    userContext?: GatewayUserContext;
    statusCode: number;
    durationMs: number;
    requestId: string;
    sourceService: 'agents' | 'legacy';
    errorMessage?: string;
  }): Promise<void> {
    const { req, userContext, statusCode, durationMs, requestId, sourceService, errorMessage } = params;
    if (!userContext?.employeeId) return;

    const path = (req.originalUrl || req.url || '').split('?')[0] || '/';
    if (path === '/api/operation-logs') {
      return;
    }

    const snapshot = await this.findHumanSnapshot(userContext.employeeId);
    if (!snapshot) return;

    const payload = this.sanitizeForLog(req.body) as Record<string, unknown>;
    const query = this.sanitizeForLog(req.query) as Record<string, unknown>;

    await this.operationLogModel.create({
      organizationId: snapshot.organizationId,
      humanEmployeeId: snapshot.humanEmployeeId,
      assistantAgentId: snapshot.assistantAgentId,
      action: `${req.method} ${path}`,
      resource: path,
      httpMethod: req.method,
      statusCode,
      success: statusCode < 400,
      requestId,
      ip: this.extractIp(req),
      userAgent: req.headers['user-agent'],
      query,
      payload,
      responseSummary: errorMessage ? { error: errorMessage } : undefined,
      sourceService,
      durationMs,
      timestamp: new Date(),
    });
  }

  private parseRuntimeControlPath(path: string): { action: string; runId: string } | null {
    const match = path.match(/^\/api\/agents\/runtime\/runs\/([^/]+)\/(pause|resume|cancel|replay)$/);
    if (match) {
      return { runId: match[1], action: match[2] };
    }

    if (path === '/api/agents/runtime/outbox/dead-letter/requeue') {
      return { runId: 'outbox', action: 'dead_letter_requeue' };
    }

    return null;
  }

  buildSignedHeaders(userContext?: GatewayUserContext): Record<string, string> {
    if (!userContext) return {};
    const encoded = encodeUserContext(userContext);
    const signature = signEncodedContext(encoded, this.contextSecret);
    return {
      'x-user-context': encoded,
      'x-user-signature': signature,
    };
  }

  async forward(req: any, res: any): Promise<void> {
    const start = Date.now();
    const requestId = (req.headers['x-request-id'] as string) || randomUUID();
    const originalUrl = req.originalUrl || req.url;
    const targetBase = this.resolveTarget(originalUrl);
    const sourceService = this.getSourceService(originalUrl);
    const pathOnly = String(originalUrl || '').split('?')[0] || '/';
    const runtimeControl = this.parseRuntimeControlPath(pathOnly);
    const targetUrl = `${targetBase}${pathOnly}`;

    const headers: Record<string, string> = {};
    if (req.headers['content-type']) {
      headers['content-type'] = req.headers['content-type'];
    }
    if (req.headers.authorization) {
      headers.authorization = req.headers.authorization;
    }
    headers['x-request-id'] = requestId;

    Object.assign(headers, this.buildSignedHeaders(req.userContext));

    const config: AxiosRequestConfig = {
      url: targetUrl,
      method: req.method,
      headers,
      params: req.query,
      data: ['GET', 'HEAD'].includes(req.method) ? undefined : req.body,
      validateStatus: () => true,
      timeout: Number(process.env.GATEWAY_PROXY_TIMEOUT_MS || 30000),
      responseType: 'arraybuffer',
    };

    try {
      const response = await axios.request(config);
      const latency = Date.now() - start;
      Object.entries(response.headers || {}).forEach(([key, value]) => {
        if (value === undefined) return;
        if (key.toLowerCase() === 'transfer-encoding') return;
        res.setHeader(key, value as any);
      });
      res.setHeader('x-request-id', requestId);
      this.logger.log(
        `requestId=${requestId} ${req.method} ${req.originalUrl || req.url} -> ${targetBase} status=${response.status} latency=${latency}ms`,
      );

      if (runtimeControl) {
        const actorId = req.userContext?.employeeId || 'unknown';
        const actorRole = req.userContext?.role || 'unknown';
        const orgId = req.userContext?.organizationId || 'unknown';
        this.logger.log(
          `runtime_control_audit requestId=${requestId} action=${runtimeControl.action} runId=${runtimeControl.runId} actorId=${actorId} actorRole=${actorRole} organizationId=${orgId} status=${response.status}`,
        );
      }

      void this.recordOperationLog({
        req,
        userContext: req.userContext,
        statusCode: response.status,
        durationMs: latency,
        requestId,
        sourceService,
      }).catch((error) => {
        const message = error instanceof Error ? error.message : 'Unknown operation log error';
        this.logger.warn(`requestId=${requestId} operation log skipped: ${message}`);
      });

      res.status(response.status).send(response.data);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Gateway proxy error';
      const latency = Date.now() - start;
      this.logger.error(
        `requestId=${requestId} ${req.method} ${req.originalUrl || req.url} -> ${targetBase} failed latency=${latency}ms: ${message}`,
      );

      if (runtimeControl) {
        const actorId = req.userContext?.employeeId || 'unknown';
        const actorRole = req.userContext?.role || 'unknown';
        const orgId = req.userContext?.organizationId || 'unknown';
        this.logger.warn(
          `runtime_control_audit requestId=${requestId} action=${runtimeControl.action} runId=${runtimeControl.runId} actorId=${actorId} actorRole=${actorRole} organizationId=${orgId} status=failed error=${message}`,
        );
      }

      void this.recordOperationLog({
        req,
        userContext: req.userContext,
        statusCode: 500,
        durationMs: latency,
        requestId,
        sourceService,
        errorMessage: message,
      }).catch((logError) => {
        const logMessage = logError instanceof Error ? logError.message : 'Unknown operation log error';
        this.logger.warn(`requestId=${requestId} operation log skipped: ${logMessage}`);
      });

      throw new InternalServerErrorException('Gateway proxy failed');
    }
  }
}
