import { Injectable, Logger } from '@nestjs/common';
import { OpenCodeAdapter } from './opencode.adapter';
import { RuntimeOrchestratorService, RuntimeRunContext } from '../runtime/runtime-orchestrator.service';
import { RuntimePersistenceService } from '../runtime/runtime-persistence.service';
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
  private readonly eventStreamIdleTickMs = 1000;
  private readonly maxBufferedEvents = 400;
  private readonly activeAbortControllers = new Map<string, AbortController>();

  constructor(
    private readonly adapter: OpenCodeAdapter,
    private readonly runtimeOrchestrator: RuntimeOrchestratorService,
    private readonly runtimePersistence: RuntimePersistenceService,
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

    const abortController = new AbortController();
    this.activeAbortControllers.set(sessionId, abortController);
    this.logger.log(`[opencode_prompt] registered AbortController sessionId=${sessionId}`);

    let prompt: { response: string; metadata: Record<string, unknown> };
    const mapper = input.mapEvent || this.mapOpenCodeEventToRuntimeEvent.bind(this);
    const liveBridge = this.startLiveEventBridge({
      sessionId,
      runtime: input.runtime,
      mapEvent: mapper,
      onDelta: input.onDelta,
      runtimeContext: input.runtimeContext,
      agentId: input.agentId,
      taskId: input.taskId,
      initialSequence: 10_000,
    });
    try {
      prompt = await this.adapter.promptSession(
        {
          sessionId,
          prompt: input.taskPrompt,
          model: input.model,
          runtime: input.runtime,
        },
        { signal: abortController.signal },
      );
    } catch (error) {
      if (this.isAbortError(error)) {
        this.logger.log(`[opencode_prompt] aborted sessionId=${sessionId}`);
        await liveBridge.stop();
        return {
          sessionId,
          response: '',
          metadata: {},
        };
      }
      throw error;
    } finally {
      this.activeAbortControllers.delete(sessionId);
      await this.sleep(300);
      await liveBridge.stop();
    }
    const result: OpenCodeExecutionStartResult = {
      sessionId,
      response: prompt.response,
      metadata: prompt.metadata,
    };

    const realEvents = liveBridge.events;
    const recordedFromRealEvents = liveBridge.getRecordedDeltaCount();

    if (recordedFromRealEvents === 0 && result.response) {
      await this.runtimeOrchestrator.recordLlmDelta({
        runId: input.runtimeContext.runId,
        agentId: input.agentId,
        messageId: input.runtimeContext.userMessageId,
        traceId: input.runtimeContext.traceId,
        sequence: liveBridge.getNextSequence(),
        delta: result.response,
        sessionId: input.runtimeContext.sessionId,
        taskId: input.taskId,
      });
      await input.onDelta?.(result.response);
    }

    const eventReconstructedResponse = liveBridge.getReconstructedResponse();
    if (!result.response && eventReconstructedResponse) {
      this.logger.log(
        `OpenCode response reconstructed from events sessionId=${result.sessionId} events=${realEvents.length}`,
      );
      const reconstructed = {
        ...result,
        response: eventReconstructedResponse,
      };
      await this.persistOpenCodeStepMessages(input, realEvents, reconstructed.response);
      return reconstructed;
    }

    await this.persistOpenCodeStepMessages(input, realEvents, result.response || eventReconstructedResponse);

    return result;
  }

  private async persistOpenCodeStepMessages(
    input: {
      runtimeContext: RuntimeRunContext;
      agentId: string;
      taskId?: string;
      model?: {
        providerID: string;
        modelID: string;
      };
    },
    events: OpenCodeAdapterEvent[],
    fallbackResponse: string,
  ): Promise<void> {
    if (!input.runtimeContext.sessionId) {
      return;
    }

    type StepAccumulator = {
      stepIndex: number;
      textChunks: string[];
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
      }>;
      sawTool: boolean;
      hasError: boolean;
      startedAt: Date;
      endedAt: Date;
    };

    const steps = new Map<number, StepAccumulator>();
    const getStep = (stepIndex: number): StepAccumulator => {
      const normalized = Number.isFinite(stepIndex) && stepIndex >= 0 ? Math.floor(stepIndex) : 0;
      const existing = steps.get(normalized);
      if (existing) {
        return existing;
      }
      const created: StepAccumulator = {
        stepIndex: normalized,
        textChunks: [],
        parts: [],
        sawTool: false,
        hasError: false,
        startedAt: new Date(),
        endedAt: new Date(),
      };
      steps.set(normalized, created);
      return created;
    };

    for (const event of events) {
      const stepIndex = this.resolveStepIndexFromEvent(event);
      const step = getStep(stepIndex);
      const classification = this.classifyOpenCodeEvent(event);
      const now = new Date(event.timestamp || Date.now());
      if (now.getTime() < step.startedAt.getTime()) {
        step.startedAt = now;
      }
      if (now.getTime() > step.endedAt.getTime()) {
        step.endedAt = now;
      }

      if (classification.part) {
        step.parts.push(classification.part);
      }
      if (classification.text) {
        step.textChunks.push(classification.text);
      }
      if (classification.sawTool) {
        step.sawTool = true;
      }
      if (classification.hasError) {
        step.hasError = true;
      }
    }

    if (!steps.size) {
      const step = getStep(0);
      if (fallbackResponse) {
        step.textChunks.push(fallbackResponse);
        step.parts.push({
          type: 'text',
          status: 'completed',
          content: fallbackResponse,
        });
      }
    }

    const sortedSteps = Array.from(steps.values()).sort((a, b) => a.stepIndex - b.stepIndex);
    for (const step of sortedSteps) {
      const content = step.textChunks.join('').trim() || fallbackResponse || '';
      const finish: 'stop' | 'tool-calls' | 'error' = step.hasError ? 'error' : step.sawTool ? 'tool-calls' : 'stop';
      const status: 'error' | 'completed' = step.hasError ? 'error' : 'completed';

      const stepParts = [
        {
          sequence: 1,
          type: 'step_start' as const,
          status: 'completed' as const,
          metadata: {
            source: 'opencode',
            stepIndex: step.stepIndex,
          },
          startedAt: step.startedAt,
          endedAt: step.startedAt,
        },
        ...step.parts.map((part, index) => ({
          sequence: index + 2,
          ...part,
          startedAt: step.startedAt,
          endedAt: step.endedAt,
        })),
        {
          sequence: step.parts.length + 2,
          type: 'step_finish' as const,
          status,
          metadata: {
            source: 'opencode',
            finish,
          },
          startedAt: step.endedAt,
          endedAt: step.endedAt,
        },
      ];

      await this.runtimePersistence.bulkCreateMessageWithParts(
        {
          runId: input.runtimeContext.runId,
          agentId: input.agentId,
          sessionId: input.runtimeContext.sessionId,
          taskId: input.taskId,
          role: 'assistant',
          sequence: step.stepIndex + 2,
          content,
          status,
          parentMessageId: input.runtimeContext.userMessageId,
          modelID: input.model?.modelID,
          providerID: input.model?.providerID,
          finish,
          stepIndex: step.stepIndex,
          metadata: {
            source: 'opencode.executeWithRuntimeBridge',
          },
        },
        stepParts,
      );
    }
  }

  private resolveStepIndexFromEvent(event: OpenCodeAdapterEvent): number {
    const payload = event.payload || {};
    const candidates = [
      (payload.stepIndex as unknown),
      (payload.step as unknown),
      (payload.round as unknown),
      ((payload.meta as Record<string, unknown> | undefined)?.stepIndex as unknown),
      ((payload.metadata as Record<string, unknown> | undefined)?.stepIndex as unknown),
      ((payload.payload as Record<string, unknown> | undefined)?.stepIndex as unknown),
    ];
    for (const candidate of candidates) {
      if (typeof candidate === 'number' && Number.isFinite(candidate)) {
        return Math.max(0, Math.floor(candidate));
      }
      if (typeof candidate === 'string' && candidate.trim()) {
        const parsed = Number(candidate);
        if (Number.isFinite(parsed)) {
          return Math.max(0, Math.floor(parsed));
        }
      }
    }
    return 0;
  }

  private classifyOpenCodeEvent(event: OpenCodeAdapterEvent): {
    part?: {
      type: 'text' | 'reasoning' | 'tool_call' | 'tool_result' | 'system_event' | 'step_start' | 'step_finish';
      status: 'pending' | 'running' | 'completed' | 'error' | 'cancelled';
      content?: string;
      input?: unknown;
      output?: unknown;
      toolId?: string;
      toolCallId?: string;
      metadata?: Record<string, unknown>;
      error?: string;
    };
    text?: string;
    sawTool: boolean;
    hasError: boolean;
  } {
    const normalizedType = String(event.type || '').toLowerCase();
    const payload = event.payload || {};
    const nestedPayload = payload.payload && typeof payload.payload === 'object'
      ? (payload.payload as Record<string, unknown>)
      : undefined;
    const text = this.extractDeltaText(payload) || (nestedPayload ? this.extractDeltaText(nestedPayload) : '');

    if (normalizedType.includes('reason')) {
      return {
        part: {
          type: 'reasoning',
          status: 'completed',
          content: text || String(payload.reasoning || payload.content || ''),
          metadata: { sourceEventType: event.type },
        },
        text,
        sawTool: false,
        hasError: false,
      };
    }

    if (normalizedType.includes('tool')) {
      const toolId = String(payload.toolId || payload.toolName || nestedPayload?.toolId || '').trim() || undefined;
      const toolCallId = String(payload.toolCallId || nestedPayload?.toolCallId || '').trim() || undefined;
      const inputValue = payload.input ?? payload.params ?? nestedPayload?.input ?? nestedPayload?.params;
      const outputValue = payload.output ?? nestedPayload?.output;
      const error = String(payload.error || nestedPayload?.error || '').trim() || undefined;
      const isResult = normalizedType.includes('result') || normalizedType.includes('complete') || normalizedType.includes('output') || normalizedType.includes('fail');
      return {
        part: {
          type: isResult ? 'tool_result' : 'tool_call',
          status: error ? 'error' : 'completed',
          toolId,
          toolCallId,
          input: isResult ? undefined : inputValue,
          output: isResult ? (outputValue ?? text) : undefined,
          error,
          metadata: { sourceEventType: event.type },
        },
        text,
        sawTool: true,
        hasError: Boolean(error),
      };
    }

    if (normalizedType.includes('error') || normalizedType.includes('fail')) {
      const error = String(payload.error || payload.message || '').trim() || 'opencode_event_error';
      return {
        part: {
          type: 'system_event',
          status: 'error',
          content: text || error,
          error,
          metadata: { sourceEventType: event.type },
        },
        text,
        sawTool: false,
        hasError: true,
      };
    }

    if (text) {
      return {
        part: {
          type: 'text',
          status: 'completed',
          content: text,
          metadata: { sourceEventType: event.type },
        },
        text,
        sawTool: false,
        hasError: false,
      };
    }

    return {
      part: {
        type: 'system_event',
        status: 'completed',
        content: normalizedType || 'opencode_event',
        metadata: {
          sourceEventType: event.type,
          payload,
        },
      },
      sawTool: false,
      hasError: false,
    };
  }

  async cancelSession(sessionId: string, runtime?: OpenCodeRuntimeOptions): Promise<boolean> {
    const normalizedSessionId = String(sessionId || '').trim();
    if (!normalizedSessionId) {
      return false;
    }

    // 1. Abort the in-flight HTTP request (so executeWithRuntimeBridge returns immediately)
    const controller = this.activeAbortControllers.get(normalizedSessionId);
    if (controller) {
      this.logger.log(`[opencode_cancel] aborting in-flight HTTP request sessionId=${normalizedSessionId}`);
      controller.abort();
      this.activeAbortControllers.delete(normalizedSessionId);
    } else {
      this.logger.log(`[opencode_cancel] no active AbortController for sessionId=${normalizedSessionId}`);
    }

    // 2. Call OpenCode server abort endpoint with retry
    const maxRetries = 2;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        this.logger.log(
          `OpenCode abort request start sessionId=${normalizedSessionId} endpoint=${runtime?.baseUrl || 'env_default'} attempt=${attempt + 1}/${maxRetries + 1}`,
        );
        await this.adapter.abortSession(normalizedSessionId, runtime);
        this.logger.log(
          `OpenCode abort request success sessionId=${normalizedSessionId} endpoint=${runtime?.baseUrl || 'env_default'}`,
        );
        return true;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error || 'unknown');
        this.logger.warn(
          `OpenCode abort request failed sessionId=${normalizedSessionId} endpoint=${runtime?.baseUrl || 'env_default'} attempt=${attempt + 1}/${maxRetries + 1} reason=${reason}`,
        );
        if (attempt < maxRetries) {
          await this.sleep(1000 * (attempt + 1));
        } else {
          // All retries exhausted — still return true if we aborted the HTTP request
          return !!controller;
        }
      }
    }
    return !!controller;
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private isAbortError(error: unknown): boolean {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return true;
    }
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      if (message.includes('abort') || message.includes('cancel')) {
        return true;
      }
      // Axios wraps abort errors with code 'ERR_CANCELED'
      if ((error as any).code === 'ERR_CANCELED' || (error as any).code === 'ECONNABORTED') {
        return true;
      }
    }
    return false;
  }

  private startLiveEventBridge(input: {
    sessionId: string;
    runtime?: OpenCodeRuntimeOptions;
    mapEvent: (event: OpenCodeAdapterEvent) => RuntimeMappedEvent;
    onDelta?: (delta: string) => void | Promise<void>;
    runtimeContext: RuntimeRunContext;
    agentId: string;
    taskId?: string;
    initialSequence: number;
  }): {
    events: OpenCodeAdapterEvent[];
    getRecordedDeltaCount: () => number;
    getReconstructedResponse: () => string;
    getNextSequence: () => number;
    stop: () => Promise<void>;
  } {
    const events: OpenCodeAdapterEvent[] = [];
    const responseChunks: string[] = [];
    let recordedDeltaCount = 0;
    let sequence = input.initialSequence;
    let stopped = false;
    const stream = this.adapter.subscribeEvents(input.sessionId, input.runtime);
    const iterator = stream[Symbol.asyncIterator]();

    const consume = async () => {
      try {
        while (!stopped) {
          const next = await Promise.race([
            iterator.next(),
            new Promise<{ timeout: true }>((resolve) => {
              setTimeout(() => resolve({ timeout: true }), this.eventStreamIdleTickMs);
            }),
          ]);

          if ((next as { timeout?: true }).timeout) {
            continue;
          }

          const value = next as IteratorResult<OpenCodeAdapterEvent>;
          if (value.done) {
            break;
          }

          const event = value.value;
          events.push(event);
          if (events.length > this.maxBufferedEvents) {
            events.shift();
          }

          const mapped = input.mapEvent(event);
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
          recordedDeltaCount += 1;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error || 'unknown error');
        this.logger.warn(`OpenCode live event bridge failed sessionId=${input.sessionId}: ${message}`);
      }
    };

    const consumerPromise = consume();

    const stop = async () => {
      if (stopped) {
        return;
      }
      stopped = true;
      try {
        await iterator.return?.(undefined as any);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error || 'unknown error');
        this.logger.debug(`OpenCode live event iterator close failed: ${message}`);
      }
      await consumerPromise;
    };

    return {
      events,
      getRecordedDeltaCount: () => {
        return recordedDeltaCount;
      },
      getReconstructedResponse: () => {
        return responseChunks.join('').trim();
      },
      getNextSequence: () => {
        return sequence;
      },
      stop,
    };
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
