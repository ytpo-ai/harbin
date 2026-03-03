import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { MemoDomainEvent, MemoEventBusService } from './memo-event-bus.service';
import { MemoService } from './memo.service';

@Injectable()
export class MemoAggregationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MemoAggregationService.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private readonly listeners: Array<{ name: 'agent.updated' | 'agent.skill_changed' | 'task.completed'; handler: (event: MemoDomainEvent) => void }> = [];

  constructor(
    private readonly memoService: MemoService,
    private readonly memoEventBus: MemoEventBusService,
  ) {}

  onModuleInit(): void {
    this.bindEventBusListeners();
    const intervalMs = Math.max(10_000, Number(process.env.MEMO_AGGREGATION_INTERVAL_MS || 60_000));
    this.timer = setInterval(() => {
      void this.runAggregation();
    }, intervalMs);
    void this.runAggregation();
    this.logger.log(`Memo aggregation scheduler started, interval=${intervalMs}ms`);
  }

  onModuleDestroy(): void {
    this.unbindEventBusListeners();
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  private bindEventBusListeners(): void {
    const register = (name: 'agent.updated' | 'agent.skill_changed' | 'task.completed') => {
      const handler = (event: MemoDomainEvent) => {
        void this.memoService.enqueueRefreshTask({
          agentId: event.agentId,
          memoKinds: event.memoKinds,
          reason: event.name,
          taskId: event.taskId,
          summary: event.summary,
        });
      };
      this.memoEventBus.on(name, handler);
      this.listeners.push({ name, handler });
    };

    register('agent.updated');
    register('agent.skill_changed');
    register('task.completed');
  }

  private unbindEventBusListeners(): void {
    for (const item of this.listeners) {
      this.memoEventBus.off(item.name, item.handler);
    }
    this.listeners.length = 0;
  }

  private async runAggregation(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const refreshResult = await this.memoService.flushRefreshQueue();
      if (refreshResult.jobs > 0) {
        this.logger.log(`Memo refresh queue flushed jobs=${refreshResult.jobs}, agents=${refreshResult.agents}`);
      }
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
