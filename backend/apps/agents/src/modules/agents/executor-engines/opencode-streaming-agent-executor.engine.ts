import { Injectable, Logger } from '@nestjs/common';

import { OpenCodeExecutionService } from '@agent/modules/opencode/opencode-execution.service';
import { AGENT_PROMPTS } from '@agent/modules/prompt-registry/agent-prompt-catalog';
import { RuntimeOrchestratorService } from '@agent/modules/runtime/runtime-orchestrator.service';

import { isMeaninglessAssistantResponse, isMeetingLikeTask, resolveLatestUserContent, resolveOpenCodeRuntimeOptions } from '../agent-executor.helpers';
import { AgentExecutorEngine } from './agent-executor-engine.interface';
import { AgentExecutorEngineInput, AgentExecutorEngineResult } from './agent-executor-engine.types';

@Injectable()
export class OpencodeStreamingAgentExecutorEngine implements AgentExecutorEngine {
  private readonly logger = new Logger(OpencodeStreamingAgentExecutorEngine.name);

  readonly mode = 'streaming' as const;
  readonly channel = 'opencode' as const;

  constructor(
    private readonly openCodeExecutionService: OpenCodeExecutionService,
    private readonly runtimeOrchestrator: RuntimeOrchestratorService,
  ) {}

  async execute(input: AgentExecutorEngineInput): Promise<AgentExecutorEngineResult> {
    const onToken = input.onToken;
    if (!onToken) {
      throw new Error('Missing onToken callback for opencode streaming execution');
    }

    const openCodeExecutionConfig = input.openCodeExecutionConfig;
    if (!openCodeExecutionConfig) {
      throw new Error('OpenCode execution config is required for opencode streaming engine');
    }

    const resolvedOpenCodeRuntime = resolveOpenCodeRuntimeOptions(openCodeExecutionConfig, input.context?.opencodeRuntime);
    input.logResolvedOpenCodeRuntime(input.taskId, 'streaming', resolvedOpenCodeRuntime);

    const sessionConfig: Record<string, unknown> = {
      metadata: {
        taskId: input.taskId,
        agentId: input.runtimeAgentId,
        source: 'agents-runtime',
        mode: 'streaming',
      },
    };
    if (openCodeExecutionConfig.projectDirectory) {
      sessionConfig.directory = openCodeExecutionConfig.projectDirectory;
      sessionConfig.projectPath = openCodeExecutionConfig.projectDirectory;
    }

    let fullResponse = '';
    let tokenChunks = 0;

    const executeOnce = async (taskPrompt: string) =>
      this.openCodeExecutionService.executeWithRuntimeBridge({
        runtimeContext: input.runtimeContext,
        agentId: input.runtimeAgentId,
        taskId: input.taskId,
        taskPrompt,
        title: input.task.title,
        sessionConfig,
        model: {
          providerID: input.modelConfig.provider,
          modelID: input.modelConfig.model,
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
          await input.context?.runtimeLifecycle?.onOpenCodeSession?.({
            sessionId,
            endpoint: resolvedOpenCodeRuntime.baseUrl,
            authEnable: resolvedOpenCodeRuntime.authEnable,
          });
        },
      });

    const firstResult = await executeOnce(resolveLatestUserContent(input.task, input.messages));
    if (!fullResponse && firstResult.response) {
      fullResponse = firstResult.response;
      tokenChunks += 1;
      onToken(firstResult.response);
    }

    if (isMeetingLikeTask(input.task, input.context) && isMeaninglessAssistantResponse(fullResponse)) {
      this.logger.warn(`[stream_task_empty_response_retry] taskId=${input.taskId} channel=opencode attempt=1`);
      await this.runtimeOrchestrator.assertRunnable(input.runtimeContext.runId);
      fullResponse = '';
      const retryResult = await executeOnce(
        `${resolveLatestUserContent(input.task, input.messages)}\n\n` +
          `【系统补充】${AGENT_PROMPTS.emptyResponseRetryInstruction.buildDefaultContent()}`,
      );
      if (!fullResponse && retryResult.response) {
        fullResponse = retryResult.response;
        tokenChunks += 1;
        onToken(retryResult.response);
      }
    }

    return {
      response: fullResponse,
      tokenChunks,
    };
  }
}
