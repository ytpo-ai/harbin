import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHmac, timingSafeEqual } from 'crypto';
import { Model } from 'mongoose';
import {
  EiOpenCodeRunSyncBatch,
  EiOpenCodeRunSyncBatchDocument,
} from '../schemas/ei-opencode-run-sync-batch.schema';
import { EiOpenCodeEventFact, EiOpenCodeEventFactDocument } from '../schemas/ei-opencode-event-fact.schema';
import {
  EiOpenCodeRunAnalytics,
  EiOpenCodeRunAnalyticsDocument,
} from '../schemas/ei-opencode-run-analytics.schema';

type OpenCodeRunSyncRun = {
  runId: string;
  agentId: string;
  roleCode?: string;
  status?: string;
  startedAt?: Date;
  completedAt?: Date;
};

type OpenCodeRunSyncEvent = {
  eventId: string;
  sequence: number;
  eventType: string;
  timestamp: Date;
  payloadDigest?: string;
};

type OpenCodeRunSyncPayload = {
  syncBatchId: string;
  envId: string;
  nodeId: string;
  run: OpenCodeRunSyncRun;
  events: OpenCodeRunSyncEvent[];
};

@Injectable()
export class EiOpencodeSyncService {
  private readonly nodeIdentityPattern = /^[a-zA-Z0-9._-]{2,64}$/;

  constructor(
    @InjectModel(EiOpenCodeRunSyncBatch.name)
    private readonly syncBatchModel: Model<EiOpenCodeRunSyncBatchDocument>,
    @InjectModel(EiOpenCodeEventFact.name)
    private readonly eventFactModel: Model<EiOpenCodeEventFactDocument>,
    @InjectModel(EiOpenCodeRunAnalytics.name)
    private readonly runAnalyticsModel: Model<EiOpenCodeRunAnalyticsDocument>,
  ) {}

  private ensureContinuousSequence(events: OpenCodeRunSyncEvent[]): void {
    if (events.length <= 1) {
      return;
    }

    const sorted = [...events].sort((a, b) => a.sequence - b.sequence);
    for (let i = 1; i < sorted.length; i += 1) {
      if (sorted[i].sequence !== sorted[i - 1].sequence + 1) {
        throw new BadRequestException(`events sequence gap detected between ${sorted[i - 1].sequence} and ${sorted[i].sequence}`);
      }
    }
  }

  private async upsertEventFacts(payload: OpenCodeRunSyncPayload): Promise<void> {
    if (payload.events.length === 0) {
      return;
    }

    const operations = payload.events.map((event) => ({
      updateOne: {
        filter: {
          runId: payload.run.runId,
          eventId: event.eventId,
        },
        update: {
          $setOnInsert: {
            runId: payload.run.runId,
            eventId: event.eventId,
            sequence: event.sequence,
            eventType: event.eventType,
            eventTimestamp: event.timestamp,
            envId: payload.envId,
            nodeId: payload.nodeId,
            agentId: payload.run.agentId,
            roleCode: payload.run.roleCode,
            payloadDigest: event.payloadDigest,
            syncBatchId: payload.syncBatchId,
            rawEvent: {
              eventId: event.eventId,
              sequence: event.sequence,
              eventType: event.eventType,
              timestamp: event.timestamp.toISOString(),
              payloadDigest: event.payloadDigest,
            },
          },
        },
        upsert: true,
      },
    }));

    await this.eventFactModel.bulkWrite(operations, { ordered: false });
  }

  private async upsertRunAnalytics(payload: OpenCodeRunSyncPayload): Promise<void> {
    const events = payload.events;
    const sequences = events.map((item) => item.sequence);
    const firstSequence = sequences.length ? Math.min(...sequences) : 0;
    const lastSequence = sequences.length ? Math.max(...sequences) : 0;
    const eventTypeBreakdown = events.reduce<Record<string, number>>((acc, event) => {
      acc[event.eventType] = (acc[event.eventType] || 0) + 1;
      return acc;
    }, {});

    const startedAt = payload.run.startedAt;
    const completedAt = payload.run.completedAt;
    const durationMs = startedAt && completedAt ? Math.max(0, completedAt.getTime() - startedAt.getTime()) : 0;

    await this.runAnalyticsModel.updateOne(
      { runId: payload.run.runId },
      {
        $set: {
          runId: payload.run.runId,
          agentId: payload.run.agentId,
          roleCode: payload.run.roleCode,
          runStatus: payload.run.status,
          envId: payload.envId,
          nodeId: payload.nodeId,
          startedAt,
          completedAt,
          durationMs,
          eventCount: events.length,
          firstSequence,
          lastSequence,
          uniqueEventTypeCount: Object.keys(eventTypeBreakdown).length,
          eventTypeBreakdown,
          lastSyncBatchId: payload.syncBatchId,
          lastSyncedAt: new Date(),
        },
      },
      { upsert: true },
    );
  }

  private ensureObject(value: unknown, field: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException(`${field} must be an object`);
    }
    return value as Record<string, unknown>;
  }

  private ensureString(value: unknown, field: string): string {
    const normalized = String(value || '').trim();
    if (!normalized) {
      throw new BadRequestException(`${field} is required`);
    }
    return normalized;
  }

  private parseDate(value: unknown, field: string): Date {
    if (value === undefined || value === null || value === '') {
      throw new BadRequestException(`${field} is required`);
    }
    const parsed = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`${field} must be a valid datetime`);
    }
    return parsed;
  }

  private parseOptionalDate(value: unknown, field: string): Date | undefined {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }
    return this.parseDate(value, field);
  }

  private ensureNodeIdentity(value: unknown, field: string): string {
    const normalized = this.ensureString(value, field);
    if (!this.nodeIdentityPattern.test(normalized)) {
      throw new BadRequestException(`${field} format is invalid`);
    }
    return normalized;
  }

  private verifyNodeSignatureSkeleton(input: {
    payload: unknown;
    signature?: string;
    timestamp?: string;
  }): { verified: boolean; mode: 'disabled' | 'verified' | 'bypass' } {
    const enforce = String(process.env.EI_INGEST_ENFORCE_SIGNATURE || 'false').toLowerCase() === 'true';
    const secret = String(process.env.EI_INGEST_NODE_SECRET || '').trim();
    if (!secret) {
      if (enforce) {
        throw new UnauthorizedException('EI_INGEST_NODE_SECRET is required when signature enforcement is enabled');
      }
      return { verified: false, mode: 'disabled' };
    }

    const signature = String(input.signature || '').trim();
    const timestampRaw = String(input.timestamp || '').trim();
    if (!signature || !timestampRaw) {
      if (enforce) {
        throw new UnauthorizedException('x-ei-node-signature and x-ei-node-timestamp are required');
      }
      return { verified: false, mode: 'bypass' };
    }

    const timestamp = Number(timestampRaw);
    if (!Number.isFinite(timestamp)) {
      throw new UnauthorizedException('x-ei-node-timestamp is invalid');
    }

    const skewMs = Math.abs(Date.now() - timestamp);
    const allowedSkewMs = 5 * 60 * 1000;
    if (skewMs > allowedSkewMs) {
      throw new UnauthorizedException('x-ei-node-timestamp is expired');
    }

    const canonical = `${timestampRaw}.${JSON.stringify(input.payload ?? null)}`;
    const expected = createHmac('sha256', secret).update(canonical).digest('hex');
    const left = Buffer.from(signature, 'utf8');
    const right = Buffer.from(expected, 'utf8');
    const verified = left.length === right.length && timingSafeEqual(left, right);
    if (!verified) {
      throw new UnauthorizedException('x-ei-node-signature verification failed');
    }
    return { verified: true, mode: 'verified' };
  }

  private normalizeOpenCodeRunSyncPayload(input: unknown): OpenCodeRunSyncPayload {
    const payload = this.ensureObject(input, 'payload');
    const runRaw = this.ensureObject(payload.run, 'run');
    const eventsRaw = payload.events;
    if (!Array.isArray(eventsRaw)) {
      throw new BadRequestException('events must be an array');
    }

    const events = eventsRaw.map((eventRaw, index) => {
      const event = this.ensureObject(eventRaw, `events[${index}]`);
      const sequence = Number(event.sequence);
      if (!Number.isInteger(sequence) || sequence < 0) {
        throw new BadRequestException(`events[${index}].sequence must be a non-negative integer`);
      }
      const payloadDigest = event.payloadDigest === undefined ? undefined : String(event.payloadDigest || '').trim();
      return {
        eventId: this.ensureString(event.eventId, `events[${index}].eventId`),
        sequence,
        eventType: this.ensureString(event.eventType, `events[${index}].eventType`),
        timestamp: this.parseDate(event.timestamp, `events[${index}].timestamp`),
        payloadDigest: payloadDigest || undefined,
      };
    });

    return {
      syncBatchId: this.ensureString(payload.syncBatchId, 'syncBatchId'),
      envId: this.ensureNodeIdentity(payload.envId, 'envId'),
      nodeId: this.ensureNodeIdentity(payload.nodeId, 'nodeId'),
      run: {
        runId: this.ensureString(runRaw.runId, 'run.runId'),
        agentId: this.ensureString(runRaw.agentId, 'run.agentId'),
        roleCode: runRaw.roleCode ? String(runRaw.roleCode).trim() : undefined,
        status: runRaw.status ? String(runRaw.status).trim() : undefined,
        startedAt: this.parseOptionalDate(runRaw.startedAt, 'run.startedAt'),
        completedAt: this.parseOptionalDate(runRaw.completedAt, 'run.completedAt'),
      },
      events,
    };
  }

  syncBatch(payload: unknown) {
    return this.syncOpenCodeRun(payload);
  }

  ingestEvents(input: { payload: unknown; signature?: string; timestamp?: string }) {
    return this.ingestOpenCodeEvents(input);
  }

  async syncOpenCodeRun(payload: unknown) {
    const normalized = this.normalizeOpenCodeRunSyncPayload(payload);
    this.ensureContinuousSequence(normalized.events);

    const existing = await this.syncBatchModel
      .findOne({ runId: normalized.run.runId, syncBatchId: normalized.syncBatchId })
      .exec();

    if (existing) {
      return {
        success: true,
        duplicate: true,
        syncBatchId: normalized.syncBatchId,
        runId: normalized.run.runId,
        eventCount: normalized.events.length,
        acceptedAt: existing.updatedAt || existing.createdAt,
      };
    }

    const sequenceValues = normalized.events.map((item) => item.sequence);
    const eventTimestamps = normalized.events.map((item) => item.timestamp.getTime());

    await this.upsertEventFacts(normalized);
    await this.upsertRunAnalytics(normalized);

    try {
      await this.syncBatchModel.create({
        syncBatchId: normalized.syncBatchId,
        runId: normalized.run.runId,
        envId: normalized.envId,
        nodeId: normalized.nodeId,
        agentId: normalized.run.agentId,
        roleCode: normalized.run.roleCode,
        runStatus: normalized.run.status,
        runStartedAt: normalized.run.startedAt,
        runCompletedAt: normalized.run.completedAt,
        eventCount: normalized.events.length,
        minSequence: sequenceValues.length ? Math.min(...sequenceValues) : undefined,
        maxSequence: sequenceValues.length ? Math.max(...sequenceValues) : undefined,
        firstEventAt: eventTimestamps.length ? new Date(Math.min(...eventTimestamps)) : undefined,
        lastEventAt: eventTimestamps.length ? new Date(Math.max(...eventTimestamps)) : undefined,
        status: 'received',
        payload: {
          ...normalized,
          run: {
            ...normalized.run,
            startedAt: normalized.run.startedAt?.toISOString(),
            completedAt: normalized.run.completedAt?.toISOString(),
          },
          events: normalized.events.map((event) => ({
            ...event,
            timestamp: event.timestamp.toISOString(),
          })),
        },
      });
    } catch (error: any) {
      if (error?.code === 11000) {
        return {
          success: true,
          duplicate: true,
          syncBatchId: normalized.syncBatchId,
          runId: normalized.run.runId,
          eventCount: normalized.events.length,
          status: 'duplicate',
        };
      }
      throw error;
    }

    return {
      success: true,
      duplicate: false,
      syncBatchId: normalized.syncBatchId,
      runId: normalized.run.runId,
      eventCount: normalized.events.length,
      status: 'received',
    };
  }

  async ingestOpenCodeEvents(input: {
    payload: unknown;
    signature?: string;
    timestamp?: string;
  }) {
    const signatureResult = this.verifyNodeSignatureSkeleton(input);
    const payloadObject = this.ensureObject(input.payload, 'payload');
    const batchesRaw = payloadObject.batches;

    if (Array.isArray(batchesRaw)) {
      const results = [] as Array<{ runId: string; duplicate: boolean; eventCount: number }>;
      for (let i = 0; i < batchesRaw.length; i += 1) {
        const result = await this.syncOpenCodeRun(batchesRaw[i]);
        results.push({
          runId: String((result as any).runId || ''),
          duplicate: Boolean((result as any).duplicate),
          eventCount: Number((result as any).eventCount || 0),
        });
      }

      return {
        success: true,
        mode: 'batch',
        batchCount: results.length,
        acceptedCount: results.filter((item) => !item.duplicate).length,
        duplicateCount: results.filter((item) => item.duplicate).length,
        signature: signatureResult,
        results,
      };
    }

    const single = await this.syncOpenCodeRun(payloadObject);
    return {
      success: true,
      mode: 'single',
      signature: signatureResult,
      result: single,
    };
  }
}
