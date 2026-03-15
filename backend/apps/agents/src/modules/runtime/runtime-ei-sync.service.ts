import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import axios from 'axios';
import { encodeUserContext, signEncodedContext } from '@libs/auth';
import { GatewayUserContext } from '@libs/contracts';
import { AgentRun, AgentRunDocument } from '../../schemas/agent-run.schema';
import { RuntimePersistenceService } from './runtime-persistence.service';

@Injectable()
export class RuntimeEiSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RuntimeEiSyncService.name);
  private timer?: NodeJS.Timeout;
  private flushing = false;

  private readonly eiBaseUrl = process.env.ENGINEERING_INTELLIGENCE_SERVICE_URL || 'http://localhost:3004';
  private readonly contextSecret = String(process.env.INTERNAL_CONTEXT_SECRET || '').trim();
  private readonly maxRetry = Math.max(1, Number(process.env.RUNTIME_EI_SYNC_MAX_RETRY || 5));
  private readonly pollIntervalMs = Math.max(1000, Number(process.env.RUNTIME_EI_SYNC_POLL_INTERVAL_MS || 5000));
  private readonly timeoutMs = Math.max(2000, Number(process.env.RUNTIME_EI_SYNC_TIMEOUT_MS || 10000));
  private readonly batchLimit = Math.max(1, Number(process.env.RUNTIME_EI_SYNC_BATCH_LIMIT || 20));
  private readonly envId = String(process.env.RUNTIME_SYNC_ENV_ID || process.env.NODE_ENV || 'local').trim();
  private readonly nodeId = String(process.env.RUNTIME_SYNC_NODE_ID || 'agents-node').trim();

  constructor(
    @InjectModel(AgentRun.name) private readonly runModel: Model<AgentRunDocument>,
    private readonly persistence: RuntimePersistenceService,
  ) {
    if (!this.contextSecret) {
      throw new Error('INTERNAL_CONTEXT_SECRET is required');
    }
  }

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.flushPendingRuns();
    }, this.pollIntervalMs);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async scheduleRunSync(runId: string): Promise<void> {
    await this.runModel.updateOne({ id: runId }, {
      $set: {
        'sync.state': 'pending',
        'sync.nextRetryAt': new Date(),
      },
      $setOnInsert: {
        'sync.retryCount': 0,
      },
    }).exec();
  }

  async syncRunNow(runId: string, options?: { replay?: boolean }): Promise<{ success: boolean; reason?: string }> {
    const run = await this.runModel.findOne({ id: runId }).exec();
    if (!run) {
      return { success: false, reason: 'run_not_found' };
    }

    try {
      const payload = await this.buildRunSyncPayload(run);
      const response = await axios.post(
        `${this.eiBaseUrl}/ei/sync-batches`,
        payload,
        {
          headers: this.buildSignedHeaders(),
          timeout: this.timeoutMs,
        },
      );

      const duplicate = Boolean(response?.data?.duplicate);
      await this.runModel.updateOne(
        { id: runId },
        {
          $set: {
            'sync.state': 'synced',
            'sync.lastSyncAt': new Date(),
            'sync.lastError': undefined,
            'sync.nextRetryAt': undefined,
            'executionData.sync': {
              ...(run.executionData?.sync as Record<string, unknown> || {}),
              lastResult: duplicate ? 'duplicate' : 'synced',
              replay: Boolean(options?.replay),
              syncedAt: new Date().toISOString(),
            },
          },
        },
      ).exec();
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || 'sync_failed');
      const retryCount = Number(run.sync?.retryCount || 0) + 1;
      const deadLettered = retryCount >= this.maxRetry;
      const backoffMs = Math.min(60_000, retryCount * 5000);
      await this.runModel.updateOne(
        { id: runId },
        {
          $set: {
            'sync.state': 'failed',
            'sync.retryCount': retryCount,
            'sync.lastError': message,
            'sync.nextRetryAt': deadLettered ? undefined : new Date(Date.now() + backoffMs),
            'sync.deadLettered': deadLettered,
            'executionData.sync': {
              ...(run.executionData?.sync as Record<string, unknown> || {}),
              lastResult: 'failed',
              replay: Boolean(options?.replay),
              failedAt: new Date().toISOString(),
              error: message,
            },
          },
        },
      ).exec();
      this.logger.warn(`EI sync failed runId=${runId} retry=${retryCount} deadLettered=${deadLettered}: ${message}`);
      return { success: false, reason: message };
    }
  }

  async flushPendingRuns(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      const now = new Date();
      const runs = await this.runModel.find({
        status: { $in: ['completed', 'failed', 'cancelled'] },
        $or: [
          { 'sync.state': 'pending' },
          {
            'sync.state': 'failed',
            'sync.deadLettered': { $ne: true },
            $or: [
              { 'sync.nextRetryAt': { $exists: false } },
              { 'sync.nextRetryAt': null },
              { 'sync.nextRetryAt': { $lte: now } },
            ],
          },
        ],
      }).sort({ updatedAt: 1 }).limit(this.batchLimit).exec();

      for (const run of runs) {
        await this.syncRunNow(run.id);
      }
    } finally {
      this.flushing = false;
    }
  }

  async listDeadLetterRuns(limit = 100): Promise<AgentRun[]> {
    return this.runModel.find({ 'sync.state': 'failed', 'sync.deadLettered': true })
      .sort({ updatedAt: -1 })
      .limit(Math.max(1, Math.min(500, limit)))
      .exec();
  }

  async requeueDeadLetterRuns(runIds?: string[], limit = 100, dryRun = false): Promise<{ matched: number; requeued: number }> {
    const query: Record<string, unknown> = {
      'sync.state': 'failed',
      'sync.deadLettered': true,
    };
    if (runIds?.length) {
      query.id = { $in: runIds };
    }

    const rows = await this.runModel.find(query).sort({ updatedAt: -1 }).limit(Math.max(1, Math.min(500, limit))).exec();
    if (dryRun || rows.length === 0) {
      return { matched: rows.length, requeued: 0 };
    }

    const ids = rows.map((row) => row.id);
    const result = await this.runModel.updateMany(
      { id: { $in: ids } },
      {
        $set: {
          'sync.state': 'pending',
          'sync.deadLettered': false,
          'sync.nextRetryAt': new Date(),
        },
      },
    ).exec();
    return { matched: rows.length, requeued: result.modifiedCount || 0 };
  }

  private async buildRunSyncPayload(run: AgentRunDocument): Promise<Record<string, unknown>> {
    const events = await this.persistence.findEventsByRun(run.id, { limit: 5000 });
    const syncBatchId = `sync-${run.id}-${Date.now()}`;

    return {
      syncBatchId,
      envId: this.envId,
      nodeId: this.nodeId,
      run: {
        runId: run.id,
        agentId: run.agentId,
        roleCode: run.roleCode,
        status: run.status,
        startedAt: run.startedAt?.toISOString?.() || new Date().toISOString(),
        completedAt: run.finishedAt?.toISOString?.(),
      },
      events: events.map((event) => ({
        eventId: event.eventId,
        sequence: event.sequence,
        eventType: event.eventType,
        timestamp: event.timestamp.toISOString(),
        payloadDigest: this.buildPayloadDigest(event.payload),
      })),
    };
  }

  private buildPayloadDigest(payload: Record<string, unknown> | undefined): string {
    const text = JSON.stringify(payload || {});
    return Buffer.from(text).toString('base64').slice(0, 128);
  }

  private buildSignedHeaders(): Record<string, string> {
    const now = Date.now();
    const context: GatewayUserContext = {
      employeeId: 'agents-service',
      role: 'system',
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
