import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  CollectDataSourceDto,
  CreateDataSourceDto,
  QueryDataSourcesDto,
  TestDataSourceDto,
  UpdateDataSourceDto,
} from '../dto';
import {
  EiDataSource,
  EiDataSourceDocument,
  EiDataSourceStatistics,
} from '../schemas/ei-data-source.schema';
import { EiDataRecord, EiDataRecordDocument } from '../schemas/ei-data-record.schema';
import { Schedule, ScheduleDocument } from '../../../../src/shared/schemas/schedule.schema';
import { EiDiscussionBackfillService } from './ei-discussion-backfill.service';

@Injectable()
export class EiDataSourcesService {
  constructor(
    @InjectModel(EiDataSource.name)
    private readonly dataSourceModel: Model<EiDataSourceDocument>,
    @InjectModel(EiDataRecord.name)
    private readonly dataRecordModel: Model<EiDataRecordDocument>,
    @InjectModel(Schedule.name)
    private readonly scheduleModel: Model<ScheduleDocument>,
    private readonly eiDiscussionBackfillService: EiDiscussionBackfillService,
  ) {}

  private normalizeFrequencyToCron(frequency: 'hourly' | 'daily' | 'weekly' | 'monthly'): string {
    if (frequency === 'hourly') {
      return '0 * * * *';
    }
    if (frequency === 'weekly') {
      return '0 9 * * 1';
    }
    if (frequency === 'monthly') {
      return '0 9 1 * *';
    }
    return '0 9 * * *';
  }

  private buildSchedulePayload(dataSource: EiDataSource): Record<string, unknown> {
    const expression = String(dataSource.cronExpression || this.normalizeFrequencyToCron(dataSource.collectFrequency)).trim();
    const sourceId = String((dataSource as any)._id || '').trim();
    const executorAgentId = String(dataSource.executorAgentId || '').trim() || 'data-collection-agent';
    const executorAgentName = String(dataSource.executorAgentName || '').trim() || 'Data Collection Agent';
    const schedulePrompt = [
      `你正在执行数据采集任务：${dataSource.name}`,
      `请先调用 builtin.sys-mg.mcp.data-collection.get-source-config 获取最新数据源配置（sourceId=${sourceId}）。`,
      '按配置执行采集后，调用 builtin.sys-mg.mcp.data-collection.write-record 写入采集结果。',
      '如采集失败，也必须写入 status=error 的记录并附带 error 信息。',
    ].join('\n');

    return {
      id: `schedule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: `数据采集: ${dataSource.name}`,
      description: `自动采集数据源 ${dataSource.name}`,
      schedule: {
        type: 'cron',
        expression,
        timezone: 'Asia/Shanghai',
      },
      target: {
        executorType: 'agent',
        executorId: executorAgentId,
        executorName: executorAgentName,
      },
      input: {
        prompt: schedulePrompt,
        payload: {
          sourceId,
          sourceType: dataSource.sourceType,
          config: dataSource.config,
        },
      },
      projectId: dataSource.projectId,
      enabled: dataSource.status === 'active',
      status: dataSource.status === 'active' ? 'idle' : 'paused',
      stats: {
        totalRuns: 0,
        successRuns: 0,
        failedRuns: 0,
        skippedRuns: 0,
      },
    };
  }

  private async createLinkedSchedule(dataSource: EiDataSource): Promise<string> {
    const schedulePayload = this.buildSchedulePayload(dataSource);
    const schedule = await this.scheduleModel.create(schedulePayload);
    return String((schedule as any)._id);
  }

  private nextStatistics(
    current: EiDataSourceStatistics | undefined,
    input: { success?: boolean; error?: string },
  ): EiDataSourceStatistics {
    const base: EiDataSourceStatistics = {
      totalCollections: Number(current?.totalCollections || 0),
      successCount: Number(current?.successCount || 0),
      errorCount: Number(current?.errorCount || 0),
      lastSuccessAt: current?.lastSuccessAt,
    };
    base.totalCollections += 1;
    if (input.success) {
      base.successCount += 1;
      base.lastSuccessAt = new Date();
    } else {
      base.errorCount += 1;
    }
    return base;
  }

  async create(payload: CreateDataSourceDto): Promise<EiDataSource> {
    if (payload.sourceType === 'api' && !String(payload.config?.url || '').trim()) {
      throw new BadRequestException('api 类型数据源必须提供 config.url');
    }
    if (!String(payload.executorAgentId || '').trim()) {
      throw new BadRequestException('创建数据源必须提供 executorAgentId，用于定时调度触发 Agent 采集');
    }

    const created = await this.dataSourceModel.create({
      ...payload,
      description: payload.description || '',
      collectFrequency: payload.collectFrequency || 'daily',
      status: payload.status || 'active',
      executorAgentId: String(payload.executorAgentId || '').trim() || undefined,
      executorAgentName: String(payload.executorAgentName || '').trim() || undefined,
      statistics: {
        totalCollections: 0,
        successCount: 0,
        errorCount: 0,
      },
      notifyDiscussion: payload.notifyDiscussion !== undefined ? Boolean(payload.notifyDiscussion) : true,
      notifyThreshold: payload.notifyThreshold || 1,
    });

    const scheduleId = await this.createLinkedSchedule(created as unknown as EiDataSource);
    const updated = await this.dataSourceModel
      .findByIdAndUpdate(created._id, { $set: { scheduleId } }, { new: true })
      .lean()
      .exec();

    return updated as unknown as EiDataSource;
  }

  async list(query: QueryDataSourcesDto): Promise<EiDataSource[]> {
    const filter: Record<string, unknown> = {};
    if (query.projectId) {
      filter.projectId = query.projectId;
    }
    if (query.sourceType) {
      filter.sourceType = query.sourceType;
    }
    if (query.status) {
      filter.status = query.status;
    }
    return this.dataSourceModel.find(filter).sort({ updatedAt: -1 }).lean().exec() as unknown as EiDataSource[];
  }

  async getById(id: string): Promise<EiDataSource> {
    const item = await this.dataSourceModel.findById(id).lean().exec();
    if (!item) {
      throw new NotFoundException(`数据源 ${id} 不存在`);
    }
    return item as unknown as EiDataSource;
  }

  async update(id: string, payload: UpdateDataSourceDto): Promise<EiDataSource> {
    const current = await this.dataSourceModel.findById(id).lean().exec();
    if (!current) {
      throw new NotFoundException(`数据源 ${id} 不存在`);
    }

    const updated = await this.dataSourceModel
      .findByIdAndUpdate(id, { $set: payload }, { new: true })
      .lean()
      .exec();

    if (!updated) {
      throw new NotFoundException(`数据源 ${id} 不存在`);
    }

    const nextExpression = payload.cronExpression || (payload.collectFrequency ? this.normalizeFrequencyToCron(payload.collectFrequency) : undefined);
    const nextEnabled = payload.status ? payload.status === 'active' : undefined;
    const nextExecutorAgentId = String(payload.executorAgentId || '').trim();
    const nextExecutorAgentName = String(payload.executorAgentName || '').trim();
    const sourceId = String(current._id || '').trim();
    const shouldRefreshScheduleInput =
      payload.name !== undefined ||
      payload.config !== undefined ||
      payload.sourceType !== undefined;

    if (current.scheduleId && (nextExpression || nextEnabled !== undefined || nextExecutorAgentId || nextExecutorAgentName || shouldRefreshScheduleInput)) {
      const schedulePatch: Record<string, unknown> = {};
      if (nextExpression) {
        schedulePatch['schedule.expression'] = nextExpression;
      }
      if (nextEnabled !== undefined) {
        schedulePatch.enabled = nextEnabled;
        schedulePatch.status = nextEnabled ? 'idle' : 'paused';
      }
      if (nextExecutorAgentId) {
        schedulePatch['target.executorId'] = nextExecutorAgentId;
      }
      if (nextExecutorAgentName) {
        schedulePatch['target.executorName'] = nextExecutorAgentName;
      }
      if (shouldRefreshScheduleInput) {
        const nextSourceName = String(payload.name || current.name || '').trim() || '未命名数据源';
        const nextSourceType = payload.sourceType || current.sourceType;
        const nextConfig = payload.config || current.config;
        schedulePatch.name = `数据采集: ${nextSourceName}`;
        schedulePatch.description = `自动采集数据源 ${nextSourceName}`;
        schedulePatch.input = {
          prompt: [
            `你正在执行数据采集任务：${nextSourceName}`,
            `请先调用 builtin.sys-mg.mcp.data-collection.get-source-config 获取最新数据源配置（sourceId=${sourceId}）。`,
            '按配置执行采集后，调用 builtin.sys-mg.mcp.data-collection.write-record 写入采集结果。',
            '如采集失败，也必须写入 status=error 的记录并附带 error 信息。',
          ].join('\n'),
          payload: {
            sourceId,
            sourceType: nextSourceType,
            config: nextConfig,
          },
        };
      }
      if (Object.keys(schedulePatch).length > 0) {
        await this.scheduleModel.updateOne({ _id: current.scheduleId }, { $set: schedulePatch }).exec();
      }
    }

    return updated as unknown as EiDataSource;
  }

  async remove(id: string): Promise<{ deleted: boolean }> {
    const item = await this.dataSourceModel.findByIdAndDelete(id).lean().exec();
    if (!item) {
      throw new NotFoundException(`数据源 ${id} 不存在`);
    }

    if (item.scheduleId) {
      await this.scheduleModel.deleteOne({ _id: item.scheduleId }).exec();
    }

    return { deleted: true };
  }

  async test(id: string, payload?: TestDataSourceDto): Promise<Record<string, unknown>> {
    const item = await this.dataSourceModel.findById(id).lean().exec();
    if (!item) {
      throw new NotFoundException(`数据源 ${id} 不存在`);
    }

    if (item.sourceType !== 'api') {
      return {
        ok: true,
        sourceType: item.sourceType,
        message: '当前仅对 api 类型执行在线测试，其它类型返回配置快照',
        config: item.config,
      };
    }

    const url = String(item.config?.url || '').trim();
    if (!url) {
      throw new BadRequestException('api 类型数据源缺少 config.url');
    }
    const method = String(item.config?.method || 'GET').toUpperCase();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(url, {
        method,
        headers: (item.config?.headers || {}) as Record<string, string>,
        signal: controller.signal,
      });
      const text = await response.text();
      const bodyPreview = payload?.mode === 'head' ? text.slice(0, 200) : text.slice(0, 1200);
      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        bodyPreview,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      throw new BadRequestException(`测试采集失败: ${message}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  async collect(id: string, payload?: CollectDataSourceDto): Promise<Record<string, unknown>> {
    const item = await this.dataSourceModel.findById(id).lean().exec();
    if (!item) {
      throw new NotFoundException(`数据源 ${id} 不存在`);
    }

    const previousRecord = await this.dataRecordModel
      .findOne({
        dataSourceId: String(item._id),
        status: { $in: ['success', 'partial'] },
      })
      .sort({ collectedAt: -1, createdAt: -1 })
      .lean()
      .exec();

    const record = await this.dataRecordModel.create({
      dataSourceId: String(item._id),
      projectId: item.projectId,
      data: payload?.data || { message: 'manual collection trigger', sourceName: item.name },
      rawData: payload?.rawData,
      collectedAt: new Date(),
      status: payload?.status || 'success',
      error: payload?.error,
      tags: payload?.tags || [],
      outlineSectionId: item.outlineSectionId,
      discussionSpaceId: item.discussionSpaceId,
      dataCategory: payload?.dataCategory || 'general',
    });

    const success = (payload?.status || 'success') === 'success';
    const nextStats = this.nextStatistics(item.statistics as EiDataSourceStatistics | undefined, {
      success,
      error: payload?.error,
    });

    await this.dataSourceModel
      .updateOne(
        { _id: item._id },
        {
          $set: {
            lastCollectedAt: new Date(),
            lastError: success ? undefined : payload?.error || 'collection failed',
            statistics: nextStats,
            status: success ? item.status : 'error',
          },
        },
      )
      .exec();

    await this.eiDiscussionBackfillService.backfillRecordToDiscussion({
      source: item as unknown as EiDataSource,
      record: record as unknown as EiDataRecord,
      nextStats,
      previousRecord: previousRecord as unknown as EiDataRecord | null,
    });

    return {
      sourceId: String(item._id),
      recordId: String((record as any)._id),
      status: payload?.status || 'success',
      collectedAt: record.collectedAt,
    };
  }
}
