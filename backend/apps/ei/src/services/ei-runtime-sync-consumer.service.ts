import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { MESSAGE_BUS, type MessageBus, type Subscription, type MessageContext } from '@libs/infra';
import { EiOpencodeSyncService } from './opencode-sync.service';

/**
 * EiRuntimeSyncConsumerService —— EI 侧的 Redis Stream 消费者。
 *
 * 订阅 `runtime.ei-sync` topic（consumer group: ei-sync-group），
 * 接收 agents 服务通过消息总线发布的 Run Sync 数据，
 * 复用已有的 `EiOpencodeSyncService.syncOpenCodeRun()` 入库逻辑。
 *
 * 这是 EI app 首个 Redis Stream 消费者，替代原有的 HTTP `/ei/sync-batches` 主链路。
 */
@Injectable()
export class EiRuntimeSyncConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EiRuntimeSyncConsumerService.name);
  private subscription?: Subscription;

  /** 是否启用 stream 消费（与 agents 侧的 RUNTIME_EI_SYNC_STREAM_ENABLED 对应） */
  private readonly enabled = process.env.RUNTIME_EI_SYNC_STREAM_ENABLED !== 'false';

  constructor(
    @Inject(MESSAGE_BUS) private readonly messageBus: MessageBus,
    private readonly opencodeSyncService: EiOpencodeSyncService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.enabled) {
      this.logger.log('EI runtime sync consumer disabled (RUNTIME_EI_SYNC_STREAM_ENABLED=false)');
      return;
    }

    try {
      this.subscription = await this.messageBus.subscribe(
        'runtime.ei-sync',
        (context: MessageContext<unknown>) => this.handleMessage(context),
        {
          group: 'ei-sync-group',
          consumer: `ei-consumer-${process.env.HOSTNAME || process.pid}`,
          batchSize: 10,
          blockMs: 2000,
        },
      );
      this.logger.log('EI runtime sync consumer started — topic=runtime.ei-sync group=ei-sync-group');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to start EI runtime sync consumer: ${msg}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.subscription) {
      await this.subscription.unsubscribe();
      this.subscription = undefined;
      this.logger.log('EI runtime sync consumer stopped');
    }
  }

  private async handleMessage(context: MessageContext<unknown>): Promise<void> {
    const { envelope } = context;
    const payload = envelope.payload;

    // payload 结构与 HTTP /ei/sync-batches 完全一致，直接复用 syncOpenCodeRun
    const runId = (payload as Record<string, unknown>)?.run
      ? ((payload as Record<string, unknown>).run as Record<string, unknown>)?.runId
      : undefined;

    try {
      const result = await this.opencodeSyncService.syncOpenCodeRun(payload) as {
        success: boolean;
        duplicate?: boolean;
        syncBatchId?: string;
        runId?: string;
        eventCount?: number;
        status?: string;
      };

      if (result.duplicate) {
        this.logger.debug(
          `[ei_sync_consumer] duplicate — messageId=${envelope.messageId} runId=${runId} syncBatchId=${result.syncBatchId || 'n/a'}`,
        );
      } else {
        this.logger.log(
          `[ei_sync_consumer] synced — messageId=${envelope.messageId} runId=${runId} syncBatchId=${result.syncBatchId || 'n/a'} eventCount=${result.eventCount ?? 0}`,
        );
      }

      await context.ack();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[ei_sync_consumer] failed — messageId=${envelope.messageId} runId=${runId} error=${msg}`,
      );
      await context.nack(msg);
    }
  }
}
