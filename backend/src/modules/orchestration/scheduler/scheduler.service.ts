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
import { OrchestrationService } from '../orchestration.service';
import {
  CreateScheduleDto,
  UpdateScheduleDto,
} from './dto';

type TriggerType = 'auto' | 'manual';

@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly runLocks = new Set<string>();

  constructor(
    @InjectModel(OrchestrationSchedule.name)
    private readonly scheduleModel: Model<OrchestrationScheduleDocument>,
    @InjectModel(OrchestrationTask.name)
    private readonly taskModel: Model<OrchestrationTaskDocument>,
    @InjectModel(Agent.name)
    private readonly agentModel: Model<AgentDocument>,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly orchestrationService: OrchestrationService,
  ) {}

  async onModuleInit(): Promise<void> {
    const enabledSchedules = await this.scheduleModel.find({ enabled: true }).exec();
    await Promise.all(enabledSchedules.map((schedule) => this.registerSchedule(schedule)));
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
    const schedule = await new this.scheduleModel({
      name: dto.name.trim(),
      description: dto.description?.trim(),
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
