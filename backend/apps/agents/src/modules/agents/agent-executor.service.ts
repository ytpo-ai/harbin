import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

import { RedisService } from '@libs/infra';
import { DebugTimingProvider } from '@libs/common';
import { CollaborationContext, CollaborationContextFactory } from '@libs/contracts';
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
import { RuntimePersistenceService } from '@agent/modules/runtime/runtime-persistence.service';
import { AgentRunScoreService } from '@agent/modules/runtime/agent-run-score.service';
import { HookPipelineService } from '@agent/modules/runtime/hooks/hook-pipeline.service';
import { LifecycleHookContext } from '@agent/modules/runtime/hooks/lifecycle-hook.types';
import { TaskExecutionScorer } from '@agent/modules/runtime/task-execution-scorer';
import { ToolService } from '@agent/modules/tools/tool.service';
import { Skill, SkillDocument } from '@agent/schemas/agent-skill.schema';
import { ContextAssemblerService } from './context/context-assembler.service';
import { ContextFingerprintService } from './context/context-fingerprint.service';
import { ContextStrategyService } from './context/context-strategy.service';

import {
  GET_TOOL_SCHEMA_TOOL_ID,
  DEFAULT_MAX_TOOL_ROUNDS,
  SKILL_CONTENT_MAX_INJECT_LENGTH,
  AGENT_ENABLED_SKILL_CACHE_TTL_SECONDS,
  normalizeToolId,
  uniqueStrings,
  compactLogText,
  toLogError,
} from './agent.constants';
import { TERMINAL_TOOL_IDS } from '@agent/modules/tools/builtin-tool-catalog';
import { AgentExecutorRuntimeService } from './agent-executor-runtime.service';
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
  buildToolSchemaHint,
  buildToolInputRepairInstruction,
  extractToolCall,
  extractAllToolCalls,
  isMeaninglessAssistantResponse,
  isMeetingLikeTask,
  isModelTimeoutError,
  getToolInputPreflightError,
  isToolInputErrorMessage,
  resolveResponseFormatFromCollaborationContext,
  hasEffectiveSchema,
  shouldRetryGenerationError,
  stripToolCallMarkup,
} from './agent-executor.helpers';
import { ScenarioType } from './context/context-block-builder.interface';
import {
  AgentContext,
  ExecuteTaskResult,
  EnabledAgentSkillContext,
} from './agent.types';

const DEFAULT_OPENCODE_TASK_TYPES = new Set([
  'code',
  'coding',
  'development.plan',
  'development.exec',
  'development.review',
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

  private debugTiming(taskId: string, stage: string, startedAt: number, extras?: Record<string, unknown>): void {
    this.debugTimingProvider.log({
      traceId: taskId,
      stage,
      startedAt,
      extras,
      traceFieldName: 'taskId',
    });
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
    private readonly runtimePersistence: RuntimePersistenceService,
    private readonly agentRunScoreService: AgentRunScoreService,
    private readonly runtimeEiSyncService: RuntimeEiSyncService,
    private readonly openCodeExecutionService: OpenCodeExecutionService,
    private readonly redisService: RedisService,
    private readonly agentExecutorRuntimeService: AgentExecutorRuntimeService,
    private readonly beforeStepOptimizationHook: AgentBeforeStepOptimizationHook,
    private readonly afterStepEvaluationHook: AgentAfterStepEvaluationHook,
    private readonly agentExecutorEngineRouter: AgentExecutorEngineRouter,
    private readonly agentOpenCodePolicyService: AgentOpenCodePolicyService,
    private readonly agentRoleService: AgentRoleService,
    private readonly promptResolverService: PromptResolverService,
    private readonly hookPipeline: HookPipelineService,
    private readonly contextAssembler: ContextAssemblerService,
    private readonly contextFingerprintService: ContextFingerprintService,
    private readonly contextStrategyService: ContextStrategyService,
    private readonly debugTimingProvider: DebugTimingProvider,
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
    const runtimeAgentId = this.agentExecutorRuntimeService.resolveRuntimeAgentId(agent as any, agentId);
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
      `[task_context] taskId=${taskId} previousMessages=${task.messages?.length || 0} hasCollaborationContext=${Boolean(context?.collaborationContext)}`,
    );

    const agentContext: AgentContext = {
      task,
      previousMessages: task.messages || [],
      workingMemory: new Map(),
      collaborationContext: context?.collaborationContext,
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
      const modelConfig = this.agentExecutorRuntimeService.buildModelConfig(agent.model as any);
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
      await this.agentExecutorRuntimeService.completeRuntimeExecution(runtimeContext, runtimeAgentId, taskId, response);
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
        await this.agentExecutorRuntimeService.failRuntimeExecution(runtimeContext, runtimeAgentId, taskId, logError.message);
        await this.runtimeEiSyncService.scheduleRunSync(runtimeContext.runId);
      }
      throw error;
    } finally {
      // 无论成功失败均释放 runtime 资源，避免占用泄漏。
      await this.agentExecutorRuntimeService.releaseRuntimeExecution(runtimeContext);
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
    const runtimeAgentId = this.agentExecutorRuntimeService.resolveRuntimeAgentId(agent as any, agentId);
    this.logger.log(
      `[stream_task_start] agent=${agent.name} agentId=${runtimeAgentId} taskId=${taskId} title="${compactLogText(task.title)}" modelId=${agent.model?.id || 'unknown'} provider=${agent.model?.provider || 'unknown'}`,
    );

    const agentContext: AgentContext = {
      task,
      previousMessages: task.messages || [],
      workingMemory: new Map(),
      collaborationContext: context?.collaborationContext,
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
      const modelConfig = this.agentExecutorRuntimeService.buildModelConfig(agent.model as any);
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

      await this.agentExecutorRuntimeService.completeRuntimeExecution(runtimeContext, runtimeAgentId, taskId, fullResponse);
      await this.runtimeEiSyncService.scheduleRunSync(runtimeContext.runId);
    } catch (error) {
      const logError = toLogError(error);
      this.logger.error(
        `[stream_task_failed] agent=${agent.name} taskId=${taskId} durationMs=${Date.now() - taskStartAt} tokenChunks=${tokenChunks} error=${logError.message}`,
        logError.stack,
      );
      const controlInterrupted = this.isControlInterruptedError(logError.message);
      if (!controlInterrupted) {
        await this.agentExecutorRuntimeService.failRuntimeExecution(runtimeContext, runtimeAgentId, taskId, logError.message);
        await this.runtimeEiSyncService.scheduleRunSync(runtimeContext.runId);
      }
      throw error;
    } finally {
      // 释放流式 runtime 资源。
      await this.agentExecutorRuntimeService.releaseRuntimeExecution(runtimeContext);
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
        }).then((result) => result.response),
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
    const runtimeContext = await this.agentExecutorRuntimeService.startRuntimeExecution({
      runtimeAgentId: input.runtimeAgentId,
      agentName: input.agent.name,
      task: input.task,
      messages,
      mode: config.mode,
      roleCode,
      executionChannel,
      executionData,
      collaborationContext: input.context?.collaborationContext,
      sessionContext: input.context?.sessionContext as { sessionId?: string; [key: string]: unknown } | undefined,
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
      collaborationContext?: CollaborationContext | Record<string, unknown>;
      actor?: {
        employeeId?: string;
        role?: string;
      };
      taskType?: string;
      teamId?: string;
      preactivatedToolIds?: string[];
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
    let plannerTextOnlyRetryUsed = false;
    const emptyMeetingResponseFallback = await this.resolveAgentPromptContent(AGENT_PROMPTS.emptyMeetingResponseFallback);
    const generationErrorRetryPrompt = meetingLike
      ? await this.resolveAgentPromptContent(AGENT_PROMPTS.generationErrorRetryInstruction)
      : '';
    const emptyResponseRetryPrompt = meetingLike
      ? await this.resolveAgentPromptContent(AGENT_PROMPTS.emptyResponseRetryInstruction)
      : '';
    const toolRoundLimitMessage = await this.resolveAgentPromptContent(AGENT_PROMPTS.toolRoundLimitMessage);
    const initialSystemMessageCount = messages.filter((message) => message.role === 'system').length;
    const scorer = new TaskExecutionScorer();
    const schemaInjectedToolIds = new Set<string>();

    const preactivatedToolIds = this.extractPreactivatedToolIds(executionContext);
    for (const toolId of preactivatedToolIds) {
      const inputContract = await this.toolService.getToolInputContract(toolId);
      if (inputContract?.schema && hasEffectiveSchema(inputContract.schema)) {
        const schemaHint = buildToolSchemaHint(toolId, inputContract.schema);
        if (schemaHint) {
          messages.push({
            role: 'system',
            content: schemaHint,
            timestamp: new Date(),
          });
          schemaInjectedToolIds.add(toolId);
        }
      }
    }

    const persistIntermediateSystemMessage = async (
      round: number,
      offset: number,
      content: string,
      metadata: Record<string, unknown>,
    ): Promise<void> => {
      if (!runtimeContext?.sessionId) {
        return;
      }
      try {
        await this.runtimePersistence.createMessage({
          runId: runtimeContext.runId,
          agentId: agentRuntimeId,
          sessionId: runtimeContext.sessionId,
          taskId: task.id,
          role: 'system',
          sequence: this.computeIntermediateSystemSequence(initialSystemMessageCount, round, offset),
          content,
          status: 'completed',
          metadata,
        });
      } catch (error) {
        const logError = toLogError(error);
        this.logger.warn(
          `[persist_intermediate_system_message_failed] agent=${agent.name} taskId=${task.id} round=${round + 1} error=${logError.message}`,
        );
      }
    };

    const persistStepMessage = async (input: {
      round: number;
      response: string;
      finish: 'stop' | 'tool-calls' | 'error' | 'cancelled' | 'paused' | 'max-rounds';
      parts: Array<{
        type: 'text' | 'reasoning' | 'tool_call' | 'tool_result' | 'system_event' | 'step_start' | 'step_finish';
        status: 'pending' | 'running' | 'completed' | 'error' | 'cancelled';
        content?: string;
        input?: unknown;
        output?: unknown;
        toolId?: string;
        toolCallId?: string;
        metadata?: Record<string, unknown>;
        error?: string;
        startedAt?: Date;
        endedAt?: Date;
      }>;
      usage?: {
        inputTokens: number;
        outputTokens: number;
        reasoningTokens?: number;
        cacheRead?: number;
        cacheWrite?: number;
        totalTokens: number;
      };
      cost?: number;
      stepStartAt: Date;
      stepEndAt: Date;
    }): Promise<void> => {
      if (!runtimeContext?.sessionId) {
        return;
      }

      const normalizedTokens = input.usage
        ? {
            input: input.usage.inputTokens,
            output: input.usage.outputTokens,
            reasoning: input.usage.reasoningTokens,
            cacheRead: input.usage.cacheRead,
            cacheWrite: input.usage.cacheWrite,
            total: input.usage.totalTokens,
          }
        : undefined;

      const stepParts = [
        {
          sequence: 1,
          type: 'step_start' as const,
          status: 'completed' as const,
          metadata: {
            round: input.round,
            taskId: task.id,
            taskType: task.type,
          },
          startedAt: input.stepStartAt,
          endedAt: input.stepStartAt,
        },
        ...input.parts.map((part, index) => ({
          sequence: index + 2,
          ...part,
          startedAt: part.startedAt || input.stepStartAt,
          endedAt: part.endedAt || input.stepEndAt,
        })),
        {
          sequence: input.parts.length + 2,
          type: 'step_finish' as const,
          status: input.finish === 'error' ? ('error' as const) : ('completed' as const),
          metadata: {
            finish: input.finish,
            tokens: normalizedTokens,
            cost: input.cost,
          },
          startedAt: input.stepEndAt,
          endedAt: input.stepEndAt,
        },
      ];

      await this.runtimePersistence.bulkCreateMessageWithParts(
        {
          runId: runtimeContext.runId,
          agentId: agentRuntimeId,
          sessionId: runtimeContext.sessionId,
          taskId: task.id,
          role: 'assistant',
          sequence: initialSystemMessageCount + input.round + 2,
          content: input.response,
          status: input.finish === 'error' ? 'error' : 'completed',
          parentMessageId: runtimeContext.userMessageId,
          modelID: modelConfig.id,
          providerID: modelConfig.provider,
          finish: input.finish,
          tokens: normalizedTokens,
          cost: input.cost,
          stepIndex: input.round,
          metadata: {
            source: 'agent.executeWithToolCalling',
            round: input.round,
            taskType: task.type,
          },
        },
        stepParts,
      );
    };

    try {
      // 多轮循环：模型 -> 解析工具调用 -> 执行工具 -> 回灌结果。
      for (let round = 0; round <= maxToolRounds; round++) {
        scorer.markRound(round);
      if (runtimeContext) {
        await this.runtimeOrchestrator.assertRunnable(runtimeContext.runId);
      }
      let response = '';
      let usage: {
        inputTokens: number;
        outputTokens: number;
        reasoningTokens?: number;
        cacheRead?: number;
        cacheWrite?: number;
        totalTokens: number;
      } | undefined;
      let cost: number | undefined;
      const stepParts: Array<{
        type: 'text' | 'reasoning' | 'tool_call' | 'tool_result' | 'system_event' | 'step_start' | 'step_finish';
        status: 'pending' | 'running' | 'completed' | 'error' | 'cancelled';
        content?: string;
        input?: unknown;
        output?: unknown;
        toolId?: string;
        toolCallId?: string;
        metadata?: Record<string, unknown>;
        error?: string;
        startedAt?: Date;
        endedAt?: Date;
      }> = [];
      let intermediateSystemOffset = 1;
      const stepStartedAt = new Date();
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
        await persistStepMessage({
          round,
          response: beforeStepHookResult.cancelReason || 'cancelled_by_before_step_hook',
          finish: 'cancelled',
          parts: [
            {
              type: 'system_event',
              status: 'cancelled',
              content: 'before_step_hook_cancel',
              error: beforeStepHookResult.cancelReason,
            },
          ],
          stepStartAt: stepStartedAt,
          stepEndAt: new Date(),
        });
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
        await persistStepMessage({
          round,
          response: beforeStepHookResult.pauseReason || 'paused_by_before_step_hook',
          finish: 'paused',
          parts: [
            {
              type: 'system_event',
              status: 'cancelled',
              content: 'before_step_hook_pause',
              error: beforeStepHookResult.pauseReason,
            },
          ],
          stepStartAt: stepStartedAt,
          stepEndAt: new Date(),
        });
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
        const responseFormat = resolveResponseFormatFromCollaborationContext(executionContext?.collaborationContext, modelConfig);
        const modelResult = await this.modelService.chat(modelConfig.id, messages, {
          temperature: modelConfig.temperature,
          maxTokens: modelConfig.maxTokens,
          ...(responseFormat ? { responseFormat } : {}),
        });
        response = modelResult.response;
        usage = modelResult.usage;
        cost = modelResult.cost;
        this.logger.log(
          `[tool_round_response] agent=${agent.name} taskId=${task.id} round=${round + 1} durationMs=${Date.now() - roundStartAt} responseLength=${response.length}`,
        );
      } catch (error) {
        if (shouldRetryGenerationError(error)) {
          scorer.deduct('D12', round, {
            detail: toLogError(error).message,
          });
        }
        if (isModelTimeoutError(error)) {
          this.logger.warn(
            `[tool_round_timeout] agent=${agent.name} taskId=${task.id} round=${round + 1} durationMs=${Date.now() - roundStartAt}`,
          );
          await persistStepMessage({
            round,
            response: '当前模型请求超时（上游响应过慢）。请稍后重试，或将问题拆小后再试。',
            finish: 'error',
            parts: [
              {
                type: 'system_event',
                status: 'error',
                content: 'model_timeout',
                error: 'model_timeout',
              },
            ],
            usage,
            cost,
            stepStartAt: stepStartedAt,
            stepEndAt: new Date(),
          });
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
          await persistStepMessage({
            round,
            response: generationErrorRetryPrompt,
            finish: 'tool-calls',
            parts: [
              {
                type: 'system_event',
                status: 'completed',
                content: 'generation_error_retry',
                error: toLogError(error).message,
              },
            ],
            usage,
            cost,
            stepStartAt: stepStartedAt,
            stepEndAt: new Date(),
          });
          continue;
        }
        if (meetingLike && shouldRetryGenerationError(error)) {
          await persistStepMessage({
            round,
            response: emptyMeetingResponseFallback,
            finish: 'error',
            parts: [
              {
                type: 'system_event',
                status: 'error',
                content: 'generation_error_fallback',
                error: toLogError(error).message,
              },
            ],
            usage,
            cost,
            stepStartAt: stepStartedAt,
            stepEndAt: new Date(),
          });
          return emptyMeetingResponseFallback;
        }
        throw error;
      }

      // 若未识别到工具调用，则尝试返回最终答案。
      const toolCalls = extractAllToolCalls(response);
      if (toolCalls.length === 0 && /<tool_call>/i.test(response)) {
        scorer.deduct('D7', round);
        // LLM 输出了 <tool_call> 标签但 JSON 解析失败，记录警告便于排查
        this.logger.warn(
          `[tool_call_parse_failed] agent=${agent.name} taskId=${task.id} round=${round + 1} responseLen=${response.length} preview=${JSON.stringify(response.slice(0, 500))}`,
        );
      }
      // 每轮只执行第一个 tool_call（后续调用的参数可能依赖前一个的输出，
      // LLM 生成时还没看到结果，参数不可靠）。丢弃后续 tool_call 并通知 LLM。
      const toolCall = toolCalls.length > 0 ? toolCalls[0] : null;
      const droppedToolCalls = toolCalls.length > 1 ? toolCalls.slice(1) : [];
      if (droppedToolCalls.length > 0) {
        for (const droppedToolCall of droppedToolCalls) {
          scorer.deduct('D2', round, {
            toolId: normalizeToolId(droppedToolCall.tool),
            detail: `executed=${toolCall?.tool} dropped=${droppedToolCall.tool}; 每轮只能输出一个 tool_call`,
          });
        }
        this.logger.log(
          `[multi_tool_call_dropped] agent=${agent.name} taskId=${task.id} round=${round + 1} executed=${toolCall?.tool} dropped=${droppedToolCalls.map((t) => t.tool).join(',')}`,
        );
      }
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
          await persistStepMessage({
            round,
            response,
            finish: 'cancelled',
            parts: [
              {
                type: 'system_event',
                status: 'cancelled',
                content: 'after_step_hook_cancel',
                error: afterStepHookResult.cancelReason,
              },
            ],
            usage,
            cost,
            stepStartAt: stepStartedAt,
            stepEndAt: new Date(),
          });
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
          await persistStepMessage({
            round,
            response,
            finish: 'paused',
            parts: [
              {
                type: 'system_event',
                status: 'cancelled',
                content: 'after_step_hook_pause',
                error: afterStepHookResult.pauseReason,
              },
            ],
            usage,
            cost,
            stepStartAt: stepStartedAt,
            stepEndAt: new Date(),
          });
          await this.runtimeOrchestrator.pauseRunWithActor(runtimeContext.runId, {
            actorId: 'lifecycle-hook',
            actorType: 'system',
            reason: afterStepHookResult.pauseReason || 'paused_by_after_step_hook',
          });
          throw new Error(`Runtime run paused by hook: ${afterStepHookResult.pauseReason || 'after_step_hook'}`);
        }

        // hook 请求重试当前 step：不返回结果，继续下一轮循环
        if (afterStepHookResult.retryRequested) {
          if (afterStepHookResult.decision === 'inject_instruction') {
            scorer.deduct('D8', round);
          }
          this.logger.log(`[after_step_hook_retry] agent=${agent.name} taskId=${task.id} round=${round + 1}`);
          if (afterStepHookResult.appendSystemMessages.length > 0) {
            for (const instruction of afterStepHookResult.appendSystemMessages) {
              messages.push({ role: 'system', content: instruction, timestamp: new Date() });
            }
          }
          stepParts.push({
            type: 'system_event',
            status: 'completed',
            content: 'after_step_hook_retry',
          });
          await persistStepMessage({
            round,
            response,
            finish: 'tool-calls',
            parts: stepParts,
            usage,
            cost,
            stepStartAt: stepStartedAt,
            stepEndAt: new Date(),
          });
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
          stepParts.push({
            type: 'system_event',
            status: 'completed',
            content: 'after_step_hook_inject_instruction',
            metadata: {
              injectedCount: afterStepHookResult.appendSystemMessages.length,
            },
          });
          await persistStepMessage({
            round,
            response,
            finish: 'tool-calls',
            parts: stepParts,
            usage,
            cost,
            stepStartAt: stepStartedAt,
            stepEndAt: new Date(),
          });
          continue;
        }

        let cleaned = stripToolCallMarkup(response);
        // 防御：stripToolCallMarkup 删除了 <tool_call> 标签后内容变空，
        // 但原始 response 有内容 — 回退保留原始文本避免信息丢失
        if (!cleaned && response.trim().length > 0) {
          this.logger.warn(
            `[strip_markup_empty_fallback] agent=${agent.name} taskId=${task.id} round=${round + 1} originalLen=${response.length}`,
          );
          cleaned = response.replace(/<\/?tool_call>/gi, '').trim();
        }
        stepParts.push({
          type: 'text',
          status: 'completed',
          content: cleaned,
        });

        // Orchestration planner 纯文本 retry：
        // 当 roleInPlan 以 planner 开头（planner / planner_initialize / planner_pre_execution / planner_post_execution）时，
        // planner 被明确要求输出 <tool_call>，但返回了纯文本（确认性文本 / phaseInitialize 输出等）。
        // 仅 retry 一次，注入强制工具调用指令。
        if (!plannerTextOnlyRetryUsed && this.isPlannerTextOnlyRetryNeeded(cleaned, executionContext)) {
          const retryRoleInPlan = String(
            ((executionContext?.collaborationContext || {}) as Record<string, unknown>).roleInPlan || '',
          ).trim();
          scorer.deduct('D9', round, {
            detail: `roleInPlan=${retryRoleInPlan}; 输出纯文本而非 tool_call: "${cleaned.slice(0, 80)}"`,
          });
          plannerTextOnlyRetryUsed = true;
          this.logger.warn(
            `[planner_text_only_retry] agent=${agent.name} taskId=${task.id} round=${round + 1} roleInPlan=${retryRoleInPlan} responsePreview=${JSON.stringify(cleaned.slice(0, 120))}`,
          );
          const retryInstruction = retryRoleInPlan === 'planner_initialize'
            ? [
                '【系统纠正 — phaseInitialize 阶段】你刚才输出了纯文本，但当前是 phaseInitialize 阶段，要求你输出 <tool_call> 工具调用。',
                '请严格按照用户指令中的"工具调用序列"继续执行尚未完成的工具调用。',
                '严禁调用 submit-task、get-plan，严禁输出确认性文本。',
                '如果所有工具调用已完成（outline 和 taskContext 均已通过 plan-initialize 写入），直接回复"phaseInitialize completed"即可，不需要输出 JSON。',
              ].join('\n')
            : [
                '【系统纠正】你刚才输出了纯文本，但本阶段要求你输出 <tool_call> 工具调用。',
                '请立即输出 <tool_call> 标签调用工具，不要输出任何其他文本。',
                '回顾上方的用户指令，按要求执行工具调用。',
              ].join('\n');
          messages.push({
            role: 'system',
            content: retryInstruction,
            timestamp: new Date(),
          });
          await persistIntermediateSystemMessage(
            round,
            intermediateSystemOffset++,
            retryInstruction,
            { source: 'tool-calling-loop.planner-text-only-retry' },
          );
          stepParts.push({
            type: 'system_event',
            status: 'completed',
            content: 'planner_text_only_retry',
          });
          await persistStepMessage({
            round,
            response: cleaned,
            finish: 'tool-calls',
            parts: stepParts,
            usage,
            cost,
            stepStartAt: stepStartedAt,
            stepEndAt: new Date(),
          });
          continue;
        }

        if (isMeaninglessAssistantResponse(cleaned)) {
          scorer.deduct('D10', round);
        }

        if (meetingLike && isMeaninglessAssistantResponse(cleaned)) {
          if (!emptyResponseRetryUsed) {
            emptyResponseRetryUsed = true;
            messages.push({
              role: 'system',
              content: emptyResponseRetryPrompt,
              timestamp: new Date(),
            });
            await persistIntermediateSystemMessage(
              round,
              intermediateSystemOffset++,
              emptyResponseRetryPrompt,
              { source: 'tool-calling-loop.empty-response-retry' },
            );
            stepParts.push({
              type: 'system_event',
              status: 'completed',
              content: 'empty_response_retry',
            });
            await persistStepMessage({
              round,
              response: cleaned,
              finish: 'tool-calls',
              parts: stepParts,
              usage,
              cost,
              stepStartAt: stepStartedAt,
              stepEndAt: new Date(),
            });
            continue;
          }
          await persistStepMessage({
            round,
            response: emptyMeetingResponseFallback,
            finish: 'stop',
            parts: [
              ...stepParts,
              {
                type: 'system_event',
                status: 'completed',
                content: 'empty_response_fallback',
              },
            ],
            usage,
            cost,
            stepStartAt: stepStartedAt,
            stepEndAt: new Date(),
          });
          return emptyMeetingResponseFallback;
        }
        await persistStepMessage({
          round,
          response: cleaned,
          finish: 'stop',
          parts: stepParts,
          usage,
          cost,
          stepStartAt: stepStartedAt,
          stepEndAt: new Date(),
        });
        return cleaned;
      }

      messages.push({
        role: 'assistant',
        content: response,
        timestamp: new Date(),
      });

      const normalizedToolCallId = normalizeToolId(toolCall.tool);
        const isMetaTool = normalizedToolCallId === GET_TOOL_SCHEMA_TOOL_ID;
        if (scorer.lastToolId === normalizedToolCallId && !isMetaTool) {
          scorer.deduct('D3', round, {
            toolId: normalizedToolCallId,
            detail: `round ${round} 与 round ${round - 1} 连续调用 ${normalizedToolCallId}`,
          });
        }
        scorer.trackToolCall(normalizedToolCallId);
        stepParts.push({
          type: 'tool_call',
          status: 'completed',
          toolId: normalizedToolCallId,
          input: toolCall.parameters,
        });
        // 工具权限校验：未授权工具直接驳回并提示模型改写。
        if (!assignedToolIds.has(normalizedToolCallId)) {
          scorer.deduct('D6', round, {
            toolId: normalizedToolCallId,
          });
          this.logger.warn(
            `[tool_denied] agent=${agent.name} taskId=${task.id} round=${round + 1} tool=${normalizedToolCallId}`,
          );
          const toolDeniedInstruction = await this.resolveAgentPromptContent(AGENT_PROMPTS.toolDeniedInstruction, {
            normalizedToolId: normalizedToolCallId,
          });
          messages.push({
            role: 'system',
            content: toolDeniedInstruction,
            timestamp: new Date(),
          });
          await persistIntermediateSystemMessage(
            round,
            intermediateSystemOffset++,
            toolDeniedInstruction,
            {
              source: 'tool-calling-loop.tool-denied',
              toolId: normalizedToolCallId,
            },
          );
          stepParts.push({
            type: 'system_event',
            status: 'error',
            content: 'tool_denied',
            error: normalizedToolCallId,
          });
          await persistStepMessage({
            round,
            response,
            finish: 'tool-calls',
            parts: stepParts,
            usage,
            cost,
            stepStartAt: stepStartedAt,
            stepEndAt: new Date(),
          });
          continue;
        }

        const inputContract = await this.toolService.getToolInputContract(normalizedToolCallId);
        const preflightInputError = getToolInputPreflightError(inputContract?.schema, toolCall.parameters);
        if (preflightInputError && inputContract?.schema) {
          const schemaHint = buildToolSchemaHint(normalizedToolCallId, inputContract.schema);
          const seenSchemaBefore = schemaInjectedToolIds.has(normalizedToolCallId);
          if (seenSchemaBefore) {
            scorer.deduct('D1', round, {
              toolId: normalizedToolCallId,
              detail: preflightInputError,
            });
          }
          this.logger.warn(
            `[tool_input_preflight_failed] agent=${agent.name} taskId=${task.id} round=${round + 1} tool=${normalizedToolCallId} error=${preflightInputError}`,
          );
          if (!seenSchemaBefore && schemaHint) {
            messages.push({
              role: 'system',
              content: schemaHint,
              timestamp: new Date(),
            });
            await persistIntermediateSystemMessage(
              round,
              intermediateSystemOffset++,
              schemaHint,
              {
                source: 'tool-calling-loop.tool-schema-injected',
                toolId: normalizedToolCallId,
              },
            );
            schemaInjectedToolIds.add(normalizedToolCallId);
          }
          const toolInputRepairInstruction = buildToolInputRepairInstruction(
            normalizedToolCallId,
            inputContract.schema,
            toolCall.parameters || {},
            preflightInputError,
          );
          messages.push({
            role: 'system',
            content: toolInputRepairInstruction,
            timestamp: new Date(),
          });
          await persistIntermediateSystemMessage(
            round,
            intermediateSystemOffset++,
            toolInputRepairInstruction,
            {
              source: seenSchemaBefore
                ? 'tool-calling-loop.tool-input-preflight-failed'
                : 'tool-calling-loop.tool-input-preflight-first-fail',
              toolId: normalizedToolCallId,
            },
          );
          stepParts.push({
            type: 'system_event',
            status: 'error',
            content: 'tool_input_preflight_failed',
            error: preflightInputError,
          });
          await persistStepMessage({
            round,
            response,
            finish: 'tool-calls',
            parts: stepParts,
            usage,
            cost,
            stepStartAt: stepStartedAt,
            stepEndAt: new Date(),
          });
          continue;
        }
        schemaInjectedToolIds.add(normalizedToolCallId);

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
          const toolExecutionContext =
            normalizedToolCallId === GET_TOOL_SCHEMA_TOOL_ID
              ? {
                ...(executionContext || {}),
                assignedToolIds: Array.from(assignedToolIds),
              }
              : executionContext;
          const execution = await this.toolService.executeTool(
            normalizedToolCallId,
            agentRuntimeId,
            toolCall.parameters,
            task.id,
            toolExecutionContext,
          );
          scorer.trackToolSuccess();
          if (normalizedToolCallId === GET_TOOL_SCHEMA_TOOL_ID) {
            const queriedToolId = normalizeToolId(String(toolCall.parameters?.toolId || ''));
            if (queriedToolId) {
              schemaInjectedToolIds.add(queriedToolId);
            }
          }
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

          stepParts.push({
            type: 'tool_result',
            status: 'completed',
            toolId: normalizedToolCallId,
            toolCallId,
            output: toolResultPayload,
          });

          // 终态工具（terminal tool）成功执行后立即终止 tool-calling 循环。
          // 典型场景：submit-task（增量编排每次只生成一个任务）、report-task-run-result（post_execute 决策完成）。
          // 终态工具集合由 BUILTIN_TOOLS 中 terminal: true 的工具静态导出，无运行时 DB 查询。
          if (TERMINAL_TOOL_IDS.has(normalizedToolCallId)) {
            const earlyResult = JSON.stringify(toolResultPayload);
            this.logger.log(
              `[terminal_tool_early_return] agent=${agent.name} taskId=${task.id} round=${round + 1} tool=${normalizedToolCallId} result=${compactLogText(earlyResult, 200)}`,
            );
            await persistStepMessage({
              round,
              response: earlyResult,
              finish: 'stop',
              parts: stepParts,
              usage,
              cost,
              stepStartAt: stepStartedAt,
              stepEndAt: new Date(),
            });
            return earlyResult;
          }

          const toolResultContent = `工具 ${normalizedToolCallId} 调用结果: ${JSON.stringify(toolResultPayload || {})}`;
          messages.push({
            role: 'system',
            content: toolResultContent,
            timestamp: new Date(),
          });
          await persistIntermediateSystemMessage(
            round,
            intermediateSystemOffset++,
            toolResultContent,
            {
              source: 'tool-calling-loop.tool-result',
              toolId: normalizedToolCallId,
            },
          );

          // 通知 LLM 被丢弃的 tool_call（参数可能依赖前一个工具的输出，不可靠）
          if (droppedToolCalls.length > 0) {
            const droppedNames = droppedToolCalls.map((t) => normalizeToolId(t.tool)).join(', ');
            const droppedNotice = `注意：你在同一条回复中输出了 ${toolCalls.length} 个 tool_call，系统只执行了第一个（${normalizedToolCallId}）。` +
              `被跳过的工具：${droppedNames}。请根据上方工具返回结果，在下一条回复中逐个发起后续工具调用。`;
            messages.push({
              role: 'system',
              content: droppedNotice,
              timestamp: new Date(),
            });
            await persistIntermediateSystemMessage(
              round,
              intermediateSystemOffset++,
              droppedNotice,
              { source: 'tool-calling-loop.dropped-tool-calls' },
            );
          }

          await persistStepMessage({
            round,
            response,
            finish: 'tool-calls',
            parts: stepParts,
            usage,
            cost,
            stepStartAt: stepStartedAt,
            stepEndAt: new Date(),
          });
        } catch (error) {
          const logError = toLogError(error);
          scorer.trackToolFailure();
          if (isToolInputErrorMessage(logError.message)) {
            scorer.deduct('D5', round, {
              toolId: normalizedToolCallId,
              detail: logError.message,
            });
          } else {
            scorer.deduct('D4', round, {
              toolId: normalizedToolCallId,
              detail: logError.message,
            });
          }
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

          stepParts.push({
            type: 'tool_result',
            status: 'error',
            toolId: normalizedToolCallId,
            toolCallId,
            error: logError.message,
          });

          const message = logError.message;
          const toolFailedInstruction = await this.resolveAgentPromptContent(AGENT_PROMPTS.toolFailedInstruction, {
            normalizedToolId: normalizedToolCallId,
            message,
          });
          messages.push({
            role: 'system',
            content: toolFailedInstruction,
            timestamp: new Date(),
          });
          await persistIntermediateSystemMessage(
            round,
            intermediateSystemOffset++,
            toolFailedInstruction,
            {
              source: 'tool-calling-loop.tool-failed',
              toolId: normalizedToolCallId,
            },
          );

          // 参数契约错误时附加修复指令，引导模型自我修正参数。
          if (isToolInputErrorMessage(message)) {
            const latestInputContract = inputContract || (await this.toolService.getToolInputContract(normalizedToolCallId));
            if (latestInputContract?.schema) {
              const toolRepairInstruction = buildToolInputRepairInstruction(
                normalizedToolCallId,
                latestInputContract.schema,
                toolCall.parameters || {},
              );
              messages.push({
                role: 'system',
                content: toolRepairInstruction,
                timestamp: new Date(),
              });
              await persistIntermediateSystemMessage(
                round,
                intermediateSystemOffset++,
                toolRepairInstruction,
                {
                  source: 'tool-calling-loop.tool-input-repair',
                  toolId: normalizedToolCallId,
                },
              );
            }
          }

          await persistStepMessage({
            round,
            response,
            finish: 'tool-calls',
            parts: stepParts,
            usage,
            cost,
            stepStartAt: stepStartedAt,
            stepEndAt: new Date(),
           });
        }
      }

      scorer.deduct('D11', maxToolRounds, {
        detail: 'reached_max_tool_rounds',
      });
      await persistStepMessage({
        round: maxToolRounds,
        response: toolRoundLimitMessage,
        finish: 'max-rounds',
        parts: [
          {
            type: 'text',
            status: 'completed',
            content: toolRoundLimitMessage,
          },
        ],
        stepStartAt: new Date(),
        stepEndAt: new Date(),
      });

      return toolRoundLimitMessage;
    } finally {
      if (runtimeContext?.runId) {
        await this.agentRunScoreService.saveScore({
          runId: runtimeContext.runId,
          agentId: agentRuntimeId,
          taskId: task.id,
          sessionId: runtimeContext.sessionId,
          summary: scorer.summarize(),
        });
      } else {
        this.logger.debug(
          `[run_score_skip] agent=${agent.name} taskId=${task.id} reason=missing_runtime_context`,
        );
      }
    }
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
    const sessionId = String(((context.sessionContext || {}) as Record<string, unknown>).sessionId || '').trim() || undefined;
    const previousNonSystemMessages = (context.previousMessages || []).filter((message) => message?.role !== 'system');

    if (sessionId) {
      const cachedSystemMessages = await this.runtimePersistence.getSessionInitialSystemMessages(sessionId);
      if (cachedSystemMessages !== undefined) {
        const cachedMessages: ChatMessage[] = cachedSystemMessages.map((message) => ({
          role: 'system',
          content: message.content,
          metadata: message.metadata,
          timestamp: new Date(),
        }));
        cachedMessages.push(...previousNonSystemMessages);
        this.debugTiming(taskId, 'build_messages.total', buildStartAt, {
          totalMessages: cachedMessages.length,
          systemBlockCount: cachedSystemMessages.length,
          scenarioType: this.resolveScenarioType(context.collaborationContext, task),
          cacheHit: true,
        });
        return cachedMessages;
      }
    }

    const loadIdentityStartAt = Date.now();
    const identityMemos = await this.memoService.getIdentityMemos(agent.id || '');
    this.debugTiming(taskId, 'build_messages.load_identity_memos', loadIdentityStartAt, {
      identityMemoCount: identityMemos.length,
    });

    const loadToolsStartAt = Date.now();
    const allowedToolIds = await this.agentRoleService.getAllowedToolIds(agent);
    const assignedTools = await this.toolService.getToolsByIds(allowedToolIds);
    this.debugTiming(taskId, 'build_messages.load_assigned_tools', loadToolsStartAt, {
      allowedToolCount: allowedToolIds.length,
      assignedToolCount: assignedTools.length,
    });

    const skillContents = new Map<string, string>();
    for (const skill of enabledSkills) {
      if (!this.contextStrategyService.shouldActivateSkillContent(skill, task, context)) continue;
      try {
        const skillDoc = await this.skillModel.findOne({ id: skill.id }, { content: 1, promptTemplateRef: 1 }).lean().exec();
        const rawContent = String((skillDoc as any)?.content || '').trim();
        const promptTemplateRef = this.normalizePromptTemplateRef((skillDoc as any)?.promptTemplateRef);
        let resolvedContent = rawContent;
        if (promptTemplateRef) {
          try {
            const resolved = await this.promptResolverService.resolve({
              scene: promptTemplateRef.scene,
              role: promptTemplateRef.role,
              defaultContent: rawContent,
            });
            resolvedContent = String(resolved.content || '').trim();
          } catch {
            resolvedContent = rawContent;
          }
        }
        if (resolvedContent) {
          skillContents.set(skill.id, resolvedContent);
        }
      } catch {
        // ignore single skill load failure
      }
    }

    const collaborationContext = (context.collaborationContext || {}) as Record<string, unknown>;
    const normalizedCollaborationContext =
      collaborationContext && typeof collaborationContext === 'object'
        ? CollaborationContextFactory.fromLegacy(collaborationContext)
        : undefined;
    const mergedContext = { ...collaborationContext };
    const sessionContext = (context.sessionContext || {}) as Record<string, any>;
    const scenarioType = this.resolveScenarioType(normalizedCollaborationContext, task);

    const assembledContext = await this.contextAssembler.assemble({
      agent,
      task,
      context,
      enabledSkills,
      scenarioType,
      contextScope: this.contextFingerprintService.resolveSystemContextScope(agent, task, {
        collaborationContext: normalizedCollaborationContext || collaborationContext,
        sessionContext,
      }),
      identityMemos,
      shared: {
        allowedToolIds,
        assignedTools,
        skillContents,
      },
      persistedContext: {
        domainContext: sessionContext.domainContext || mergedContext.domainContext,
        collaborationContext: sessionContext.collaborationContext || normalizedCollaborationContext || context.collaborationContext,
        runSummaries: sessionContext.runSummaries,
      },
    });
    let messages = assembledContext.messages;

    if (sessionId) {
      const runtimeAgentId = agent.id || (agent as any)._id?.toString?.() || '';
      const systemMessages = messages
        .filter((message) => message.role === 'system')
        .map((message) => {
          const content = String(message.content || '').trim();
          if (!content) {
            return null;
          }
          const metadata = message.metadata && typeof message.metadata === 'object'
            ? ({ ...(message.metadata as Record<string, unknown>) } as Record<string, unknown>)
            : undefined;
          return {
            id: `msg-${uuidv4()}`,
            content,
            ...(metadata ? { metadata } : {}),
          };
        })
        .filter((message): message is { id: string; content: string; metadata?: Record<string, unknown> } => Boolean(message));

      const persisted = await this.runtimePersistence.setSessionInitialSystemMessages(sessionId, systemMessages);
      if (persisted && systemMessages.length > 0) {
        // Session-level system messages are intentionally stored under a synthetic runId.
        // They are queried via session.messageIds instead of runtime run linkage.
        const runId = `system-init-${sessionId}`;
        for (let index = 0; index < systemMessages.length; index++) {
          const systemMessage = systemMessages[index];
          await this.runtimePersistence.createMessage({
            id: systemMessage.id,
            runId,
            agentId: runtimeAgentId,
            sessionId,
            taskId: task.id,
            role: 'system',
            sequence: index + 1,
            content: systemMessage.content,
            status: 'completed',
            metadata: {
              ...(systemMessage.metadata || {}),
              source: 'session.initialSystemMessages',
            },
          });
        }
      }

      if (persisted) {
        messages = [
          ...systemMessages.map((message) => ({
            role: 'system' as const,
            content: message.content,
            ...(message.metadata ? { metadata: message.metadata } : {}),
            timestamp: new Date(),
          })),
          ...previousNonSystemMessages,
        ];
      } else {
        const cachedAfterPersist = await this.runtimePersistence.getSessionInitialSystemMessages(sessionId);
        if (cachedAfterPersist !== undefined) {
          messages = [
            ...cachedAfterPersist.map((message) => ({
              role: 'system' as const,
              content: message.content,
              ...(message.metadata ? { metadata: message.metadata } : {}),
              timestamp: new Date(),
            })),
            ...previousNonSystemMessages,
          ];
        } else {
          this.logger.warn(
            `[session_system_messages_cache_miss_after_persist] taskId=${task.id} sessionId=${sessionId} persisted=${persisted} fallback=assembled_messages`,
          );
        }
      }
    }

    this.debugTiming(taskId, 'build_messages.total', buildStartAt, {
      totalMessages: messages.length,
      systemBlockCount: assembledContext.systemBlockCount,
      scenarioType,
      cacheHit: false,
    });
    return messages;
  }

  private computeIntermediateSystemSequence(base: number, round: number, offset: number): number {
    return base + (round + 2) * 100 + offset;
  }

  private resolveScenarioType(
    collaborationContext?: CollaborationContext | Record<string, unknown>,
    task?: Task,
  ): ScenarioType {
    if (collaborationContext && typeof collaborationContext === 'object' && 'scenarioMode' in collaborationContext) {
      const scenarioMode = String((collaborationContext as CollaborationContext).scenarioMode || '').trim();
      if (scenarioMode === 'meeting' || scenarioMode === 'orchestration' || scenarioMode === 'inner-message' || scenarioMode === 'chat') {
        return scenarioMode;
      }
    }

    const legacyContext = collaborationContext as Record<string, unknown> | undefined;
    if (legacyContext?.meetingId) {
      return 'meeting';
    }
    if (legacyContext?.planId) {
      return 'orchestration';
    }
    if (task?.type === 'internal_message') {
      return 'inner-message';
    }
    return 'chat';
  }

  // ---- private helpers ----

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

  private normalizePromptTemplateRef(input: unknown): { scene: string; role: string } | null {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return null;
    }
    const scene = String((input as any).scene || '').trim();
    const role = String((input as any).role || '').trim();
    if (!scene || !role) {
      return null;
    }
    return { scene, role };
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

  // 获取工具调用最大轮次，优先环境变量配置。
  private getMaxToolRounds(): number {
    const configuredRounds = Number(process.env.MAX_TOOL_ROUNDS);
    if (Number.isFinite(configuredRounds) && configuredRounds > 0) {
      return Math.floor(configuredRounds);
    }
    return DEFAULT_MAX_TOOL_ROUNDS;
  }

  private extractPreactivatedToolIds(executionContext?: {
    preactivatedToolIds?: string[];
  }): string[] {
    if (!Array.isArray(executionContext?.preactivatedToolIds)) {
      return [];
    }

    return Array.from(
      new Set(
        executionContext.preactivatedToolIds
          .map((toolId) => normalizeToolId(String(toolId || '').trim()))
          .filter(Boolean),
      ),
    );
  }

  /**
   * 判断是否需要 orchestration planner 纯文本 retry。
   * 条件：roleInPlan 以 planner 开头 + 响应是纯文本（无 tool_call）+ round 0（首轮）。
   * 仅在 planner 被明确要求输出 tool_call 时触发（planner 场景下 prompt 总是要求 tool_call）。
   */
  private isPlannerTextOnlyRetryNeeded(
    cleaned: string,
    executionContext?: { collaborationContext?: Record<string, unknown> | any },
  ): boolean {
    const collaborationCtx = (executionContext?.collaborationContext || {}) as Record<string, unknown>;
    const roleInPlan = String(collaborationCtx.roleInPlan || '').trim();
    if (!roleInPlan.startsWith('planner')) {
      return false;
    }
    // 如果 cleaned 为空（LLM 返回了空字符串），也应该 retry
    // 如果 cleaned 有内容但不包含 tool_call（确认性文本），也应该 retry
    return cleaned.length === 0 || !/<tool_call>/i.test(cleaned);
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
