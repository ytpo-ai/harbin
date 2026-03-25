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
import axios from 'axios';
import { Schedule, ScheduleDocument } from '../../shared/schemas/schedule.schema';
import { CreateScheduleDto, UpdateScheduleDto } from './dto';
import { AgentClientService } from '../agents-client/agent-client.service';

type TriggerType = 'auto' | 'manual';

@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly runLocks = new Set<string>();
  private readonly lifecycleMonitorTimers = new Map<string, NodeJS.Timeout>();
  private readonly schedulerAlertWebhookUrl = String(process.env.SCHEDULER_ALERT_WEBHOOK_URL || '').trim();
  private readonly monitorIntervalMs = Math.max(1000, Number(process.env.SCHEDULER_MESSAGE_MONITOR_INTERVAL_MS || 3000));
  private readonly monitorMaxAttempts = Math.max(1, Number(process.env.SCHEDULER_MESSAGE_MONITOR_MAX_ATTEMPTS || 20));
  private readonly dispatchMaxAttempts = Math.max(1, Number(process.env.SCHEDULER_DISPATCH_MAX_ATTEMPTS || 3));
  private readonly systemEngineeringStatisticsScheduleName = 'system-engineering-statistics';
  private readonly systemDocsHeatScheduleName = 'system-docs-heat';
  private readonly systemScheduleNames = [
    'system-meeting-monitor',
    'system-engineering-statistics',
    'system-docs-heat',
    'system-cto-daily-requirement-triage',
    'system-memo-event-flush',
    'system-memo-full-aggregation',
  ];

  constructor(
    @InjectModel(Schedule.name)
    private readonly scheduleModel: Model<ScheduleDocument>,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly agentClientService: AgentClientService,
  ) {}

  async onModuleInit(): Promise<void> {
    const enabledSchedules = await this.scheduleModel.find({ enabled: true }).exec();
    await Promise.all(enabledSchedules.map((schedule) => this.registerSchedule(schedule)));
    await this.logMissingSystemSchedules();
  }

  onModuleDestroy(): void {
    for (const key of this.schedulerRegistry.getCronJobs().keys()) {
      if (key.startsWith('schedule-cron:')) {
        this.schedulerRegistry.deleteCronJob(key);
      }
    }
    for (const key of this.schedulerRegistry.getIntervals()) {
      if (key.startsWith('schedule-interval:')) {
        this.schedulerRegistry.deleteInterval(key);
      }
    }
    for (const timer of this.lifecycleMonitorTimers.values()) {
      clearTimeout(timer);
    }
    this.lifecycleMonitorTimers.clear();
  }

  async getOrCreateEngineeringStatisticsSchedule(): Promise<Schedule> {
    const schedule = await this.scheduleModel.findOne({ name: this.systemEngineeringStatisticsScheduleName }).exec();
    if (!schedule) {
      throw new NotFoundException('Engineering statistics schedule is unavailable, run seed first');
    }
    if (schedule.enabled) {
      await this.registerSchedule(schedule);
    }
    return this.getScheduleById(this.getEntityId(schedule as unknown as Record<string, unknown>));
  }

  async triggerSystemEngineeringStatistics(payload?: {
    receiverId?: string;
    scope?: 'all' | 'docs' | 'frontend' | 'backend';
    tokenMode?: 'estimate' | 'exact';
    projectIds?: string[];
    triggeredBy?: string;
  }): Promise<{ accepted: boolean; status: string; scheduleId: string }> {
    const schedule = await this.scheduleModel.findOne({ name: this.systemEngineeringStatisticsScheduleName }).exec();
    if (!schedule) {
      throw new NotFoundException('Engineering statistics schedule is unavailable, run seed first');
    }
    const scheduleId = this.getEntityId(schedule as unknown as Record<string, unknown>);
    const basePayload = (schedule.input?.payload || {}) as Record<string, unknown>;

    await this.dispatchSchedule(schedule, 'manual', {
      inputOverride: {
        payload: {
          ...basePayload,
          ...(payload?.receiverId ? { receiverId: payload.receiverId } : {}),
          ...(payload?.scope ? { scope: payload.scope } : {}),
          ...(payload?.tokenMode ? { tokenMode: payload.tokenMode } : {}),
          ...(Array.isArray(payload?.projectIds) ? { projectIds: payload.projectIds } : {}),
          triggeredBy: payload?.triggeredBy || 'frontend-trigger',
        },
      },
    });

    return { accepted: true, status: 'triggered', scheduleId };
  }

  async getOrCreateDocsHeatSchedule(): Promise<Schedule> {
    const schedule = await this.scheduleModel.findOne({ name: this.systemDocsHeatScheduleName }).exec();
    if (!schedule) {
      throw new NotFoundException('Docs heat schedule is unavailable, run seed first');
    }
    if (schedule.enabled) {
      await this.registerSchedule(schedule);
    }
    return this.getScheduleById(this.getEntityId(schedule as unknown as Record<string, unknown>));
  }

  async triggerSystemDocsHeat(payload?: {
    topN?: number;
    triggeredBy?: string;
  }): Promise<{ accepted: boolean; status: string; scheduleId: string }> {
    const schedule = await this.scheduleModel.findOne({ name: this.systemDocsHeatScheduleName }).exec();
    if (!schedule) {
      throw new NotFoundException('Docs heat schedule is unavailable, run seed first');
    }
    const scheduleId = this.getEntityId(schedule as unknown as Record<string, unknown>);
    const basePayload = (schedule.input?.payload || {}) as Record<string, unknown>;

    await this.dispatchSchedule(schedule, 'manual', {
      inputOverride: {
        payload: {
          ...basePayload,
          ...(Number.isFinite(Number(payload?.topN)) && Number(payload?.topN) > 0
            ? { topN: Math.floor(Number(payload?.topN)) }
            : {}),
          triggeredBy: payload?.triggeredBy || 'frontend-trigger',
        },
      },
    });

    return { accepted: true, status: 'triggered', scheduleId };
  }

  async createSchedule(createdBy: string, dto: CreateScheduleDto): Promise<Schedule> {
    await this.validateScheduleDto(dto.schedule);
    this.assertScheduleTarget(dto.target?.executorId);

    const now = new Date();
    const schedule = await new this.scheduleModel({
      name: dto.name.trim(),
      description: dto.description?.trim(),
      schedule: {
        ...dto.schedule,
        timezone: dto.schedule.timezone || 'Asia/Shanghai',
      },
      target: {
        executorType: 'agent',
        executorId: dto.target.executorId.trim(),
        executorName: dto.target.executorName?.trim() || undefined,
      },
      input: dto.input || {},
      message: this.resolveMessageConfig(dto.message, dto.name),
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

  async listSchedules(): Promise<Schedule[]> {
    return this.scheduleModel.find({}).sort({ createdAt: -1 }).exec();
  }

  async getScheduleById(scheduleId: string): Promise<Schedule> {
    const schedule = await this.scheduleModel.findOne({ _id: scheduleId }).exec();
    if (!schedule) {
      throw new NotFoundException('Schedule not found');
    }
    return schedule;
  }

  async updateSchedule(scheduleId: string, dto: UpdateScheduleDto): Promise<Schedule> {
    const existing = await this.getScheduleById(scheduleId);
    const nextScheduleConfig = dto.schedule || existing.schedule;
    await this.validateScheduleDto(nextScheduleConfig);

    if (dto.target?.executorId !== undefined) {
      this.assertScheduleTarget(dto.target.executorId);
    }

    const updated = await this.scheduleModel
      .findOneAndUpdate(
        { _id: scheduleId },
        {
          $set: {
            ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
            ...(dto.description !== undefined ? { description: dto.description.trim() || undefined } : {}),
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
                    executorId: dto.target.executorId?.trim() || existing.target.executorId,
                    executorName: dto.target.executorName?.trim() || undefined,
                  },
                }
              : {}),
            ...(dto.input !== undefined ? { input: dto.input } : {}),
            ...(dto.message !== undefined
              ? {
                  message: this.resolveMessageConfig(dto.message, dto.name || existing.name),
                }
              : {}),
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

  async enableSchedule(scheduleId: string): Promise<Schedule> {
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

  async disableSchedule(scheduleId: string): Promise<Schedule> {
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

  async getScheduleHistory(scheduleId: string, limit = 20): Promise<Array<Record<string, unknown>>> {
    const schedule = await this.getScheduleById(scheduleId);
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    try {
      const data = await this.agentClientService.listInnerMessages({
        page: 1,
        pageSize: safeLimit,
        source: 'scheduler',
        scheduleId,
      });

      return data.items.map((item) => {
        const payload = item?.payload && typeof item.payload === 'object' ? item.payload : {};
        const status = String(item?.status || '').trim();
        const createdAt = item?.createdAt || item?.sentAt || new Date().toISOString();
        const updatedAt = item?.updatedAt || item?.processedAt || item?.failedAt || createdAt;

        return {
          _id: String(item?._id || item?.messageId || `${scheduleId}-${createdAt}`),
          messageId: item?.messageId,
          status,
          summary: String(item?.title || '').trim() || String(payload?.prompt || '').trim() || 'scheduler dispatch',
          error: status === 'failed' ? String(item?.error || '').trim() : '',
          eventType: item?.eventType,
          receiverAgentId: item?.receiverAgentId,
          triggerType: payload?.triggerType,
          createdAt,
          updatedAt,
        };
      });
    } catch (error) {
      this.logger.warn(
        `Failed to query inner-message history for schedule ${scheduleId}: ${error instanceof Error ? error.message : String(error)}`,
      );

      const history: Array<Record<string, unknown>> = [];
      if (schedule.lastRun?.startedAt || schedule.lastRun?.completedAt) {
        const scheduleMeta = schedule as unknown as { updatedAt?: Date };
        const createdAt = (schedule.lastRun?.startedAt || scheduleMeta.updatedAt || new Date()).toISOString();
        const updatedAt = (schedule.lastRun?.completedAt || scheduleMeta.updatedAt || new Date()).toISOString();
        history.push({
          _id: `last-run-${scheduleId}`,
          status: schedule.lastRun?.success ? 'completed' : 'failed',
          summary: schedule.lastRun?.result || '',
          error: schedule.lastRun?.error || '',
          createdAt,
          updatedAt,
        });
      }
      return history.slice(0, safeLimit);
    }
  }

  private async registerSchedule(schedule: ScheduleDocument | Schedule): Promise<void> {
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
      const job = new CronJob(
        expression,
        () => {
          this.dispatchById(scheduleId).catch((error) => {
            this.logger.error(`Failed to execute cron schedule ${scheduleId}`, error?.stack || String(error));
          });
        },
        null,
        false,
        schedule.schedule.timezone || 'Asia/Shanghai',
      );
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
    schedule: ScheduleDocument | Schedule,
    triggerType: TriggerType,
    options?: {
      inputOverride?: {
        prompt?: string;
        payload?: Record<string, unknown>;
      };
    },
  ): Promise<void> {
    const scheduleId = this.getEntityId(schedule as unknown as Record<string, unknown>);
    if (!scheduleId) {
      return;
    }

    if (this.runLocks.has(scheduleId)) {
      await this.scheduleModel.updateOne({ _id: scheduleId }, { $inc: { 'stats.skippedRuns': 1 } }).exec();
      this.logger.warn(`Schedule ${scheduleId} skipped: already running`);
      return;
    }

    this.runLocks.add(scheduleId);
    const startedAt = new Date();

    try {
      const effectiveInput = this.mergeInput(schedule.input, options?.inputOverride);

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

      const dispatched = await this.dispatchToAgent(schedule, effectiveInput, triggerType);
      const completedAt = new Date();
      const success = dispatched.accepted;

      if (!success) {
        await this.scheduleModel
          .updateOne(
            { _id: scheduleId },
            {
              $set: {
                status: 'error',
                nextRunAt: this.computeNextRunAt(schedule.schedule, completedAt),
                lastRun: {
                  startedAt,
                  completedAt,
                  success: false,
                  result: undefined,
                  error: 'inner-message dispatch rejected',
                  taskId: dispatched.messageId || undefined,
                  attempts: 1,
                },
              },
              $inc: {
                'stats.totalRuns': 1,
                'stats.failedRuns': 1,
              },
            },
          )
          .exec();

        await this.recordDeadLetter({
          scheduleId,
          taskId: dispatched.messageId,
          triggerType,
          reason: 'inner-message dispatch rejected',
          attempts: 1,
        });
        await this.notifyScheduleFailure(scheduleId, schedule.name, 'inner-message dispatch rejected');
        return;
      }

      await this.scheduleModel
        .updateOne(
          { _id: scheduleId },
          {
            $set: {
              status: 'running',
              nextRunAt: this.computeNextRunAt(schedule.schedule, completedAt),
              lastRun: {
                startedAt,
                completedAt,
                success: undefined,
                result: `inner-message dispatched: ${dispatched.messageId}`,
                error: undefined,
                taskId: dispatched.messageId || undefined,
                attempts: 1,
              },
            },
            $inc: {
              'stats.totalRuns': 1,
            },
          },
        )
        .exec();

      this.monitorDispatchedMessageLifecycle({
        scheduleId,
        scheduleName: schedule.name,
        messageId: dispatched.messageId,
        triggerType,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Dispatch failed';
      this.logger.error(`Schedule ${scheduleId} dispatch failed: ${reason}`);

      await this.scheduleModel
        .updateOne(
          { _id: scheduleId },
          {
            $set: {
              status: 'error',
              'lastRun.completedAt': new Date(),
              'lastRun.success': false,
              'lastRun.error': reason,
            },
            $inc: {
              'stats.totalRuns': 1,
              'stats.failedRuns': 1,
            },
          },
        )
        .exec();

      await this.recordDeadLetter({
        scheduleId,
        triggerType,
        reason,
        attempts: 1,
      });
      await this.notifyScheduleFailure(scheduleId, schedule.name, reason);
    } finally {
      this.runLocks.delete(scheduleId);
    }
  }

  private async dispatchToAgent(
    schedule: ScheduleDocument | Schedule,
    effectiveInput: { prompt?: string; payload?: Record<string, unknown> },
    triggerType: TriggerType,
  ): Promise<{ messageId: string; accepted: boolean }> {
    const scheduleId = this.getEntityId(schedule as unknown as Record<string, unknown>);
    const eventType = String(schedule.message?.eventType || '').trim() || 'schedule.trigger';
    const title = String(schedule.message?.title || '').trim() || `定时任务: ${schedule.name}`;
    const payload = {
      scheduleId,
      scheduleName: schedule.name,
      triggerType,
      prompt: effectiveInput.prompt,
      ...(effectiveInput.payload || {}),
    };

    return this.agentClientService.sendDirectInnerMessage({
      senderAgentId: 'scheduler-system',
      receiverAgentId: schedule.target.executorId,
      eventType,
      title,
      content: this.buildMessageContent(schedule, effectiveInput, triggerType),
      payload,
      source: 'scheduler',
      dedupKey: `schedule:${scheduleId}:${Date.now()}`,
      maxAttempts: this.dispatchMaxAttempts,
    });
  }

  private monitorDispatchedMessageLifecycle(input: {
    scheduleId: string;
    scheduleName: string;
    messageId: string;
    triggerType: TriggerType;
  }): void {
    const monitorKey = this.getLifecycleMonitorKey(input.scheduleId, input.messageId);
    const poll = async (attempt: number): Promise<void> => {
      try {
        const data = await this.agentClientService.listInnerMessages({
          page: 1,
          pageSize: 1,
          source: 'scheduler',
          scheduleId: input.scheduleId,
          messageId: input.messageId,
        });

        const message = Array.isArray(data.items) && data.items.length > 0 ? data.items[0] : null;
        if (!message) {
          if (attempt >= this.monitorMaxAttempts) {
            await this.markScheduleLifecycleFailure({
              scheduleId: input.scheduleId,
              scheduleName: input.scheduleName,
              messageId: input.messageId,
              triggerType: input.triggerType,
              reason: 'inner-message not found while monitoring lifecycle',
            });
            this.stopLifecycleMonitor(monitorKey);
            return;
          }
          this.scheduleNextLifecycleMonitorPoll(monitorKey, attempt + 1, poll);
          return;
        }

        const status = String(message.status || '').trim().toLowerCase();
        if (status === 'processed') {
          const completedAt =
            message.processedAt ||
            message.updatedAt ||
            message.deliveredAt ||
            message.sentAt ||
            new Date().toISOString();

          await this.scheduleModel
            .updateOne(
              { _id: input.scheduleId, 'lastRun.taskId': input.messageId },
              {
                $set: {
                  status: 'idle',
                  'lastRun.completedAt': new Date(completedAt),
                  'lastRun.success': true,
                  'lastRun.result': `inner-message processed: ${input.messageId}`,
                  'lastRun.error': undefined,
                },
                $inc: {
                  'stats.successRuns': 1,
                },
              },
            )
            .exec();

          this.stopLifecycleMonitor(monitorKey);
          return;
        }

        if (status === 'failed') {
          const reason = String(message.error || '').trim() || 'inner-message processing failed';
          await this.markScheduleLifecycleFailure({
            scheduleId: input.scheduleId,
            scheduleName: input.scheduleName,
            messageId: input.messageId,
            triggerType: input.triggerType,
            reason,
          });
          this.stopLifecycleMonitor(monitorKey);
          return;
        }

        if (attempt >= this.monitorMaxAttempts) {
          await this.markScheduleLifecycleFailure({
            scheduleId: input.scheduleId,
            scheduleName: input.scheduleName,
            messageId: input.messageId,
            triggerType: input.triggerType,
            reason: `inner-message lifecycle monitor timeout after ${this.monitorMaxAttempts} polls`,
          });
          this.stopLifecycleMonitor(monitorKey);
          return;
        }

        this.scheduleNextLifecycleMonitorPoll(monitorKey, attempt + 1, poll);
      } catch (error) {
        this.logger.warn(
          `Scheduler lifecycle monitor error scheduleId=${input.scheduleId} messageId=${input.messageId}: ${error instanceof Error ? error.message : String(error)}`,
        );
        if (attempt >= this.monitorMaxAttempts) {
          await this.markScheduleLifecycleFailure({
            scheduleId: input.scheduleId,
            scheduleName: input.scheduleName,
            messageId: input.messageId,
            triggerType: input.triggerType,
            reason: 'inner-message lifecycle monitor request failed repeatedly',
          });
          this.stopLifecycleMonitor(monitorKey);
          return;
        }
        this.scheduleNextLifecycleMonitorPoll(monitorKey, attempt + 1, poll);
      }
    };

    this.scheduleNextLifecycleMonitorPoll(monitorKey, 1, poll);
  }

  private scheduleNextLifecycleMonitorPoll(
    monitorKey: string,
    attempt: number,
    poll: (attempt: number) => Promise<void>,
  ): void {
    this.stopLifecycleMonitor(monitorKey);
    const timer = setTimeout(() => {
      poll(attempt).catch((error) => {
        this.logger.warn(
          `Scheduler lifecycle monitor poll failure key=${monitorKey}: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }, this.monitorIntervalMs);
    this.lifecycleMonitorTimers.set(monitorKey, timer);
  }

  private stopLifecycleMonitor(monitorKey: string): void {
    const timer = this.lifecycleMonitorTimers.get(monitorKey);
    if (timer) {
      clearTimeout(timer);
      this.lifecycleMonitorTimers.delete(monitorKey);
    }
  }

  private async markScheduleLifecycleFailure(input: {
    scheduleId: string;
    scheduleName: string;
    messageId: string;
    triggerType: TriggerType;
    reason: string;
  }): Promise<void> {
    await this.scheduleModel
      .updateOne(
        { _id: input.scheduleId, 'lastRun.taskId': input.messageId },
        {
          $set: {
            status: 'error',
            'lastRun.completedAt': new Date(),
            'lastRun.success': false,
            'lastRun.error': input.reason,
            'lastRun.result': undefined,
          },
          $inc: {
            'stats.failedRuns': 1,
          },
        },
      )
      .exec();

    await this.recordDeadLetter({
      scheduleId: input.scheduleId,
      taskId: input.messageId,
      triggerType: input.triggerType,
      reason: input.reason,
      attempts: this.dispatchMaxAttempts,
    });
    await this.notifyScheduleFailure(input.scheduleId, input.scheduleName, input.reason);
  }

  private buildMessageContent(
    schedule: Schedule,
    effectiveInput: { prompt?: string; payload?: Record<string, unknown> },
    triggerType: TriggerType,
  ): string {
    const parts: string[] = [
      '你收到一条来自定时调度器的任务消息。',
      `调度名称: ${schedule.name}`,
      `触发方式: ${triggerType === 'auto' ? '自动触发（定时）' : '手动触发'}`,
    ];

    if (schedule.description) {
      parts.push(`任务描述: ${schedule.description}`);
    }

    if (effectiveInput.prompt) {
      parts.push('', '任务指令:', effectiveInput.prompt);
    }

    if (effectiveInput.payload && Object.keys(effectiveInput.payload).length > 0) {
      parts.push('', '结构化参数:', JSON.stringify(effectiveInput.payload, null, 2));
    }

    parts.push(
      '',
      '要求:',
      '1) 根据上述信息，使用你的已授权工具自主完成任务。',
      '2) 如果信息不足，做最小可行响应并说明缺失信息。',
      '3) 完成后请简要总结执行结果。',
    );

    return parts.join('\n');
  }

  private mergeInput(
    base: { prompt?: string; payload?: Record<string, unknown> } | undefined,
    override: { prompt?: string; payload?: Record<string, unknown> } | undefined,
  ): { prompt?: string; payload?: Record<string, unknown> } {
    return {
      prompt: override?.prompt ?? base?.prompt,
      payload: {
        ...(base?.payload || {}),
        ...(override?.payload || {}),
      },
    };
  }

  private resolveMessageConfig(
    message: { eventType?: string; title?: string } | undefined,
    fallbackName: string,
  ): { eventType: string; title?: string } {
    const eventType = String(message?.eventType || '').trim() || 'schedule.trigger';
    const title = String(message?.title || '').trim() || fallbackName.trim();
    return {
      eventType,
      title,
    };
  }

  private assertScheduleTarget(executorId: string | undefined): void {
    const normalized = String(executorId || '').trim();
    if (!normalized) {
      throw new BadRequestException('target.executorId is required');
    }
  }

  private async recordDeadLetter(options: {
    scheduleId: string;
    taskId?: string;
    triggerType: TriggerType;
    reason: string;
    attempts: number;
  }): Promise<void> {
    await this.scheduleModel
      .updateOne(
        { _id: options.scheduleId },
        {
          $push: {
            deadLetters: {
              $each: [
                {
                  failedAt: new Date(),
                  taskId: options.taskId || undefined,
                  triggerType: options.triggerType,
                  reason: options.reason,
                  attempts: options.attempts,
                },
              ],
              $slice: -50,
            },
          },
        },
      )
      .exec();
  }

  private async notifyScheduleFailure(scheduleId: string, scheduleName: string, reason: string): Promise<void> {
    const payload = {
      event: 'scheduler.dead_letter',
      scheduleId,
      scheduleName,
      reason,
      timestamp: new Date().toISOString(),
    };

    this.logger.error(`Schedule moved to dead letter: ${JSON.stringify(payload)}`);

    if (!this.schedulerAlertWebhookUrl) {
      return;
    }

    try {
      await axios.post(this.schedulerAlertWebhookUrl, payload, {
        timeout: Number(process.env.SCHEDULER_ALERT_TIMEOUT_MS || 5000),
      });
    } catch (error) {
      this.logger.warn(`Failed to send scheduler dead-letter webhook: ${error instanceof Error ? error.message : String(error)}`);
    }
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

  private async logMissingSystemSchedules(): Promise<void> {
    const existing = await this.scheduleModel
      .find({ name: { $in: this.systemScheduleNames } })
      .select({ name: 1 })
      .lean()
      .exec();
    const existingNames = new Set(existing.map((item) => String((item as { name?: string }).name || '')));
    const missing = this.systemScheduleNames.filter((name) => !existingNames.has(name));
    if (missing.length) {
      this.logger.warn(`System schedules missing: ${missing.join(', ')}. Run manual seed to initialize.`);
    }
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
    return `schedule-cron:${scheduleId}`;
  }

  private getIntervalKey(scheduleId: string): string {
    return `schedule-interval:${scheduleId}`;
  }

  private getLifecycleMonitorKey(scheduleId: string, messageId: string): string {
    return `schedule-monitor:${scheduleId}:${messageId}`;
  }
}
