import { INestApplicationContext } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CronJob } from 'cron';
import {
  OrchestrationSchedule,
  OrchestrationScheduleDocument,
} from '../src/shared/schemas/orchestration-schedule.schema';
import {
  OrchestrationPlan,
  OrchestrationPlanDocument,
} from '../src/shared/schemas/orchestration-plan.schema';

type SystemSeedName =
  | 'meeting-monitor'
  | 'engineering-statistics'
  | 'memo-event-flush'
  | 'memo-full-aggregation';

const SYSTEM_SEED_ORDER: SystemSeedName[] = [
  'meeting-monitor',
  'engineering-statistics',
  'memo-event-flush',
  'memo-full-aggregation',
];

const systemMeetingMonitorScheduleName = 'system-meeting-monitor';
const systemMeetingMonitorPlanKey = 'system-meeting-monitor';
const systemEngineeringStatisticsScheduleName = 'system-engineering-statistics';
const systemEngineeringStatisticsPlanKey = 'system-engineering-statistics';
const systemMemoEventFlushScheduleName = 'system-memo-event-flush';
const systemMemoEventFlushPlanKey = 'system-memo-event-flush';
const systemMemoFullAggregationScheduleName = 'system-memo-full-aggregation';
const systemMemoFullAggregationPlanKey = 'system-memo-full-aggregation';
const engineeringStatisticsToolId = 'builtin.sys-mg.mcp.rd-intelligence.engineering-statistics-run';

export async function seedSystemSchedules(
  app: INestApplicationContext,
  options?: { only?: SystemSeedName[] },
): Promise<{ total: number; enabled: number; seeded: SystemSeedName[] }> {
  const scheduleModel = app.get<Model<OrchestrationScheduleDocument>>(getModelToken(OrchestrationSchedule.name));
  const planModel = app.get<Model<OrchestrationPlanDocument>>(getModelToken(OrchestrationPlan.name));
  const only = options?.only?.length ? options.only : SYSTEM_SEED_ORDER;
  const selected = SYSTEM_SEED_ORDER.filter((name) => only.includes(name));
  const created: OrchestrationScheduleDocument[] = [];

  for (const seed of selected) {
    if (seed === 'meeting-monitor') {
      const schedule = await ensureMeetingMonitorSchedule(scheduleModel, planModel);
      if (schedule) created.push(schedule);
      continue;
    }
    if (seed === 'engineering-statistics') {
      const schedule = await ensureEngineeringStatisticsSchedule(scheduleModel, planModel);
      if (schedule) created.push(schedule);
      continue;
    }
    if (seed === 'memo-event-flush') {
      const schedule = await ensureMemoEventFlushSchedule(scheduleModel, planModel);
      if (schedule) created.push(schedule);
      continue;
    }
    if (seed === 'memo-full-aggregation') {
      const schedule = await ensureMemoFullAggregationSchedule(scheduleModel, planModel);
      if (schedule) created.push(schedule);
    }
  }

  return {
    total: created.length,
    enabled: created.filter((schedule) => schedule.enabled).length,
    seeded: selected,
  };
}

async function ensureMeetingMonitorSchedule(
  scheduleModel: Model<OrchestrationScheduleDocument>,
  planModel: Model<OrchestrationPlanDocument>,
): Promise<OrchestrationScheduleDocument | null> {
  const plan = await ensureSystemPlan(planModel, {
    systemKey: systemMeetingMonitorPlanKey,
    linkedScheduleName: systemMeetingMonitorScheduleName,
    title: '系统会议监控计划',
    sourcePrompt: '系统内置计划：监控 active 会议空闲状态，在超时阈值触发提醒并自动结束会议',
  });
  const planId = getEntityId(plan as unknown as Record<string, unknown>);
  const existing = await scheduleModel.findOne({ name: systemMeetingMonitorScheduleName }).exec();

  const intervalMs = Number(process.env.MEETING_ASSISTANT_INTERVAL_MS || 300000);
  if (intervalMs < 300000) {
    return null;
  }

  const input = buildMeetingMonitorInput();
  if (existing) {
    await scheduleModel
      .updateOne(
        { _id: getEntityId(existing as unknown as Record<string, unknown>) },
        {
          $set: {
            input,
            'schedule.intervalMs': intervalMs,
            planId,
          },
        },
      )
      .exec();
    return scheduleModel.findOne({ _id: getEntityId(existing as unknown as Record<string, unknown>) }).exec();
  }

  return new scheduleModel({
    name: systemMeetingMonitorScheduleName,
    description: '系统内置：监控进行中的会议，在会议长时间未活动时发送提醒并自动结束',
    planId,
    schedule: {
      type: 'interval',
      intervalMs,
    },
    target: {
      executorType: 'agent',
      executorId: 'meeting-assistant',
      executorName: '会议助理',
    },
    input,
    enabled: true,
    status: 'idle',
    nextRunAt: new Date(Date.now() + intervalMs),
    stats: {
      totalRuns: 0,
      successRuns: 0,
      failedRuns: 0,
      skippedRuns: 0,
    },
    createdBy: 'system',
  }).save();
}

async function ensureEngineeringStatisticsSchedule(
  scheduleModel: Model<OrchestrationScheduleDocument>,
  planModel: Model<OrchestrationPlanDocument>,
): Promise<OrchestrationScheduleDocument | null> {
  const plan = await ensureSystemPlan(planModel, {
    systemKey: systemEngineeringStatisticsPlanKey,
    linkedScheduleName: systemEngineeringStatisticsScheduleName,
    title: '系统工程统计计划',
    sourcePrompt: '系统内置计划：执行工程统计工具，统计 docs/frontend/backend 数据并通知消息中心',
  });
  const planId = getEntityId(plan as unknown as Record<string, unknown>);
  const existing = await scheduleModel.findOne({ name: systemEngineeringStatisticsScheduleName }).exec();

  const cronExpression = String(process.env.ENGINEERING_STATISTICS_CRON || '0 9 * * *').trim();
  const timezone = String(process.env.ENGINEERING_STATISTICS_TIMEZONE || 'Asia/Shanghai').trim() || 'Asia/Shanghai';
  const targetAgentId = String(process.env.ENGINEERING_STATISTICS_AGENT_ID || 'meeting-assistant').trim();

  const input = {
    prompt: '系统内置计划：触发工程统计工具，生成统计快照并通过消息中心通知结果。',
    payload: {
      toolId: engineeringStatisticsToolId,
      toolParameters: {
        scope: 'all',
        tokenMode: 'estimate',
        triggeredBy: 'system-schedule',
      },
    },
  };

  if (existing) {
    await scheduleModel
      .updateOne(
        { _id: getEntityId(existing as unknown as Record<string, unknown>) },
        {
          $set: {
            planId,
            schedule: {
              type: 'cron',
              expression: cronExpression,
              timezone,
            },
            target: {
              executorType: 'agent',
              executorId: targetAgentId,
            },
            input,
          },
        },
      )
      .exec();
    return scheduleModel.findOne({ _id: getEntityId(existing as unknown as Record<string, unknown>) }).exec();
  }

  return new scheduleModel({
    name: systemEngineeringStatisticsScheduleName,
    description: '系统内置：定时触发工程统计计划',
    planId,
    schedule: {
      type: 'cron',
      expression: cronExpression,
      timezone,
    },
    target: {
      executorType: 'agent',
      executorId: targetAgentId,
    },
    input,
    enabled: true,
    status: 'idle',
    nextRunAt: computeNextRunAt({
      type: 'cron',
      expression: cronExpression,
      timezone,
    }),
    stats: {
      totalRuns: 0,
      successRuns: 0,
      failedRuns: 0,
      skippedRuns: 0,
    },
    createdBy: 'system',
  }).save();
}

async function ensureMemoEventFlushSchedule(
  scheduleModel: Model<OrchestrationScheduleDocument>,
  planModel: Model<OrchestrationPlanDocument>,
): Promise<OrchestrationScheduleDocument | null> {
  const plan = await ensureSystemPlan(planModel, {
    systemKey: systemMemoEventFlushPlanKey,
    linkedScheduleName: systemMemoEventFlushScheduleName,
    title: '系统 Memo 事件聚合计划',
    sourcePrompt: '系统内置计划：异步触发 memo 事件聚合 flush',
  });
  const planId = getEntityId(plan as unknown as Record<string, unknown>);
  const existing = await scheduleModel.findOne({ name: systemMemoEventFlushScheduleName }).exec();

  const intervalMs = Math.max(10_000, Number(process.env.MEMO_AGGREGATION_INTERVAL_MS || 60_000));
  const targetAgentId = String(process.env.MEMO_AGGREGATION_AGENT_ID || 'meeting-assistant').trim() || 'meeting-assistant';
  const input = {
    prompt: '系统内置计划：异步触发 memo 事件聚合 flush。',
    payload: {
      memoCommand: 'flush_events',
      triggeredBy: 'system-schedule',
    },
  };

  if (existing) {
    await scheduleModel
      .updateOne(
        { _id: getEntityId(existing as unknown as Record<string, unknown>) },
        {
          $set: {
            planId,
            schedule: {
              type: 'interval',
              intervalMs,
            },
            target: {
              executorType: 'agent',
              executorId: targetAgentId,
            },
            input,
          },
        },
      )
      .exec();
    return scheduleModel.findOne({ _id: getEntityId(existing as unknown as Record<string, unknown>) }).exec();
  }

  return new scheduleModel({
    name: systemMemoEventFlushScheduleName,
    description: '系统内置：定时触发 memo 事件聚合 flush',
    planId,
    schedule: {
      type: 'interval',
      intervalMs,
    },
    target: {
      executorType: 'agent',
      executorId: targetAgentId,
    },
    input,
    enabled: String(process.env.MEMO_EVENT_FLUSH_SCHEDULE_ENABLED || 'true').toLowerCase() !== 'false',
    status: 'idle',
    nextRunAt: new Date(Date.now() + intervalMs),
    stats: {
      totalRuns: 0,
      successRuns: 0,
      failedRuns: 0,
      skippedRuns: 0,
    },
    createdBy: 'system',
  }).save();
}

async function ensureMemoFullAggregationSchedule(
  scheduleModel: Model<OrchestrationScheduleDocument>,
  planModel: Model<OrchestrationPlanDocument>,
): Promise<OrchestrationScheduleDocument | null> {
  const plan = await ensureSystemPlan(planModel, {
    systemKey: systemMemoFullAggregationPlanKey,
    linkedScheduleName: systemMemoFullAggregationScheduleName,
    title: '系统 Memo 全量聚合计划',
    sourcePrompt: '系统内置计划：异步触发 memo 全量聚合（Identity + Evaluation）',
  });
  const planId = getEntityId(plan as unknown as Record<string, unknown>);
  const existing = await scheduleModel.findOne({ name: systemMemoFullAggregationScheduleName }).exec();

  const intervalMs = Math.max(60_000, Number(process.env.MEMO_FULL_AGGREGATION_INTERVAL_MS || 24 * 60 * 60 * 1000));
  const targetAgentId = String(process.env.MEMO_AGGREGATION_AGENT_ID || 'meeting-assistant').trim() || 'meeting-assistant';
  const input = {
    prompt: '系统内置计划：异步触发 memo 全量聚合。',
    payload: {
      memoCommand: 'full_aggregation',
      triggeredBy: 'system-schedule',
    },
  };

  if (existing) {
    await scheduleModel
      .updateOne(
        { _id: getEntityId(existing as unknown as Record<string, unknown>) },
        {
          $set: {
            planId,
            schedule: {
              type: 'interval',
              intervalMs,
            },
            target: {
              executorType: 'agent',
              executorId: targetAgentId,
            },
            input,
          },
        },
      )
      .exec();
    return scheduleModel.findOne({ _id: getEntityId(existing as unknown as Record<string, unknown>) }).exec();
  }

  return new scheduleModel({
    name: systemMemoFullAggregationScheduleName,
    description: '系统内置：定时触发 memo 全量聚合',
    planId,
    schedule: {
      type: 'interval',
      intervalMs,
    },
    target: {
      executorType: 'agent',
      executorId: targetAgentId,
    },
    input,
    enabled: String(process.env.MEMO_FULL_AGGREGATION_SCHEDULE_ENABLED || 'true').toLowerCase() !== 'false',
    status: 'idle',
    nextRunAt: new Date(Date.now() + intervalMs),
    stats: {
      totalRuns: 0,
      successRuns: 0,
      failedRuns: 0,
      skippedRuns: 0,
    },
    createdBy: 'system',
  }).save();
}

async function ensureSystemPlan(
  planModel: Model<OrchestrationPlanDocument>,
  options: {
    systemKey: string;
    linkedScheduleName: string;
    title: string;
    sourcePrompt: string;
  },
): Promise<OrchestrationPlanDocument> {
  const plan = await planModel
    .findOneAndUpdate(
      { 'metadata.systemKey': options.systemKey },
      {
        $set: {
          title: options.title,
          sourcePrompt: options.sourcePrompt,
          status: 'planned',
          strategy: {
            plannerAgentId: 'meeting-assistant',
            mode: 'hybrid',
          },
          createdBy: 'system',
          'metadata.system': true,
          'metadata.systemKey': options.systemKey,
          'metadata.linkedScheduleName': options.linkedScheduleName,
        },
        $setOnInsert: {
          taskIds: [],
          stats: {
            totalTasks: 0,
            completedTasks: 0,
            failedTasks: 0,
            waitingHumanTasks: 0,
          },
        },
      },
      { new: true, upsert: true },
    )
    .exec();

  if (!plan) {
    throw new Error(`Failed to ensure system plan: ${options.systemKey}`);
  }
  return plan;
}

function buildMeetingMonitorInput(): { prompt: string; payload: Record<string, unknown> } {
  return {
    prompt: [
      '你是会议助理。请通过可用的 meeting MCP 工具执行会议空闲巡检。',
      '检查所有 active 会议的最后消息时间。',
      '当会议超过1小时无消息时，发送提醒消息。',
      '当会议超过2小时无消息时，先发送结束通知，再结束会议。',
      '请避免重复提醒同一会议，并输出结构化执行摘要。',
    ].join('\n'),
    payload: {
      action: 'meeting_monitor',
      thresholds: {
        warningMs: Number(process.env.MEETING_INACTIVE_WARNING_MS || 3600000),
        endMs: Number(process.env.MEETING_INACTIVE_END_MS || 7200000),
      },
      messages: {
        warning: '会议已超过1小时未有消息，将自动结束',
        end: '会议已超过2小时未有消息，自动结束会议',
      },
    },
  };
}

function computeNextRunAt(
  schedule: { type: 'cron' | 'interval'; expression?: string; intervalMs?: number; timezone?: string },
  baseTime = new Date(),
): Date | undefined {
  if (schedule.type === 'interval') {
    if (!schedule.intervalMs) return undefined;
    return new Date(baseTime.getTime() + schedule.intervalMs);
  }
  if (!schedule.expression) return undefined;
  try {
    const job = new CronJob(schedule.expression, () => undefined, null, false, schedule.timezone || 'Asia/Shanghai');
    const next = job.nextDate();
    if (next && typeof next === 'object' && 'toJSDate' in (next as object)) {
      return (next as { toJSDate: () => Date }).toJSDate();
    }
    return new Date(String(next));
  } catch {
    return undefined;
  }
}

function getEntityId(entity: Record<string, unknown>): string {
  if (typeof entity.id === 'string') {
    return entity.id;
  }
  if (entity._id && typeof entity._id === 'object' && 'toString' in (entity._id as object)) {
    return (entity._id as { toString: () => string }).toString();
  }
  if (typeof entity._id === 'string') {
    return entity._id;
  }
  return '';
}
