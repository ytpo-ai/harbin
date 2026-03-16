import { Injectable, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { MessageEvent } from '@nestjs/common';
import { AgentTaskEvent } from './contracts/agent-task.contract';
import { RedisService } from '@libs/infra';

@Injectable()
export class RuntimeSseStreamService {
  private readonly logger = new Logger(RuntimeSseStreamService.name);
  private readonly heartbeatIntervalMs = Math.max(5000, Number(process.env.AGENT_TASK_SSE_HEARTBEAT_MS || 15000));

  constructor(private readonly redisService: RedisService) {}

  buildTaskChannel(taskId: string): string {
    return `agent-task-events:${taskId}`;
  }

  createTaskSseStream(options: {
    taskId: string;
    replay: AgentTaskEvent[];
  }): Observable<MessageEvent> {
    const { taskId, replay } = options;

    return new Observable<MessageEvent>((subscriber) => {
      replay.forEach((event) => {
        subscriber.next(this.toSseMessage(event));
      });

      const channel = this.buildTaskChannel(taskId);
      const listener = (message: string) => {
        try {
          const parsed = JSON.parse(message) as AgentTaskEvent;
          subscriber.next(this.toSseMessage(parsed));
        } catch (error) {
          const reason = error instanceof Error ? error.message : 'unknown';
          this.logger.warn(`Failed to parse task event message taskId=${taskId}: ${reason}`);
        }
      };

      void this.redisService.subscribe(channel, listener).catch((error) => {
        const reason = error instanceof Error ? error.message : 'unknown';
        this.logger.warn(`Subscribe task channel failed taskId=${taskId}: ${reason}`);
      });

      const timer = setInterval(() => {
        const heartbeat: AgentTaskEvent = {
          id: `hb-${Date.now()}`,
          type: 'heartbeat',
          taskId,
          sequence: 0,
          timestamp: new Date().toISOString(),
          payload: {
            ok: true,
          },
        };
        subscriber.next(this.toSseMessage(heartbeat));
      }, this.heartbeatIntervalMs);

      return () => {
        clearInterval(timer);
        void this.redisService.unsubscribe(channel, listener).catch(() => undefined);
      };
    });
  }

  private toSseMessage(event: AgentTaskEvent): MessageEvent {
    return {
      id: event.id,
      type: event.type,
      data: event,
    };
  }
}
