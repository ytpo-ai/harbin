import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Model } from 'mongoose';
import { CronJob } from 'cron';
import { Agent, AgentDocument } from '../../../shared/schemas/agent.schema';
import {
  OrchestrationSchedule,
  OrchestrationScheduleDocument,
} from '../../../shared/schemas/orchestration-schedule.schema';
import {
  OrchestrationTask,
  OrchestrationTaskDocument,
  OrchestrationTaskStatus,
} from '../../../shared/schemas/orchestration-task.schema';
import {
  OrchestrationPlan,
  OrchestrationPlanDocument,
} from '../../../shared/schemas/orchestration-plan.schema';
import { OrchestrationService } from '../orchestration.service';
import {
  CreateScheduleDto,
  UpdateScheduleDto,
} from './dto';
import { AgentClientService } from '../../agents-client/agent-client.service';

type TriggerType = 'auto' | 'manual';

@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly runLocks = new Set<string>();
  private readonly systemMeetingMonitorScheduleName = 'system-meeting-monitor';
  private readonly systemMeetingMonitorPlanKey = 'system-meeting-monitor';
  private memoEventAggregationTimer?: NodeJS.Timeout;
  private memoFullAggregationTimer?: NodeJS.Timeout;

  constructor(
    @InjectModel(OrchestrationSchedule.name)
    private readonly scheduleModel: Model<OrchestrationScheduleDocument>,
    @InjectModel(OrchestrationTask.name)
    private readonly taskModel: Model<OrchestrationTaskDocument>,
    @InjectModel(OrchestrationPlan.name)
    private readonly orchestrationPlanModel: Model<OrchestrationPlanDocument>,
    @InjectModel(Agent.name)
    private readonly agentModel: Model<AgentDocument>,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly orchestrationService: OrchestrationService,
    private readonly agentClientService: AgentClientService,
  ) {}

  async onModuleInit(): Promise<void> {
    const enabledSchedules = await this.scheduleModel.find({ enabled: true }).exec();
    await Promise.all(enabledSchedules.map((schedule) => this.registerSchedule(schedule)));
    this.startMemoAggregationTimers();
  }

  async seedMeetingMonitorSchedule(): Promise<void> {
    await this.ensureMeetingMonitorSchedule();
  }

  private async ensureMeetingMonitorSchedule(): Promise<void> {
    const plan = await this.ensureMeetingMonitorPlan();
    const planId = this.getEntityId(plan as unknown as Record<string, unknown>);

    const existing = await this.scheduleModel.findOne({ name: this.systemMeetingMonitorScheduleName }).exec();
    const intervalMs = Number(process.env.MEETING_ASSISTANT_INTERVAL_MS || 300000);
    if (intervalMs < 300000) {
      this.logger.warn('MEETING_ASSISTANT_INTERVAL_MS must be at least 5 minutes, skipping meeting monitor');
      return;
    }

    const monitorInput = this.buildMeetingMonitorInput();
    if (existing) {
      await this.scheduleModel
        .updateOne(
          { _id: this.getEntityId(existing as unknown as Record<string, unknown>) },
          {
            $set: {
              input: monitorInput,
              'schedule.intervalMs': intervalMs,
              planId,
            },
          },
        )
        .exec();

      if (existing.enabled) {
        const refreshed = await this.scheduleModel.findOne({ _id: this.getEntityId(existing as unknown as Record<string, unknown>) }).exec();
        if (refreshed) {
          await this.registerSchedule(refreshed);
        }
      }
      return;
    }

    try {
      const schedule = await new this.scheduleModel({
        name: this.systemMeetingMonitorScheduleName,
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
        input: monitorInput,
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

      await this.registerSchedule(schedule);
      this.logger.log(`Created system meeting monitor schedule with interval=${intervalMs}ms`);
    } catch (error) {
      this.logger.error('Failed to create meeting monitor schedule', error);
    }
  }

  private async ensureMeetingMonitorPlan(): Promise<OrchestrationPlanDocument> {
    const prompt = '系统内置计划：监控 active 会议空闲状态，在超时阈值触发提醒并自动结束会议';
    const title = '系统会议监控计划';

    const plan = await this.orchestrationPlanModel
      .findOneAndUpdate(
        { 'metadata.systemKey': this.systemMeetingMonitorPlanKey },
        {
          $set: {
            title,
            sourcePrompt: prompt,
            status: 'planned',
            strategy: {
              plannerAgentId: 'meeting-assistant',
              mode: 'hybrid',
            },
            createdBy: 'system',
            'metadata.system': true,
            'metadata.systemKey': this.systemMeetingMonitorPlanKey,
            'metadata.linkedScheduleName': this.systemMeetingMonitorScheduleName,
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
      throw new Error('Failed to ensure system meeting monitor plan');
    }

    return plan;
  }

  onModuleDestroy(): void {
    if (this.memoEventAggregationTimer) {
      clearInterval(this.memoEventAggregationTimer);
    }
    if (this.memoFullAggregationTimer) {
      clearInterval(this.memoFullAggregationTimer);
    }

    for (const key of this.schedulerRegistry.getCronJobs().keys()) {
      if (key.startsWith('orch-schedule-cron:')) {
        this.schedulerRegistry.deleteCronJob(key);
      }
    }
    for (const key of this.schedulerRegistry.getIntervals()) {
      if (key.startsWith('orch-schedule-interval:')) {
        this.schedulerRegistry.deleteInterval(key);
      }
    }
  }

  async createSchedule(createdBy: string, dto: CreateScheduleDto): Promise<OrchestrationSchedule> {
    await this.validateScheduleDto(dto.schedule);
    const agent = await this.ensureAgentExists(dto.target.executorId);
    const now = new Date();
    const linkedPlanId = this.resolveLinkedPlanId(dto.input);
    const schedule = await new this.scheduleModel({
      name: dto.name.trim(),
      description: dto.description?.trim(),
      planId: linkedPlanId,
      schedule: {
        ...dto.schedule,
        timezone: dto.schedule.timezone || 'Asia/Shanghai',
      },
      target: {
        executorType: 'agent',
        executorId: dto.target.executorId,
        executorName: agent.name,
      },
      input: dto.input || {},
      enabled: dto.enabled ?? true,
      status: dto.enabled === false ? 'paused' : 'idle',
      nextRunAt: this.computeNextRunAt(dto.schedule, now),
      stats: {
        totalRuns: 0,
        successRuns: 0,
        failedRuns: 0,
        skippedRuns: 0,
      },
      createdBy,
    }).save();

    if (schedule.enabled) {
      await this.registerSchedule(schedule);
    }

    return schedule;
  }

  async listSchedules(): Promise<OrchestrationSchedule[]> {
    return this.scheduleModel.find({}).sort({ createdAt: -1 }).exec();
  }

  async getScheduleById(scheduleId: string): Promise<OrchestrationSchedule> {
    const schedule = await this.scheduleModel.findOne({ _id: scheduleId }).exec();
    if (!schedule) {
      throw new NotFoundException('Schedule not found');
    }
    return schedule;
  }

  async updateSchedule(scheduleId: string, dto: UpdateScheduleDto): Promise<OrchestrationSchedule> {
    const existing = await this.getScheduleById(scheduleId);

    const nextScheduleConfig = dto.schedule || existing.schedule;
    await this.validateScheduleDto(nextScheduleConfig);

    const nextTargetId = dto.target?.executorId || existing.target.executorId;
    const agent = await this.ensureAgentExists(nextTargetId);
    const linkedPlanId = dto.input !== undefined ? this.resolveLinkedPlanId(dto.input) : undefined;

    const updated = await this.scheduleModel
      .findOneAndUpdate(
        { _id: scheduleId },
        {
          $set: {
            ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
            ...(dto.description !== undefined ? { description: dto.description.trim() } : {}),
            ...(dto.schedule
              ? {
                  schedule: {
                    ...dto.schedule,
                    timezone: dto.schedule.timezone || existing.schedule.timezone || 'Asia/Shanghai',
                  },
                }
              : {}),
            ...(dto.target
              ? {
                  target: {
                    executorType: 'agent',
                    executorId: nextTargetId,
                    executorName: agent.name,
                  },
                }
              : {}),
            ...(dto.input !== undefined ? { input: dto.input } : {}),
            ...(linkedPlanId !== undefined ? { planId: linkedPlanId } : {}),
            ...(dto.enabled !== undefined
              ? {
                  enabled: dto.enabled,
                  status: dto.enabled ? 'idle' : 'paused',
                }
              : {}),
            nextRunAt: this.computeNextRunAt(nextScheduleConfig),
          },
        },
        { new: true },
      )
      .exec();

    if (!updated) {
      throw new NotFoundException('Schedule not found');
    }

    this.unregisterSchedule(scheduleId);
    if (updated.enabled) {
      await this.registerSchedule(updated);
    }

    return updated;
  }

  async enableSchedule(scheduleId: string): Promise<OrchestrationSchedule> {
    const existing = await this.getScheduleById(scheduleId);
    const updated = await this.scheduleModel
      .findOneAndUpdate(
        { _id: scheduleId },
        {
          $set: {
            enabled: true,
            status: 'idle',
            nextRunAt: this.computeNextRunAt(existing.schedule),
          },
        },
        { new: true },
      )
      .exec();

    if (!updated) {
      throw new NotFoundException('Schedule not found');
    }

    await this.registerSchedule(updated);
    return updated;
  }

  async disableSchedule(scheduleId: string): Promise<OrchestrationSchedule> {
    const updated = await this.scheduleModel
      .findOneAndUpdate(
        { _id: scheduleId },
        {
          $set: {
            enabled: false,
            status: 'paused',
          },
        },
        { new: true },
      )
      .exec();
    if (!updated) {
      throw new NotFoundException('Schedule not found');
    }
    this.unregisterSchedule(scheduleId);
    return updated;
  }

  async deleteSchedule(scheduleId: string): Promise<{ success: boolean }> {
    const deleted = await this.scheduleModel.deleteOne({ _id: scheduleId }).exec();
    this.unregisterSchedule(scheduleId);
    return { success: (deleted.deletedCount || 0) > 0 };
  }

  async triggerSchedule(scheduleId: string): Promise<{ accepted: boolean; status: string }> {
    const schedule = await this.getScheduleById(scheduleId);
    await this.dispatchSchedule(schedule, 'manual');
    return { accepted: true, status: 'triggered' };
  }

  async getScheduleHistory(scheduleId: string, limit = 20): Promise<OrchestrationTask[]> {
    await this.getScheduleById(scheduleId);
    return this.taskModel
      .find({ mode: 'schedule', scheduleId })
      .sort({ createdAt: -1 })
      .limit(Math.min(Math.max(limit, 1), 100))
      .exec();
  }

  async findSchedulesByPlanId(planId: string): Promise<OrchestrationSchedule[]> {
    return this.scheduleModel.find({ planId }).exec();
  }

  private async registerSchedule(schedule: OrchestrationScheduleDocument | OrchestrationSchedule): Promise<void> {
    const scheduleId = this.getEntityId(schedule as unknown as Record<string, unknown>);
    if (!scheduleId || !schedule.enabled) {
      return;
    }

    this.unregisterSchedule(scheduleId);

    if (schedule.schedule.type === 'interval') {
      const intervalMs = schedule.schedule.intervalMs || 0;
      if (intervalMs < 60_000) {
        this.logger.warn(`Skip schedule ${scheduleId}: interval too short`);
        return;
      }
      const key = this.getIntervalKey(scheduleId);
      const timer = setInterval(() => {
        this.dispatchById(scheduleId).catch((error) => {
          this.logger.error(`Failed to execute interval schedule ${scheduleId}`, error?.stack || String(error));
        });
      }, intervalMs);
      this.schedulerRegistry.addInterval(key, timer);
      return;
    }

    const expression = schedule.schedule.expression;
    if (!expression) {
      this.logger.warn(`Skip schedule ${scheduleId}: cron expression missing`);
      return;
    }

    try {
      const job = new CronJob(expression, () => {
        this.dispatchById(scheduleId).catch((error) => {
          this.logger.error(`Failed to execute cron schedule ${scheduleId}`, error?.stack || String(error));
        });
      }, null, false, schedule.schedule.timezone || 'Asia/Shanghai');
      this.schedulerRegistry.addCronJob(this.getCronKey(scheduleId), job);
      job.start();
    } catch (error) {
      this.logger.error(`Invalid cron schedule ${scheduleId}`, error instanceof Error ? error.stack : String(error));
    }
  }

  private unregisterSchedule(scheduleId: string): void {
    const cronKey = this.getCronKey(scheduleId);
    const intervalKey = this.getIntervalKey(scheduleId);

    if (this.schedulerRegistry.doesExist('cron', cronKey)) {
      const cron = this.schedulerRegistry.getCronJob(cronKey);
      cron.stop();
      this.schedulerRegistry.deleteCronJob(cronKey);
    }
    if (this.schedulerRegistry.doesExist('interval', intervalKey)) {
      this.schedulerRegistry.deleteInterval(intervalKey);
    }
  }

  private async dispatchById(scheduleId: string): Promise<void> {
    const schedule = await this.scheduleModel.findOne({ _id: scheduleId }).exec();
    if (!schedule || !schedule.enabled) {
      return;
    }
    await this.dispatchSchedule(schedule, 'auto');
  }

  private async dispatchSchedule(
    schedule: OrchestrationScheduleDocument | OrchestrationSchedule,
    triggerType: TriggerType,
  ): Promise<void> {
    const scheduleId = this.getEntityId(schedule as unknown as Record<string, unknown>);
    if (!scheduleId) {
      return;
    }

    if (this.runLocks.has(scheduleId)) {
      await this.scheduleModel
        .updateOne(
          { _id: scheduleId },
          {
            $inc: {
              'stats.skippedRuns': 1,
            },
          },
        )
        .exec();
      return;
    }

    this.runLocks.add(scheduleId);
    const startedAt = new Date();

    await this.scheduleModel
      .updateOne(
        { _id: scheduleId },
        {
          $set: {
            status: 'running',
            'lastRun.startedAt': startedAt,
          },
        },
      )
      .exec();

    let executionStatus: OrchestrationTaskStatus | null = null;
    let taskId = '';
    let sessionId = '';
    let errorMessage = '';
    let result = '';

    try {
      const task = await new this.taskModel({
        mode: 'schedule',
        scheduleId,
        planId: schedule.planId,
        title: schedule.name,
        description: this.buildTaskDescription(schedule),
        priority: 'medium',
        status: schedule.target.executorId ? 'assigned' : 'pending',
        order: 0,
        dependencyTaskIds: [],
        assignment: {
          executorType: 'agent',
          executorId: schedule.target.executorId,
          reason: `Triggered by schedule (${triggerType})`,
        },
        runLogs: [
          {
            timestamp: startedAt,
            level: 'info',
            message: `Schedule triggered (${triggerType})`,
            metadata: {
              scheduleId,
              triggerType,
            },
          },
        ],
      }).save();

      taskId = task._id.toString();
      const execution = await this.orchestrationService.executeStandaloneTask(taskId);
      executionStatus = execution.status;
      result = execution.result || '';

      const latestTask = await this.taskModel.findOne({ _id: taskId }).exec();
      sessionId = latestTask?.sessionId || '';
      errorMessage = execution.error || latestTask?.result?.error || '';
    } catch (error) {
      executionStatus = 'failed';
      errorMessage = error instanceof Error ? error.message : 'Schedule execution failed';
      this.logger.error(`Schedule ${scheduleId} execution failed`, error instanceof Error ? error.stack : String(error));
    } finally {
      const completedAt = new Date();
      const success = executionStatus === 'completed';

      await this.scheduleModel
        .updateOne(
          { _id: scheduleId },
          {
            $set: {
              status: success ? 'idle' : 'error',
              nextRunAt: this.computeNextRunAt(schedule.schedule, completedAt),
              lastRun: {
                startedAt,
                completedAt,
                success,
                result: result || undefined,
                error: errorMessage || undefined,
                taskId: taskId || undefined,
                sessionId: sessionId || undefined,
              },
            },
            $inc: {
              'stats.totalRuns': 1,
              'stats.successRuns': success ? 1 : 0,
              'stats.failedRuns': success ? 0 : 1,
            },
          },
        )
        .exec();

      this.runLocks.delete(scheduleId);
    }
  }

  private async ensureAgentExists(agentId: string): Promise<AgentDocument> {
    const agent = await this.agentModel.findOne({ _id: agentId }).exec();
    if (!agent) {
      throw new NotFoundException('Agent not found');
    }
    return agent;
  }

  private async validateScheduleDto(schedule: {
    type: 'cron' | 'interval';
    expression?: string;
    intervalMs?: number;
    timezone?: string;
  }): Promise<void> {
    if (schedule.type === 'cron') {
      if (!schedule.expression?.trim()) {
        throw new BadRequestException('schedule.expression is required when type=cron');
      }
      try {
        const job = new CronJob(schedule.expression, () => undefined, null, false, schedule.timezone || 'Asia/Shanghai');
        job.nextDate();
      } catch {
        throw new BadRequestException('Invalid cron expression');
      }
      return;
    }

    if (!schedule.intervalMs || schedule.intervalMs < 60_000) {
      throw new BadRequestException('schedule.intervalMs must be at least 60000 when type=interval');
    }
  }

  private computeNextRunAt(
    schedule: { type: 'cron' | 'interval'; expression?: string; intervalMs?: number; timezone?: string },
    baseTime = new Date(),
  ): Date | undefined {
    if (schedule.type === 'interval') {
      if (!schedule.intervalMs) {
        return undefined;
      }
      return new Date(baseTime.getTime() + schedule.intervalMs);
    }
    if (!schedule.expression) {
      return undefined;
    }
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

  private buildMeetingMonitorInput(): { prompt: string; payload: Record<string, unknown> } {
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

  private startMemoAggregationTimers(): void {
    const enabled = String(process.env.MEMO_SCHEDULER_ENABLED || 'true').toLowerCase() !== 'false';
    if (!enabled) {
      this.logger.log('Memo scheduler disabled by MEMO_SCHEDULER_ENABLED=false');
      return;
    }

    const eventIntervalMs = Math.max(10_000, Number(process.env.MEMO_AGGREGATION_INTERVAL_MS || 60_000));
    this.memoEventAggregationTimer = setInterval(() => {
      this.agentClientService.flushMemoEvents().catch((error) => {
        this.logger.warn(`Periodic memo event flush failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    }, eventIntervalMs);

    const fullIntervalMs = Math.max(
      60_000,
      Number(process.env.MEMO_FULL_AGGREGATION_INTERVAL_MS || 24 * 60 * 60 * 1000),
    );
    this.memoFullAggregationTimer = setInterval(() => {
      this.agentClientService.triggerMemoFullAggregation().catch((error) => {
        this.logger.warn(
          `Periodic full memo aggregation failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }, fullIntervalMs);

    void this.agentClientService.flushMemoEvents();
    this.logger.log(`Memo event flush scheduler started, interval=${eventIntervalMs}ms`);
    this.logger.log(`Memo full aggregation scheduler started, interval=${fullIntervalMs}ms`);
  }

  private buildTaskDescription(schedule: OrchestrationSchedule): string {
    const prompt = schedule.input?.prompt?.trim();
    const payload = schedule.input?.payload;
    if (!payload) {
      return prompt || `Scheduled task: ${schedule.name}`;
    }
    return [
      prompt || `Scheduled task: ${schedule.name}`,
      'Structured payload:',
      JSON.stringify(payload, null, 2),
    ].join('\n\n');
  }

  private resolveLinkedPlanId(input?: { prompt?: string; payload?: Record<string, unknown> }): string | undefined {
    const payload = input?.payload;
    if (!payload || typeof payload !== 'object') {
      return undefined;
    }
    const planId = payload.planId;
    if (typeof planId !== 'string') {
      return undefined;
    }
    const normalized = planId.trim();
    return normalized || undefined;
  }

  private getEntityId(entity: Record<string, unknown>): string {
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

  private getCronKey(scheduleId: string): string {
    return `orch-schedule-cron:${scheduleId}`;
  }

  private getIntervalKey(scheduleId: string): string {
    return `orch-schedule-interval:${scheduleId}`;
  }
}
