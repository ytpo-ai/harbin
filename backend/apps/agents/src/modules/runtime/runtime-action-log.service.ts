import { Injectable } from '@nestjs/common';
import { AgentActionLogService } from '../action-logs/agent-action-log.service';
import { RuntimeEvent } from './contracts/runtime-event.contract';

@Injectable()
export class RuntimeActionLogIngestionService {
  private readonly maxPayloadChars = Number(process.env.RUNTIME_ACTION_LOG_SYNC_MAX_PAYLOAD_CHARS || 12000);
  private readonly maxToolOutputChars = Number(process.env.RUNTIME_ACTION_LOG_SYNC_MAX_TOOL_OUTPUT_CHARS || 8000);
  private readonly previewChars = Number(process.env.RUNTIME_ACTION_LOG_SYNC_PREVIEW_CHARS || 2000);

  private readonly allowedEventTypes = new Set<string>([
    'run.started',
    'run.step.started',
    'run.completed',
    'run.failed',
    'run.paused',
    'run.resumed',
    'run.cancelled',
    'tool.pending',
    'tool.running',
    'tool.completed',
    'tool.failed',
    'permission.asked',
    'permission.replied',
    'permission.denied',
  ]);

  constructor(private readonly agentActionLogService: AgentActionLogService) {}

  async syncRuntimeEvent(event: RuntimeEvent): Promise<void> {
    if (!this.allowedEventTypes.has(event.eventType)) {
      return;
    }

    const payload = this.compactPayloadForSync(event);
    await this.agentActionLogService.recordRuntimeHookEvent({
      eventId: event.eventId,
      eventType: event.eventType,
      agentId: event.agentId,
      sessionId: event.sessionId,
      runId: event.runId,
      taskId: event.taskId,
      messageId: event.messageId,
      partId: event.partId,
      toolCallId: event.toolCallId,
      sequence: event.sequence,
      timestamp: event.timestamp,
      traceId: event.traceId,
      payload,
    });
  }

  private compactPayloadForSync(event: RuntimeEvent): Record<string, unknown> {
    const rawPayload = event.payload && typeof event.payload === 'object' ? event.payload : {};
    let compactPayload = rawPayload;

    if (event.eventType === 'tool.completed') {
      compactPayload = this.compactToolCompletedPayload(rawPayload);
    }

    const compactPayloadText = this.safeStringify(compactPayload);
    if (compactPayloadText.length <= this.maxPayloadChars) {
      return compactPayload;
    }

    const toolFields = this.extractToolFields(compactPayload);
    return {
      ...toolFields,
      payloadTruncated: true,
      payloadOriginalSize: compactPayloadText.length,
      payloadPreview: compactPayloadText.slice(0, this.previewChars),
    };
  }

  private compactToolCompletedPayload(payload: Record<string, unknown>): Record<string, unknown> {
    const output = payload.output;
    if (output === undefined) {
      return payload;
    }

    const outputText = this.safeStringify(output);
    if (outputText.length <= this.maxToolOutputChars) {
      return payload;
    }

    const { output: _output, ...rest } = payload;
    return {
      ...rest,
      outputTruncated: true,
      outputSize: outputText.length,
      outputType: Array.isArray(output) ? 'array' : typeof output,
      outputPreview: outputText.slice(0, this.previewChars),
    };
  }

  private safeStringify(value: unknown): string {
    try {
      const serialized = JSON.stringify(value);
      if (serialized !== undefined) {
        return serialized;
      }
    } catch {
      // fallback below
    }
    return String(value);
  }

  private extractToolFields(payload: Record<string, unknown>): Record<string, unknown> {
    const toolId = typeof payload.toolId === 'string' ? payload.toolId : undefined;
    const toolName = typeof payload.toolName === 'string' ? payload.toolName : undefined;
    const params = payload.params !== undefined ? payload.params : payload.input;

    if (params === undefined) {
      return {
        ...(toolId ? { toolId } : {}),
        ...(toolName ? { toolName } : {}),
      };
    }

    const paramsText = this.safeStringify(params);
    if (paramsText.length <= this.previewChars) {
      return {
        ...(toolId ? { toolId } : {}),
        ...(toolName ? { toolName } : {}),
        params,
      };
    }

    return {
      ...(toolId ? { toolId } : {}),
      ...(toolName ? { toolName } : {}),
      paramsTruncated: true,
      paramsSize: paramsText.length,
      paramsPreview: paramsText.slice(0, this.previewChars),
    };
  }

}
