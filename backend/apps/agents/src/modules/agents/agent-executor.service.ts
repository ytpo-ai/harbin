import { createHash } from 'crypto';

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

import { RedisService } from '@libs/infra';
import { ApiKeyService } from '@legacy/modules/api-keys/api-key.service';
import { Agent } from '@agent/schemas/agent.schema';
import { Task, ChatMessage, AIModel } from '@legacy/shared/types';

import { MemoEventBusService } from '@agent/modules/memos/memo-event-bus.service';
import { MemoService } from '@agent/modules/memos/memo.service';
import { MemoWriteQueueService } from '@agent/modules/memos/memo-write-queue.service';
import { ModelService } from '@agent/modules/models/model.service';
import { OpenCodeExecutionService } from '@agent/modules/opencode/opencode-execution.service';
import { AGENT_PROMPTS, AgentPromptTemplate } from '@agent/modules/prompt-registry/agent-prompt-catalog';
import { PromptResolverService } from '@agent/modules/prompt-registry/prompt-resolver.service';
import { RuntimeEiSyncService } from '@agent/modules/runtime/runtime-ei-sync.service';
import { RuntimeOrchestratorService, RuntimeRunContext } from '@agent/modules/runtime/runtime-orchestrator.service';
import { HookPipelineService } from '@agent/modules/runtime/hooks/hook-pipeline.service';
import { LifecycleHookContext } from '@agent/modules/runtime/hooks/lifecycle-hook.types';
import { ToolService } from '@agent/modules/tools/tool.service';
import { Skill, SkillDocument } from '@agent/schemas/agent-skill.schema';

import {
  MEMO_MCP_SEARCH_TOOL_ID,
  MEMO_MCP_APPEND_TOOL_ID,
  DEFAULT_MAX_TOOL_ROUNDS,
  SKILL_CONTENT_MAX_INJECT_LENGTH,
  AGENT_ENABLED_SKILL_CACHE_TTL_SECONDS,
  SYSTEM_CONTEXT_FINGERPRINT_TTL_SECONDS,
  normalizeToolId,
  uniqueStrings,
  compactLogText,
  toLogError,
} from './agent.constants';
import { AgentExecutionService } from './agent-execution.service';
import { AgentAfterStepEvaluationHook } from './hooks/agent-after-step-evaluation.hook';
import { AgentBeforeStepOptimizationHook } from './hooks/agent-before-step-optimization.hook';
import {
  AgentExecutorAfterStepHookResult,
  AgentExecutorBeforeStepHookResult,
  AgentExecutorStepContext,
} from './agent-executor-step-hooks.types';
import { AgentExecutorEngineRouter } from './executor-engines/agent-executor-engine.router';
import { AgentExecutionChannel, AgentExecutionMode, OpenCodeExecutionConfig, ResolvedOpenCodeRuntime } from './executor-engines/agent-executor-engine.types';
import { AgentOpenCodePolicyService } from './agent-opencode-policy.service';
import { AgentRoleService } from './agent-role.service';
import {
  buildTaskResultMemo,
  buildToolInputRepairInstruction,
  extractToolCall,
  isMeaninglessAssistantResponse,
  isMeetingLikeTask,
  isModelTimeoutError,
  getToolInputPreflightError,
  isToolInputErrorMessage,
  shouldRetryGenerationError,
  stripToolCallMarkup,
} from './agent-executor.helpers';
import {
  AgentContext,
  ExecuteTaskResult,
  EnabledAgentSkillContext,
  SystemContextFingerprintRecord,
  TaskInfoSnapshot,
  IdentityMemoSnapshotItem,
} from './agent.types';

const DEFAULT_OPENCODE_TASK_TYPES = new Set([
  'code',
  'coding',
  'development',
  'engineering',
  'engineering_development',
  'implement',
  'implementation',
  'devops',
  'bugfix',
  'fix',
  'refactor',
  'frontend_dev',
  'backend_dev',
]);

@Injectable()
export class AgentExecutorService {
  private readonly logger = new Logger(AgentExecutorService.name);
  private readonly debugTimingEnabled = this.readEnvBoolean('AGENT_DEBUG_TIMING', false);

  // 记录关键阶段耗时，便于线上排障和性能观测。
  private debugTiming(taskId: string, stage: string, startedAt: number, extras?: Record<string, unknown>): void {
    if (!this.debugTimingEnabled) {
      return;
    }
    const extraText = extras
      ? Object.entries(extras)
          .map(([key, value]) => `${key}=${String(value)}`)
          .join(' ')
      : '';
    this.logger.debug(
      `[timing_debug] taskId=${taskId} stage=${stage} durationMs=${Date.now() - startedAt}${extraText ? ` ${extraText}` : ''}`,
    );
  }

  // 注入 Agent 执行所需依赖（模型、工具、记忆、运行时、策略等）。
  constructor(
    @InjectModel(Skill.name) private skillModel: Model<SkillDocument>,
    private readonly modelService: ModelService,
    private readonly apiKeyService: ApiKeyService,
    private readonly toolService: ToolService,
    private readonly memoService: MemoService,
    private readonly memoWriteQueue: MemoWriteQueueService,
    private readonly memoEventBus: MemoEventBusService,
    private readonly runtimeOrchestrator: RuntimeOrchestratorService,
    private readonly runtimeEiSyncService: RuntimeEiSyncService,
    private readonly openCodeExecutionService: OpenCodeExecutionService,
    private readonly redisService: RedisService,
    private readonly agentExecutionService: AgentExecutionService,
    private readonly beforeStepOptimizationHook: AgentBeforeStepOptimizationHook,
    private readonly afterStepEvaluationHook: AgentAfterStepEvaluationHook,
    private readonly agentExecutorEngineRouter: AgentExecutorEngineRouter,
    private readonly agentOpenCodePolicyService: AgentOpenCodePolicyService,
    private readonly agentRoleService: AgentRoleService,
    private readonly promptResolverService: PromptResolverService,
    private readonly hookPipeline: HookPipelineService,
  ) {}

  /**
   * 通过 HookPipeline 执行 step.before 阶段所有已注册 hooks。
   * 返回值兼容旧 AgentExecutorBeforeStepHookResult 格式。
   */
  private async runBeforeStepHooks(
    context: AgentExecutorStepContext,
    runtimeContext?: RuntimeRunContext,
  ): Promise<AgentExecutorBeforeStepHookResult> {
    const pipelineContext: LifecycleHookContext = {
      phase: 'step.before',
      runId: runtimeContext?.runId || '',
      agentId: (context.agent as any)?.id || (context.agent as any)?._id?.toString?.() || '',
      taskId: context.task?.id,
      sessionId: runtimeContext?.sessionId,
      traceId: runtimeContext?.traceId || '',
      timestamp: Date.now(),
      payload: {
        agent: context.agent,
        task: context.task,
        messages: context.messages,
        modelConfig: context.modelConfig,
        round: context.round,
        maxRounds: context.maxRounds,
        assignedToolIds: context.assignedToolIds,
        executedToolIds: context.executedToolIds,
      },
    };

    const result = await this.hookPipeline.run(pipelineContext);

    return {
      appendSystemMessages: result.appendMessages,
      forcedToolCall: result.finalPayload.forcedToolCall as AgentExecutorBeforeStepHookResult['forcedToolCall'],
      decision: (result.finalPayload.decision as string) || 'none',
      messageFilters: result.messageFilters.length > 0 ? result.messageFilters : undefined,
      pauseRequested: result.pauseRequested || undefined,
      pauseReason: result.pauseReason,
      cancelRequested: result.cancelRequested || undefined,
      cancelReason: result.cancelReason,
    };
  }

  /**
   * 通过 HookPipeline 执行 step.after 阶段所有已注册 hooks。
   * 返回值兼容旧 AgentExecutorAfterStepHookResult 格式。
   */
  private async runAfterStepHooks(
    context: AgentExecutorStepContext,
    response: string,
    runtimeContext?: RuntimeRunContext,
  ): Promise<AgentExecutorAfterStepHookResult> {
    const pipelineContext: LifecycleHookContext = {
      phase: 'step.after',
      runId: runtimeContext?.runId || '',
      agentId: (context.agent as any)?.id || (context.agent as any)?._id?.toString?.() || '',
      taskId: context.task?.id,
      sessionId: runtimeContext?.sessionId,
      traceId: runtimeContext?.traceId || '',
      timestamp: Date.now(),
      payload: {
        agent: context.agent,
        task: context.task,
        messages: context.messages,
        modelConfig: context.modelConfig,
        round: context.round,
        maxRounds: context.maxRounds,
        assignedToolIds: context.assignedToolIds,
        executedToolIds: context.executedToolIds,
        response,
      },
    };

    const result = await this.hookPipeline.run(pipelineContext);

    return {
      appendSystemMessages: result.appendMessages,
      decision: (result.finalPayload.decision as string) === 'inject_instruction' ? 'inject_instruction' : 'accept',
      pauseRequested: result.pauseRequested || undefined,
      pauseReason: result.pauseReason,
      cancelRequested: result.cancelRequested || undefined,
      cancelReason: result.cancelReason,
      retryRequested: result.retryRequested || undefined,
    };
  }

  // ---- public execution methods ----

  // 兼容旧接口：执行任务并仅返回文本结果。
  async executeTask(
    agent: Agent,
    agentId: string,
    task: Task,
    context?: Partial<AgentContext>,
  ): Promise<string> {
    const detailed = await this.executeTaskDetailed(agent, agentId, task, context);
    return detailed.response;
  }

  // 执行任务并返回完整运行信息（响应、runId、sessionId）。
  async executeTaskDetailed(
    agent: Agent,
    agentId: string,
    task: Task,
    context?: Partial<AgentContext>,
  ): Promise<ExecuteTaskResult> {
    // 初始化任务运行上下文，并补齐 taskId。
    const taskStartAt = Date.now();
    const taskId = this.ensureTaskRuntime(task);
    const runtimeAgentId = this.agentExecutionService.resolveRuntimeAgentId(agent as any, agentId);
    this.logger.log(
      `[task_start] agent=${agent.name} agentId=${runtimeAgentId} taskId=${taskId} title="${compactLogText(task.title)}" type=${task.type} priority=${task.priority} modelId=${agent.model?.id || 'unknown'} provider=${agent.model?.provider || 'unknown'} hasCustomApiKey=${Boolean(agent.apiKeyId)}`,
    );

    // 异步写入待办/行为记忆，不阻塞主执行链路。
    void this.runMemoOperation('task_start_upsert_todo', taskId, async () => {
      await this.memoWriteQueue.queueUpsertTaskTodo(agent.id || agentId, {
        id: taskId,
        title: task.title,
        description: task.description,
        status: 'running',
        sourceType: 'orchestration_task',
      });
    });

    this.logger.log(
      `[task_context] taskId=${taskId} previousMessages=${task.messages?.length || 0} hasTeamContext=${Boolean(context?.teamContext)}`,
    );

    const agentContext: AgentContext = {
      task,
      previousMessages: task.messages || [],
      workingMemory: new Map(),
      teamContext: context?.teamContext,
      ...context,
    };

    // 预处理阶段：加载技能、拼接消息、解析执行路由。
    const prepared = await this.prepareExecution(
      {
        mode: 'detailed',
        stagePrefix: 'prepare',
        emitTaskPreparationLogs: true,
      },
      {
        agent,
        agentId,
        runtimeAgentId,
        task,
        taskId,
        context,
        agentContext,
      },
    );
    const { enabledSkills, messages, openCodeExecutionConfig, executionChannel, runtimeContext } = prepared;

    try {
      // OpenCode 渠道先执行预算闸门，避免超预算运行。
      if (executionChannel === 'opencode' && openCodeExecutionConfig) {
        await this.agentOpenCodePolicyService.applyAgentBudgetGate(agent, runtimeAgentId, task, runtimeContext, context);
      }
      const modelConfig = this.agentExecutionService.buildModelConfig(agent.model as any);
      const engine = this.agentExecutorEngineRouter.resolve('detailed', executionChannel);
      const { response: engineResponse } = await engine.execute({
        mode: 'detailed',
        channel: executionChannel,
        agent,
        runtimeAgentId,
        task,
        taskId,
        messages,
        runtimeContext,
        modelConfig,
        context,
        openCodeExecutionConfig: openCodeExecutionConfig || undefined,
        resolveCustomApiKey: this.createResolveCustomApiKeyHandler(agent, taskId, 'prepare.resolve_custom_api_key'),
        executeWithToolCalling: this.executeWithToolCalling.bind(this),
        logResolvedOpenCodeRuntime: this.logResolvedOpenCodeRuntime.bind(this),
      });

      let response = engineResponse;

      // 会议类任务最终兜底：保证最小可用回执。
      if (isMeetingLikeTask(task, context) && isMeaninglessAssistantResponse(response)) {
        response = await this.resolveAgentPromptContent(AGENT_PROMPTS.emptyMeetingResponseFallback);
      }

      this.logger.log(
        `[task_success] agent=${agent.name} taskId=${taskId} responseLength=${response.length} durationMs=${Date.now() - taskStartAt}`,
      );

      // 成功后异步写入完成行为与 todo 状态，并触发 memo 事件。
      void this.runMemoOperation('task_complete_todo', taskId, async () => {
        await this.memoWriteQueue.queueCompleteTaskTodo(agent.id || agentId, taskId, 'Task finished by agent runtime', 'success');
      });

      this.memoEventBus.emit({
        name: 'task.completed',
        agentId: agent.id || agentId,
        memoKinds: ['history', 'todo', 'draft'],
        taskId,
        summary: compactLogText(response, 240),
      });

      this.appendAssistantMessage(task, response, agent, enabledSkills);

      // 落 runtime 成功态并安排 EI 数据同步。
      await this.agentExecutionService.completeRuntimeExecution(runtimeContext, runtimeAgentId, taskId, response);
      await this.runtimeEiSyncService.scheduleRunSync(runtimeContext.runId);

      return {
        response,
        runId: runtimeContext.runId,
        sessionId: runtimeContext.sessionId,
      };
    } catch (error) {
      const logError = toLogError(error);
      this.logger.error(
        `[task_failed] agent=${agent.name} taskId=${taskId} durationMs=${Date.now() - taskStartAt} error=${logError.message}`,
        logError.stack,
      );

      // 控制面中断（取消/暂停/已完成）不重复标记为运行失败。
      const controlInterrupted = this.isControlInterruptedError(logError.message);
      void this.runMemoOperation('task_failed_todo', taskId, async () => {
        await this.memoWriteQueue.queueCompleteTaskTodo(
          agent.id || agentId,
          taskId,
          controlInterrupted ? 'Task interrupted before completion' : logError.message,
          controlInterrupted ? 'cancelled' : 'failed',
        );
      });
      if (!controlInterrupted) {
        await this.agentExecutionService.failRuntimeExecution(runtimeContext, runtimeAgentId, taskId, logError.message);
        await this.runtimeEiSyncService.scheduleRunSync(runtimeContext.runId);
      }
      throw error;
    } finally {
      // 无论成功失败均释放 runtime 资源，避免占用泄漏。
      await this.agentExecutionService.releaseRuntimeExecution(runtimeContext);
    }
  }

  // 流式执行任务：按 token 增量回调，同时返回最终聚合结果。
  async executeTaskWithStreaming(
    agent: Agent,
    agentId: string,
    task: Task,
    onToken: (token: string) => void,
    context?: Partial<AgentContext>,
  ): Promise<ExecuteTaskResult> {
    const taskStartAt = Date.now();
    const taskId = this.ensureTaskRuntime(task);
    const runtimeAgentId = this.agentExecutionService.resolveRuntimeAgentId(agent as any, agentId);
    this.logger.log(
      `[stream_task_start] agent=${agent.name} agentId=${runtimeAgentId} taskId=${taskId} title="${compactLogText(task.title)}" modelId=${agent.model?.id || 'unknown'} provider=${agent.model?.provider || 'unknown'}`,
    );

    const agentContext: AgentContext = {
      task,
      previousMessages: task.messages || [],
      workingMemory: new Map(),
      teamContext: context?.teamContext,
      ...context,
    };

    // 与 detailed 模式一致的预处理：技能、消息、路由、runtime。
    const prepared = await this.prepareExecution(
      {
        mode: 'streaming',
        stagePrefix: 'stream_prepare',
        emitTaskPreparationLogs: false,
      },
      {
        agent,
        agentId,
        runtimeAgentId,
        task,
        taskId,
        context,
        agentContext,
      },
    );
    const { enabledSkills, messages, openCodeExecutionConfig, executionChannel, runtimeContext } = prepared;

    let fullResponse = '';
    let tokenChunks = 0;
    try {
      // OpenCode 流式模式同样受预算闸门控制。
      if (executionChannel === 'opencode' && openCodeExecutionConfig) {
        await this.agentOpenCodePolicyService.applyAgentBudgetGate(agent, runtimeAgentId, task, runtimeContext, context);
      }
      await this.runtimeOrchestrator.assertRunnable(runtimeContext.runId);
      const modelConfig = this.agentExecutionService.buildModelConfig(agent.model as any);
      const engine = this.agentExecutorEngineRouter.resolve('streaming', executionChannel);
      const engineResult = await engine.execute({
        mode: 'streaming',
        channel: executionChannel,
        agent,
        runtimeAgentId,
        task,
        taskId,
        messages,
        runtimeContext,
        modelConfig,
        context,
        openCodeExecutionConfig: openCodeExecutionConfig || undefined,
        onToken,
        resolveCustomApiKey: this.createResolveCustomApiKeyHandler(agent, taskId, 'stream_prepare.resolve_custom_api_key'),
        executeWithToolCalling: this.executeWithToolCalling.bind(this),
        logResolvedOpenCodeRuntime: this.logResolvedOpenCodeRuntime.bind(this),
      });
      fullResponse = engineResult.response;
      tokenChunks = engineResult.tokenChunks ?? tokenChunks;

      // 流式最终兜底，确保会议场景输出不为空洞。
      if (isMeetingLikeTask(task, context) && isMeaninglessAssistantResponse(fullResponse)) {
        const emptyMeetingResponseFallback = await this.resolveAgentPromptContent(AGENT_PROMPTS.emptyMeetingResponseFallback);
        fullResponse = emptyMeetingResponseFallback;
        tokenChunks += 1;
        onToken(emptyMeetingResponseFallback);
      }

      await this.agentExecutionService.completeRuntimeExecution(runtimeContext, runtimeAgentId, taskId, fullResponse);
      await this.runtimeEiSyncService.scheduleRunSync(runtimeContext.runId);
    } catch (error) {
      const logError = toLogError(error);
      this.logger.error(
        `[stream_task_failed] agent=${agent.name} taskId=${taskId} durationMs=${Date.now() - taskStartAt} tokenChunks=${tokenChunks} error=${logError.message}`,
        logError.stack,
      );
      const controlInterrupted = this.isControlInterruptedError(logError.message);
      if (!controlInterrupted) {
        await this.agentExecutionService.failRuntimeExecution(runtimeContext, runtimeAgentId, taskId, logError.message);
        await this.runtimeEiSyncService.scheduleRunSync(runtimeContext.runId);
      }
      throw error;
    } finally {
      // 释放流式 runtime 资源。
      await this.agentExecutionService.releaseRuntimeExecution(runtimeContext);
    }

    this.logger.log(
      `[stream_task_success] agent=${agent.name} taskId=${taskId} durationMs=${Date.now() - taskStartAt} tokenChunks=${tokenChunks} responseLength=${fullResponse.length}`,
    );

    this.appendAssistantMessage(task, fullResponse, agent, enabledSkills);

    return {
      response: fullResponse,
      runId: runtimeContext.runId,
      sessionId: runtimeContext.sessionId,
    };
  }

  // 快速探活：验证模型配置与 API Key 是否可用。
  async testAgentConnection(
    agent: Agent,
    options?: { model?: AIModel; apiKeyId?: string },
  ): Promise<{
    success: boolean;
    agent?: string;
    model?: string;
    response?: string;
    responseLength?: number;
    duration?: string;
    error?: string;
    note?: string;
    keySource?: 'custom' | 'system';
    timestamp: string;
  }> {
    const modelConfig: AIModel = {
      id: options?.model?.id || agent.model.id,
      name: options?.model?.name || agent.model.name,
      provider: (options?.model?.provider || agent.model.provider) as AIModel['provider'],
      model: options?.model?.model || agent.model.model,
      maxTokens: options?.model?.maxTokens || agent.model.maxTokens || 4096,
      temperature: options?.model?.temperature ?? agent.model.temperature ?? 0.7,
      topP: options?.model?.topP ?? agent.model.topP,
      reasoning: options?.model?.reasoning ?? agent.model.reasoning,
    };

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: agent.systemPrompt || (await this.resolveAgentPromptContent(AGENT_PROMPTS.testConnectionDefaultSystemPrompt)),
        timestamp: new Date(),
      },
      {
        role: 'user',
        content: await this.resolveAgentPromptContent(AGENT_PROMPTS.testConnectionUserMessage),
        timestamp: new Date(),
      },
    ];

    // 统一模型测试执行器，含 20s 超时保护。
    const runModelTest = async (customApiKey?: string) => {
      this.modelService.registerProvider(modelConfig, customApiKey);
      const startTime = Date.now();
      const response = await Promise.race([
        this.modelService.chat(modelConfig.id, messages, {
          temperature: modelConfig.temperature ?? 0.7,
          maxTokens: 128,
        }),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error('模型测试超时（20s）')), 20000),
        ),
      ]);
      return {
        response,
        duration: `${Date.now() - startTime}ms`,
      };
    };

    // 判定模型不存在类错误，便于返回更可操作提示。
    const isModelNotFoundError = (message: string): boolean => {
      const lower = (message || '').toLowerCase();
      return (
        (lower.includes('not_found_error') && lower.includes('model')) ||
        lower.includes('not found the model') ||
        lower.includes('model not found') ||
        lower === 'not found' ||
        lower.includes('not found (alibaba endpoint=')
      );
    };

    // 判定鉴权类错误（401/unauthorized）。
    const isAuthError = (message: string): boolean => {
      const lower = (message || '').toLowerCase();
      return lower.includes('401') || lower.includes('invalid authentication') || lower.includes('unauthorized');
    };

    // 统一提供商别名，避免 key/provider 比较误判。
    const normalizeProvider = (provider?: string): string => {
      const value = (provider || '').trim().toLowerCase();
      if (value === 'kimi') return 'moonshot';
      if (value === 'claude') return 'anthropic';
      return value;
    };

    const keyId = options?.apiKeyId?.trim() || undefined;
    const buildBaseResult = (keySource: 'custom' | 'system') => ({
      agent: agent.name,
      model: modelConfig.name,
      keySource,
      timestamp: new Date().toISOString(),
    });
    const buildFailureResult = (keySource: 'custom' | 'system', error: string) => ({
      success: false,
      ...buildBaseResult(keySource),
      error,
    });
    const buildSuccessResult = (keySource: 'custom' | 'system', result: { response: string; duration: string }, note?: string) => ({
      success: true,
      ...buildBaseResult(keySource),
      response: result.response,
      responseLength: result.response.length,
      duration: result.duration,
      ...(note ? { note } : {}),
    });

    try {
      // 优先按用户指定 key 测试；失败时按规则尝试系统 key 回退。
      if (keyId) {
        const selectedApiKey = await this.apiKeyService.getApiKey(keyId);
        if (!selectedApiKey) {
          return buildFailureResult('custom', '所选API Key不存在，请重新选择');
        }

        if (normalizeProvider(selectedApiKey.provider) !== normalizeProvider(modelConfig.provider)) {
          return buildFailureResult(
            'custom',
            `所选API Key提供商(${selectedApiKey.provider})与模型提供商(${modelConfig.provider})不匹配`,
          );
        }

        const customApiKey = await this.apiKeyService.getDecryptedKey(keyId);
        if (!customApiKey) {
          return buildFailureResult('custom', 'Agent绑定的API Key无效或已失效，请重新选择API Key');
        }

        try {
          const result = await runModelTest(customApiKey);
          await this.apiKeyService.recordUsage(keyId);
          return buildSuccessResult('custom', result);
        } catch (customError) {
          const customMessage = customError instanceof Error ? customError.message : 'Unknown error';
          this.logger.error(`Agent ${agent.name} model test failed with custom key: ${customMessage}`);

          if (isModelNotFoundError(customMessage)) {
            return buildFailureResult('custom', `当前模型在提供商侧不可用，请切换模型后重试。详细信息：${customMessage}`);
          }

          if (isAuthError(customMessage)) {
            return buildFailureResult('custom', `自定义API Key鉴权失败，请检查该Key是否有效/可用。详细信息：${customMessage}`);
          }

          try {
            const fallbackResult = await runModelTest(undefined);
            return buildSuccessResult(
              'system',
              fallbackResult,
              `自定义API Key测试失败，已使用系统默认Key回退成功：${customMessage}`,
            );
          } catch (fallbackError) {
            const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : 'Unknown error';
            this.logger.error(`Agent ${agent.name} model fallback test failed: ${fallbackMessage}`);
            return buildFailureResult('custom', `自定义API Key失败: ${customMessage}; 系统默认Key失败: ${fallbackMessage}`);
          }
        }
      }

      const result = await runModelTest(undefined);
      return buildSuccessResult('system', result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Agent ${agent.name} model test failed: ${message}`);
      return buildFailureResult(keyId ? 'custom' : 'system', message);
    }
  }

  // 取消 runtime run（由系统 actor 发起）。
  async cancelRuntimeRun(runId: string, reason?: string): Promise<void> {
    if (!String(runId || '').trim()) {
      return;
    }
    await this.runtimeOrchestrator.cancelRunWithActor(runId, {
      actorId: 'agent-task-worker',
      actorType: 'system',
      reason: reason || 'user_cancel',
    });
  }

  // 取消 OpenCode 会话。
  async cancelOpenCodeSession(
    sessionId: string,
    runtime?: {
      endpoint?: string;
      authEnable?: boolean;
    },
  ): Promise<boolean> {
    if (!String(sessionId || '').trim()) {
      return false;
    }

    return this.openCodeExecutionService.cancelSession(sessionId, {
      baseUrl: runtime?.endpoint,
      authEnable: runtime?.authEnable,
    });
  }

  // ---- private execution methods ----

  private async prepareExecution(
    config: {
      mode: AgentExecutionMode;
      stagePrefix: 'prepare' | 'stream_prepare';
      emitTaskPreparationLogs: boolean;
    },
    input: {
      agent: Agent;
      agentId: string;
      runtimeAgentId: string;
      task: Task;
      taskId: string;
      context?: Partial<AgentContext>;
      agentContext: AgentContext;
    },
  ): Promise<{
    enabledSkills: EnabledAgentSkillContext[];
    messages: ChatMessage[];
    routeDecision: {
      channel: AgentExecutionChannel;
      taskType: string;
      source: string;
      openCodeExecutionConfig: OpenCodeExecutionConfig | null;
    };
    openCodeExecutionConfig: OpenCodeExecutionConfig | null;
    executionChannel: AgentExecutionChannel;
    runtimeContext: RuntimeRunContext;
  }> {
    const preExecutionStartAt = Date.now();
    const skillsStartAt = Date.now();
    const enabledSkills = await this.getEnabledSkillsForAgent(input.agent, input.agentId);
    this.debugTiming(input.taskId, `${config.stagePrefix}.enabled_skills`, skillsStartAt, { enabledSkills: enabledSkills.length });
    if (config.emitTaskPreparationLogs) {
      this.logger.log(
        `[task_skills] taskId=${input.taskId} enabledSkills=${enabledSkills.length} skillNames=${enabledSkills.map((item) => item.name).join('|') || 'none'}`,
      );
    }

    const buildMessagesStartAt = Date.now();
    const messages = await this.buildMessages(input.agent, input.task, input.agentContext, enabledSkills);
    this.debugTiming(input.taskId, `${config.stagePrefix}.build_messages`, buildMessagesStartAt, { compiledMessages: messages.length });
    if (config.emitTaskPreparationLogs) {
      this.logger.log(`[task_messages] taskId=${input.taskId} compiledMessages=${messages.length}`);
    }

    const routeStartAt = Date.now();
    const routeDecision = await this.resolveExecutionRoute(input.agent, input.task, input.context);
    this.debugTiming(input.taskId, `${config.stagePrefix}.resolve_execution_route`, routeStartAt, {
      channel: routeDecision.channel,
      routeSource: routeDecision.source,
      taskType: routeDecision.taskType,
    });
    const openCodeExecutionConfig = routeDecision.openCodeExecutionConfig;
    const roleStartAt = Date.now();
    const role = await this.agentRoleService.getRoleById(input.agent.roleId);
    this.debugTiming(input.taskId, `${config.stagePrefix}.load_role`, roleStartAt, { hasRole: Boolean(role) });
    const roleCode = role?.code ? String(role.code).trim() : undefined;
    const executionChannel: AgentExecutionChannel = routeDecision.channel;
    const executionData = this.buildExecutionData(
      input.agent,
      routeDecision,
      executionChannel,
      config.mode === 'streaming' ? 'streaming' : undefined,
    );

    const startRuntimeExecutionAt = Date.now();
    const runtimeContext = await this.agentExecutionService.startRuntimeExecution({
      runtimeAgentId: input.runtimeAgentId,
      agentName: input.agent.name,
      task: input.task,
      messages,
      mode: config.mode,
      roleCode,
      executionChannel,
      executionData,
      teamContext: input.context?.teamContext,
    });
    this.debugTiming(input.taskId, `${config.stagePrefix}.start_runtime_execution`, startRuntimeExecutionAt, {
      runId: runtimeContext.runId,
      sessionId: runtimeContext.sessionId || 'none',
    });

    await input.context?.runtimeLifecycle?.onStarted?.({
      runId: runtimeContext.runId,
      sessionId: runtimeContext.sessionId,
      traceId: runtimeContext.traceId,
    });

    const appendSystemMessagesAt = Date.now();
    await this.agentExecutionService.appendSystemMessagesToSession(runtimeContext, messages, input.agent.id || input.agentId);
    this.debugTiming(input.taskId, `${config.stagePrefix}.append_system_messages`, appendSystemMessagesAt, { count: messages.length });
    this.debugTiming(input.taskId, `${config.stagePrefix}.total_before_model`, preExecutionStartAt, {
      channel: executionChannel,
      routeSource: routeDecision.source,
    });

    return {
      enabledSkills,
      messages,
      routeDecision,
      openCodeExecutionConfig,
      executionChannel,
      runtimeContext,
    };
  }

  // 解析最终执行路由：native 或 opencode。
  private async resolveExecutionRoute(
    agent: Agent,
    task: Task,
    context?: Partial<AgentContext>,
  ): Promise<{
    channel: AgentExecutionChannel;
    taskType: string;
    source: string;
    openCodeExecutionConfig: OpenCodeExecutionConfig | null;
  }> {
    const openCodeExecutionConfig =
      (this.agentOpenCodePolicyService.parseOpenCodeExecutionConfig(agent.config) as OpenCodeExecutionConfig | null) || null;
    const taskType = this.resolveExecutionTaskType(task, context);
    const preferredChannel = this.resolvePreferredExecutionChannel(context);

    // Agent 未开启 OpenCode 时直接走 native。
    if (!openCodeExecutionConfig) {
      this.logger.log(
        `[execution_route] agent=${agent.name} taskType=${taskType} channel=native source=opencode_disabled opencodeEnabled=false`,
      );
      return {
        channel: 'native',
        taskType,
        source: 'opencode_disabled',
        openCodeExecutionConfig,
      };
    }

    // 上下文显式偏好优先级最高。
    if (preferredChannel) {
      return await this.finalizeExecutionRoute(agent, taskType, preferredChannel, `context_preferred_${preferredChannel}`, openCodeExecutionConfig);
    }

    // 其次使用配置化 task routing 规则。
    const routing = openCodeExecutionConfig.taskRouting;
    if (routing) {
      if (routing.opencodeTaskTypes.includes(taskType)) {
        return await this.finalizeExecutionRoute(agent, taskType, 'opencode', 'config_task_routing_opencode', openCodeExecutionConfig);
      }
      if (routing.nativeTaskTypes.includes(taskType)) {
        return await this.finalizeExecutionRoute(agent, taskType, 'native', 'config_task_routing_native', openCodeExecutionConfig);
      }
      return await this.finalizeExecutionRoute(
        agent,
        taskType,
        routing.defaultChannel,
        `config_task_routing_default_${routing.defaultChannel}`,
        openCodeExecutionConfig,
      );
    }

    // 最后按内置任务类型白名单回退。
    const fallbackChannel: AgentExecutionChannel = DEFAULT_OPENCODE_TASK_TYPES.has(taskType) ? 'opencode' : 'native';
    const fallbackSource = fallbackChannel === 'opencode' ? 'default_task_type_opencode' : 'default_task_type_native';
    return this.finalizeExecutionRoute(agent, taskType, fallbackChannel, fallbackSource, openCodeExecutionConfig);
  }

  // 在返回路由前执行必要的 gate 校验与日志记录。
  private async finalizeExecutionRoute(
    agent: Agent,
    taskType: string,
    channel: AgentExecutionChannel,
    source: string,
    openCodeExecutionConfig: OpenCodeExecutionConfig,
  ): Promise<{
    channel: AgentExecutionChannel;
    taskType: string;
    source: string;
    openCodeExecutionConfig: OpenCodeExecutionConfig;
  }> {
    if (channel === 'opencode') {
      const role = await this.agentRoleService.assertRoleExists(agent.roleId);
      this.agentOpenCodePolicyService.assertOpenCodeExecutionGate(agent, String(role.code || '').trim(), openCodeExecutionConfig);
    }

    this.logger.log(
      `[execution_route] agent=${agent.name} taskType=${taskType} channel=${channel} source=${source} opencodeEnabled=true`,
    );

    return {
      channel,
      taskType,
      source,
      openCodeExecutionConfig,
    };
  }

  // 汇总多来源 taskType，并标准化为小写值。
  private resolveExecutionTaskType(task: Task, context?: Partial<AgentContext>): string {
    const candidates = [
      context?.runtimeRouting?.taskType,
      this.asString((context?.sessionContext as Record<string, unknown> | undefined)?.runtimeTaskType),
      this.asString((context?.sessionContext as Record<string, unknown> | undefined)?.taskType),
      task.type,
    ];
    for (const candidate of candidates) {
      const normalized = String(candidate || '').trim().toLowerCase();
      if (normalized) {
        return normalized;
      }
    }
    return 'general';
  }

  // 解析上下文中的渠道偏好提示。
  private resolvePreferredExecutionChannel(context?: Partial<AgentContext>): AgentExecutionChannel | null {
    const candidates = [
      context?.runtimeRouting?.preferredChannel,
      this.asString((context?.sessionContext as Record<string, unknown> | undefined)?.runtimeChannelHint),
      this.asString((context?.sessionContext as Record<string, unknown> | undefined)?.preferredRuntimeChannel),
    ];
    for (const candidate of candidates) {
      const normalized = String(candidate || '').trim().toLowerCase();
      if (normalized === 'native' || normalized === 'opencode') {
        return normalized;
      }
    }
    return null;
  }

  // 安全字符串收敛，避免非字符串污染路由判断。
  private asString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
  }

  // Native 执行核心：模型生成 + 工具调用多轮闭环。
  private async executeWithToolCalling(
    agent: Agent,
    task: Task,
    initialMessages: ChatMessage[],
    modelConfig: AIModel,
    runtimeContext?: RuntimeRunContext,
    executionContext?: {
      teamContext?: any;
      actor?: {
        employeeId?: string;
        role?: string;
      };
      taskType?: string;
      teamId?: string;
    },
  ): Promise<string> {
    const maxToolRounds = this.getMaxToolRounds();
    const messages = [...initialMessages];
    const assignedToolIds = new Set(await this.agentRoleService.getAllowedToolIds(agent));
    const agentRuntimeId = agent.id || (agent as any)._id?.toString?.() || '';
    const executedToolIds = new Set<string>();
    const meetingLike = isMeetingLikeTask(task, executionContext);
    let emptyResponseRetryUsed = false;
    let errorRetryUsed = false;
    const emptyMeetingResponseFallback = await this.resolveAgentPromptContent(AGENT_PROMPTS.emptyMeetingResponseFallback);
    const generationErrorRetryPrompt = meetingLike
      ? await this.resolveAgentPromptContent(AGENT_PROMPTS.generationErrorRetryInstruction)
      : '';
    const emptyResponseRetryPrompt = meetingLike
      ? await this.resolveAgentPromptContent(AGENT_PROMPTS.emptyResponseRetryInstruction)
      : '';
    const toolRoundLimitMessage = await this.resolveAgentPromptContent(AGENT_PROMPTS.toolRoundLimitMessage);

    // 多轮循环：模型 -> 解析工具调用 -> 执行工具 -> 回灌结果。
    for (let round = 0; round <= maxToolRounds; round++) {
      if (runtimeContext) {
        await this.runtimeOrchestrator.assertRunnable(runtimeContext.runId);
      }
      let response: string;
      const roundStartAt = Date.now();
      this.logger.log(
        `[tool_round_start] agent=${agent.name} taskId=${task.id} round=${round + 1}/${maxToolRounds + 1} messageCount=${messages.length} modelId=${modelConfig.id}`,
      );

      const stepContext: AgentExecutorStepContext = {
        agent,
        task,
        messages,
        modelConfig,
        round,
        maxRounds: maxToolRounds,
        assignedToolIds: Array.from(assignedToolIds),
        executedToolIds: Array.from(executedToolIds),
      };

      const beforeStepHookResult = await this.runBeforeStepHooks(stepContext, runtimeContext);

      // hook 请求取消：立即中断执行
      if (beforeStepHookResult.cancelRequested && runtimeContext) {
        this.logger.warn(`[step_hook_cancel] agent=${agent.name} taskId=${task.id} round=${round + 1} reason=${beforeStepHookResult.cancelReason}`);
        await this.runtimeOrchestrator.cancelRunWithActor(runtimeContext.runId, {
          actorId: 'lifecycle-hook',
          actorType: 'system',
          reason: beforeStepHookResult.cancelReason || 'cancelled_by_before_step_hook',
        });
        throw new Error(`Runtime run cancelled by hook: ${beforeStepHookResult.cancelReason || 'before_step_hook'}`);
      }

      // hook 请求暂停：暂停 run 后中断执行
      if (beforeStepHookResult.pauseRequested && runtimeContext) {
        this.logger.warn(`[step_hook_pause] agent=${agent.name} taskId=${task.id} round=${round + 1} reason=${beforeStepHookResult.pauseReason}`);
        await this.runtimeOrchestrator.pauseRunWithActor(runtimeContext.runId, {
          actorId: 'lifecycle-hook',
          actorType: 'system',
          reason: beforeStepHookResult.pauseReason || 'paused_by_before_step_hook',
        });
        throw new Error(`Runtime run paused by hook: ${beforeStepHookResult.pauseReason || 'before_step_hook'}`);
      }

      // 应用消息过滤规则
      if (beforeStepHookResult.messageFilters?.length) {
        const filtered = HookPipelineService.applyMessageFilters(messages, beforeStepHookResult.messageFilters);
        messages.length = 0;
        messages.push(...filtered);
      }

      if (beforeStepHookResult.appendSystemMessages.length > 0) {
        for (const instruction of beforeStepHookResult.appendSystemMessages) {
          messages.push({
            role: 'system',
            content: instruction,
            timestamp: new Date(),
          });
        }
      }
      if (beforeStepHookResult.forcedToolCall) {
        const forcedToolCall = beforeStepHookResult.forcedToolCall;
        messages.push({
          role: 'system',
          content: await this.buildForcedToolCallInstruction(agent, forcedToolCall),
          timestamp: new Date(),
        });
      }

      try {
        response = await this.modelService.chat(modelConfig.id, messages, {
          temperature: modelConfig.temperature,
          maxTokens: modelConfig.maxTokens,
        });
        this.logger.log(
          `[tool_round_response] agent=${agent.name} taskId=${task.id} round=${round + 1} durationMs=${Date.now() - roundStartAt} responseLength=${response.length}`,
        );
      } catch (error) {
        if (isModelTimeoutError(error)) {
          this.logger.warn(
            `[tool_round_timeout] agent=${agent.name} taskId=${task.id} round=${round + 1} durationMs=${Date.now() - roundStartAt}`,
          );
          return '当前模型请求超时（上游响应过慢）。请稍后重试，或将问题拆小后再试。';
        }
        if (meetingLike && !errorRetryUsed && shouldRetryGenerationError(error)) {
          errorRetryUsed = true;
          this.logger.warn(
            `[tool_round_retry] agent=${agent.name} taskId=${task.id} round=${round + 1} reason=${toLogError(error).message}`,
          );
          messages.push({
            role: 'system',
            content: generationErrorRetryPrompt,
            timestamp: new Date(),
          });
          continue;
        }
        if (meetingLike && shouldRetryGenerationError(error)) {
          return emptyMeetingResponseFallback;
        }
        throw error;
      }

      // 若未识别到工具调用，则尝试返回最终答案。
      const toolCall = extractToolCall(response);
      if (!toolCall) {
        const afterStepHookResult = await this.runAfterStepHooks(
          {
            ...stepContext,
            executedToolIds: Array.from(executedToolIds),
          },
          response,
          runtimeContext,
        );

        // hook 请求取消：立即中断执行
        if (afterStepHookResult.cancelRequested && runtimeContext) {
          this.logger.warn(`[after_step_hook_cancel] agent=${agent.name} taskId=${task.id} round=${round + 1} reason=${afterStepHookResult.cancelReason}`);
          await this.runtimeOrchestrator.cancelRunWithActor(runtimeContext.runId, {
            actorId: 'lifecycle-hook',
            actorType: 'system',
            reason: afterStepHookResult.cancelReason || 'cancelled_by_after_step_hook',
          });
          throw new Error(`Runtime run cancelled by hook: ${afterStepHookResult.cancelReason || 'after_step_hook'}`);
        }

        // hook 请求暂停：暂停 run 后中断执行
        if (afterStepHookResult.pauseRequested && runtimeContext) {
          this.logger.warn(`[after_step_hook_pause] agent=${agent.name} taskId=${task.id} round=${round + 1} reason=${afterStepHookResult.pauseReason}`);
          await this.runtimeOrchestrator.pauseRunWithActor(runtimeContext.runId, {
            actorId: 'lifecycle-hook',
            actorType: 'system',
            reason: afterStepHookResult.pauseReason || 'paused_by_after_step_hook',
          });
          throw new Error(`Runtime run paused by hook: ${afterStepHookResult.pauseReason || 'after_step_hook'}`);
        }

        // hook 请求重试当前 step：不返回结果，继续下一轮循环
        if (afterStepHookResult.retryRequested) {
          this.logger.log(`[after_step_hook_retry] agent=${agent.name} taskId=${task.id} round=${round + 1}`);
          if (afterStepHookResult.appendSystemMessages.length > 0) {
            for (const instruction of afterStepHookResult.appendSystemMessages) {
              messages.push({ role: 'system', content: instruction, timestamp: new Date() });
            }
          }
          continue;
        }

        if (afterStepHookResult.decision === 'inject_instruction' && afterStepHookResult.appendSystemMessages.length > 0) {
          for (const instruction of afterStepHookResult.appendSystemMessages) {
            messages.push({
              role: 'system',
              content: instruction,
              timestamp: new Date(),
            });
          }
          continue;
        }

        const cleaned = stripToolCallMarkup(response);
        if (meetingLike && isMeaninglessAssistantResponse(cleaned)) {
          if (!emptyResponseRetryUsed) {
            emptyResponseRetryUsed = true;
            messages.push({
              role: 'system',
              content: emptyResponseRetryPrompt,
              timestamp: new Date(),
            });
            continue;
          }
          return emptyMeetingResponseFallback;
        }
        return cleaned;
      }

      messages.push({
        role: 'assistant',
        content: response,
        timestamp: new Date(),
      });

      const normalizedToolCallId = normalizeToolId(toolCall.tool);
      // 工具权限校验：未授权工具直接驳回并提示模型改写。
      if (!assignedToolIds.has(normalizedToolCallId)) {
        this.logger.warn(
          `[tool_denied] agent=${agent.name} taskId=${task.id} round=${round + 1} tool=${normalizedToolCallId}`,
        );
        messages.push({
          role: 'system',
          content: await this.resolveAgentPromptContent(AGENT_PROMPTS.toolDeniedInstruction, {
            normalizedToolId: normalizedToolCallId,
          }),
          timestamp: new Date(),
        });
        continue;
      }

      const inputContract = await this.toolService.getToolInputContract(normalizedToolCallId);
      const preflightInputError = getToolInputPreflightError(inputContract?.schema, toolCall.parameters);
      if (preflightInputError && inputContract?.schema) {
        this.logger.warn(
          `[tool_input_preflight_failed] agent=${agent.name} taskId=${task.id} round=${round + 1} tool=${normalizedToolCallId} error=${preflightInputError}`,
        );
        messages.push({
          role: 'system',
          content: buildToolInputRepairInstruction(
            normalizedToolCallId,
            inputContract.schema,
            toolCall.parameters || {},
            preflightInputError,
          ),
          timestamp: new Date(),
        });
        continue;
      }

      const toolCallId = `toolcall-${uuidv4()}`;
      let runtimeToolPartId: string | undefined;
      const runtimeToolEventBase = runtimeContext
        ? {
            runId: runtimeContext.runId,
            agentId: agentRuntimeId,
            taskId: task.id,
            toolId: normalizedToolCallId,
            toolName: toolCall.tool,
            toolCallId,
            input: toolCall.parameters,
            traceId: runtimeContext.traceId,
            sequence: round + 1,
            messageId: runtimeContext.userMessageId,
          }
        : null;
      // 执行工具并将结果写回消息上下文，供下一轮模型消费。
      try {
        if (runtimeToolEventBase) {
          runtimeToolPartId = await this.runtimeOrchestrator.recordToolPending(runtimeToolEventBase);
          await this.runtimeOrchestrator.recordToolRunning({
            ...runtimeToolEventBase,
            partId: runtimeToolPartId,
          });
        }

        this.logger.log(
          `[tool_execute_start] agent=${agent.name} taskId=${task.id} round=${round + 1} tool=${normalizedToolCallId} parameters=${compactLogText(JSON.stringify(toolCall.parameters || {}), 240)}`,
        );
        const execution = await this.toolService.executeTool(
          normalizedToolCallId,
          agentRuntimeId,
          toolCall.parameters,
          task.id,
          executionContext,
        );
        executedToolIds.add(normalizedToolCallId);
        const toolResultPayload = this.extractToolResultPayload(execution);
        this.logger.log(
          `[tool_execute_success] agent=${agent.name} taskId=${task.id} round=${round + 1} tool=${normalizedToolCallId} resultKeys=${Object.keys(toolResultPayload || {}).join('|') || 'none'}`,
        );

        if (runtimeToolEventBase) {
          await this.runtimeOrchestrator.recordToolCompleted({
            ...runtimeToolEventBase,
            partId: runtimeToolPartId,
            output: toolResultPayload,
          });
        }

        messages.push({
          role: 'system',
          content: `工具 ${normalizedToolCallId} 调用结果: ${JSON.stringify(toolResultPayload || {})}`,
          timestamp: new Date(),
        });
      } catch (error) {
        const logError = toLogError(error);
        this.logger.error(
          `[tool_execute_failed] agent=${agent.name} taskId=${task.id} round=${round + 1} tool=${normalizedToolCallId} error=${logError.message}`,
          logError.stack,
        );

        if (runtimeToolEventBase) {
          await this.runtimeOrchestrator.recordToolFailed({
            ...runtimeToolEventBase,
            partId: runtimeToolPartId,
            error: logError.message,
          });
        }

        const message = logError.message;
        messages.push({
          role: 'system',
          content: await this.resolveAgentPromptContent(AGENT_PROMPTS.toolFailedInstruction, {
            normalizedToolId: normalizedToolCallId,
            message,
          }),
          timestamp: new Date(),
        });

        // 参数契约错误时附加修复指令，引导模型自我修正参数。
        if (isToolInputErrorMessage(message)) {
          const latestInputContract = inputContract || (await this.toolService.getToolInputContract(normalizedToolCallId));
          if (latestInputContract?.schema) {
            messages.push({
              role: 'system',
              content: buildToolInputRepairInstruction(
                normalizedToolCallId,
                latestInputContract.schema,
                toolCall.parameters || {},
              ),
              timestamp: new Date(),
            });
          }
        }
      }
    }

    return toolRoundLimitMessage;
  }

  // ---- message building ----

  // 组装发送给模型的完整消息栈（system/user/history/memory/tools/skills）。
  async buildMessages(
    agent: Agent,
    task: Task,
    context: AgentContext,
    enabledSkills: EnabledAgentSkillContext[],
  ): Promise<ChatMessage[]> {
    const buildStartAt = Date.now();
    const taskId = String(task.id || 'unknown');
    const messages: ChatMessage[] = [];
    // 会议类任务会附加更强的执行约束与空响应兜底策略。
    const meetingLikeTask = isMeetingLikeTask(task, context);
    const loadIdentityStartAt = Date.now();
    const identityMemos = await this.memoService.getIdentityMemos(agent.id || '');
    this.debugTiming(taskId, 'build_messages.load_identity_memos', loadIdentityStartAt, {
      identityMemoCount: identityMemos.length,
    });
    const previousSystemMessages = (context.previousMessages || []).filter((message) => message?.role === 'system');
    const previousNonSystemMessages = (context.previousMessages || []).filter((message) => message?.role !== 'system');

    // 1) 注入 Agent 工作准则（固定首条 system prompt）。
    messages.push({
      role: 'system',
      content: await this.resolveAgentPromptContent(AGENT_PROMPTS.agentWorkingGuideline),
      timestamp: new Date(),
    });

    // 2) 注入 Agent 基础 system prompt。
    messages.push({
      role: 'system',
      content: agent.systemPrompt,
      timestamp: new Date(),
    });

    const contextScope = this.resolveSystemContextScope(agent, task, context);

    // 3) 注入身份记忆，并通过指纹做增量下发降低 token 开销。
    if (identityMemos.length > 0) {
      const identityContent = identityMemos
        .map((memo) => {
          const content = String(memo.content || '');
          const topic = memo.payload?.topic ? String(memo.payload.topic) : '';
          return `## ${memo.title}${topic ? ` (${topic})` : ''}\n\n${content}`;
        })
        .join('\n\n---\n\n');
      const identitySnapshot: IdentityMemoSnapshotItem[] = identityMemos
        .map((memo) => ({
          title: String(memo.title || '').trim(),
          topic: memo.payload?.topic ? String(memo.payload.topic).trim() : '',
          contentHash: this.hashFingerprint(String(memo.content || '')),
        }))
        .sort((a, b) => `${a.title}:${a.topic}`.localeCompare(`${b.title}:${b.topic}`));
      const identityMessage = await this.resolveSystemContextBlockContent({
        scope: contextScope,
        blockType: 'identity',
        fullContent: `【身份与职责】以下是你的身份定义，请始终以此为准：\n\n${identityContent}`,
        snapshot: {
          items: identitySnapshot,
        },
        buildDelta: (previous, current) =>
          this.buildIdentityMemoDelta(
            Array.isArray((previous as any)?.items) ? ((previous as any).items as IdentityMemoSnapshotItem[]) : [],
            Array.isArray((current as any)?.items) ? ((current as any).items as IdentityMemoSnapshotItem[]) : [],
          ),
        deltaPrefix: '【身份与职责增量更新】',
      });
      if (identityMessage) {
        messages.push({
          role: 'system',
          content: identityMessage,
          timestamp: new Date(),
        });
      }
    }

    // 4) 非会议类任务注入任务信息块（同样支持增量更新）。
    if (!meetingLikeTask) {
      const descAlreadyInHistory =
        task.description &&
        task.description.length > 50 &&
        context.previousMessages.some(
          (msg) =>
            msg.role === 'user' &&
            typeof msg.content === 'string' &&
            msg.content.includes(task.description.slice(0, 100)),
        );
      const taskInfoSnapshot: TaskInfoSnapshot = {
        title: String(task.title || '').trim(),
        description: String(task.description || '').trim(),
        type: String(task.type || '').trim(),
        priority: String(task.priority || '').trim(),
      };
      const fullTaskInfoContent = descAlreadyInHistory
        ? `任务信息:\n标题: ${taskInfoSnapshot.title}\n类型: ${taskInfoSnapshot.type}\n优先级: ${taskInfoSnapshot.priority}`
        : `任务信息:\n标题: ${taskInfoSnapshot.title}\n描述: ${taskInfoSnapshot.description}\n类型: ${taskInfoSnapshot.type}\n优先级: ${taskInfoSnapshot.priority}`;
      const taskInfoContent = await this.resolveSystemContextBlockContent({
        scope: contextScope,
        blockType: 'task-info',
        fullContent: fullTaskInfoContent,
        snapshot: taskInfoSnapshot,
        buildDelta: (previous, current) => this.buildTaskInfoDelta(previous as TaskInfoSnapshot, current as TaskInfoSnapshot),
        deltaPrefix: '任务信息增量更新：',
      });
      if (taskInfoContent) {
        messages.push({
          role: 'system',
          content: taskInfoContent,
          timestamp: new Date(),
        });
      }
    }

    // 5) 注入技能元信息，并按匹配度按需激活技能全文。
    if (enabledSkills.length > 0) {
      const skillLines = enabledSkills
        .map(
          (skill) =>
            `- ${skill.name} (id=${skill.id}, proficiency=${skill.proficiencyLevel}) | description=${skill.description} | tags=${(skill.tags || []).join(', ') || 'N/A'}`,
        )
        .join('\n');

      messages.push({
        role: 'system',
        content:
          `Enabled Skills for this agent:\n${skillLines}\n\n` +
          '以下为技能索引。请按任务上下文激活并严格遵循对应技能方法论。',
        timestamp: new Date(),
      });

      for (const skill of enabledSkills) {
        if (this.shouldActivateSkillContent(skill, task, context)) {
          const loadSkillContentStartAt = Date.now();
          try {
            const skillDoc = await this.skillModel
              .findOne({ id: skill.id }, { content: 1, contentSize: 1 })
              .lean()
              .exec();
            const rawContent = (skillDoc as any)?.content;
            if (rawContent && typeof rawContent === 'string' && rawContent.trim()) {
              const content =
                rawContent.length > SKILL_CONTENT_MAX_INJECT_LENGTH
                  ? rawContent.slice(0, SKILL_CONTENT_MAX_INJECT_LENGTH) +
                    '\n\n[... 内容已截断，可通过工具查询完整版本]'
                  : rawContent;
              messages.push({
                role: 'system',
                content: `【激活技能方法论 - ${skill.name}】\n\n${content}`,
                timestamp: new Date(),
              });
              this.logger.log(
                `[skill_activated] skill=${skill.name} id=${skill.id} contentSize=${rawContent.length} taskType=${task.type}`,
              );
            }
            this.debugTiming(taskId, 'build_messages.load_skill_content', loadSkillContentStartAt, {
              skillId: skill.id,
              skillName: skill.name,
              activated: true,
            });
          } catch (err: any) {
            this.logger.warn(
              `[skill_content_load_failed] skill=${skill.id} error=${err?.message || err}`,
            );
            this.debugTiming(taskId, 'build_messages.load_skill_content_failed', loadSkillContentStartAt, {
              skillId: skill.id,
              skillName: skill.name,
            });
          }
        }
      }
    }

    // 6) 注入已分配工具清单与工具策略提示。
    const loadToolsStartAt = Date.now();
    const allowedToolIds = await this.agentRoleService.getAllowedToolIds(agent);
    const assignedTools = await this.toolService.getToolsByIds(allowedToolIds);
    this.debugTiming(taskId, 'build_messages.load_assigned_tools', loadToolsStartAt, {
      allowedToolCount: allowedToolIds.length,
      assignedToolCount: assignedTools.length,
    });
    if (assignedTools.length > 0) {
      const toolSpecs = assignedTools.map((tool) => {
        const id = (tool as any).canonicalId || normalizeToolId((tool as any).id);
        const name = String(tool.name || '').trim() || 'Unnamed Tool';
        const description = String(tool.description || '').trim() || 'No description';
        return `- ${id} | ${name} | ${description}`;
      });

      messages.push({
        role: 'system',
        content: await this.resolveAgentPromptContent(AGENT_PROMPTS.toolInjectionInstruction, { toolSpecs }),
        timestamp: new Date(),
      });

      const toolPromptMessages = this.buildToolPromptMessages(assignedTools);
      if (toolPromptMessages.length > 0) {
        messages.push({
          role: 'system',
          content: await this.resolveAgentPromptContent(AGENT_PROMPTS.toolStrategyWrapper, {
            toolPromptMessages,
          }),
          timestamp: new Date(),
        });
      }
    }

    // 7) 注入团队上下文，支持多 Agent 协作。
    if (context.teamContext) {
      messages.push({
        role: 'system',
        content: `团队上下文: ${JSON.stringify(context.teamContext)}`,
        timestamp: new Date(),
      });
    }

    // 8) 会议类任务注入会议执行规范模板。
    if (meetingLikeTask) {
      const meetingPolicyStartAt = Date.now();
      const meetingExecutionPolicyTemplate = await this.resolveAgentPromptTemplate(
        AGENT_PROMPTS.defaultMeetingExecutionPolicyPrompt,
      );
      const meetingExecutionPolicy = await this.resolveSystemContextBlockContent({
        scope: contextScope,
        blockType: 'meeting-execution-policy',
        fullContent: meetingExecutionPolicyTemplate.content,
        snapshot: {
          version: 'step2-prompt-registry',
          templateVersion: meetingExecutionPolicyTemplate.version || 'code-default',
          templateSource: meetingExecutionPolicyTemplate.source,
          contentHash: this.hashFingerprint(meetingExecutionPolicyTemplate.content),
        },
      });
      if (meetingExecutionPolicy) {
        messages.push({
          role: 'system',
          content: meetingExecutionPolicy,
          timestamp: new Date(),
        });
      }
      this.debugTiming(taskId, 'build_messages.meeting_execution_policy', meetingPolicyStartAt, {
        templateVersion: meetingExecutionPolicyTemplate.version || 'code-default',
      });
    }

    // 10) 追加历史 system 消息，保持跨轮一致性（跳过本轮已注入的重复内容）。
    const injectedSystemContents = new Set(
      messages
        .filter((message) => message.role === 'system')
        .map((message) => String(message.content || '').trim())
        .filter((content) => content.length > 0),
    );
    const uniquePreviousSystemMessages = previousSystemMessages.filter((message) => {
      const normalized = String(message?.content || '').trim();
      if (!normalized) {
        return false;
      }
      if (injectedSystemContents.has(normalized)) {
        return false;
      }
      injectedSystemContents.add(normalized);
      return true;
    });
    messages.push(...uniquePreviousSystemMessages);

    // 11) 检索任务相关记忆摘要并注入。
    // const memoryContextStartAt = Date.now();
    // const memoryContext = await this.memoService.getTaskMemoryContext(
    //   agent.id || '',
    //   `${task.title}\n${task.description}\n${task.messages?.slice(-1)[0]?.content || ''}`,
    // );
    // this.debugTiming(taskId, 'build_messages.load_task_memory_context', memoryContextStartAt, {
    //   hasMemoryContext: Boolean(memoryContext),
    // });
    // if (memoryContext) {
    //   messages.push({
    //     role: 'system',
    //     content:
    //       `以下是从备忘录中按需检索到的相关记忆（渐进加载摘要）:\n${memoryContext}\n\n` +
    //       '请优先参考这些记忆，并在必要时调用 builtin.sys-mg.internal.memory.search-memo 获取更完整上下文；若有新结论可调用 builtin.sys-mg.internal.memory.append-memo 追加沉淀。',
    //     timestamp: new Date(),
    //   });
    // }

    // 12) 最后追加非 system 历史消息，形成完整上下文。
    messages.push(...previousNonSystemMessages);

    this.debugTiming(taskId, 'build_messages.total', buildStartAt, {
      totalMessages: messages.length,
      meetingLikeTask,
    });

    return messages;
  }

  // ---- private helpers ----

  // 生成工具策略提示，并做去重与稳定排序。
  buildToolPromptMessages(
    assignedTools: Array<{
      id?: string;
      canonicalId?: string;
      prompt?: string;
    }>,
  ): string[] {
    const seen = new Set<string>();
    return assignedTools
      .map((tool) => {
        const toolId = String(tool.canonicalId || tool.id || '').trim();
        const prompt = String(tool.prompt || '').trim();
        return { toolId, prompt };
      })
      .filter((item) => item.toolId && item.prompt)
      .sort((a, b) => a.toolId.localeCompare(b.toolId))
      .map((item) => `工具使用策略（${item.toolId}）:\n${item.prompt}`)
      .filter((message) => {
        if (seen.has(message)) return false;
        seen.add(message);
        return true;
      });
  }

  // 获取 Agent 启用技能：先查缓存，未命中再查库并回填缓存。
  private async getEnabledSkillsForAgent(agent: Agent, agentId: string): Promise<EnabledAgentSkillContext[]> {
    const candidateAgentIds = uniqueStrings([agentId, agent.id || '']);
    if (!candidateAgentIds.length) {
      return [];
    }

    for (const candidateAgentId of candidateAgentIds) {
      const cached = await this.redisService.get(this.agentEnabledSkillCacheKey(candidateAgentId));
      if (!cached) continue;
      try {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed?.items)) {
          return parsed.items as EnabledAgentSkillContext[];
        }
      } catch {
        // ignore cache parse error and fallback to DB
      }
    }

    const agentSkillIds = uniqueStrings((agent.skills || []).filter(Boolean));
    if (!agentSkillIds.length) {
      return [];
    }

    const skills = await this.skillModel
      .find({ id: { $in: agentSkillIds }, status: { $in: ['active', 'experimental'] } })
      .exec();

    const contexts: EnabledAgentSkillContext[] = skills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      tags: skill.tags || [],
      proficiencyLevel: 'beginner',
    }));

    const payload = JSON.stringify({
      agentIds: candidateAgentIds,
      items: contexts,
      updatedAt: new Date().toISOString(),
    });
    await Promise.all(
      candidateAgentIds.map((candidateAgentId) =>
        this.redisService.set(
          this.agentEnabledSkillCacheKey(candidateAgentId),
          payload,
          AGENT_ENABLED_SKILL_CACHE_TTL_SECONDS,
        ),
      ),
    );

    return contexts;
  }

  // 构建启用技能缓存 key。
  private agentEnabledSkillCacheKey(agentId: string): string {
    return `agent:enabled-skills:${agentId}`;
  }

  // 判断是否需要把技能全文注入到本次上下文中。
  private shouldActivateSkillContent(
    skill: EnabledAgentSkillContext,
    task: Task,
    context?: AgentContext,
  ): boolean {
    const meetingLike = isMeetingLikeTask(task, context);
    const taskText = `${task.title || ''} ${task.description || ''} ${task.type || ''}`.toLowerCase();
    const tags = (skill.tags || []).map((t) => t.toLowerCase());
    const skillName = String(skill.name || '').toLowerCase();

    if (meetingLike) {
      const meetingPinnedSkills = ['meeting-resilience', 'meeting-sensitive-planner'];
      if (meetingPinnedSkills.some((signal) => skillName.includes(signal) || tags.some((tag) => tag.includes(signal)))) {
        return true;
      }
    }

    if (task.type && tags.some((tag) => tag.includes(task.type!))) {
      return true;
    }

    if (task.type === 'planning') {
      const planningSignals = ['planning', 'orchestration', 'guard', 'planner'];
      if (tags.some((tag) => planningSignals.some((s) => tag.includes(s)))) {
        return true;
      }
    }

    const skillSignals = [skill.name.toLowerCase(), ...tags];
    let hitCount = 0;
    for (const signal of skillSignals) {
      const words = signal.split(/[\s\-_]+/).filter((w) => w.length >= 3);
      if (words.some((word) => taskText.includes(word))) {
        hitCount++;
      }
      if (hitCount >= 2) return true;
    }

    return false;
  }

  private async buildForcedToolCallInstruction(
    agent: Agent,
    forcedToolCall: NonNullable<AgentExecutorBeforeStepHookResult['forcedToolCall']>,
  ): Promise<string> {
    const renderedFromSkill = await this.renderForcedToolCallInstructionFromSkill(agent, forcedToolCall);
    if (renderedFromSkill) {
      return renderedFromSkill;
    }

    return this.resolveAgentPromptContent(AGENT_PROMPTS.forcedToolCallInstruction, {
      tool: forcedToolCall.tool,
      parametersJson: JSON.stringify(forcedToolCall.parameters || {}),
    });
  }

  private async renderForcedToolCallInstructionFromSkill(
    agent: Agent,
    forcedToolCall: NonNullable<AgentExecutorBeforeStepHookResult['forcedToolCall']>,
  ): Promise<string | null> {
    const skillIds = uniqueStrings((agent.skills || []).filter(Boolean));
    if (!skillIds.length) {
      return null;
    }

    try {
      const skills = await this.skillModel
        .find(
          { id: { $in: skillIds }, status: { $in: ['active', 'experimental'] } },
          { id: 1, name: 1, tags: 1, content: 1 },
        )
        .lean()
        .exec();
      const target = (skills || []).find((skill: any) => {
        const name = String(skill?.name || '').toLowerCase();
        const tags = Array.isArray(skill?.tags) ? skill.tags.map((tag: unknown) => String(tag || '').toLowerCase()) : [];
        const signals = ['forced-action-template', 'forced-tool-call'];
        return signals.some((signal) => name.includes(signal) || tags.some((tag) => tag.includes(signal)));
      }) as any;

      const rawTemplate = String(target?.content || '').trim();
      if (!rawTemplate) {
        return null;
      }

      const truncatedTemplate =
        rawTemplate.length > SKILL_CONTENT_MAX_INJECT_LENGTH
          ? rawTemplate.slice(0, SKILL_CONTENT_MAX_INJECT_LENGTH) + '\n\n[... 内容已截断，可通过工具查询完整版本]'
          : rawTemplate;

      const parametersJson = JSON.stringify(forcedToolCall.parameters || {});
      const rendered = truncatedTemplate
        .replace(/\{\{tool\}\}/g, forcedToolCall.tool)
        .replace(/\{\{parameters\}\}/g, parametersJson)
        .trim();
      if (!rendered) {
        return null;
      }

      return rendered;
    } catch (error) {
      this.logger.warn(
        `[forced_tool_call_skill_template_load_failed] agent=${agent.id || 'unknown'} error=${toLogError(error).message}`,
      );
      return null;
    }
  }

  // 计算系统上下文作用域，用于做分场景指纹缓存。
  private resolveSystemContextScope(
    agent: { id?: string; _id?: { toString?: () => string } },
    task: Task,
    context?: { teamContext?: any },
  ): string {
    const agentId = String(agent.id || agent._id?.toString?.() || 'unknown').trim() || 'unknown';
    const teamContext = context?.teamContext || {};
    const meetingId = String(teamContext?.meetingId || '').trim();
    if (meetingId) {
      return `meeting:${meetingId}:agent:${agentId}`;
    }
    const sessionId = String(teamContext?.sessionId || '').trim();
    if (sessionId) {
      return `session:${sessionId}:agent:${agentId}`;
    }
    const taskId = String(task.id || '').trim();
    if (taskId) {
      return `task:${taskId}:agent:${agentId}`;
    }
    return `ephemeral:${agentId}:${this.hashFingerprint(`${task.title || ''}|${task.type || ''}|${task.teamId || ''}`)}`;
  }

  // 构建系统上下文指纹缓存 key。
  private systemContextFingerprintCacheKey(scope: string, blockType: string): string {
    return `agent:system-context-fingerprint:${scope}:${blockType}`;
  }

  // 计算稳定指纹，用于变更检测。
  private hashFingerprint(input: string): string {
    return createHash('sha256').update(String(input || '')).digest('hex');
  }

  // 根据指纹判断是“全量注入”还是“增量注入”，避免重复发送大段 system 文本。
  private async resolveSystemContextBlockContent(options: {
    scope: string;
    blockType: string;
    fullContent: string;
    snapshot: unknown;
    buildDelta?: (previous: unknown, current: unknown) => string;
    deltaPrefix?: string;
  }): Promise<string | null> {
    const fullContent = String(options.fullContent || '').trim();
    if (!fullContent) {
      return null;
    }

    const normalizedSnapshot = (options.snapshot || {}) as Record<string, unknown>;
    const fingerprint = this.hashFingerprint(JSON.stringify(normalizedSnapshot));
    const key = this.systemContextFingerprintCacheKey(options.scope, options.blockType);
    const nextRecord: SystemContextFingerprintRecord = {
      fingerprint,
      snapshot: normalizedSnapshot,
      updatedAt: new Date().toISOString(),
    };

    try {
      const cached = await this.redisService.get(key);
      if (cached) {
        const parsed = JSON.parse(cached) as SystemContextFingerprintRecord;
        if (parsed?.fingerprint === fingerprint) {
          return null;
        }

        if (options.buildDelta && parsed?.snapshot) {
          const delta = String(options.buildDelta(parsed.snapshot, normalizedSnapshot) || '').trim();
          if (delta) {
            await this.redisService.set(key, JSON.stringify(nextRecord), SYSTEM_CONTEXT_FINGERPRINT_TTL_SECONDS);
            return options.deltaPrefix ? `${options.deltaPrefix}\n${delta}` : delta;
          }
        }
      }

      await this.redisService.set(key, JSON.stringify(nextRecord), SYSTEM_CONTEXT_FINGERPRINT_TTL_SECONDS);
      return fullContent;
    } catch {
      return fullContent;
    }
  }

  // 生成任务信息差异文本。
  buildTaskInfoDelta(previous: TaskInfoSnapshot, current: TaskInfoSnapshot): string {
    const changes: string[] = [];
    if (previous.title !== current.title) {
      changes.push(`- 标题：${previous.title || '（空）'} -> ${current.title || '（空）'}`);
    }
    if (previous.description !== current.description) {
      changes.push(
        `- 描述：${compactLogText(previous.description, 120) || '（空）'} -> ${compactLogText(current.description, 120) || '（空）'}`,
      );
    }
    if (previous.type !== current.type) {
      changes.push(`- 类型：${previous.type || '（空）'} -> ${current.type || '（空）'}`);
    }
    if (previous.priority !== current.priority) {
      changes.push(`- 优先级：${previous.priority || '（空）'} -> ${current.priority || '（空）'}`);
    }
    return changes.join('\n');
  }

  // 生成身份记忆差异文本（新增/更新/移除）。
  private buildIdentityMemoDelta(
    previous: IdentityMemoSnapshotItem[],
    current: IdentityMemoSnapshotItem[],
  ): string {
    const toMap = (items: IdentityMemoSnapshotItem[]) =>
      new Map(items.map((item) => [`${item.title}::${item.topic}`, item]));
    const previousMap = toMap(previous || []);
    const currentMap = toMap(current || []);

    const added: string[] = [];
    const updated: string[] = [];
    const removed: string[] = [];

    for (const [key, next] of currentMap.entries()) {
      const prev = previousMap.get(key);
      const label = next.topic ? `${next.title} (${next.topic})` : next.title;
      if (!prev) {
        added.push(label);
        continue;
      }
      if (prev.contentHash !== next.contentHash) {
        updated.push(label);
      }
    }

    for (const [key, prev] of previousMap.entries()) {
      if (currentMap.has(key)) continue;
      removed.push(prev.topic ? `${prev.title} (${prev.topic})` : prev.title);
    }

    const lines: string[] = [];
    if (added.length) lines.push(`- 新增：${added.join('、')}`);
    if (updated.length) lines.push(`- 更新：${updated.join('、')}`);
    if (removed.length) lines.push(`- 移除：${removed.join('、')}`);
    return lines.join('\n');
  }

  // 记录 OpenCode 运行时解析结果，便于定位来源与配置覆盖。
  private logResolvedOpenCodeRuntime(
    taskId: string,
    mode: AgentExecutionMode,
    runtime: ResolvedOpenCodeRuntime,
  ): void {
    this.logger.log(
      `[opencode_runtime_resolved] taskId=${taskId} mode=${mode} source=${runtime.source} baseUrl=${runtime.baseUrl || 'env'} authEnable=${runtime.authEnable}`,
    );
  }

  // 渲染模板默认内容（代码内置版本）。
  private renderAgentPrompt<TPayload>(
    template: AgentPromptTemplate<TPayload>,
    payload?: TPayload,
  ): string {
    const buildDefaultContent = template.buildDefaultContent as unknown as (input?: TPayload) => string;
    return buildDefaultContent(payload);
  }

  // 解析 Prompt 模板：优先缓存发布版本，失败回退代码默认。
  private async resolveAgentPromptTemplate<TPayload>(
    template: AgentPromptTemplate<TPayload>,
    payload?: TPayload,
  ): Promise<{
    content: string;
    source: 'session_override' | 'db_published' | 'redis_cache' | 'code_default';
    version?: number;
  }> {
    const defaultContent = this.renderAgentPrompt(template, payload);
    try {
      const hasPublishedCache = await this.promptResolverService.hasPublishedCache(template.scene, template.role);
      if (!hasPublishedCache) {
        this.logger.debug(
          `[prompt_resolve_skip] scene=${template.scene} role=${template.role} reason=redis_miss fallback=code_default`,
        );
        return {
          content: defaultContent,
          source: 'code_default',
        };
      }

      return await this.promptResolverService.resolve({
        scene: template.scene,
        role: template.role,
        defaultContent,
        cacheOnly: true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || 'unknown');
      this.logger.warn(
        `[prompt_resolve_failed] scene=${template.scene} role=${template.role} error=${message} fallback=code_default`,
      );
      return {
        content: defaultContent,
        source: 'code_default',
      };
    }
  }

  // 获取模板最终内容（仅返回 content）。
  private async resolveAgentPromptContent<TPayload>(
    template: AgentPromptTemplate<TPayload>,
    payload?: TPayload,
  ): Promise<string> {
    const resolved = await this.resolveAgentPromptTemplate(template, payload);
    return resolved.content;
  }

  // 确保 task 具备运行所需字段（id/messages）。
  private ensureTaskRuntime(task: Task): string {
    const existingTaskId = typeof task?.id === 'string' ? task.id.trim() : '';
    if (existingTaskId) {
      if (!Array.isArray(task.messages)) {
        task.messages = [];
      }
      return existingTaskId;
    }

    const generatedTaskId = `task-${uuidv4()}`;
    task.id = generatedTaskId;
    if (!Array.isArray(task.messages)) {
      task.messages = [];
    }
    this.logger.warn(`[task_id_missing] generatedTaskId=${generatedTaskId} title="${compactLogText(task.title)}"`);
    return generatedTaskId;
  }

  private buildExecutionData(
    agent: Agent,
    routeDecision: { taskType: string; source: string; openCodeExecutionConfig: OpenCodeExecutionConfig | null },
    executionChannel: AgentExecutionChannel,
    mode?: 'streaming',
  ): Record<string, unknown> {
    const executionDataBase: Record<string, unknown> = {
      taskType: routeDecision.taskType,
      routeSource: routeDecision.source,
      modelProvider: agent.model?.provider,
      modelId: agent.model?.id,
      modelName: agent.model?.name,
      model: agent.model?.model,
      openCode: {
        enabled: Boolean(routeDecision.openCodeExecutionConfig),
        strictExecution: executionChannel === 'opencode',
        selected: executionChannel === 'opencode',
        projectDirectory: routeDecision.openCodeExecutionConfig?.projectDirectory,
        endpoint: routeDecision.openCodeExecutionConfig?.endpoint,
        endpointRef: routeDecision.openCodeExecutionConfig?.endpointRef,
        authEnable: routeDecision.openCodeExecutionConfig?.authEnable,
        taskRouting: routeDecision.openCodeExecutionConfig?.taskRouting,
        modelPolicy: routeDecision.openCodeExecutionConfig?.modelPolicy,
      },
    };
    if (!mode) {
      return executionDataBase;
    }
    return {
      mode,
      ...executionDataBase,
    };
  }

  private createResolveCustomApiKeyHandler(
    agent: Agent,
    taskId: string,
    timingStage: string,
  ): (logPrefix: 'task' | 'stream_task') => Promise<string | undefined> {
    return async (logPrefix) => {
      const resolveApiKeyStartAt = Date.now();
      const customApiKey = await this.resolveCustomApiKey(agent, taskId, logPrefix);
      this.debugTiming(taskId, timingStage, resolveApiKeyStartAt, {
        keySource: customApiKey ? 'custom' : 'system',
      });
      return customApiKey;
    };
  }

  private appendAssistantMessage(
    task: Task,
    content: string,
    agent: Agent,
    enabledSkills: EnabledAgentSkillContext[],
  ): void {
    task.messages.push({
      role: 'assistant',
      content,
      timestamp: new Date(),
      metadata: {
        agentId: agent.id,
        agentName: agent.name,
        usedSkillIds: enabledSkills.map((item) => item.id),
        usedSkillNames: enabledSkills.map((item) => item.name),
        usedSkills: enabledSkills.map((item) => ({
          id: item.id,
          name: item.name,
          proficiencyLevel: item.proficiencyLevel,
        })),
      },
    });
  }

  private isControlInterruptedError(message: string): boolean {
    const normalizedError = String(message || '').toLowerCase();
    return (
      normalizedError.includes('cancelled') ||
      normalizedError.includes('paused') ||
      normalizedError.includes('already completed')
    );
  }

  // 异步执行 memo 操作并统一记录成功/失败日志，不抛出主流程异常。
  private runMemoOperation(label: string, taskId: string, operation: () => Promise<void>): void {
    const startedAt = Date.now();
    void operation()
      .then(() => {
        this.logger.log(`[memo_op_success] taskId=${taskId} label=${label} durationMs=${Date.now() - startedAt}`);
      })
      .catch((error) => {
        const logError = toLogError(error);
        this.logger.warn(
          `[memo_op_failed] taskId=${taskId} label=${label} durationMs=${Date.now() - startedAt} error=${logError.message}`,
        );
      });
  }

  // 解析 Agent 自定义 API Key；不可用时回退系统 Key。
  private async resolveCustomApiKey(
    agent: { apiKeyId?: string; name: string },
    taskId: string,
    logPrefix: 'task' | 'stream_task',
  ): Promise<string | undefined> {
    if (!agent.apiKeyId) {
      return undefined;
    }

    const customApiKey = await this.apiKeyService.getDecryptedKey(agent.apiKeyId);
    if (customApiKey) {
      this.logger.log(`[${logPrefix}_api_key] taskId=${taskId} agent=${agent.name} source=custom`);
      await this.apiKeyService.recordUsage(agent.apiKeyId);
      return customApiKey;
    }

    this.logger.warn(`[${logPrefix}_api_key] taskId=${taskId} agent=${agent.name} customApiKeyNotAvailable fallback=system`);
    return undefined;
  }

  private readEnvBoolean(name: string, fallback: boolean): boolean {
    const value = String(process.env[name] || '').trim().toLowerCase();
    if (!value) {
      return fallback;
    }
    if (['1', 'true', 'yes', 'on'].includes(value)) {
      return true;
    }
    if (['0', 'false', 'no', 'off'].includes(value)) {
      return false;
    }
    return fallback;
  }

  // 获取工具调用最大轮次，优先环境变量配置。
  private getMaxToolRounds(): number {
    const configuredRounds = Number(process.env.MAX_TOOL_ROUNDS);
    if (Number.isFinite(configuredRounds) && configuredRounds > 0) {
      return Math.floor(configuredRounds);
    }
    return DEFAULT_MAX_TOOL_ROUNDS;
  }

  // 抽取工具执行结果中的 data 载荷，统一返回结构。
  private extractToolResultPayload(execution: any): any {
    const result = execution?.result;
    if (result && typeof result === 'object' && 'data' in result) {
      return result.data;
    }
    return result || {};
  }
}
