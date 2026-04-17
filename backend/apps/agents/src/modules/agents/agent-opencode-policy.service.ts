import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  buildMessageCenterEvent,
  MESSAGE_BUS,
  MESSAGE_CENTER_EVENT_SOURCE_AGENTS,
  type MessageBus,
} from '@libs/infra';
import { AgentRun, AgentRunDocument } from '../../schemas/agent-run.schema';
import { AgentMessage, AgentMessageDocument } from '../../schemas/agent-message.schema';
import { Agent } from '@agent/schemas/agent.schema';
import { RuntimeOrchestratorService, RuntimeRunContext } from '../runtime/runtime-orchestrator.service';
import { Task } from '../../../../../src/shared/types';

export interface OpenCodeModelBinding {
  provider: string;
  model: string;
}

export interface OpenCodeExecutionConfig {
  provider: 'opencode';
  endpoint?: string;
  endpointRef?: string;
  authEnable: boolean;
  requestTimeoutMs?: number;
  taskRouting?: {
    opencodeTaskTypes: string[];
    nativeTaskTypes: string[];
    defaultChannel: 'native' | 'opencode';
  };
  modelPolicy: {
    bound?: OpenCodeModelBinding;
    fallback: OpenCodeModelBinding[];
  };
}

interface AgentBudgetConfig {
  period: 'day' | 'week' | 'month';
  limit: number;
  unit: 'runCount' | 'dailyCost';
}

interface AgentTaskExecutionContext {
  actor?: {
    employeeId?: string;
  };
  approval?: {
    approved?: boolean;
    approvalId?: string;
    approverId?: string;
    reason?: string;
  };
}

const OPENCODE_ALLOWED_ROLE_CODES = new Set(['devops-engineer', 'fullstack-engineer', 'technical-architect']);
const OPENCODE_BUDGET_PERIOD_SET = new Set(['day', 'week', 'month']);
const OPENCODE_BUDGET_UNIT_SET = new Set(['runCount', 'dailyCost']);
const OPENCODE_MODEL_BINDING_CHECK_ENABLED = 'OPENCODE_MODEL_BINDING_CHECK_ENABLED';

@Injectable()
export class AgentOpenCodePolicyService {
  private readonly logger = new Logger(AgentOpenCodePolicyService.name);

  constructor(
    @InjectModel(AgentRun.name) private readonly agentRunModel: Model<AgentRunDocument>,
    @InjectModel(AgentMessage.name) private readonly agentMessageModel: Model<AgentMessageDocument>,
    private readonly runtimeOrchestrator: RuntimeOrchestratorService,
    @Inject(MESSAGE_BUS) private readonly messageBus: MessageBus,
  ) {}

  assertOpenCodeExecutionGate(agent: Agent, roleCode: string, executionConfig: OpenCodeExecutionConfig): void {
    const normalizedRoleCode = String(roleCode || '').trim();
    if (!OPENCODE_ALLOWED_ROLE_CODES.has(normalizedRoleCode)) {
      throw new BadRequestException(
        `OpenCode execution role not allowed: ${normalizedRoleCode || 'unknown'}. Allowed roles: devops-engineer, fullstack-engineer, technical-architect`,
      );
    }

    const boundModel = executionConfig.modelPolicy.bound;
    if (!boundModel) {
      return;
    }

    if (!this.isModelBindingCheckEnabled()) {
      return;
    }

    const currentProvider = String(agent.model?.provider || '').trim();
    const currentModel = String(agent.model?.model || '').trim();
    if (!this.matchesModelBinding(boundModel, currentProvider, currentModel)) {
      throw new BadRequestException(
        `OpenCode model binding mismatch: expected ${boundModel.provider}/${boundModel.model}, got ${currentProvider}/${currentModel}`,
      );
    }
  }

  parseOpenCodeExecutionConfig(config: unknown): OpenCodeExecutionConfig | null {
    if (!this.isPlainObject(config)) {
      return null;
    }

    const execution = (config as Record<string, unknown>).execution;
    if (!this.isPlainObject(execution)) {
      return null;
    }

    const provider = String((execution as Record<string, unknown>).provider || '')
      .trim()
      .toLowerCase();
    if (provider !== 'opencode') {
      return null;
    }

    const endpointRaw = (execution as Record<string, unknown>).endpoint;
    if (endpointRaw !== undefined && endpointRaw !== null && typeof endpointRaw !== 'string') {
      throw new BadRequestException('agent.config.execution.endpoint must be a string');
    }
    const endpoint = typeof endpointRaw === 'string' && endpointRaw.trim().length > 0 ? endpointRaw.trim() : undefined;

    const endpointRefRaw = (execution as Record<string, unknown>).endpointRef;
    if (endpointRefRaw !== undefined && endpointRefRaw !== null && typeof endpointRefRaw !== 'string') {
      throw new BadRequestException('agent.config.execution.endpointRef must be a string');
    }
    const endpointRef =
      typeof endpointRefRaw === 'string' && endpointRefRaw.trim().length > 0 ? endpointRefRaw.trim() : undefined;

    const authEnableRaw = (execution as Record<string, unknown>).auth_enable;
    if (authEnableRaw !== undefined && typeof authEnableRaw !== 'boolean') {
      throw new BadRequestException('agent.config.execution.auth_enable must be a boolean');
    }
    const authEnable = authEnableRaw === true;

    const requestTimeoutMsRaw = (execution as Record<string, unknown>).request_timeout_ms;
    if (requestTimeoutMsRaw !== undefined && requestTimeoutMsRaw !== null) {
      const parsedTimeout = Number(requestTimeoutMsRaw);
      if (!Number.isFinite(parsedTimeout) || parsedTimeout < 1000) {
        throw new BadRequestException('agent.config.execution.request_timeout_ms must be a number >= 1000');
      }
    }
    const requestTimeoutMs =
      requestTimeoutMsRaw !== undefined && requestTimeoutMsRaw !== null
        ? Math.floor(Number(requestTimeoutMsRaw))
        : undefined;

    const taskRouting = this.parseTaskRoutingConfig(execution as Record<string, unknown>);

    const modelPolicyRaw = (execution as Record<string, unknown>).modelPolicy;
    if (modelPolicyRaw !== undefined && !this.isPlainObject(modelPolicyRaw)) {
      throw new BadRequestException('agent.config.execution.modelPolicy must be a JSON object');
    }

    const modelPolicy = this.isPlainObject(modelPolicyRaw) ? (modelPolicyRaw as Record<string, unknown>) : {};
    const bound = this.parseModelBinding(modelPolicy.bound, 'agent.config.execution.modelPolicy.bound');

    const fallbackRaw = modelPolicy.fallback;
    const fallback: OpenCodeModelBinding[] = [];
    if (fallbackRaw !== undefined) {
      if (!Array.isArray(fallbackRaw)) {
        throw new BadRequestException('agent.config.execution.modelPolicy.fallback must be an array');
      }
      for (let i = 0; i < fallbackRaw.length; i += 1) {
        const binding = this.parseModelBinding(fallbackRaw[i], `agent.config.execution.modelPolicy.fallback[${i}]`);
        if (binding) {
          fallback.push(binding);
        }
      }
    }

    return {
      provider: 'opencode',
      endpoint,
      endpointRef,
      authEnable,
      requestTimeoutMs,
      taskRouting,
      modelPolicy: {
        bound,
        fallback,
      },
    };
  }

  private parseTaskRoutingConfig(execution: Record<string, unknown>): OpenCodeExecutionConfig['taskRouting'] {
    const raw = execution.taskRouting ?? execution.task_type_routing;
    if (raw === undefined || raw === null) {
      return undefined;
    }
    if (!this.isPlainObject(raw)) {
      throw new BadRequestException('agent.config.execution.taskRouting must be a JSON object');
    }

    const parseTaskTypes = (value: unknown, fieldPath: string): string[] => {
      if (value === undefined || value === null) {
        return [];
      }
      if (!Array.isArray(value)) {
        throw new BadRequestException(`${fieldPath} must be an array of strings`);
      }
      const normalized = value
        .map((item, index) => {
          if (typeof item !== 'string') {
            throw new BadRequestException(`${fieldPath}[${index}] must be a string`);
          }
          return item.trim().toLowerCase();
        })
        .filter(Boolean);
      return Array.from(new Set(normalized));
    };

    const opencodeTaskTypes = parseTaskTypes(
      (raw as Record<string, unknown>).opencodeTaskTypes ?? (raw as Record<string, unknown>).opencode_task_types,
      'agent.config.execution.taskRouting.opencodeTaskTypes',
    );
    const nativeTaskTypes = parseTaskTypes(
      (raw as Record<string, unknown>).nativeTaskTypes ?? (raw as Record<string, unknown>).native_task_types,
      'agent.config.execution.taskRouting.nativeTaskTypes',
    );

    const defaultChannelRaw =
      (raw as Record<string, unknown>).defaultChannel ?? (raw as Record<string, unknown>).default_channel;
    let defaultChannel: 'native' | 'opencode' = 'native';
    if (defaultChannelRaw !== undefined && defaultChannelRaw !== null) {
      if (typeof defaultChannelRaw !== 'string') {
        throw new BadRequestException('agent.config.execution.taskRouting.defaultChannel must be a string');
      }
      const normalized = defaultChannelRaw.trim().toLowerCase();
      if (normalized !== 'native' && normalized !== 'opencode') {
        throw new BadRequestException('agent.config.execution.taskRouting.defaultChannel must be native or opencode');
      }
      defaultChannel = normalized as 'native' | 'opencode';
    }

    return {
      opencodeTaskTypes,
      nativeTaskTypes,
      defaultChannel,
    };
  }

  async applyAgentBudgetGate(
    agent: Agent,
    runtimeAgentId: string,
    task: Task,
    runtimeContext: RuntimeRunContext,
    context?: AgentTaskExecutionContext,
  ): Promise<void> {
    const budgetConfig = this.parseAgentBudgetConfig(agent.config);
    if (!budgetConfig) {
      return;
    }

    const usage = await this.evaluateAgentBudgetUsage(runtimeAgentId, budgetConfig, runtimeContext.resumed);
    if (!usage.exceeded) {
      return;
    }

    if (budgetConfig.unit === 'dailyCost') {
      await this.publishAgentDailyCostExceededEvent({
        agent,
        runtimeAgentId,
        task,
        runtimeContext,
        context,
        budgetConfig,
        usage,
      });
      throw new BadRequestException(
        `Agent daily cost quota exceeded. period=${budgetConfig.period}, limit=${budgetConfig.limit}, used=${usage.usedAfter}`,
      );
    }

    const approval = context?.approval;
    const approved = approval?.approved === true;
    const quotaPayload = {
      gate: 'agent_budget',
      period: budgetConfig.period,
      unit: budgetConfig.unit,
      limit: budgetConfig.limit,
      usedBefore: usage.usedBefore,
      usedAfter: usage.usedAfter,
      periodStart: usage.periodStart.toISOString(),
      periodEnd: usage.periodEnd.toISOString(),
    };

    if (approved) {
      const approverId = approval?.approverId || context?.actor?.employeeId;
      await this.runtimeOrchestrator.resumeRunWithActor(runtimeContext.runId, {
        actorId: approverId || 'approval-system',
        actorType: approverId ? 'employee' : 'system',
        reason: approval?.reason || 'quota approval granted',
      });
      await this.runtimeOrchestrator.recordPermissionDecision({
        runId: runtimeContext.runId,
        agentId: runtimeAgentId,
        sessionId: runtimeContext.sessionId,
        taskId: task.id,
        traceId: runtimeContext.traceId,
        approved: true,
        payload: {
          ...quotaPayload,
          approvalId: approval?.approvalId,
          approverId,
          reason: approval?.reason || 'quota approval granted',
        },
      });
      return;
    }

    await this.runtimeOrchestrator.pauseRunWithActor(runtimeContext.runId, {
      actorId: context?.actor?.employeeId || 'system',
      actorType: context?.actor?.employeeId ? 'employee' : 'system',
      reason: 'quota exceeded, approval required',
    });
    await this.runtimeOrchestrator.recordPermissionAsked({
      runId: runtimeContext.runId,
      agentId: runtimeAgentId,
      sessionId: runtimeContext.sessionId,
      taskId: task.id,
      traceId: runtimeContext.traceId,
      payload: {
        ...quotaPayload,
        requestType: 'quota.exceeded',
        message: 'Agent quota exceeded and approval is required to continue execution',
      },
    });

    throw new BadRequestException(
      `Agent quota exceeded and run paused for approval. period=${budgetConfig.period}, limit=${budgetConfig.limit}, used=${usage.usedAfter}`,
    );
  }

  private parseModelBinding(value: unknown, fieldPath: string): OpenCodeModelBinding | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }

    if (typeof value === 'string') {
      const raw = value.trim();
      if (!raw) {
        return undefined;
      }
      const separator = raw.includes('/') ? '/' : ':';
      const [provider, model] = raw.split(separator);
      if (!provider || !model) {
        throw new BadRequestException(`${fieldPath} must be "provider/model" or an object`);
      }
      return {
        provider: provider.trim(),
        model: model.trim(),
      };
    }

    if (!this.isPlainObject(value)) {
      throw new BadRequestException(`${fieldPath} must be a JSON object`);
    }

    const provider = String((value as Record<string, unknown>).provider || '').trim();
    const model = String((value as Record<string, unknown>).model || '').trim();
    if (!provider || !model) {
      throw new BadRequestException(`${fieldPath} must include provider and model`);
    }
    return { provider, model };
  }

  private matchesModelBinding(binding: OpenCodeModelBinding, provider: string, model: string): boolean {
    return binding.provider === provider && binding.model === model;
  }

  private isModelBindingCheckEnabled(): boolean {
    const raw = String(process.env[OPENCODE_MODEL_BINDING_CHECK_ENABLED] || 'false')
      .trim()
      .toLowerCase();
    return raw === 'true';
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private parseAgentBudgetConfig(config: unknown): AgentBudgetConfig | null {
    if (!this.isPlainObject(config)) {
      return null;
    }

    const budget = (config as Record<string, unknown>).budget;
    if (budget === undefined || budget === null) {
      return null;
    }
    if (!this.isPlainObject(budget)) {
      throw new BadRequestException('agent.config.budget must be a JSON object');
    }

    const periodRaw = String((budget as Record<string, unknown>).period || '')
      .trim()
      .toLowerCase();
    const limitRaw = Number((budget as Record<string, unknown>).limit);
    const unitRaw = String((budget as Record<string, unknown>).unit || 'runCount').trim();

    if (!periodRaw || !OPENCODE_BUDGET_PERIOD_SET.has(periodRaw)) {
      throw new BadRequestException('agent.config.budget.period must be one of day/week/month');
    }
    if (!Number.isFinite(limitRaw) || limitRaw < 0) {
      throw new BadRequestException('agent.config.budget.limit must be a non-negative number');
    }
    if (!OPENCODE_BUDGET_UNIT_SET.has(unitRaw)) {
      throw new BadRequestException('agent.config.budget.unit must be runCount or dailyCost');
    }

    if (unitRaw === 'dailyCost' && periodRaw !== 'day') {
      throw new BadRequestException('agent.config.budget.period must be day when unit=dailyCost');
    }

    return {
      period: periodRaw as AgentBudgetConfig['period'],
      limit: unitRaw === 'runCount' ? Math.floor(limitRaw) : limitRaw,
      unit: unitRaw as AgentBudgetConfig['unit'],
    };
  }

  private async evaluateAgentBudgetUsage(
    agentId: string,
    budgetConfig: AgentBudgetConfig,
    resumedRun: boolean,
  ): Promise<{
    usedBefore: number;
    usedAfter: number;
    exceeded: boolean;
    periodStart: Date;
    periodEnd: Date;
  }> {
    if (budgetConfig.unit === 'dailyCost') {
      return this.evaluateAgentDailyCostUsage(agentId, budgetConfig);
    }

    const periodStart = this.resolveBudgetPeriodStart(budgetConfig.period);
    const periodEnd = new Date();
    const usedAfter = await this.agentRunModel
      .countDocuments({
        agentId,
        startedAt: {
          $gte: periodStart,
          $lte: periodEnd,
        },
      })
      .exec();
    const usedBefore = resumedRun ? usedAfter : Math.max(0, usedAfter - 1);

    return {
      usedBefore,
      usedAfter,
      exceeded: usedAfter > budgetConfig.limit,
      periodStart,
      periodEnd,
    };
  }

  private async evaluateAgentDailyCostUsage(
    agentId: string,
    budgetConfig: AgentBudgetConfig,
  ): Promise<{
    usedBefore: number;
    usedAfter: number;
    exceeded: boolean;
    periodStart: Date;
    periodEnd: Date;
  }> {
    const periodStart = this.resolveBudgetPeriodStart('day');
    const periodEnd = new Date();
    const aggregate = await this.agentMessageModel
      .aggregate<{ totalCost: number }>([
        {
          $match: {
            agentId,
            createdAt: {
              $gte: periodStart,
              $lte: periodEnd,
            },
          },
        },
        {
          $group: {
            _id: null,
            totalCost: {
              $sum: {
                $ifNull: ['$cost', 0],
              },
            },
          },
        },
      ])
      .exec();

    const usedAfter = Number(aggregate[0]?.totalCost || 0);

    return {
      usedBefore: usedAfter,
      usedAfter,
      exceeded: usedAfter >= budgetConfig.limit,
      periodStart,
      periodEnd,
    };
  }

  private async publishAgentDailyCostExceededEvent(input: {
    agent: Agent;
    runtimeAgentId: string;
    task: Task;
    runtimeContext: RuntimeRunContext;
    context?: AgentTaskExecutionContext;
    budgetConfig: AgentBudgetConfig;
    usage: {
      usedBefore: number;
      usedAfter: number;
      exceeded: boolean;
      periodStart: Date;
      periodEnd: Date;
    };
  }): Promise<void> {
    const receiverId = String(input.context?.actor?.employeeId || '').trim() || undefined;
    const taskTitle = String(input.task.title || '').trim() || input.task.id || '未命名任务';
    const occurredAt = new Date().toISOString();
    const event = buildMessageCenterEvent({
      eventType: 'agent.cost.exceeded',
      source: MESSAGE_CENTER_EVENT_SOURCE_AGENTS,
      occurredAt,
      traceId: input.runtimeContext.traceId,
      data: {
        receiverId,
        messageType: 'system_alert',
        title: 'Agent 每日 Cost 额度已超限',
        content: `Agent「${input.agent.name}」今日已消耗 $${input.usage.usedAfter.toFixed(6)}，超出额度 $${input.budgetConfig.limit.toFixed(6)}，任务「${taskTitle}」已被拦截。`,
        bizKey: `agent-cost-exceeded:${input.runtimeAgentId}:${input.runtimeContext.runId}`,
        priority: 'high',
        extra: {
          agentId: input.runtimeAgentId,
          agentName: input.agent.name,
          runId: input.runtimeContext.runId,
          sessionId: input.runtimeContext.sessionId,
          taskId: input.task.id,
          taskTitle,
          traceId: input.runtimeContext.traceId,
          period: input.budgetConfig.period,
          unit: input.budgetConfig.unit,
          limit: input.budgetConfig.limit,
          usedBefore: input.usage.usedBefore,
          usedAfter: input.usage.usedAfter,
          periodStart: input.usage.periodStart.toISOString(),
          periodEnd: input.usage.periodEnd.toISOString(),
        },
      },
    });

    try {
      await this.messageBus.publish('message-center.events', { payload: event });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error || 'unknown');
      this.logger.warn(
        `Publish agent cost exceeded message-center event failed: agentId=${input.runtimeAgentId} runId=${input.runtimeContext.runId} reason=${reason}`,
      );
    }
  }

  private resolveBudgetPeriodStart(period: AgentBudgetConfig['period']): Date {
    const now = new Date();
    if (period === 'day') {
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }
    if (period === 'week') {
      const day = now.getDay();
      const diffToMonday = (day + 6) % 7;
      return new Date(now.getFullYear(), now.getMonth(), now.getDate() - diffToMonday);
    }
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }
}
