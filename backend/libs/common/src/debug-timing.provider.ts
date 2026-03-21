import { Injectable, Logger } from '@nestjs/common';

export interface DebugTimingRecord {
  traceId: string;
  stage: string;
  startedAt: number;
  extras?: Record<string, unknown>;
  traceFieldName?: string;
}

@Injectable()
export class DebugTimingProvider {
  private readonly logger = new Logger(DebugTimingProvider.name);
  private readonly enabled = this.readEnvBoolean('AGENT_DEBUG_TIMING', false);

  log(record: DebugTimingRecord): void {
    if (!this.enabled) {
      return;
    }
    const traceFieldName = record.traceFieldName || 'traceId';
    const extraText = record.extras
      ? Object.entries(record.extras)
          .map(([key, value]) => `${key}=${String(value)}`)
          .join(' ')
      : '';
    this.logger.debug(
      `[timing_debug] ${traceFieldName}=${record.traceId} stage=${record.stage} durationMs=${Date.now() - record.startedAt}${extraText ? ` ${extraText}` : ''}`,
    );
  }

  private readEnvBoolean(name: string, fallback: boolean): boolean {
    const raw = process.env[name];
    if (raw === undefined) {
      return fallback;
    }
    const normalized = raw.trim().toLowerCase();
    if (!normalized) {
      return fallback;
    }
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
  }
}
