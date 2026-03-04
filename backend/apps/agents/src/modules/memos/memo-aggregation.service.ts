import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Agent, AgentDocument } from '../../../../../src/shared/schemas/agent.schema';
import { MemoDomainEvent, MemoDomainEventName, MemoEventBusService } from './memo-event-bus.service';
import { MemoService } from './memo.service';
import { IdentityAggregationService } from './identity-aggregation.service';
import { EvaluationAggregationService } from './evaluation-aggregation.service';

@Injectable()
export class MemoAggregationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MemoAggregationService.name);
  private timer?: NodeJS.Timeout;
  private scheduledTimer?: NodeJS.Timeout;
  private running = false;
  private readonly listeners: Array<{ name: MemoDomainEventName; handler: (event: MemoDomainEvent) => void }> = [];

  constructor(
    private readonly memoService: MemoService,
    private readonly memoEventBus: MemoEventBusService,
    private readonly identityAggregationService: IdentityAggregationService,
    private readonly evaluationAggregationService: EvaluationAggregationService,
    @InjectModel(Agent.name) private readonly agentModel: Model<AgentDocument>,
  ) {}

  onModuleInit(): void {
    this.bindEventBusListeners();
    const intervalMs = Math.max(10_000, Number(process.env.MEMO_AGGREGATION_INTERVAL_MS || 60_000));
    this.timer = setInterval(() => {
      void this.runAggregation();
    }, intervalMs);

    const scheduledIntervalMs = Number(process.env.MEMO_FULL_AGGREGATION_INTERVAL_MS || 24 * 60 * 60 * 1000);
    this.scheduledTimer = setInterval(() => {
      void this.handleScheduledFullAggregation();
    }, scheduledIntervalMs);

    void this.runAggregation();
    this.logger.log(`Memo aggregation scheduler started, interval=${intervalMs}ms`);
    this.logger.log(`Scheduled full aggregation interval=${scheduledIntervalMs}ms`);
  }

  onModuleDestroy(): void {
    this.unbindEventBusListeners();
    if (this.timer) {
      clearInterval(this.timer);
    }
    if (this.scheduledTimer) {
      clearInterval(this.scheduledTimer);
    }
  }

  async triggerFullAggregation(): Promise<void> {
    return this.handleScheduledFullAggregation();
  }

  private async handleScheduledFullAggregation(): Promise<void> {
    this.logger.log('Starting scheduled full aggregation for all agents');
    try {
      const agents = await this.agentModel.find({ isActive: true }).exec();
      for (const agent of agents) {
        try {
          const runtimeAgentId = agent.id || (agent as any)._id?.toString();
          if (!runtimeAgentId) continue;
          await Promise.all([
            this.identityAggregationService.aggregateIdentity(runtimeAgentId),
            this.evaluationAggregationService.aggregateEvaluation(runtimeAgentId),
          ]);
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          const runtimeAgentId = agent.id || (agent as any)._id?.toString();
          this.logger.error(`Failed to aggregate identity/evaluation for agent ${runtimeAgentId}: ${message}`);
        }
      }
      this.logger.log(`Scheduled full aggregation completed for ${agents.length} agents`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Scheduled full aggregation failed: ${message}`);
    }
  }

  private bindEventBusListeners(): void {
    const register = (name: MemoDomainEventName) => {
      const handler = (event: MemoDomainEvent) => {
        this.handleEvent(event);
      };
      this.memoEventBus.on(name, handler);
      this.listeners.push({ name, handler });
    };

    register('agent.updated');
    register('agent.skill_changed');
    register('task.completed');
    register('orchestration.task_completed');
  }

  private async handleEvent(event: MemoDomainEvent): Promise<void> {
    this.logger.log(`Handling event: ${event.name} for agent: ${event.agentId}`);

    switch (event.name) {
      case 'agent.updated':
      case 'agent.skill_changed':
        try {
          await this.identityAggregationService.aggregateIdentity(event.agentId);
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          this.logger.error(`Failed to aggregate identity for agent ${event.agentId}: ${message}`);
        }
        break;

      case 'task.completed':
      case 'orchestration.task_completed':
        try {
          await this.identityAggregationService.aggregateIdentity(event.agentId);
          await this.evaluationAggregationService.aggregateEvaluation(event.agentId);
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          this.logger.error(`Failed to aggregate for agent ${event.agentId}: ${message}`);
        }
        break;

      default:
        this.logger.warn(`Unhandled event type: ${event.name}`);
    }
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
