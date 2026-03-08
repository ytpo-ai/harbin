import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { encodeUserContext, signEncodedContext } from '@libs/auth';
import { GatewayUserContext } from '@libs/contracts';
import { RuntimeEvent } from './contracts/runtime-event.contract';

@Injectable()
export class RuntimeActionLogSyncService {
  private readonly legacyBaseUrl = process.env.LEGACY_SERVICE_URL || 'http://localhost:3001/api';
  private readonly contextSecret = process.env.INTERNAL_CONTEXT_SECRET || 'internal-context-secret';
  private readonly timeout = Number(process.env.RUNTIME_ACTION_LOG_SYNC_TIMEOUT_MS || 8000);
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

  async syncRuntimeEvent(event: RuntimeEvent): Promise<void> {
    if (!this.allowedEventTypes.has(event.eventType)) {
      return;
    }

    const payload = this.compactPayloadForSync(event);
    await axios.post(
      `${this.legacyBaseUrl}/agent-action-logs/internal/runtime-hooks`,
      {
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
      },
      {
        headers: this.buildSignedHeaders(event),
        timeout: this.timeout,
      },
    );
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

    return {
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

  private buildSignedHeaders(event: RuntimeEvent): Record<string, string> {
    const now = Date.now();
    const context: GatewayUserContext = {
      employeeId: 'agents-service',
      role: 'system',
      organizationId: event.organizationId,
      issuedAt: now,
      expiresAt: now + 60 * 1000,
    };
    const encoded = encodeUserContext(context);
    const signature = signEncodedContext(encoded, this.contextSecret);
    return {
      'x-user-context': encoded,
      'x-user-signature': signature,
      'content-type': 'application/json',
    };
  }

}
