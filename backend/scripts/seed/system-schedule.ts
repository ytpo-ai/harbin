import { INestApplicationContext } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CronJob } from 'cron';
import { Schedule, ScheduleDocument } from '../../src/shared/schemas/schedule.schema';

type SystemSeedName =
  | 'meeting-monitor'
  | 'engineering-statistics'
  | 'docs-heat'
  | 'cto-daily-requirement-triage'
  | 'memo-event-flush'
  | 'memo-full-aggregation';

const SYSTEM_SEED_ORDER: SystemSeedName[] = [
  'meeting-monitor',
  'engineering-statistics',
  'docs-heat',
  'cto-daily-requirement-triage',
  'memo-event-flush',
  'memo-full-aggregation',
];

const systemMeetingMonitorScheduleName = 'system-meeting-monitor';
const systemEngineeringStatisticsScheduleName = 'system-engineering-statistics';
const systemDocsHeatScheduleName = 'system-docs-heat';
const systemCtoDailyRequirementTriageScheduleName = 'system-cto-daily-requirement-triage';
const systemMemoEventFlushScheduleName = 'system-memo-event-flush';
const systemMemoFullAggregationScheduleName = 'system-memo-full-aggregation';

export async function seedSystemSchedules(
  app: INestApplicationContext,
  options?: { only?: SystemSeedName[] },
): Promise<{ total: number; enabled: number; seeded: SystemSeedName[] }> {
  const scheduleModel = app.get<Model<ScheduleDocument>>(getModelToken(Schedule.name));
  const only = options?.only?.length ? options.only : SYSTEM_SEED_ORDER;
  const selected = SYSTEM_SEED_ORDER.filter((name) => only.includes(name));
  const created: ScheduleDocument[] = [];

  for (const seed of selected) {
    if (seed === 'meeting-monitor') {
      const schedule = await ensureMeetingMonitorSchedule(scheduleModel);
      if (schedule) created.push(schedule);
      continue;
    }
    if (seed === 'engineering-statistics') {
      const schedule = await ensureEngineeringStatisticsSchedule(scheduleModel);
      if (schedule) created.push(schedule);
      continue;
    }
    if (seed === 'docs-heat') {
      const schedule = await ensureDocsHeatSchedule(scheduleModel);
      if (schedule) created.push(schedule);
      continue;
    }
    if (seed === 'cto-daily-requirement-triage') {
      const schedule = await ensureCtoDailyRequirementTriageSchedule(scheduleModel);
      if (schedule) created.push(schedule);
      continue;
    }
    if (seed === 'memo-event-flush') {
      const schedule = await ensureMemoEventFlushSchedule(scheduleModel);
      if (schedule) created.push(schedule);
      continue;
    }
    if (seed === 'memo-full-aggregation') {
      const schedule = await ensureMemoFullAggregationSchedule(scheduleModel);
      if (schedule) created.push(schedule);
    }
  }

  return {
    total: created.length,
    enabled: created.filter((schedule) => schedule.enabled).length,
    seeded: selected,
  };
}

async function ensureDocsHeatSchedule(
  scheduleModel: Model<ScheduleDocument>,
): Promise<ScheduleDocument | null> {
  const cronExpression = String(process.env.DOCS_HEAT_CRON || '0 */2 * * *').trim();
  const timezone = String(process.env.DOCS_HEAT_TIMEZONE || 'Asia/Shanghai').trim() || 'Asia/Shanghai';
  const targetAgentId = String(process.env.DOCS_HEAT_AGENT_ID || 'meeting-assistant').trim();

  return upsertScheduleByName(scheduleModel, systemDocsHeatScheduleName, {
    name: systemDocsHeatScheduleName,
    description: '系统内置：定时触发文档热度统计',
    schedule: {
      type: 'cron',
      expression: cronExpression,
      timezone,
    },
    target: {
      executorType: 'agent',
      executorId: targetAgentId,
    },
    input: {
      prompt: '系统内置计划：触发文档热度统计，刷新 docs 热度排行。',
      payload: {
        topN: 20,
        triggeredBy: 'system-schedule',
      },
    },
    message: {
      eventType: 'schedule.docs-heat',
      title: '系统文档热度统计',
    },
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
  });
}

async function ensureMeetingMonitorSchedule(
  scheduleModel: Model<ScheduleDocument>,
): Promise<ScheduleDocument | null> {
  const intervalMs = Number(process.env.MEETING_ASSISTANT_INTERVAL_MS || 300000);
  if (intervalMs < 300000) {
    return null;
  }

  return upsertScheduleByName(scheduleModel, systemMeetingMonitorScheduleName, {
    name: systemMeetingMonitorScheduleName,
    description: '系统内置：监控进行中的会议，在会议长时间未活动时发送提醒并自动结束',
    schedule: {
      type: 'interval',
      intervalMs,
    },
    target: {
      executorType: 'agent',
      executorId: String(process.env.MEETING_MONITOR_AGENT_ID || 'meeting-assistant').trim() || 'meeting-assistant',
      executorName: '会议助理',
    },
    input: buildMeetingMonitorInput(),
    message: {
      eventType: 'schedule.meeting-monitor',
      title: '系统会议巡检',
    },
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
  });
}

async function ensureEngineeringStatisticsSchedule(
  scheduleModel: Model<ScheduleDocument>,
): Promise<ScheduleDocument | null> {
  const cronExpression = String(process.env.ENGINEERING_STATISTICS_CRON || '0 9 * * *').trim();
  const timezone = String(process.env.ENGINEERING_STATISTICS_TIMEZONE || 'Asia/Shanghai').trim() || 'Asia/Shanghai';
  const targetAgentId = String(process.env.ENGINEERING_STATISTICS_AGENT_ID || 'meeting-assistant').trim();

  return upsertScheduleByName(scheduleModel, systemEngineeringStatisticsScheduleName, {
    name: systemEngineeringStatisticsScheduleName,
    description: '系统内置：定时触发工程统计',
    schedule: {
      type: 'cron',
      expression: cronExpression,
      timezone,
    },
    target: {
      executorType: 'agent',
      executorId: targetAgentId,
    },
    input: {
      prompt: '系统内置计划：执行工程统计工具，生成统计快照并通知消息中心。',
      payload: {
        scope: 'all',
        tokenMode: 'estimate',
        triggeredBy: 'system-schedule',
      },
    },
    message: {
      eventType: 'schedule.engineering-statistics',
      title: '系统工程统计',
    },
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
  });
}

async function ensureMemoEventFlushSchedule(
  scheduleModel: Model<ScheduleDocument>,
): Promise<ScheduleDocument | null> {
  const intervalMs = Math.max(10_000, Number(process.env.MEMO_AGGREGATION_INTERVAL_MS || 60_000));
  const targetAgentId = String(process.env.MEMO_AGGREGATION_AGENT_ID || 'meeting-assistant').trim() || 'meeting-assistant';

  return upsertScheduleByName(scheduleModel, systemMemoEventFlushScheduleName, {
    name: systemMemoEventFlushScheduleName,
    description: '系统内置：定时触发 memo 事件聚合 flush',
    schedule: {
      type: 'interval',
      intervalMs,
    },
    target: {
      executorType: 'agent',
      executorId: targetAgentId,
    },
    input: {
      prompt: '系统内置计划：触发 memo 事件聚合 flush。',
      payload: {
        memoCommand: 'flush_events',
        triggeredBy: 'system-schedule',
      },
    },
    message: {
      eventType: 'schedule.memo-flush',
      title: '系统 Memo 事件聚合',
    },
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
  });
}

async function ensureCtoDailyRequirementTriageSchedule(
  scheduleModel: Model<ScheduleDocument>,
): Promise<ScheduleDocument | null> {
  const cronExpression = '0 10 * * *';
  const timezone = 'Asia/Shanghai';
  const targetAgentId = 'executive-lead';

  return upsertScheduleByName(scheduleModel, systemCtoDailyRequirementTriageScheduleName, {
    name: systemCtoDailyRequirementTriageScheduleName,
    description: '系统内置：CTO 每日整理项目需求并分发给研发 Agent',
    schedule: {
      type: 'cron',
      expression: cronExpression,
      timezone,
    },
    target: {
      executorType: 'agent',
      executorId: targetAgentId,
      executorName: 'CTO Agent',
    },
    input: buildCtoDailyRequirementTriageInput(),
    message: {
      eventType: 'schedule.cto-daily-triage',
      title: 'CTO 每日需求分诊',
    },
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
  });
}

async function ensureMemoFullAggregationSchedule(
  scheduleModel: Model<ScheduleDocument>,
): Promise<ScheduleDocument | null> {
  const intervalMs = Math.max(60_000, Number(process.env.MEMO_FULL_AGGREGATION_INTERVAL_MS || 24 * 60 * 60 * 1000));
  const targetAgentId = String(process.env.MEMO_AGGREGATION_AGENT_ID || 'meeting-assistant').trim() || 'meeting-assistant';

  return upsertScheduleByName(scheduleModel, systemMemoFullAggregationScheduleName, {
    name: systemMemoFullAggregationScheduleName,
    description: '系统内置：定时触发 memo 全量聚合',
    schedule: {
      type: 'interval',
      intervalMs,
    },
    target: {
      executorType: 'agent',
      executorId: targetAgentId,
    },
    input: {
      prompt: '系统内置计划：触发 memo 全量聚合。',
      payload: {
        memoCommand: 'full_aggregation',
        triggeredBy: 'system-schedule',
      },
    },
    message: {
      eventType: 'schedule.memo-aggregation',
      title: '系统 Memo 全量聚合',
    },
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
  });
}

async function upsertScheduleByName(
  scheduleModel: Model<ScheduleDocument>,
  name: string,
  payload: Record<string, unknown>,
): Promise<ScheduleDocument | null> {
  const existing = await scheduleModel.findOne({ name }).exec();
  if (existing) {
    await scheduleModel
      .updateOne(
        { _id: getEntityId(existing as unknown as Record<string, unknown>) },
        {
          $set: payload,
        },
      )
      .exec();
    return scheduleModel.findOne({ _id: getEntityId(existing as unknown as Record<string, unknown>) }).exec();
  }

  return new scheduleModel(payload).save();
}

function buildCtoDailyRequirementTriageInput(): { prompt: string; payload: Record<string, unknown> } {
  return {
    prompt: [
      '你是 CTO Agent，请执行每日研发需求治理例行任务。',
      '步骤1：通过 requirement MCP 工具读取 todo/blocked 需求并按优先级整理当日待办。',
      '步骤2：为可执行需求补充分配负责人，必要时更新到 assigned。',
      '步骤3：对需要启动开发的需求创建或更新编排计划，并分发给研发 Agent（fullstack-engineer/devops-engineer/technical-architect）。',
      '步骤4：输出结构化日报，包含需求总数、分发结果、阻塞项和下一步建议。',
      '若需求信息不足，请先通过 requirement.comment 记录澄清问题，再暂缓分发。',
    ].join('\n'),
    payload: {
      workflow: 'cto_daily_requirement_triage',
      triggeredBy: 'system-schedule',
      runAt: '10:00',
      timezone: 'Asia/Shanghai',
    },
  };
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
