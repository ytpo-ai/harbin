import { Injectable, Logger } from '@nestjs/common';
import { OpenCodeAdapter } from './opencode.adapter';
import { RuntimeOrchestratorService, RuntimeRunContext } from '../runtime/runtime-orchestrator.service';
import {
  OpenCodeAdapterEvent,
  OpenCodeExecutionStartInput,
  OpenCodeExecutionStartResult,
} from './contracts/opencode.contract';

interface RuntimeMappedEvent {
  runtimeEventType: 'llm.delta' | 'run.completed' | 'run.failed' | 'ignore';
  payload: Record<string, unknown>;
}

@Injectable()
export class OpenCodeExecutionService {
  private readonly logger = new Logger(OpenCodeExecutionService.name);

  constructor(
    private readonly adapter: OpenCodeAdapter,
    private readonly runtimeOrchestrator: RuntimeOrchestratorService,
  ) {}

  async startExecution(input: OpenCodeExecutionStartInput): Promise<OpenCodeExecutionStartResult> {
    const sessionId = await this.ensureSessionId(input);
    const result = await this.adapter.promptSession({
      sessionId,
      prompt: input.taskPrompt,
      model: input.model,
    });

    return {
      sessionId,
      response: result.response,
      metadata: result.metadata,
    };
  }

  async consumeSessionEvents(
    sessionId: string,
    onEvent: (event: OpenCodeAdapterEvent) => Promise<void> | void,
  ): Promise<void> {
    for await (const event of this.adapter.subscribeEvents(sessionId)) {
      try {
        await onEvent(event);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error || 'unknown error');
        this.logger.warn(`OpenCode event handler failed: ${message}`);
      }
    }
  }

  mapOpenCodeEventToRuntimePayload(event: OpenCodeAdapterEvent): Record<string, unknown> {
    return {
      source: 'opencode',
      eventType: event.type,
      sessionId: event.sessionId,
      timestamp: event.timestamp,
      payload: event.payload,
    };
  }

  mapOpenCodeEventToRuntimeEvent(event: OpenCodeAdapterEvent): RuntimeMappedEvent {
    const normalizedType = String(event.type || '').toLowerCase();
    if (normalizedType.includes('progress') || normalizedType.includes('delta')) {
      return {
        runtimeEventType: 'llm.delta',
        payload: this.mapOpenCodeEventToRuntimePayload(event),
      };
    }
    if (normalizedType.includes('failed') || normalizedType.includes('error')) {
      return {
        runtimeEventType: 'run.failed',
        payload: this.mapOpenCodeEventToRuntimePayload(event),
      };
    }
    if (normalizedType.includes('completed') || normalizedType.includes('done')) {
      return {
        runtimeEventType: 'run.completed',
        payload: this.mapOpenCodeEventToRuntimePayload(event),
      };
    }
    return {
      runtimeEventType: 'ignore',
      payload: this.mapOpenCodeEventToRuntimePayload(event),
    };
  }

  async executeWithRuntimeBridge(input: {
    runtimeContext: RuntimeRunContext;
    agentId: string;
    taskId?: string;
    taskPrompt: string;
    title?: string;
    sessionConfig?: Record<string, unknown>;
    model?: {
      providerID: string;
      modelID: string;
    };
    mapEvent?: (event: OpenCodeAdapterEvent) => RuntimeMappedEvent;
  }): Promise<OpenCodeExecutionStartResult> {
    const result = await this.startExecution({
      taskPrompt: input.taskPrompt,
      sessionId: input.runtimeContext.sessionId,
      title: input.title,
      sessionConfig: input.sessionConfig,
      model: input.model,
    });

    const syntheticEvents: OpenCodeAdapterEvent[] = [
      {
        type: 'step.progress',
        sessionId: result.sessionId,
        timestamp: new Date().toISOString(),
        payload: {
          text: result.response,
          metadata: result.metadata,
        },
        raw: result,
      },
      {
        type: 'task.completed',
        sessionId: result.sessionId,
        timestamp: new Date().toISOString(),
        payload: {
          metadata: result.metadata,
        },
        raw: result,
      },
    ];

    const mapper = input.mapEvent || this.mapOpenCodeEventToRuntimeEvent.bind(this);
    let sequence = 10_000;

    for (const event of syntheticEvents) {
      const mapped = mapper(event);
      if (mapped.runtimeEventType === 'llm.delta') {
        await this.runtimeOrchestrator.recordLlmDelta({
          runId: input.runtimeContext.runId,
          agentId: input.agentId,
          messageId: input.runtimeContext.userMessageId,
          traceId: input.runtimeContext.traceId,
          sequence: sequence++,
          delta: result.response,
          sessionId: input.runtimeContext.sessionId,
          taskId: input.taskId,
        });
      }
    }

    return result;
  }

  private async ensureSessionId(input: OpenCodeExecutionStartInput): Promise<string> {
    if (input.sessionId?.trim()) {
      return input.sessionId.trim();
    }

    const session = await this.adapter.createSession({
      title: input.title,
      config: input.sessionConfig,
    });
    return session.id;
  }
}
