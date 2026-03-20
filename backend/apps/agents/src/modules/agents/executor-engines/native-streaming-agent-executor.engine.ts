import { Injectable, Logger } from '@nestjs/common';

import { ModelService } from '@agent/modules/models/model.service';
import { RuntimeOrchestratorService } from '@agent/modules/runtime/runtime-orchestrator.service';

import { AgentExecutorEngine } from './agent-executor-engine.interface';
import { AgentExecutorEngineInput, AgentExecutorEngineResult } from './agent-executor-engine.types';

@Injectable()
export class NativeStreamingAgentExecutorEngine implements AgentExecutorEngine {
  private readonly logger = new Logger(NativeStreamingAgentExecutorEngine.name);

  readonly mode = 'streaming' as const;
  readonly channel = 'native' as const;

  constructor(
    private readonly modelService: ModelService,
    private readonly runtimeOrchestrator: RuntimeOrchestratorService,
  ) {}

  async execute(input: AgentExecutorEngineInput): Promise<AgentExecutorEngineResult> {
    const onToken = input.onToken;
    if (!onToken) {
      throw new Error('Missing onToken callback for native streaming execution');
    }

    const customApiKey = await input.resolveCustomApiKey('stream_task');
    this.modelService.ensureProviderWithKey(input.modelConfig, customApiKey);

    let fullResponse = '';
    let tokenChunks = 0;
    let streamSequence = 1;
    let runtimeInterrupted = false;

    await this.modelService.streamingChat(
      input.agent.model.id,
      input.messages,
      (token) => {
        if (runtimeInterrupted) {
          throw new Error('Runtime run interrupted');
        }
        fullResponse += token;
        tokenChunks += 1;
        onToken(token);
        if (tokenChunks % 20 === 0) {
          void this.runtimeOrchestrator.assertRunnable(input.runtimeContext.runId).catch(() => {
            runtimeInterrupted = true;
          });
        }
        void this.runtimeOrchestrator
          .recordLlmDelta({
            runId: input.runtimeContext.runId,
            agentId: input.runtimeAgentId,
            messageId: input.runtimeContext.userMessageId,
            traceId: input.runtimeContext.traceId,
            sequence: streamSequence++,
            delta: token,
            sessionId: input.runtimeContext.sessionId,
            taskId: input.taskId,
          })
          .catch((eventError) => {
            const eventMessage = eventError instanceof Error ? eventError.message : String(eventError || 'unknown');
            this.logger.warn(`[stream_llm_delta_event_failed] taskId=${input.taskId} error=${eventMessage}`);
          });
      },
      {
        temperature: input.agent.model.temperature,
        maxTokens: input.agent.model.maxTokens,
      },
    );

    return {
      response: fullResponse,
      tokenChunks,
    };
  }
}
