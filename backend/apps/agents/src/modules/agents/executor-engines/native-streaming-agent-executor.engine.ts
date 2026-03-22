import { Injectable, Logger } from '@nestjs/common';

import { ModelService } from '@agent/modules/models/model.service';
import { RuntimeOrchestratorService } from '@agent/modules/runtime/runtime-orchestrator.service';

import { extractToolCall } from '../agent-executor.helpers';

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

    // First streaming round
    const firstRound = await this.streamOnce(input, onToken);

    // Check if model emitted a tool_call — if so, delegate to multi-round tool-calling loop
    const toolCall = extractToolCall(firstRound.response);
    if (toolCall && input.executeWithToolCalling) {
      this.logger.log(
        `[native_stream_tool_detected] taskId=${input.taskId} tool=${toolCall.tool} — falling back to executeWithToolCalling`,
      );
      const response = await input.executeWithToolCalling(
        input.agent,
        input.task,
        input.messages,
        input.modelConfig,
        input.runtimeContext,
        {
          collaborationContext: input.context?.collaborationContext,
          actor: input.context?.actor,
          taskType: input.task.type,
          teamId: input.task.teamId,
        },
      );
      return { response, tokenChunks: firstRound.tokenChunks };
    }

    return {
      response: firstRound.response,
      tokenChunks: firstRound.tokenChunks,
    };
  }

  private async streamOnce(
    input: AgentExecutorEngineInput,
    onToken: (token: string) => void,
  ): Promise<{ response: string; tokenChunks: number }> {
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

    return { response: fullResponse, tokenChunks };
  }
}
