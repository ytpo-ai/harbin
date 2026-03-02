import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { MemoService } from './memo.service';

@Injectable()
export class MemoAggregationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MemoAggregationService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly memoService: MemoService) {}

  onModuleInit(): void {
    const intervalMs = Math.max(10_000, Number(process.env.MEMO_AGGREGATION_INTERVAL_MS || 60_000));
    this.timer = setInterval(() => {
      void this.runAggregation();
    }, intervalMs);
    void this.runAggregation();
    this.logger.log(`Memo aggregation scheduler started, interval=${intervalMs}ms`);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  private async runAggregation(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.memoService.flushEventQueue();
      if (result.events > 0) {
        this.logger.log(`Memo aggregation flushed events=${result.events}, agents=${result.agents}, topics=${result.topics}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Memo aggregation failed: ${message}`);
    } finally {
      this.running = false;
    }
  }
}
