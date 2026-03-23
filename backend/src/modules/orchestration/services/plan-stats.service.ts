import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  OrchestrationPlan,
  OrchestrationPlanDocument,
  OrchestrationPlanStatus,
} from '../../../shared/schemas/orchestration-plan.schema';
import {
  OrchestrationTask,
  OrchestrationTaskDocument,
} from '../../../shared/schemas/orchestration-task.schema';
import {
  PlanSession,
  PlanSessionDocument,
} from '../../../shared/schemas/orchestration-plan-session.schema';

@Injectable()
export class PlanStatsService {
  constructor(
    @InjectModel(OrchestrationPlan.name)
    private readonly orchestrationPlanModel: Model<OrchestrationPlanDocument>,
    @InjectModel(OrchestrationTask.name)
    private readonly orchestrationTaskModel: Model<OrchestrationTaskDocument>,
    @InjectModel(PlanSession.name)
    private readonly planSessionModel: Model<PlanSessionDocument>,
  ) {}

  async refreshPlanStats(planId: string): Promise<void> {
    const tasks = await this.orchestrationTaskModel.find({ planId }).exec();
    const stats = {
      totalTasks: tasks.length,
      completedTasks: 0,
      failedTasks: 0,
      waitingHumanTasks: 0,
    };

    await this.orchestrationPlanModel
      .updateOne(
        { _id: planId },
        {
          $set: {
            stats,
          },
        },
      )
      .exec();
  }

  async setPlanStatus(planId: string, status: OrchestrationPlanStatus): Promise<void> {
    await this.orchestrationPlanModel
      .updateOne(
        { _id: planId },
        {
          $set: {
            status,
          },
        },
      )
      .exec();
  }

  async setPlanSessionStatus(planId: string, status: OrchestrationPlanStatus): Promise<void> {
    const mappedStatus = status === 'drafting' ? 'active' : 'active';
    await this.planSessionModel
      .updateOne(
        { planId },
        {
          $set: {
            status: mappedStatus,
          },
        },
      )
      .exec();
  }

  normalizePlanStatus(status?: string, taskCount = 0): OrchestrationPlanStatus {
    if (status === 'draft' || status === 'drafting' || status === 'planned') {
      return status;
    }
    if (status === 'failed' && taskCount === 0) {
      return 'draft';
    }
    return 'planned';
  }

  async syncPlanSessionTasks(planId: string): Promise<void> {
    const plan = await this.orchestrationPlanModel.findOne({ _id: planId }).select({ title: 1 }).lean().exec();
    const tasks = await this.orchestrationTaskModel
      .find({ planId })
      .sort({ order: 1 })
      .lean<OrchestrationTask[]>()
      .exec();

    const snapshots = tasks.map((task, index) => ({
      taskId: this.getEntityId(task as any),
      order: index,
      title: task.title,
      status: task.status,
      input: task.description,
      output: task.result?.output,
      error: task.result?.error,
      executorType: task.assignment?.executorType,
      executorId: task.assignment?.executorId,
      updatedAt: new Date(),
    }));

    await this.planSessionModel
      .updateOne(
        { planId },
        {
          $set: {
            ...(plan?.title ? { title: plan.title } : {}),
            tasks: snapshots,
          },
        },
        { upsert: true },
      )
      .exec();
  }

  private getEntityId(entity: Record<string, any>): string {
    const docId = entity?._id;
    if (typeof docId === 'string') {
      return docId;
    }
    if (docId?.toString) {
      return docId.toString();
    }
    return String(entity?.id || '');
  }

  async updatePlanSessionTask(
    planId: string,
    taskId: string,
    patch: {
      status?: 'pending' | 'assigned' | 'in_progress' | 'blocked' | 'waiting_human' | 'completed' | 'failed' | 'cancelled';
      input?: string;
      output?: string;
      error?: string;
      executorType?: 'agent' | 'employee' | 'unassigned';
      executorId?: string;
      agentSessionId?: string;
      agentRunId?: string;
    },
  ): Promise<void> {
    if (!String(planId || '').trim()) {
      return;
    }

    const setPayload: Record<string, any> = {
      'tasks.$.updatedAt': new Date(),
    };
    if (patch.status) setPayload['tasks.$.status'] = patch.status;
    if (patch.input !== undefined) setPayload['tasks.$.input'] = patch.input;
    if (patch.output !== undefined) setPayload['tasks.$.output'] = patch.output;
    if (patch.error !== undefined) setPayload['tasks.$.error'] = patch.error;
    if (patch.executorType !== undefined) setPayload['tasks.$.executorType'] = patch.executorType;
    if (patch.executorId !== undefined) setPayload['tasks.$.executorId'] = patch.executorId;
    if (patch.agentSessionId !== undefined) setPayload['tasks.$.agentSessionId'] = patch.agentSessionId;
    if (patch.agentRunId !== undefined) setPayload['tasks.$.agentRunId'] = patch.agentRunId;

    await this.planSessionModel
      .updateOne(
        { planId, 'tasks.taskId': taskId },
        {
          $set: setPayload,
        },
      )
      .exec();
  }
}
