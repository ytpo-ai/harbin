import { Injectable, Logger } from '@nestjs/common';

import { OpenCodeExecutionService } from '@agent/modules/opencode/opencode-execution.service';
import { AGENT_PROMPTS } from '@agent/modules/prompt-registry/agent-prompt-catalog';
import { RuntimeOrchestratorService } from '@agent/modules/runtime/runtime-orchestrator.service';

import { isMeaninglessAssistantResponse, isMeetingLikeTask, resolveLatestUserContent, resolveOpenCodeRuntimeOptions } from '../agent-executor.helpers';
import { AgentExecutorEngine } from './agent-executor-engine.interface';
import { AgentExecutorEngineInput, AgentExecutorEngineResult } from './agent-executor-engine.types';

@Injectable()
export class OpencodeAgentExecutorEngine implements AgentExecutorEngine {
  private readonly logger = new Logger(OpencodeAgentExecutorEngine.name);

  readonly mode = 'detailed' as const;
  readonly channel = 'opencode' as const;

  constructor(
    private readonly openCodeExecutionService: OpenCodeExecutionService,
    private readonly runtimeOrchestrator: RuntimeOrchestratorService,
  ) {}

  async execute(input: AgentExecutorEngineInput): Promise<AgentExecutorEngineResult> {
    const openCodeExecutionConfig = input.openCodeExecutionConfig;
    if (!openCodeExecutionConfig) {
      throw new Error('OpenCode execution config is required for opencode detailed engine');
    }

    const sessionConfig: Record<string, unknown> = {
      metadata: {
        taskId: input.taskId,
        agentId: input.runtimeAgentId,
        source: 'agents-runtime',
      },
    };
    if (openCodeExecutionConfig.projectDirectory) {
      sessionConfig.directory = openCodeExecutionConfig.projectDirectory;
      sessionConfig.projectPath = openCodeExecutionConfig.projectDirectory;
    }

    const resolvedOpenCodeRuntime = resolveOpenCodeRuntimeOptions(openCodeExecutionConfig, input.context?.opencodeRuntime);
    input.logResolvedOpenCodeRuntime(input.taskId, 'detailed', resolvedOpenCodeRuntime);

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
      });

    let response = (await executeOnce(resolveLatestUserContent(input.task, input.messages))).response;

    if (isMeetingLikeTask(input.task, input.context) && isMeaninglessAssistantResponse(response)) {
      this.logger.warn(`[task_empty_response_retry] taskId=${input.taskId} channel=opencode attempt=1`);
      await this.runtimeOrchestrator.assertRunnable(input.runtimeContext.runId);
      const retryPrompt =
        `${resolveLatestUserContent(input.task, input.messages)}\n\n` +
        `【系统补充】${AGENT_PROMPTS.emptyResponseRetryInstruction.buildDefaultContent()}`;
      response = (await executeOnce(retryPrompt)).response;
    }

    return { response };
  }
}
