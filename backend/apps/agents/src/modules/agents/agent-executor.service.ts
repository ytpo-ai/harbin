import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { Agent } from '../../../../../src/shared/schemas/agent.schema';
import { Skill, SkillDocument } from '../../schemas/agent-skill.schema';
import { ModelService } from '../models/model.service';
import { ApiKeyService } from '../../../../../src/modules/api-keys/api-key.service';
import { Task, ChatMessage, AIModel } from '../../../../../src/shared/types';
import { ToolService } from '../tools/tool.service';
import { MemoService } from '../memos/memo.service';
import { MemoEventBusService } from '../memos/memo-event-bus.service';
import { MemoWriteQueueService } from '../memos/memo-write-queue.service';
import { RuntimeOrchestratorService, RuntimeRunContext } from '../runtime/runtime-orchestrator.service';
import { RuntimeEiSyncService } from '../runtime/runtime-ei-sync.service';
import { OpenCodeExecutionService } from '../opencode/opencode-execution.service';
import { RedisService } from '@libs/infra';
import { AgentExecutionService } from './agent-execution.service';
import { AgentOrchestrationIntentService } from './agent-orchestration-intent.service';
import { AgentOpenCodePolicyService } from './agent-opencode-policy.service';
import { AgentRoleService } from './agent-role.service';
import { AGENT_PROMPTS, AgentPromptTemplate } from '../prompt-registry/agent-prompt-catalog';
import { PromptResolverService } from '../prompt-registry/prompt-resolver.service';
import {
  MODEL_ADD_TOOL_ID,
  MODEL_LIST_TOOL_ID,
  MODEL_MANAGEMENT_AGENT_NAME,
} from './model-management-agent.constants';
import {
  AgentContext,
  ExecuteTaskResult,
  EnabledAgentSkillContext,
  SystemContextFingerprintRecord,
  TaskInfoSnapshot,
  IdentityMemoSnapshotItem,
} from './agent.types';
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

type ExecutionChannel = 'native' | 'opencode';

@Injectable()
export class AgentExecutorService {
  private readonly logger = new Logger(AgentExecutorService.name);

  private debugTiming(taskId: string, stage: string, startedAt: number, extras?: Record<string, unknown>): void {
    const extraText = extras
      ? Object.entries(extras)
          .map(([key, value]) => `${key}=${String(value)}`)
          .join(' ')
      : '';
    this.logger.debug(
      `[timing_debug] taskId=${taskId} stage=${stage} durationMs=${Date.now() - startedAt}${extraText ? ` ${extraText}` : ''}`,
    );
  }

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
    private readonly agentOrchestrationIntentService: AgentOrchestrationIntentService,
    private readonly agentOpenCodePolicyService: AgentOpenCodePolicyService,
    private readonly agentRoleService: AgentRoleService,
    private readonly promptResolverService: PromptResolverService,
  ) {}

  // ---- public execution methods ----

  async executeTask(
    agent: Agent,
    agentId: string,
    task: Task,
    context?: Partial<AgentContext>,
  ): Promise<string> {
    const detailed = await this.executeTaskDetailed(agent, agentId, task, context);
    return detailed.response;
  }

  async executeTaskDetailed(
    agent: Agent,
    agentId: string,
    task: Task,
    context?: Partial<AgentContext>,
  ): Promise<ExecuteTaskResult> {
    const taskStartAt = Date.now();
    const taskId = this.ensureTaskRuntime(task);
    const runtimeAgentId = this.agentExecutionService.resolveRuntimeAgentId(agent as any, agentId);
    this.logger.log(
      `[task_start] agent=${agent.name} agentId=${runtimeAgentId} taskId=${taskId} title="${compactLogText(task.title)}" type=${task.type} priority=${task.priority} modelId=${agent.model?.id || 'unknown'} provider=${agent.model?.provider || 'unknown'} hasCustomApiKey=${Boolean(agent.apiKeyId)}`,
    );

    void this.runMemoOperation('task_start_upsert_todo', taskId, async () => {
      await this.memoWriteQueue.queueUpsertTaskTodo(agent.id || agentId, {
        id: taskId,
        title: task.title,
        description: task.description,
        status: 'running',
        sourceType: 'orchestration_task',
      });
    });
    void this.runMemoOperation('task_start_record_behavior', taskId, async () => {
      await this.memoWriteQueue.queueRecordBehavior({
        agentId: agent.id || agentId,
        event: 'task_start',
        taskId,
        title: `Task start: ${task.title}`,
        details: `taskType=${task.type}, priority=${task.priority}, description=${task.description}`,
        tags: [task.type, task.priority, 'task_start'],
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

    const preExecutionStartAt = Date.now();
    const skillsStartAt = Date.now();
    const enabledSkills = await this.getEnabledSkillsForAgent(agent, agentId);
    this.debugTiming(taskId, 'prepare.enabled_skills', skillsStartAt, { enabledSkills: enabledSkills.length });
    this.logger.log(
      `[task_skills] taskId=${taskId} enabledSkills=${enabledSkills.length} skillNames=${enabledSkills.map((item) => item.name).join('|') || 'none'}`,
    );
    const buildMessagesStartAt = Date.now();
    const messages = await this.buildMessages(agent, task, agentContext, enabledSkills);
    this.debugTiming(taskId, 'prepare.build_messages', buildMessagesStartAt, { compiledMessages: messages.length });
    this.logger.log(`[task_messages] taskId=${taskId} compiledMessages=${messages.length}`);

    const routeStartAt = Date.now();
    const routeDecision = await this.resolveExecutionRoute(agent, task, context);
    this.debugTiming(taskId, 'prepare.resolve_execution_route', routeStartAt, {
      channel: routeDecision.channel,
      routeSource: routeDecision.source,
      taskType: routeDecision.taskType,
    });
    const openCodeExecutionConfig = routeDecision.openCodeExecutionConfig;
    const roleStartAt = Date.now();
    const role = await this.agentRoleService.getRoleById(agent.roleId);
    this.debugTiming(taskId, 'prepare.load_role', roleStartAt, { hasRole: Boolean(role) });
    const roleCode = role?.code ? String(role.code).trim() : undefined;
    const executionChannel: ExecutionChannel = routeDecision.channel;
    const executionData: Record<string, unknown> = {
      taskType: routeDecision.taskType,
      routeSource: routeDecision.source,
      modelProvider: agent.model?.provider,
      modelId: agent.model?.id,
      modelName: agent.model?.name,
      model: agent.model?.model,
      openCode: {
        enabled: Boolean(openCodeExecutionConfig),
        strictExecution: executionChannel === 'opencode',
        selected: executionChannel === 'opencode',
        projectDirectory: openCodeExecutionConfig?.projectDirectory,
        endpoint: openCodeExecutionConfig?.endpoint,
        endpointRef: openCodeExecutionConfig?.endpointRef,
        authEnable: openCodeExecutionConfig?.authEnable,
        taskRouting: openCodeExecutionConfig?.taskRouting,
        modelPolicy: openCodeExecutionConfig?.modelPolicy,
      },
    };

    const startRuntimeExecutionAt = Date.now();
    const runtimeContext = await this.agentExecutionService.startRuntimeExecution({
      runtimeAgentId,
      agentName: agent.name,
      task,
      messages,
      mode: 'detailed',
      roleCode,
      executionChannel,
      executionData,
      teamContext: context?.teamContext,
    });
    this.debugTiming(taskId, 'prepare.start_runtime_execution', startRuntimeExecutionAt, {
      runId: runtimeContext.runId,
      sessionId: runtimeContext.sessionId || 'none',
    });

    await context?.runtimeLifecycle?.onStarted?.({
      runId: runtimeContext.runId,
      sessionId: runtimeContext.sessionId,
      traceId: runtimeContext.traceId,
    });

    const appendSystemMessagesAt = Date.now();
    await this.agentExecutionService.appendSystemMessagesToSession(runtimeContext, messages, agent.id || agentId);
    this.debugTiming(taskId, 'prepare.append_system_messages', appendSystemMessagesAt, { count: messages.length });
    this.debugTiming(taskId, 'prepare.total_before_model', preExecutionStartAt, {
      channel: executionChannel,
      routeSource: routeDecision.source,
    });

    try {
      if (executionChannel === 'opencode' && openCodeExecutionConfig) {
        await this.agentOpenCodePolicyService.applyAgentBudgetGate(agent, runtimeAgentId, task, runtimeContext, context);
      }
      let response = '';

      const modelConfig = this.agentExecutionService.buildModelConfig(agent.model as any);
      const resolveApiKeyStartAt = Date.now();
      const customApiKey = await this.resolveCustomApiKey(agent, taskId, 'task');
      this.debugTiming(taskId, 'prepare.resolve_custom_api_key', resolveApiKeyStartAt, {
        keySource: customApiKey ? 'custom' : 'system',
      });

      if (executionChannel === 'opencode' && openCodeExecutionConfig) {
        const sessionConfig: Record<string, unknown> = {
          metadata: {
            taskId,
            agentId: runtimeAgentId,
            source: 'agents-runtime',
          },
        };
        if (openCodeExecutionConfig.projectDirectory) {
          sessionConfig.directory = openCodeExecutionConfig.projectDirectory;
          sessionConfig.projectPath = openCodeExecutionConfig.projectDirectory;
        }

        const resolvedOpenCodeRuntime = this.resolveOpenCodeRuntimeOptions(openCodeExecutionConfig, context?.opencodeRuntime);
        this.logResolvedOpenCodeRuntime(taskId, 'detailed', resolvedOpenCodeRuntime);

        const openCodeResult = await this.openCodeExecutionService.executeWithRuntimeBridge({
          runtimeContext,
          agentId: runtimeAgentId,
          taskId,
          taskPrompt: this.resolveLatestUserContent(task, messages),
          title: task.title,
          sessionConfig,
          model: {
            providerID: modelConfig.provider,
            modelID: modelConfig.model,
          },
          runtime: {
            baseUrl: resolvedOpenCodeRuntime.baseUrl,
            authEnable: resolvedOpenCodeRuntime.authEnable,
            requestTimeoutMs: openCodeExecutionConfig.requestTimeoutMs,
          },
        });

        response = openCodeResult.response;
        if (this.isMeetingLikeTask(task, context) && this.isMeaninglessAssistantResponse(response)) {
          this.logger.warn(`[task_empty_response_retry] taskId=${taskId} channel=opencode attempt=1`);
          await this.runtimeOrchestrator.assertRunnable(runtimeContext.runId);
          const retryResult = await this.openCodeExecutionService.executeWithRuntimeBridge({
            runtimeContext,
            agentId: runtimeAgentId,
            taskId,
            taskPrompt:
              `${this.resolveLatestUserContent(task, messages)}\n\n` +
              '【系统补充】上一轮回复为空。请立即输出最小可用回执，至少包含：已分配、已通知、下一检查点。',
            title: task.title,
            sessionConfig,
            model: {
              providerID: modelConfig.provider,
              modelID: modelConfig.model,
            },
            runtime: {
              baseUrl: resolvedOpenCodeRuntime.baseUrl,
              authEnable: resolvedOpenCodeRuntime.authEnable,
              requestTimeoutMs: openCodeExecutionConfig.requestTimeoutMs,
            },
          });
          response = retryResult.response;
        }
      } else {
        this.modelService.ensureProviderWithKey(modelConfig, customApiKey);

        response = await this.executeWithToolCalling(
          agent,
          task,
          messages,
          modelConfig,
          runtimeContext,
          {
            teamContext: context?.teamContext,
            actor: context?.actor,
            taskType: task.type,
            teamId: task.teamId,
          },
        );
      }

      if (this.isMeetingLikeTask(task, context) && this.isMeaninglessAssistantResponse(response)) {
        response = await this.resolveAgentPromptContent(AGENT_PROMPTS.emptyMeetingResponseFallback);
      }

      this.logger.log(
        `[task_success] agent=${agent.name} taskId=${taskId} responseLength=${response.length} durationMs=${Date.now() - taskStartAt}`,
      );

      void this.runMemoOperation('task_complete_record_behavior', taskId, async () => {
        await this.memoWriteQueue.queueRecordBehavior({
          agentId: agent.id || agentId,
          event: 'task_complete',
          taskId,
          title: `Task complete: ${task.title}`,
          details: this.buildTaskResultMemo(response),
          tags: [task.type, 'task_complete'],
        });
      });
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

      task.messages.push({
        role: 'assistant',
        content: response,
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
      void this.runMemoOperation('task_failed_record_behavior', taskId, async () => {
        await this.memoWriteQueue.queueRecordBehavior({
          agentId: agent.id || agentId,
          event: 'task_failed',
          taskId,
          title: `Task failed: ${task.title}`,
          details: error instanceof Error ? error.message : String(error || 'Unknown error'),
          tags: [task.type, 'task_failed'],
        });
      });
      const normalizedError = logError.message.toLowerCase();
      const controlInterrupted =
        normalizedError.includes('cancelled') ||
        normalizedError.includes('paused') ||
        normalizedError.includes('already completed');
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
      await this.agentExecutionService.releaseRuntimeExecution(runtimeContext);
    }
  }

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

    const preExecutionStartAt = Date.now();
    const skillsStartAt = Date.now();
    const enabledSkills = await this.getEnabledSkillsForAgent(agent, agentId);
    this.debugTiming(taskId, 'stream_prepare.enabled_skills', skillsStartAt, { enabledSkills: enabledSkills.length });
    const buildMessagesStartAt = Date.now();
    const messages = await this.buildMessages(agent, task, agentContext, enabledSkills);
    this.debugTiming(taskId, 'stream_prepare.build_messages', buildMessagesStartAt, { compiledMessages: messages.length });

    const routeStartAt = Date.now();
    const routeDecision = await this.resolveExecutionRoute(agent, task, context);
    this.debugTiming(taskId, 'stream_prepare.resolve_execution_route', routeStartAt, {
      channel: routeDecision.channel,
      routeSource: routeDecision.source,
      taskType: routeDecision.taskType,
    });
    const openCodeExecutionConfig = routeDecision.openCodeExecutionConfig;
    const roleStartAt = Date.now();
    const role = await this.agentRoleService.getRoleById(agent.roleId);
    this.debugTiming(taskId, 'stream_prepare.load_role', roleStartAt, { hasRole: Boolean(role) });
    const roleCode = role?.code ? String(role.code).trim() : undefined;
    const executionChannel: ExecutionChannel = routeDecision.channel;
    const executionData: Record<string, unknown> = {
      mode: 'streaming',
      taskType: routeDecision.taskType,
      routeSource: routeDecision.source,
      modelProvider: agent.model?.provider,
      modelId: agent.model?.id,
      modelName: agent.model?.name,
      model: agent.model?.model,
      openCode: {
        enabled: Boolean(openCodeExecutionConfig),
        strictExecution: executionChannel === 'opencode',
        selected: executionChannel === 'opencode',
        projectDirectory: openCodeExecutionConfig?.projectDirectory,
        endpoint: openCodeExecutionConfig?.endpoint,
        endpointRef: openCodeExecutionConfig?.endpointRef,
        authEnable: openCodeExecutionConfig?.authEnable,
        taskRouting: openCodeExecutionConfig?.taskRouting,
        modelPolicy: openCodeExecutionConfig?.modelPolicy,
      },
    };

    const startRuntimeExecutionAt = Date.now();
    const runtimeContext = await this.agentExecutionService.startRuntimeExecution({
      runtimeAgentId,
      agentName: agent.name,
      task,
      messages,
      mode: 'streaming',
      roleCode,
      executionChannel,
      executionData,
      teamContext: context?.teamContext,
    });
    this.debugTiming(taskId, 'stream_prepare.start_runtime_execution', startRuntimeExecutionAt, {
      runId: runtimeContext.runId,
      sessionId: runtimeContext.sessionId || 'none',
    });

    await context?.runtimeLifecycle?.onStarted?.({
      runId: runtimeContext.runId,
      sessionId: runtimeContext.sessionId,
      traceId: runtimeContext.traceId,
    });

    const appendSystemMessagesAt = Date.now();
    await this.agentExecutionService.appendSystemMessagesToSession(runtimeContext, messages, agent.id || agentId);
    this.debugTiming(taskId, 'stream_prepare.append_system_messages', appendSystemMessagesAt, { count: messages.length });
    this.debugTiming(taskId, 'stream_prepare.total_before_model', preExecutionStartAt, {
      channel: executionChannel,
      routeSource: routeDecision.source,
    });

    let fullResponse = '';
    let tokenChunks = 0;
    let streamSequence = 1;
    let runtimeInterrupted = false;
    try {
      if (executionChannel === 'opencode' && openCodeExecutionConfig) {
        await this.agentOpenCodePolicyService.applyAgentBudgetGate(agent, runtimeAgentId, task, runtimeContext, context);
      }
      await this.runtimeOrchestrator.assertRunnable(runtimeContext.runId);
      if (executionChannel === 'opencode' && openCodeExecutionConfig) {
        const resolvedOpenCodeRuntime = this.resolveOpenCodeRuntimeOptions(openCodeExecutionConfig, context?.opencodeRuntime);
        this.logResolvedOpenCodeRuntime(taskId, 'streaming', resolvedOpenCodeRuntime);

        const sessionConfig: Record<string, unknown> = {
          metadata: {
            taskId,
            agentId: runtimeAgentId,
            source: 'agents-runtime',
            mode: 'streaming',
          },
        };
        if (openCodeExecutionConfig.projectDirectory) {
          sessionConfig.directory = openCodeExecutionConfig.projectDirectory;
          sessionConfig.projectPath = openCodeExecutionConfig.projectDirectory;
        }

        const openCodeResult = await this.openCodeExecutionService.executeWithRuntimeBridge({
          runtimeContext,
          agentId: runtimeAgentId,
          taskId,
          taskPrompt: this.resolveLatestUserContent(task, messages),
          title: task.title,
          sessionConfig,
          model: {
            providerID: agent.model.provider,
            modelID: agent.model.model,
          },
          runtime: {
            baseUrl: resolvedOpenCodeRuntime.baseUrl,
            authEnable: resolvedOpenCodeRuntime.authEnable,
            requestTimeoutMs: openCodeExecutionConfig.requestTimeoutMs,
          },
          onDelta: async (delta) => {
            if (!delta) return;
            tokenChunks += 1;
            fullResponse += delta;
            onToken(delta);
          },
          onSessionReady: async (sessionId) => {
            await context?.runtimeLifecycle?.onOpenCodeSession?.({
              sessionId,
              endpoint: resolvedOpenCodeRuntime.baseUrl,
              authEnable: resolvedOpenCodeRuntime.authEnable,
            });
          },
        });

        if (!fullResponse && openCodeResult.response) {
          fullResponse = openCodeResult.response;
          tokenChunks += 1;
          onToken(openCodeResult.response);
        }

        if (this.isMeetingLikeTask(task, context) && this.isMeaninglessAssistantResponse(fullResponse)) {
          this.logger.warn(`[stream_task_empty_response_retry] taskId=${taskId} channel=opencode attempt=1`);
          await this.runtimeOrchestrator.assertRunnable(runtimeContext.runId);
          fullResponse = '';
          const retryResult = await this.openCodeExecutionService.executeWithRuntimeBridge({
            runtimeContext,
            agentId: runtimeAgentId,
            taskId,
            taskPrompt:
              `${this.resolveLatestUserContent(task, messages)}\n\n` +
              '【系统补充】上一轮回复为空。请立即输出最小可用回执，至少包含：已分配、已通知、下一检查点。',
            title: task.title,
            sessionConfig,
            model: {
              providerID: agent.model.provider,
              modelID: agent.model.model,
            },
            runtime: {
              baseUrl: resolvedOpenCodeRuntime.baseUrl,
              authEnable: resolvedOpenCodeRuntime.authEnable,
              requestTimeoutMs: openCodeExecutionConfig.requestTimeoutMs,
            },
            onDelta: async (delta) => {
              if (!delta) return;
              tokenChunks += 1;
              fullResponse += delta;
              onToken(delta);
            },
            onSessionReady: async (sessionId) => {
              await context?.runtimeLifecycle?.onOpenCodeSession?.({
                sessionId,
                endpoint: resolvedOpenCodeRuntime.baseUrl,
                authEnable: resolvedOpenCodeRuntime.authEnable,
              });
            },
          });

          if (!fullResponse && retryResult.response) {
            fullResponse = retryResult.response;
            tokenChunks += 1;
            onToken(retryResult.response);
          }
        }
      } else {
        const resolveApiKeyStartAt = Date.now();
        const customApiKey = await this.resolveCustomApiKey(agent, taskId, 'stream_task');
        this.debugTiming(taskId, 'stream_prepare.resolve_custom_api_key', resolveApiKeyStartAt, {
          keySource: customApiKey ? 'custom' : 'system',
        });
        const modelConfig = this.agentExecutionService.buildModelConfig(agent.model as any);
        this.modelService.ensureProviderWithKey(modelConfig, customApiKey);

        await this.modelService.streamingChat(
          agent.model.id,
          messages,
          (token) => {
            if (runtimeInterrupted) {
              throw new Error('Runtime run interrupted');
            }
            fullResponse += token;
            tokenChunks += 1;
            onToken(token);
            if (tokenChunks % 20 === 0) {
              void this.runtimeOrchestrator.assertRunnable(runtimeContext.runId).catch(() => {
                runtimeInterrupted = true;
              });
            }
            void this.runtimeOrchestrator
              .recordLlmDelta({
                runId: runtimeContext.runId,
                agentId: runtimeAgentId,
                messageId: runtimeContext.userMessageId,
                traceId: runtimeContext.traceId,
                sequence: streamSequence++,
                delta: token,
                sessionId: runtimeContext.sessionId,
                taskId,
              })
              .catch((eventError) => {
                const eventMessage = eventError instanceof Error ? eventError.message : String(eventError || 'unknown');
                this.logger.warn(`[stream_llm_delta_event_failed] taskId=${taskId} error=${eventMessage}`);
              });
          },
          {
            temperature: agent.model.temperature,
            maxTokens: agent.model.maxTokens,
          },
        );
      }

      if (this.isMeetingLikeTask(task, context) && this.isMeaninglessAssistantResponse(fullResponse)) {
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
      const normalizedError = logError.message.toLowerCase();
      const controlInterrupted =
        normalizedError.includes('cancelled') ||
        normalizedError.includes('paused') ||
        normalizedError.includes('already completed');
      if (!controlInterrupted) {
        await this.agentExecutionService.failRuntimeExecution(runtimeContext, runtimeAgentId, taskId, logError.message);
        await this.runtimeEiSyncService.scheduleRunSync(runtimeContext.runId);
      }
      throw error;
    } finally {
      await this.agentExecutionService.releaseRuntimeExecution(runtimeContext);
    }

    this.logger.log(
      `[stream_task_success] agent=${agent.name} taskId=${taskId} durationMs=${Date.now() - taskStartAt} tokenChunks=${tokenChunks} responseLength=${fullResponse.length}`,
    );

    task.messages.push({
      role: 'assistant',
      content: fullResponse,
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

    return {
      response: fullResponse,
      runId: runtimeContext.runId,
      sessionId: runtimeContext.sessionId,
    };
  }

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

    const isAuthError = (message: string): boolean => {
      const lower = (message || '').toLowerCase();
      return lower.includes('401') || lower.includes('invalid authentication') || lower.includes('unauthorized');
    };

    const normalizeProvider = (provider?: string): string => {
      const value = (provider || '').trim().toLowerCase();
      if (value === 'kimi') return 'moonshot';
      if (value === 'claude') return 'anthropic';
      return value;
    };

    const keyId = options?.apiKeyId?.trim() || undefined;

    try {
      if (keyId) {
        const selectedApiKey = await this.apiKeyService.getApiKey(keyId);
        if (!selectedApiKey) {
          return {
            success: false,
            agent: agent.name,
            model: modelConfig.name,
            error: '所选API Key不存在，请重新选择',
            keySource: 'custom',
            timestamp: new Date().toISOString(),
          };
        }

        if (normalizeProvider(selectedApiKey.provider) !== normalizeProvider(modelConfig.provider)) {
          return {
            success: false,
            agent: agent.name,
            model: modelConfig.name,
            error: `所选API Key提供商(${selectedApiKey.provider})与模型提供商(${modelConfig.provider})不匹配`,
            keySource: 'custom',
            timestamp: new Date().toISOString(),
          };
        }

        const customApiKey = await this.apiKeyService.getDecryptedKey(keyId);
        if (!customApiKey) {
          return {
            success: false,
            agent: agent.name,
            model: modelConfig.name,
            error: 'Agent绑定的API Key无效或已失效，请重新选择API Key',
            keySource: 'custom',
            timestamp: new Date().toISOString(),
          };
        }

        try {
          const result = await runModelTest(customApiKey);
          await this.apiKeyService.recordUsage(keyId);
          return {
            success: true,
            agent: agent.name,
            model: modelConfig.name,
            response: result.response,
            responseLength: result.response.length,
            duration: result.duration,
            keySource: 'custom',
            timestamp: new Date().toISOString(),
          };
        } catch (customError) {
          const customMessage = customError instanceof Error ? customError.message : 'Unknown error';
          this.logger.error(`Agent ${agent.name} model test failed with custom key: ${customMessage}`);

          if (isModelNotFoundError(customMessage)) {
            return {
              success: false,
              agent: agent.name,
              model: modelConfig.name,
              error: `当前模型在提供商侧不可用，请切换模型后重试。详细信息：${customMessage}`,
              keySource: 'custom',
              timestamp: new Date().toISOString(),
            };
          }

          if (isAuthError(customMessage)) {
            return {
              success: false,
              agent: agent.name,
              model: modelConfig.name,
              error: `自定义API Key鉴权失败，请检查该Key是否有效/可用。详细信息：${customMessage}`,
              keySource: 'custom',
              timestamp: new Date().toISOString(),
            };
          }

          try {
            const fallbackResult = await runModelTest(undefined);
            return {
              success: true,
              agent: agent.name,
              model: modelConfig.name,
              response: fallbackResult.response,
              responseLength: fallbackResult.response.length,
              duration: fallbackResult.duration,
              keySource: 'system',
              note: `自定义API Key测试失败，已使用系统默认Key回退成功：${customMessage}`,
              timestamp: new Date().toISOString(),
            };
          } catch (fallbackError) {
            const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : 'Unknown error';
            this.logger.error(`Agent ${agent.name} model fallback test failed: ${fallbackMessage}`);
            return {
              success: false,
              agent: agent.name,
              model: modelConfig.name,
              error: `自定义API Key失败: ${customMessage}; 系统默认Key失败: ${fallbackMessage}`,
              keySource: 'custom',
              timestamp: new Date().toISOString(),
            };
          }
        }
      }

      const result = await runModelTest(undefined);
      return {
        success: true,
        agent: agent.name,
        model: modelConfig.name,
        response: result.response,
        responseLength: result.response.length,
        duration: result.duration,
        keySource: 'system',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Agent ${agent.name} model test failed: ${message}`);
      return {
        success: false,
        agent: agent.name,
        model: modelConfig.name,
        error: message,
        keySource: keyId ? 'custom' : 'system',
        timestamp: new Date().toISOString(),
      };
    }
  }

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

  private async resolveExecutionRoute(
    agent: Agent,
    task: Task,
    context?: Partial<AgentContext>,
  ): Promise<{
    channel: ExecutionChannel;
    taskType: string;
    source: string;
    openCodeExecutionConfig: ReturnType<AgentOpenCodePolicyService['parseOpenCodeExecutionConfig']>;
  }> {
    const openCodeExecutionConfig = this.agentOpenCodePolicyService.parseOpenCodeExecutionConfig(agent.config);
    const taskType = this.resolveExecutionTaskType(task, context);
    const preferredChannel = this.resolvePreferredExecutionChannel(context);

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

    if (preferredChannel) {
      return await this.finalizeExecutionRoute(agent, taskType, preferredChannel, `context_preferred_${preferredChannel}`, openCodeExecutionConfig);
    }

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

    const fallbackChannel: ExecutionChannel = DEFAULT_OPENCODE_TASK_TYPES.has(taskType) ? 'opencode' : 'native';
    const fallbackSource = fallbackChannel === 'opencode' ? 'default_task_type_opencode' : 'default_task_type_native';
    return this.finalizeExecutionRoute(agent, taskType, fallbackChannel, fallbackSource, openCodeExecutionConfig);
  }

  private async finalizeExecutionRoute(
    agent: Agent,
    taskType: string,
    channel: ExecutionChannel,
    source: string,
    openCodeExecutionConfig: NonNullable<ReturnType<AgentOpenCodePolicyService['parseOpenCodeExecutionConfig']>>,
  ): Promise<{
    channel: ExecutionChannel;
    taskType: string;
    source: string;
    openCodeExecutionConfig: NonNullable<ReturnType<AgentOpenCodePolicyService['parseOpenCodeExecutionConfig']>>;
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

  private resolvePreferredExecutionChannel(context?: Partial<AgentContext>): ExecutionChannel | null {
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

  private asString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
  }

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
    const meetingLike = this.isMeetingLikeTask(task, executionContext);
    let emptyResponseRetryUsed = false;
    let errorRetryUsed = false;
    const emptyMeetingResponseFallback = await this.resolveAgentPromptContent(AGENT_PROMPTS.emptyMeetingResponseFallback);
    const generationErrorRetryPrompt = meetingLike
      ? await this.resolveAgentPromptContent(AGENT_PROMPTS.generationErrorRetryInstruction)
      : '';
    const modelManagementGroundingPrompt = await this.resolveAgentPromptContent(
      AGENT_PROMPTS.modelManagementGroundingInstruction,
    );
    const emptyResponseRetryPrompt = meetingLike
      ? await this.resolveAgentPromptContent(AGENT_PROMPTS.emptyResponseRetryInstruction)
      : '';
    const toolRoundLimitMessage = await this.resolveAgentPromptContent(AGENT_PROMPTS.toolRoundLimitMessage);

    const deterministicModelManagementResult = await this.tryHandleModelManagementDeterministically(
      agent,
      task,
      messages,
      assignedToolIds,
      agentRuntimeId,
    );
    if (deterministicModelManagementResult) {
      return deterministicModelManagementResult;
    }

    const forcedOrchestrationAction = this.agentOrchestrationIntentService.extractForcedOrchestrationAction(
      task,
      messages,
      assignedToolIds,
      executionContext,
    );
    if (!forcedOrchestrationAction && this.agentOrchestrationIntentService.hasMeetingOrchestrationIntent(task, messages, executionContext)) {
      const hasAnyOrchestrationTool = this.agentOrchestrationIntentService.hasAnyOrchestrationTool(assignedToolIds);
      if (!hasAnyOrchestrationTool) {
        return '我识别到你希望执行计划编排，但当前这个 Agent 未分配 builtin.sys-mg.mcp.orchestration.* 工具。请在 Agent 管理中为其绑定对应 MCP Profile 工具后重试。';
      }
    }
    if (forcedOrchestrationAction) {
      this.logger.log(
        `Forced tool call triggered: ${forcedOrchestrationAction.tool} (agent=${agent.name}, reason=${forcedOrchestrationAction.reason})`,
      );
      try {
        const execution = await this.toolService.executeTool(
          forcedOrchestrationAction.tool,
          agentRuntimeId,
          forcedOrchestrationAction.parameters,
          task.id,
          executionContext,
        );
        return this.agentOrchestrationIntentService.formatForcedOrchestrationAnswer(
          forcedOrchestrationAction.tool,
          this.extractToolResultPayload(execution),
          forcedOrchestrationAction.parameters,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown error';
        this.logger.warn(`Forced tool call ${forcedOrchestrationAction.tool} failed: ${message}`);
        return `我已识别到你希望执行计划编排，并尝试调用 ${forcedOrchestrationAction.tool}，但执行失败（${message}）。请补充必要参数（如 planId/taskId）后重试。`;
      }
    }

    for (let round = 0; round <= maxToolRounds; round++) {
      if (runtimeContext) {
        await this.runtimeOrchestrator.assertRunnable(runtimeContext.runId);
      }
      let response: string;
      const roundStartAt = Date.now();
      this.logger.log(
        `[tool_round_start] agent=${agent.name} taskId=${task.id} round=${round + 1}/${maxToolRounds + 1} messageCount=${messages.length} modelId=${modelConfig.id}`,
      );
      try {
        response = await this.modelService.chat(modelConfig.id, messages, {
          temperature: modelConfig.temperature,
          maxTokens: modelConfig.maxTokens,
        });
        this.logger.log(
          `[tool_round_response] agent=${agent.name} taskId=${task.id} round=${round + 1} durationMs=${Date.now() - roundStartAt} responseLength=${response.length}`,
        );
      } catch (error) {
        if (this.isModelTimeoutError(error)) {
          this.logger.warn(
            `[tool_round_timeout] agent=${agent.name} taskId=${task.id} round=${round + 1} durationMs=${Date.now() - roundStartAt}`,
          );
          return '当前模型请求超时（上游响应过慢）。请稍后重试，或将问题拆小后再试。';
        }
        if (meetingLike && !errorRetryUsed && this.shouldRetryGenerationError(error)) {
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
        if (meetingLike && this.shouldRetryGenerationError(error)) {
          return emptyMeetingResponseFallback;
        }
        throw error;
      }

      const toolCall = this.extractToolCall(response);
      if (!toolCall) {
        if (this.shouldForceModelManagementGrounding(agent, task, messages, response, executedToolIds)) {
          messages.push({
            role: 'system',
            content: modelManagementGroundingPrompt,
            timestamp: new Date(),
          });
          continue;
        }
        const cleaned = this.stripToolCallMarkup(response);
        if (meetingLike && this.isMeaninglessAssistantResponse(cleaned)) {
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

      const toolCallId = `toolcall-${uuidv4()}`;
      let runtimeToolPartId: string | undefined;
      try {
        if (runtimeContext) {
          runtimeToolPartId = await this.runtimeOrchestrator.recordToolPending({
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
          });
          await this.runtimeOrchestrator.recordToolRunning({
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

        if (runtimeContext) {
          await this.runtimeOrchestrator.recordToolCompleted({
            runId: runtimeContext.runId,
            agentId: agentRuntimeId,
            taskId: task.id,
            toolId: normalizedToolCallId,
            toolName: toolCall.tool,
            toolCallId,
            input: toolCall.parameters,
            output: toolResultPayload,
            traceId: runtimeContext.traceId,
            sequence: round + 1,
            messageId: runtimeContext.userMessageId,
            partId: runtimeToolPartId,
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

        if (runtimeContext) {
          await this.runtimeOrchestrator.recordToolFailed({
            runId: runtimeContext.runId,
            agentId: agentRuntimeId,
            taskId: task.id,
            toolId: normalizedToolCallId,
            toolName: toolCall.tool,
            toolCallId,
            input: toolCall.parameters,
            error: logError.message,
            traceId: runtimeContext.traceId,
            sequence: round + 1,
            messageId: runtimeContext.userMessageId,
            partId: runtimeToolPartId,
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

        if (this.isToolInputErrorMessage(message)) {
          const inputContract = await this.toolService.getToolInputContract(normalizedToolCallId);
          if (inputContract?.schema) {
            messages.push({
              role: 'system',
              content: this.buildToolInputRepairInstruction(normalizedToolCallId, inputContract.schema, toolCall.parameters || {}),
              timestamp: new Date(),
            });
          }
        }
      }
    }

    return toolRoundLimitMessage;
  }

  // ---- message building ----

  async buildMessages(
    agent: Agent,
    task: Task,
    context: AgentContext,
    enabledSkills: EnabledAgentSkillContext[],
  ): Promise<ChatMessage[]> {
    const buildStartAt = Date.now();
    const taskId = String(task.id || 'unknown');
    const messages: ChatMessage[] = [];
    const meetingLikeTask = this.isMeetingLikeTask(task, context);
    const loadIdentityStartAt = Date.now();
    const identityMemos = await this.memoService.getIdentityMemos(agent.id || '');
    this.debugTiming(taskId, 'build_messages.load_identity_memos', loadIdentityStartAt, {
      identityMemoCount: identityMemos.length,
    });
    const previousSystemMessages = (context.previousMessages || []).filter((message) => message?.role === 'system');
    const previousNonSystemMessages = (context.previousMessages || []).filter((message) => message?.role !== 'system');

    messages.push({
      role: 'system',
      content: agent.systemPrompt,
      timestamp: new Date(),
    });

    const contextScope = this.resolveSystemContextScope(agent, task, context);

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
          '请优先基于以上已启用技能的能力边界来拆解与执行任务，并在输出中体现对应技能的方法论。',
        timestamp: new Date(),
      });

      for (const skill of enabledSkills) {
        if (this.shouldActivateSkillContent(skill, task)) {
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

      messages.push({
        role: 'system',
        content: await this.resolveAgentPromptContent(AGENT_PROMPTS.toolPriorityInstruction),
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

    if (context.teamContext) {
      messages.push({
        role: 'system',
        content: `团队上下文: ${JSON.stringify(context.teamContext)}`,
        timestamp: new Date(),
      });
    }

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

    messages.push(...previousSystemMessages);

    const memoryContextStartAt = Date.now();
    const memoryContext = await this.memoService.getTaskMemoryContext(
      agent.id || '',
      `${task.title}\n${task.description}\n${task.messages?.slice(-1)[0]?.content || ''}`,
    );
    this.debugTiming(taskId, 'build_messages.load_task_memory_context', memoryContextStartAt, {
      hasMemoryContext: Boolean(memoryContext),
    });
    if (memoryContext) {
      messages.push({
        role: 'system',
        content:
          `以下是从备忘录中按需检索到的相关记忆（渐进加载摘要）:\n${memoryContext}\n\n` +
          '请优先参考这些记忆，并在必要时调用 builtin.sys-mg.internal.memory.search-memo 获取更完整上下文；若有新结论可调用 builtin.sys-mg.internal.memory.append-memo 追加沉淀。',
        timestamp: new Date(),
      });
    }

    messages.push(...previousNonSystemMessages);

    this.debugTiming(taskId, 'build_messages.total', buildStartAt, {
      totalMessages: messages.length,
      meetingLikeTask,
    });

    return messages;
  }

  // ---- private helpers ----

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

  private agentEnabledSkillCacheKey(agentId: string): string {
    return `agent:enabled-skills:${agentId}`;
  }

  private shouldActivateSkillContent(
    skill: EnabledAgentSkillContext,
    task: Task,
  ): boolean {
    const taskText = `${task.title || ''} ${task.description || ''} ${task.type || ''}`.toLowerCase();
    const tags = (skill.tags || []).map((t) => t.toLowerCase());

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

  private systemContextFingerprintCacheKey(scope: string, blockType: string): string {
    return `agent:system-context-fingerprint:${scope}:${blockType}`;
  }

  private hashFingerprint(input: string): string {
    return createHash('sha256').update(String(input || '')).digest('hex');
  }

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

  resolveOpenCodeRuntimeOptions(
    executionConfig: {
      endpoint?: string;
      endpointRef?: string;
      authEnable: boolean;
    },
    runtime?: {
      endpoint?: string;
      endpointRef?: string;
      authEnable?: boolean;
    },
  ): {
    baseUrl?: string;
    authEnable: boolean;
    source: 'agent_config_endpoint' | 'agent_config_endpoint_ref' | 'runtime_endpoint' | 'runtime_endpoint_ref' | 'env_default';
  } {
    const endpoint = String(executionConfig.endpoint || '').trim();
    if (endpoint) {
      return {
        baseUrl: endpoint,
        authEnable: executionConfig.authEnable,
        source: 'agent_config_endpoint',
      };
    }

    const endpointRef = String(executionConfig.endpointRef || '').trim();
    if (endpointRef) {
      return {
        baseUrl: endpointRef,
        authEnable: executionConfig.authEnable,
        source: 'agent_config_endpoint_ref',
      };
    }

    const runtimeEndpoint = String(runtime?.endpoint || '').trim();
    if (runtimeEndpoint) {
      return {
        baseUrl: runtimeEndpoint,
        authEnable: runtime?.authEnable ?? executionConfig.authEnable,
        source: 'runtime_endpoint',
      };
    }

    const runtimeEndpointRef = String(runtime?.endpointRef || '').trim();
    if (runtimeEndpointRef) {
      return {
        baseUrl: runtimeEndpointRef,
        authEnable: runtime?.authEnable ?? executionConfig.authEnable,
        source: 'runtime_endpoint_ref',
      };
    }

    return {
      baseUrl: undefined,
      authEnable: executionConfig.authEnable,
      source: 'env_default',
    };
  }

  private logResolvedOpenCodeRuntime(
    taskId: string,
    mode: 'detailed' | 'streaming',
    runtime: {
      baseUrl?: string;
      authEnable: boolean;
      source: 'agent_config_endpoint' | 'agent_config_endpoint_ref' | 'runtime_endpoint' | 'runtime_endpoint_ref' | 'env_default';
    },
  ): void {
    this.logger.log(
      `[opencode_runtime_resolved] taskId=${taskId} mode=${mode} source=${runtime.source} baseUrl=${runtime.baseUrl || 'env'} authEnable=${runtime.authEnable}`,
    );
  }

  isMeetingLikeTask(
    task: Task,
    context?: {
      teamContext?: any;
      taskType?: string;
    },
  ): boolean {
    return task.type === 'meeting' || context?.taskType === 'meeting' || Boolean(context?.teamContext?.meetingId);
  }

  private renderAgentPrompt<TPayload>(
    template: AgentPromptTemplate<TPayload>,
    payload?: TPayload,
  ): string {
    const buildDefaultContent = template.buildDefaultContent as unknown as (input?: TPayload) => string;
    return buildDefaultContent(payload);
  }

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

  private async resolveAgentPromptContent<TPayload>(
    template: AgentPromptTemplate<TPayload>,
    payload?: TPayload,
  ): Promise<string> {
    const resolved = await this.resolveAgentPromptTemplate(template, payload);
    return resolved.content;
  }

  isMeaninglessAssistantResponse(response: string | undefined): boolean {
    const normalized = String(response || '').trim();
    if (!normalized) {
      return true;
    }
    if (['-', '—', '–', '...', '…'].includes(normalized)) {
      return true;
    }
    return /^[\s\-—–_.…]+$/.test(normalized);
  }

  private shouldRetryGenerationError(error: unknown): boolean {
    const message = toLogError(error).message.toLowerCase();
    return (
      message.includes('timeout') ||
      message.includes('timed out') ||
      message.includes('econnreset') ||
      message.includes('socket hang up') ||
      message.includes('temporar') ||
      message.includes('rate limit') ||
      message.includes('503') ||
      message.includes('502')
    );
  }

  private isModelTimeoutError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error || '');
    const lower = message.toLowerCase();
    return (
      lower.includes('request timed out') ||
      lower.includes('timeout') ||
      lower.includes('etimedout') ||
      lower.includes('abort')
    );
  }

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

  private resolveLatestUserContent(task: Task, messages: ChatMessage[]): string {
    const latestUserMessage = [...(task.messages || []), ...(messages || [])]
      .reverse()
      .find((item) => item?.role === 'user' && typeof item.content === 'string' && item.content.trim().length > 0)?.content;

    return latestUserMessage || task.description || task.title || '';
  }

  private shouldForceModelManagementGrounding(
    agent: Agent,
    task: Task,
    messages: ChatMessage[],
    response: string,
    executedToolIds: Set<string>,
  ): boolean {
    if (agent.name !== MODEL_MANAGEMENT_AGENT_NAME) {
      return false;
    }

    const latestUserContent = [...(task.messages || []), ...messages]
      .reverse()
      .find((item) => item?.role === 'user' && typeof item.content === 'string' && item.content.trim().length > 0)?.content || '';

    const userText = latestUserContent.toLowerCase();
    const modelResponse = (response || '').toLowerCase();

    const claimsAddSuccess =
      modelResponse.includes('已添加') ||
      modelResponse.includes('添加完成') ||
      modelResponse.includes('发起了添加') ||
      modelResponse.includes('开始添加') ||
      modelResponse.includes('已经完成') ||
      modelResponse.includes('successfully added') ||
      modelResponse.includes('already added');

    const asksAddStatus =
      userText.includes('添加好了吗') ||
      userText.includes('加好了吗') ||
      userText.includes('添加成功') ||
      userText.includes('added') ||
      userText.includes('add done');

    const confirmsAddAction =
      userText === '是的' ||
      userText === '好的' ||
      userText === '确认' ||
      userText === '确认添加' ||
      userText.includes('需要添加') ||
      userText.includes('请添加') ||
      userText.includes('开始添加') ||
      userText.includes('添加到系统') ||
      userText.includes('add to system') ||
      userText.includes('yes, add') ||
      userText.includes('yes add');

    const addExecuted = executedToolIds.has(MODEL_ADD_TOOL_ID);
    const listExecuted = executedToolIds.has(MODEL_LIST_TOOL_ID);

    if (claimsAddSuccess && (!addExecuted || !listExecuted)) {
      return true;
    }

    if (confirmsAddAction && !addExecuted) {
      return true;
    }

    if (asksAddStatus && !listExecuted) {
      return true;
    }

    return false;
  }

  private async tryHandleModelManagementDeterministically(
    agent: Agent,
    task: Task,
    messages: ChatMessage[],
    assignedToolIds: Set<string>,
    agentRuntimeId: string,
  ): Promise<string | null> {
    if (agent.name !== MODEL_MANAGEMENT_AGENT_NAME) {
      return null;
    }

    const latestUser = [...(task.messages || []), ...messages]
      .reverse()
      .find((item) => item?.role === 'user' && typeof item.content === 'string' && item.content.trim().length > 0)?.content;
    const latestUserText = String(latestUser || '').trim().toLowerCase();
    if (!latestUserText) {
      return null;
    }

    const isConfirmAdd =
      ['是的', '好的', '确认', '确认添加'].includes(latestUserText) ||
      latestUserText.includes('需要添加') ||
      latestUserText.includes('请添加') ||
      latestUserText.includes('添加到系统') ||
      latestUserText.includes('yes add') ||
      latestUserText.includes('yes, add');

    const asksAddStatus = latestUserText.includes('添加好了吗') || latestUserText.includes('加好了吗');

    if (!isConfirmAdd && !asksAddStatus) {
      return null;
    }

    const targets = this.extractRequestedModelsFromConversation(task, messages);
    if (!targets.length) {
      return '我已收到添加请求，但没有识别到明确的模型 ID（例如 gpt-5.3-codex）。请提供要添加的模型 ID，我将立即执行并回传结果。';
    }

    if (asksAddStatus && assignedToolIds.has(MODEL_LIST_TOOL_ID)) {
      try {
        const listExecution = await this.toolService.executeTool(
          MODEL_LIST_TOOL_ID,
          agentRuntimeId,
          { limit: 500 },
          task.id,
        );
        const listPayload = this.extractToolResultPayload(listExecution);
        const list = Array.isArray(listPayload?.models) ? listPayload.models : [];
        const existingIds = new Set(
          list
            .map((item: any) => String(item?.id || item?.model || '').trim().toLowerCase())
            .filter(Boolean),
        );
        const exists = targets.filter((item) => existingIds.has(item));
        const missing = targets.filter((item) => !existingIds.has(item));
        if (!missing.length) {
          return `已确认：目标模型已在系统中。\n已存在：${exists.join('、')}`;
        }
        return `核验结果：部分模型尚未添加完成。\n已存在：${exists.join('、') || '无'}\n缺失：${missing.join('、')}`;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown error';
        return `我尝试核验模型状态，但查询失败：${message}`;
      }
    }

    if (!isConfirmAdd || !assignedToolIds.has(MODEL_ADD_TOOL_ID)) {
      return null;
    }

    const addResults: Array<{ model: string; created: boolean; message: string }> = [];
    for (const model of targets) {
      const provider = this.inferProviderFromModelId(model);
      try {
        const addExecution = await this.toolService.executeTool(
          MODEL_ADD_TOOL_ID,
          agentRuntimeId,
          {
            provider,
            model,
            name: this.toModelDisplayName(model),
          },
          task.id,
        );

        const addPayload = this.extractToolResultPayload(addExecution);

        addResults.push({
          model,
          created: Boolean(addPayload?.created),
          message: String(addPayload?.message || ''),
        });
      } catch (error) {
        addResults.push({
          model,
          created: false,
          message: error instanceof Error ? error.message : 'unknown error',
        });
      }
    }

    if (!assignedToolIds.has(MODEL_LIST_TOOL_ID)) {
      const lines = addResults.map((item) => `- ${item.model}: ${item.created ? '已添加' : `失败（${item.message}）`}`);
      return `已执行模型添加请求，结果如下：\n${lines.join('\n')}`;
    }

    try {
      const listExecution = await this.toolService.executeTool(
        MODEL_LIST_TOOL_ID,
        agentRuntimeId,
        { limit: 500 },
        task.id,
      );
      const listPayload = this.extractToolResultPayload(listExecution);
      const list = Array.isArray(listPayload?.models) ? listPayload.models : [];
      const existingIds = new Set(
        list
          .map((item: any) => String(item?.id || item?.model || '').trim().toLowerCase())
          .filter(Boolean),
      );
      const verified = targets.filter((item) => existingIds.has(item));
      const unverified = targets.filter((item) => !existingIds.has(item));
      return `已执行添加并完成核验。\n添加结果：${addResults.map((item) => `${item.model}:${item.created ? 'created' : 'failed'}`).join('，')}\n核验存在：${verified.join('、') || '无'}\n核验缺失：${unverified.join('、') || '无'}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      return `已执行模型添加，但列表核验失败：${message}`;
    }
  }

  private extractRequestedModelsFromConversation(task: Task, messages: ChatMessage[]): string[] {
    const collector = [
      task.title || '',
      task.description || '',
      ...(task.messages || []).map((item) => item?.content || ''),
      ...messages.map((item) => item?.content || ''),
    ]
      .map((item) => String(item || ''))
      .join('\n');

    const regex = /(gpt-[a-z0-9.\-]+|o1[a-z0-9.\-]*|claude-[a-z0-9.\-]+|gemini-[a-z0-9.\-]+|deepseek-[a-z0-9.\-]+|qwen[a-z0-9.\-]*|llama-[a-z0-9.\-]+|kimi-[a-z0-9.\-]+|moonshot-[a-z0-9.\-]+|mistral-[a-z0-9.\-]+|grok-[a-z0-9.\-]+)/gi;
    const matches = collector.match(regex) || [];
    return Array.from(new Set(matches.map((item) => item.trim().toLowerCase())));
  }

  private inferProviderFromModelId(modelId: string): string {
    const value = String(modelId || '').toLowerCase();
    if (value.startsWith('gpt-') || value.startsWith('o1')) return 'openai';
    if (value.startsWith('claude-')) return 'anthropic';
    if (value.startsWith('gemini-')) return 'google';
    if (value.startsWith('deepseek-')) return 'deepseek';
    if (value.startsWith('qwen')) return 'alibaba';
    if (value.startsWith('llama-')) return 'meta';
    if (value.startsWith('kimi-') || value.startsWith('moonshot-')) return 'moonshot';
    if (value.startsWith('mistral-')) return 'mistral';
    if (value.startsWith('grok-')) return 'xai';
    return 'custom';
  }

  private toModelDisplayName(model: string): string {
    return String(model || '')
      .split('-')
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  private extractToolCall(response: string): { tool: string; parameters: any } | null {
    const closedTagMatch = response.match(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/i);
    if (closedTagMatch) {
      return this.parseToolCallPayload(closedTagMatch[1]);
    }

    const openTagOnlyMatch = response.match(/<tool_call>\s*([\s\S]*)$/i);
    if (openTagOnlyMatch) {
      return this.parseToolCallPayload(openTagOnlyMatch[1]);
    }

    if (response.includes('"tool"') && response.includes('"parameters"')) {
      return this.parseToolCallPayload(response);
    }

    return null;
  }

  private isToolInputErrorMessage(message: string): boolean {
    const normalized = String(message || '').toLowerCase();
    if (!normalized) return false;
    if (normalized.includes('invalid tool parameters')) return true;
    if (normalized.includes('missing required field')) return true;
    if (normalized.includes('requires') && normalized.includes('parameter')) return true;
    if (normalized.includes('requires receiveragentid')) return true;
    if (normalized.includes('requires title and content')) return true;
    if (normalized.includes('title and content are required')) return true;
    return false;
  }

  private buildToolInputRepairInstruction(
    normalizedToolId: string,
    schema: Record<string, unknown>,
    previousParameters: Record<string, unknown>,
  ): string {
    const schemaText = compactLogText(JSON.stringify(schema || {}), 2400);
    const paramsText = compactLogText(JSON.stringify(previousParameters || {}), 1200);
    return [
      `参数修正要求：你刚刚调用工具 ${normalizedToolId} 时参数不符合契约。`,
      `仅基于以下工具定义修正参数并立即重试，不要补充其他解释文本。`,
      `inputSchema=${schemaText}`,
      `lastParameters=${paramsText}`,
      `请只输出 <tool_call>{"tool":"${normalizedToolId}","parameters":{...}}</tool_call>`,
    ].join('\n');
  }

  private parseToolCallPayload(payload: string): { tool: string; parameters: any } | null {
    const cleaned = payload.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
    const candidates = [cleaned];

    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      candidates.push(cleaned.slice(firstBrace, lastBrace + 1).trim());
    }

    for (const candidate of candidates) {
      if (!candidate) continue;
      try {
        const parsed = JSON.parse(candidate);
        if (!parsed || typeof parsed !== 'object' || typeof parsed.tool !== 'string') {
          continue;
        }

        return {
          tool: parsed.tool,
          parameters: parsed.parameters && typeof parsed.parameters === 'object' ? parsed.parameters : {},
        };
      } catch {
        continue;
      }
    }

    return null;
  }

  private stripToolCallMarkup(content: string): string {
    const withoutClosedBlocks = content.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '');
    const withoutDanglingBlocks = withoutClosedBlocks.replace(/<tool_call>\s*[\s\S]*$/gi, '');
    return withoutDanglingBlocks.trim();
  }

  private buildTaskResultMemo(response: string): string {
    const normalized = String(response || '').replace(/\s+/g, ' ').trim();
    if (normalized.length <= 800) return normalized;
    return `${normalized.slice(0, 797)}...`;
  }

  private getMaxToolRounds(): number {
    const configuredRounds = Number(process.env.MAX_TOOL_ROUNDS);
    if (Number.isFinite(configuredRounds) && configuredRounds > 0) {
      return Math.floor(configuredRounds);
    }
    return DEFAULT_MAX_TOOL_ROUNDS;
  }

  private extractToolResultPayload(execution: any): any {
    const result = execution?.result;
    if (result && typeof result === 'object' && 'data' in result) {
      return result.data;
    }
    return result || {};
  }
}
