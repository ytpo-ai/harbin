import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Observable, Subject } from 'rxjs';
import {
  OrchestrationPlan,
  OrchestrationPlanDocument,
} from '../../../shared/schemas/orchestration-plan.schema';
import {
  OrchestrationTask,
  OrchestrationTaskDocument,
} from '../../../shared/schemas/orchestration-task.schema';
import { AgentClientService } from '../../agents-client/agent-client.service';

@Injectable()
export class PlanEventStreamService {
  private readonly planEventStreams = new Map<string, Set<Subject<any>>>();

  constructor(
    @InjectModel(OrchestrationPlan.name)
    private readonly orchestrationPlanModel: Model<OrchestrationPlanDocument>,
    @InjectModel(OrchestrationTask.name)
    private readonly orchestrationTaskModel: Model<OrchestrationTaskDocument>,
    private readonly agentClientService: AgentClientService,
  ) {}

  async streamPlanEvents(planId: string): Promise<Observable<any>> {
    const plan = await this.orchestrationPlanModel.findOne({ _id: planId }).lean().exec();
    if (!plan) {
      throw new NotFoundException('Plan not found');
    }

    return new Observable((subscriber) => {
      let streamSet = this.planEventStreams.get(planId);
      if (!streamSet) {
        streamSet = new Set<Subject<any>>();
        this.planEventStreams.set(planId, streamSet);
      }

      const channel = new Subject<any>();
      const channelSubscription = channel.subscribe({
        next: (event) => subscriber.next(event),
        error: (error) => subscriber.error(error),
        complete: () => subscriber.complete(),
      });

      streamSet.add(channel);

      void Promise.all([
        this.orchestrationPlanModel.findOne({ _id: planId }).lean().exec(),
        this.orchestrationTaskModel.find({ planId }).sort({ order: 1 }).lean().exec(),
      ])
        .then(([latestPlan, tasks]) => {
          channel.next({
            data: {
              type: 'plan.snapshot',
              data: {
                planId,
                status: latestPlan?.status,
                stats: latestPlan?.stats,
                tasks: tasks || [],
              },
            },
          });
        })
        .catch(() => undefined);

      return () => {
        channelSubscription.unsubscribe();
        const targetSet = this.planEventStreams.get(planId);
        if (!targetSet) {
          return;
        }
        targetSet.delete(channel);
        channel.complete();
        if (!targetSet.size) {
          this.planEventStreams.delete(planId);
        }
      };
    });
  }

  emitPlanStreamEvent(planId: string, eventType: string, data: Record<string, any>): void {
    const listeners = this.planEventStreams.get(planId);
    if (!listeners?.size) {
      return;
    }
    const event = {
      data: {
        type: eventType,
        data,
      },
    };
    for (const channel of listeners) {
      channel.next(event);
    }
  }

  emitTaskLifecycleEvent(taskId: string, eventType: string, payload: Record<string, any>): void {
    void this.agentClientService
      .publishTaskLifecycleEvent({
        eventType,
        taskId,
        planId: String(payload.planId || ''),
        status: payload.status as any,
        senderAgentId: String(payload.senderAgentId || 'orchestration-system'),
        title: `${eventType}: ${String(payload.taskTitle || taskId)}`,
        content: `Task ${String(payload.taskTitle || taskId)} event ${eventType}`,
        payload,
      })
      .catch(() => undefined);
  }
}
