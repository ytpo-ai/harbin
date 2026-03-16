import { Injectable, Logger } from '@nestjs/common';
import { OpenCodeAdapter } from './opencode.adapter';
import { RuntimeOrchestratorService, RuntimeRunContext } from '../runtime/runtime-orchestrator.service';
import {
  OpenCodeAdapterEvent,
  OpenCodeExecutionStartInput,
  OpenCodeExecutionStartResult,
  OpenCodeRuntimeOptions,
} from './contracts/opencode.contract';

interface RuntimeMappedEvent {
  runtimeEventType: 'llm.delta' | 'run.completed' | 'run.failed' | 'ignore';
  payload: Record<string, unknown>;
}

@Injectable()
export class OpenCodeExecutionService {
  private readonly logger = new Logger(OpenCodeExecutionService.name);
  private readonly eventReadTimeoutMs = 5000;
  private readonly eventReadLimit = 40;

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
      runtime: input.runtime,
    });

    return {
      sessionId,
      response: result.response,
      metadata: result.metadata,
    };
  }

  async consumeSessionEvents(
    sessionId: string,
    runtime: OpenCodeRuntimeOptions | undefined,
    onEvent: (event: OpenCodeAdapterEvent) => Promise<void> | void,
  ): Promise<void> {
    for await (const event of this.adapter.subscribeEvents(sessionId, runtime)) {
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
    runtime?: OpenCodeRuntimeOptions;
    mapEvent?: (event: OpenCodeAdapterEvent) => RuntimeMappedEvent;
    onDelta?: (delta: string) => void | Promise<void>;
    onSessionReady?: (sessionId: string) => void | Promise<void>;
  }): Promise<OpenCodeExecutionStartResult> {
    const sessionId = await this.ensureSessionId({
      taskPrompt: input.taskPrompt,
      sessionId: undefined,
      title: input.title,
      sessionConfig: input.sessionConfig,
      model: input.model,
      runtime: input.runtime,
    });
    await input.onSessionReady?.(sessionId);
    const prompt = await this.adapter.promptSession({
      sessionId,
      prompt: input.taskPrompt,
      model: input.model,
      runtime: input.runtime,
    });
    const result: OpenCodeExecutionStartResult = {
      sessionId,
      response: prompt.response,
      metadata: prompt.metadata,
    };

    const mapper = input.mapEvent || this.mapOpenCodeEventToRuntimeEvent.bind(this);
    let sequence = 10_000;
    let recordedFromRealEvents = 0;
    const responseChunks: string[] = [];

    const realEvents = await this.collectSessionEvents(
      result.sessionId,
      this.eventReadLimit,
      this.eventReadTimeoutMs,
      input.runtime,
    );
    for (const event of realEvents) {
      const mapped = mapper(event);
      if (mapped.runtimeEventType !== 'llm.delta') {
        continue;
      }

      const delta = this.extractDeltaText(mapped.payload) || this.extractDeltaText(event.payload || {});
      if (!delta) {
        continue;
      }

      responseChunks.push(delta);
      await input.onDelta?.(delta);

      await this.runtimeOrchestrator.recordLlmDelta({
        runId: input.runtimeContext.runId,
        agentId: input.agentId,
        messageId: input.runtimeContext.userMessageId,
        traceId: input.runtimeContext.traceId,
        sequence: sequence++,
        delta,
        sessionId: input.runtimeContext.sessionId,
        taskId: input.taskId,
      });
      recordedFromRealEvents += 1;
    }

    if (recordedFromRealEvents === 0 && result.response) {
      await this.runtimeOrchestrator.recordLlmDelta({
        runId: input.runtimeContext.runId,
        agentId: input.agentId,
        messageId: input.runtimeContext.userMessageId,
        traceId: input.runtimeContext.traceId,
        sequence,
        delta: result.response,
        sessionId: input.runtimeContext.sessionId,
        taskId: input.taskId,
      });
    }

    const eventReconstructedResponse = responseChunks.join('').trim();
    if (!result.response && eventReconstructedResponse) {
      this.logger.log(
        `OpenCode response reconstructed from events sessionId=${result.sessionId} chunks=${responseChunks.length}`,
      );
      return {
        ...result,
        response: eventReconstructedResponse,
      };
    }

    return result;
  }

  async cancelSession(sessionId: string, runtime?: OpenCodeRuntimeOptions): Promise<boolean> {
    const normalizedSessionId = String(sessionId || '').trim();
    if (!normalizedSessionId) {
      return false;
    }

    try {
      this.logger.log(
        `OpenCode abort request start sessionId=${normalizedSessionId} endpoint=${runtime?.baseUrl || 'env_default'}`,
      );
      await this.adapter.abortSession(normalizedSessionId, runtime);
      this.logger.log(
        `OpenCode abort request success sessionId=${normalizedSessionId} endpoint=${runtime?.baseUrl || 'env_default'}`,
      );
      return true;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error || 'unknown');
      this.logger.warn(
        `OpenCode abort request failed sessionId=${normalizedSessionId} endpoint=${runtime?.baseUrl || 'env_default'} reason=${reason}`,
      );
      return false;
    }
  }

  private async collectSessionEvents(
    sessionId: string,
    limit: number,
    timeoutMs: number,
    runtime?: OpenCodeRuntimeOptions,
  ): Promise<OpenCodeAdapterEvent[]> {
    const events: OpenCodeAdapterEvent[] = [];
    const stream = this.adapter.subscribeEvents(sessionId, runtime);
    const iterator = stream[Symbol.asyncIterator]();

    try {
      while (events.length < limit) {
        const next = await Promise.race([
          iterator.next(),
          new Promise<{ timeout: true }>((resolve) => {
            setTimeout(() => resolve({ timeout: true }), timeoutMs);
          }),
        ]);

        if ((next as { timeout?: true }).timeout) {
          break;
        }

        const value = next as IteratorResult<OpenCodeAdapterEvent>;
        if (value.done) {
          break;
        }

        events.push(value.value);
      }
    } finally {
      try {
        await iterator.return?.(undefined as any);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error || 'unknown error');
        this.logger.debug(`OpenCode event iterator close failed: ${message}`);
      }
    }

    return events;
  }

  private extractDeltaText(payload: Record<string, unknown>): string {
    const directKeys = ['delta', 'text', 'content', 'message'];
    for (const key of directKeys) {
      const value = payload[key];
      if (typeof value === 'string' && value.trim()) {
        return value;
      }
    }

    const nested = payload.payload;
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      for (const key of directKeys) {
        const value = (nested as Record<string, unknown>)[key];
        if (typeof value === 'string' && value.trim()) {
          return value;
        }
      }
    }

    const candidateObjects = [payload, nested].filter(
      (item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)),
    );
    for (const obj of candidateObjects) {
      const info = obj.info;
      if (info && typeof info === 'object' && !Array.isArray(info)) {
        const infoContent = (info as Record<string, unknown>).content;
        if (typeof infoContent === 'string' && infoContent.trim()) {
          return infoContent;
        }
        const infoParts = (info as Record<string, unknown>).parts;
        const textFromInfoParts = this.extractTextFromParts(infoParts);
        if (textFromInfoParts) {
          return textFromInfoParts;
        }
      }

      const textFromParts = this.extractTextFromParts(obj.parts);
      if (textFromParts) {
        return textFromParts;
      }
    }

    return '';
  }

  private extractTextFromParts(parts: unknown): string {
    if (!Array.isArray(parts)) {
      return '';
    }

    const chunks: string[] = [];
    for (const part of parts) {
      if (!part || typeof part !== 'object' || Array.isArray(part)) {
        continue;
      }
      const row = part as Record<string, unknown>;
      if (typeof row.text === 'string' && row.text.trim()) {
        chunks.push(row.text);
        continue;
      }
      if (typeof row.content === 'string' && row.content.trim()) {
        chunks.push(row.content);
      }
    }

    return chunks.join('').trim();
  }

  private async ensureSessionId(input: OpenCodeExecutionStartInput): Promise<string> {
    if (input.sessionId?.trim()) {
      return input.sessionId.trim();
    }

    const session = await this.adapter.createSession({
      title: input.title,
      config: input.sessionConfig,
      model: input.model,
      runtime: input.runtime,
    });
    return session.id;
  }
}
