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
import { Agent, AgentDocument } from '@agent/schemas/agent.schema';
import {
  OrchestrationSchedule,
  OrchestrationScheduleDocument,
} from '@legacy/shared/schemas/orchestration-schedule.schema';
import {
  OrchestrationTask,
  OrchestrationTaskDocument,
  OrchestrationTaskStatus,
} from '../../../shared/schemas/orchestration-task.schema';
import {
  OrchestrationRun,
  OrchestrationRunDocument,
} from '../../../shared/schemas/orchestration-run.schema';
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
  private readonly schedulerAlertWebhookUrl = String(process.env.SCHEDULER_ALERT_WEBHOOK_URL || '').trim();
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
    @InjectModel(OrchestrationSchedule.name)
    private readonly scheduleModel: Model<OrchestrationScheduleDocument>,
    @InjectModel(OrchestrationTask.name)
    private readonly taskModel: Model<OrchestrationTaskDocument>,
    @InjectModel(OrchestrationRun.name)
    private readonly runModel: Model<OrchestrationRunDocument>,
    @InjectModel(Agent.name)
    private readonly agentModel: Model<AgentDocument>,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly orchestrationService: OrchestrationService,
    private readonly agentClientService: AgentClientService,
  ) {}

  async onModuleInit(): Promise<void> {
    const enabledSchedules = await this.scheduleModel.find({ enabled: true }).exec();
    await Promise.all(enabledSchedules.map((schedule) => this.registerSchedule(schedule)));
    await this.logMissingSystemSchedules();
  }

  async getOrCreateEngineeringStatisticsSchedule(): Promise<OrchestrationSchedule> {
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
    const baseToolParameters =
      basePayload.toolParameters && typeof basePayload.toolParameters === 'object'
        ? (basePayload.toolParameters as Record<string, unknown>)
        : {};

    await this.dispatchSchedule(schedule, 'manual', {
      inputOverride: {
        payload: {
          ...basePayload,
          toolParameters: {
            ...baseToolParameters,
            ...(payload?.receiverId ? { receiverId: payload.receiverId } : {}),
            ...(payload?.scope ? { scope: payload.scope } : {}),
            ...(payload?.tokenMode ? { tokenMode: payload.tokenMode } : {}),
            ...(Array.isArray(payload?.projectIds) ? { projectIds: payload.projectIds } : {}),
            triggeredBy: payload?.triggeredBy || 'frontend-trigger',
          },
        },
      },
    });
    return { accepted: true, status: 'triggered', scheduleId };
  }

  async getOrCreateDocsHeatSchedule(): Promise<OrchestrationSchedule> {
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
    const baseToolParameters =
      basePayload.toolParameters && typeof basePayload.toolParameters === 'object'
        ? (basePayload.toolParameters as Record<string, unknown>)
        : {};

    await this.dispatchSchedule(schedule, 'manual', {
      inputOverride: {
        payload: {
          ...basePayload,
          toolParameters: {
            ...baseToolParameters,
            ...(Number.isFinite(Number(payload?.topN)) && Number(payload?.topN) > 0
              ? { topN: Math.floor(Number(payload?.topN)) }
              : {}),
            triggeredBy: payload?.triggeredBy || 'frontend-trigger',
          },
        },
      },
    });
    return { accepted: true, status: 'triggered', scheduleId };
  }

  onModuleDestroy(): void {
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

  async getScheduleHistory(scheduleId: string, limit = 20): Promise<OrchestrationRun[]> {
    await this.getScheduleById(scheduleId);
    return this.runModel
      .find({ scheduleId })
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

    const lockAcquired = await this.acquireRunLock(scheduleId);
    if (!lockAcquired) {
      return;
    }

    const startedAt = new Date();
    const effectiveInput = {
      prompt: options?.inputOverride?.prompt ?? schedule.input?.prompt,
      payload: {
        ...(schedule.input?.payload || {}),
        ...(options?.inputOverride?.payload || {}),
      },
    };

    try {
      await this.markScheduleStarted(scheduleId, startedAt);
      const executionResult = await this.executeWithRetry({
        schedule,
        scheduleId,
        triggerType,
        startedAt,
        effectiveInput,
      });
      const completedAt = new Date();
      const success = executionResult.executionStatus === 'completed';

      if (!success) {
        await this.recordDeadLetter({
          scheduleId,
          taskId: executionResult.taskId || executionResult.runId,
          triggerType,
          reason: executionResult.errorMessage || 'Schedule execution failed',
          attempts: executionResult.attempts,
        });
        await this.notifyScheduleFailure({
          scheduleId,
          scheduleName: schedule.name,
          triggerType,
          attempts: executionResult.attempts,
          taskId: executionResult.taskId || executionResult.runId,
          errorMessage: executionResult.errorMessage,
        });
      }

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
                result: executionResult.result || undefined,
                error: executionResult.errorMessage || undefined,
                taskId: executionResult.taskId || executionResult.runId || undefined,
                sessionId: executionResult.sessionId || undefined,
                attempts: executionResult.attempts,
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
    } finally {
      this.runLocks.delete(scheduleId);
    }
  }

  private async acquireRunLock(scheduleId: string): Promise<boolean> {
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
      return false;
    }

    this.runLocks.add(scheduleId);
    return true;
  }

  private async markScheduleStarted(scheduleId: string, startedAt: Date): Promise<void> {
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
  }

  private async executeWithRetry(options: {
    schedule: OrchestrationScheduleDocument | OrchestrationSchedule;
    scheduleId: string;
    triggerType: TriggerType;
    startedAt: Date;
    effectiveInput: {
      prompt?: string;
      payload?: Record<string, unknown>;
    };
  }): Promise<{
    executionStatus: OrchestrationTaskStatus;
    taskId?: string;
    runId?: string;
    sessionId?: string;
    errorMessage: string;
    result?: string;
    attempts: number;
  }> {
    const retryConfig = this.resolveRetryConfig();
    const maxAttempts = retryConfig.maxRetries + 1;

    let lastResult: {
      executionStatus: OrchestrationTaskStatus;
      taskId?: string;
      runId?: string;
      sessionId?: string;
      errorMessage: string;
      result?: string;
      attempts: number;
    } = {
      executionStatus: 'failed',
      taskId: undefined,
      runId: undefined,
      sessionId: undefined,
      errorMessage: 'Schedule execution failed',
      result: undefined,
      attempts: 0,
    };

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      lastResult = await this.executeSingleAttempt({
        ...options,
        attempt,
      });

      if (lastResult.executionStatus === 'completed') {
        return lastResult;
      }

      if (attempt < maxAttempts) {
        const delayMs = this.computeBackoffDelayMs(attempt, retryConfig.baseDelayMs, retryConfig.maxDelayMs);
        this.logger.warn(
          `Schedule ${options.scheduleId} attempt ${attempt}/${maxAttempts} failed, retrying in ${delayMs}ms: ${lastResult.errorMessage}`,
        );
        await this.sleep(delayMs);
      }
    }

    return lastResult;
  }

  private async executeSingleAttempt(options: {
    schedule: OrchestrationScheduleDocument | OrchestrationSchedule;
    scheduleId: string;
    triggerType: TriggerType;
    startedAt: Date;
    effectiveInput: {
      prompt?: string;
      payload?: Record<string, unknown>;
    };
    attempt: number;
  }): Promise<{
    executionStatus: OrchestrationTaskStatus;
    taskId?: string;
    runId?: string;
    sessionId?: string;
    errorMessage: string;
    result?: string;
    attempts: number;
  }> {
    const { schedule, scheduleId, triggerType, startedAt, effectiveInput, attempt } = options;
    let taskId: string | undefined;
    let runId: string | undefined;
    let sessionId: string | undefined;
    let errorMessage = '';
    let result: string | undefined;
    let executionStatus: OrchestrationTaskStatus = 'failed';

    try {
      if (schedule.planId) {
        const run = await this.orchestrationService.executePlanRun(schedule.planId, 'schedule', {
          scheduleId,
          continueOnFailure: true,
        });
        runId = this.getEntityId(run as unknown as Record<string, unknown>);
        executionStatus = run.status === 'completed' ? 'completed' : 'failed';
        result = run.summary || JSON.stringify(run.stats || {});
        errorMessage = run.error || '';
      } else {
        const task = await new this.taskModel({
          title: schedule.name,
          description: this.buildTaskDescription({
            ...schedule,
            input: effectiveInput,
          } as OrchestrationSchedule),
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
                attempt,
              },
            },
          ],
        }).save();

        taskId = task._id.toString();
        const execution = await this.executeScheduleTaskByInput(taskId, schedule, effectiveInput);
        executionStatus = execution.status;
        result = execution.result || '';

        const latestTask = await this.taskModel.findOne({ _id: taskId }).exec();
        sessionId = latestTask?.sessionId || '';
        errorMessage = execution.error || latestTask?.result?.error || '';
      }
    } catch (error) {
      executionStatus = 'failed';
      errorMessage = error instanceof Error ? error.message : 'Schedule execution failed';
      this.logger.error(`Schedule ${scheduleId} attempt ${attempt} failed`, error instanceof Error ? error.stack : String(error));
    }

    return {
      executionStatus,
      taskId,
      runId,
      sessionId,
      errorMessage,
      result,
      attempts: attempt,
    };
  }

  private resolveRetryConfig(): { maxRetries: number; baseDelayMs: number; maxDelayMs: number } {
    const maxRetries = Math.max(0, Number(process.env.SCHEDULER_MAX_RETRIES || 2));
    const baseDelayMs = Math.max(500, Number(process.env.SCHEDULER_RETRY_BASE_DELAY_MS || 1000));
    const maxDelayMs = Math.max(baseDelayMs, Number(process.env.SCHEDULER_RETRY_MAX_DELAY_MS || 30000));
    return { maxRetries, baseDelayMs, maxDelayMs };
  }

  private computeBackoffDelayMs(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
    const delay = baseDelayMs * Math.pow(2, Math.max(0, attempt - 1));
    return Math.min(maxDelayMs, delay);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
              failedAt: new Date(),
              taskId: options.taskId || undefined,
              triggerType: options.triggerType,
              reason: options.reason,
              attempts: options.attempts,
            },
          },
        },
      )
      .exec();
  }

  private async notifyScheduleFailure(options: {
    scheduleId: string;
    scheduleName: string;
    triggerType: TriggerType;
    attempts: number;
    taskId?: string;
    errorMessage?: string;
  }): Promise<void> {
    const payload = {
      event: 'scheduler.dead_letter',
      scheduleId: options.scheduleId,
      scheduleName: options.scheduleName,
      triggerType: options.triggerType,
      attempts: options.attempts,
      taskId: options.taskId,
      errorMessage: options.errorMessage,
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
      this.logger.warn(
        `Failed to send scheduler dead-letter webhook: ${error instanceof Error ? error.message : String(error)}`,
      );
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

  private async executeScheduleTaskByInput(
    taskId: string,
    schedule: OrchestrationScheduleDocument | OrchestrationSchedule,
    effectiveInput: {
      prompt?: string;
      payload?: Record<string, unknown>;
    },
  ): Promise<{ status: OrchestrationTaskStatus; result?: string; error?: string }> {
    const payload =
      effectiveInput?.payload && typeof effectiveInput.payload === 'object'
        ? (effectiveInput.payload as Record<string, unknown>)
        : {};
    const memoCommand = String(payload.memoCommand || '').trim();
    if (memoCommand === 'flush_events' || memoCommand === 'full_aggregation') {
      const enqueued = await this.agentClientService.enqueueMemoAggregationCommand({
        commandType: memoCommand,
        scheduleId: this.getEntityId(schedule as unknown as Record<string, unknown>),
        taskId,
        agentId: typeof payload.agentId === 'string' ? payload.agentId : undefined,
        triggeredBy: typeof payload.triggeredBy === 'string' ? payload.triggeredBy : 'system-schedule',
      });

      if (!enqueued.accepted) {
        return {
          status: 'failed',
          error: 'Failed to enqueue memo aggregation command',
        };
      }

      const output = JSON.stringify(
        {
          accepted: true,
          queued: enqueued.queued,
          requestId: enqueued.requestId,
          commandType: memoCommand,
        },
        null,
        2,
      );

      await this.taskModel
        .updateOne(
          { _id: taskId },
          {
            $set: {
              status: 'completed',
              completedAt: new Date(),
              result: {
                summary: `Memo aggregation command queued: ${memoCommand}`,
                output,
              },
            },
            $push: {
              runLogs: {
                timestamp: new Date(),
                level: 'info',
                message: `Memo aggregation command queued: ${memoCommand}`,
                metadata: {
                  requestId: enqueued.requestId,
                },
              },
            },
          },
        )
        .exec();

      return {
        status: 'completed',
        result: output,
      };
    }

    const toolId = String(effectiveInput?.payload?.toolId || '').trim();
    const toolParameters =
      effectiveInput?.payload && typeof effectiveInput.payload.toolParameters === 'object'
        ? (effectiveInput.payload.toolParameters as Record<string, unknown>)
        : undefined;

    if (toolId) {
      try {
        const execution = await this.agentClientService.executeTool(
          toolId,
          schedule.target.executorId,
          {
            ...(toolParameters || {}),
          },
          taskId,
        );

        const output = JSON.stringify((execution as any)?.result?.data || execution || {}, null, 2);
        await this.taskModel
          .updateOne(
            { _id: taskId },
            {
              $set: {
                status: 'completed',
                completedAt: new Date(),
                result: {
                  summary: `Tool executed: ${toolId}`,
                  output,
                },
              },
              $push: {
                runLogs: {
                  timestamp: new Date(),
                  level: 'info',
                  message: `Tool execution completed: ${toolId}`,
                },
              },
            },
          )
          .exec();

        return {
          status: 'completed',
          result: output,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Tool execution failed';
        await this.taskModel
          .updateOne(
            { _id: taskId },
            {
              $set: {
                status: 'failed',
                completedAt: new Date(),
                result: {
                  error: message,
                },
              },
              $push: {
                runLogs: {
                  timestamp: new Date(),
                  level: 'error',
                  message: `Tool execution failed: ${toolId}`,
                  metadata: {
                    error: message,
                  },
                },
              },
            },
          )
          .exec();

        return {
          status: 'failed',
          error: message,
        };
      }
    }

    return this.orchestrationService.executeStandaloneTask(taskId);
  }

  private async logMissingSystemSchedules(): Promise<void> {
    const existing = await this.scheduleModel
      .find({
        name: { $in: this.systemScheduleNames },
      })
      .select({ name: 1 })
      .lean()
      .exec();
    const existingNames = new Set(existing.map((item) => String((item as { name?: string }).name || '')));
    const missing = this.systemScheduleNames.filter((name) => !existingNames.has(name));
    if (missing.length) {
      this.logger.warn(`System schedules missing: ${missing.join(', ')}. Run manual seed to initialize.`);
    }
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
