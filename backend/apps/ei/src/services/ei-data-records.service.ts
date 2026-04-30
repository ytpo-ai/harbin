import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage } from 'mongoose';
import {
  AggregateDataRecordsDto,
  CleanupDataRecordsDto,
  QueryDataRecordsDto,
} from '../dto';
import { EiDataRecord, EiDataRecordDocument } from '../schemas/ei-data-record.schema';

@Injectable()
export class EiDataRecordsService {
  constructor(
    @InjectModel(EiDataRecord.name)
    private readonly dataRecordModel: Model<EiDataRecordDocument>,
  ) {}

  private buildTimeRange(startDate?: string, endDate?: string): Record<string, Date> | undefined {
    const range: Record<string, Date> = {};
    if (startDate) {
      const start = new Date(startDate);
      if (!Number.isNaN(start.getTime())) {
        range.$gte = start;
      }
    }
    if (endDate) {
      const end = new Date(endDate);
      if (!Number.isNaN(end.getTime())) {
        range.$lte = end;
      }
    }
    return Object.keys(range).length > 0 ? range : undefined;
  }

  async list(query: QueryDataRecordsDto): Promise<EiDataRecord[]> {
    const filter: Record<string, unknown> = {};
    if (query.projectId) {
      filter.projectId = query.projectId;
    }
    if (query.dataSourceId) {
      filter.dataSourceId = query.dataSourceId;
    }
    if (query.dataCategory) {
      filter.dataCategory = query.dataCategory;
    }
    if (query.status) {
      filter.status = query.status;
    }
    if (query.tag) {
      filter.tags = query.tag;
    }

    const range = this.buildTimeRange(query.startDate, query.endDate);
    if (range) {
      filter.collectedAt = range;
    }

    return this.dataRecordModel.find(filter).sort({ collectedAt: -1 }).limit(500).lean().exec() as unknown as EiDataRecord[];
  }

  async getById(id: string): Promise<EiDataRecord> {
    const record = await this.dataRecordModel.findById(id).lean().exec();
    if (!record) {
      throw new NotFoundException(`数据记录 ${id} 不存在`);
    }
    return record as unknown as EiDataRecord;
  }

  async aggregate(query: AggregateDataRecordsDto): Promise<Array<{ key: string; count: number }>> {
    const filter: Record<string, unknown> = {};
    if (query.projectId) {
      filter.projectId = query.projectId;
    }
    if (query.dataCategory) {
      filter.dataCategory = query.dataCategory;
    }
    const range = this.buildTimeRange(query.startDate, query.endDate);
    if (range) {
      filter.collectedAt = range;
    }

    const groupBy = query.groupBy || 'day';
    const pipeline: PipelineStage[] = [{ $match: filter }];

    if (groupBy === 'tag') {
      pipeline.push({ $unwind: '$tags' });
      pipeline.push({ $group: { _id: '$tags', count: { $sum: 1 } } });
    } else if (groupBy === 'dataCategory') {
      pipeline.push({ $group: { _id: '$dataCategory', count: { $sum: 1 } } });
    } else {
      pipeline.push({
        $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: '$collectedAt',
              timezone: 'Asia/Shanghai',
            },
          },
          count: { $sum: 1 },
        },
      });
    }

    pipeline.push({ $sort: { _id: 1 } });

    const result = await this.dataRecordModel.aggregate(pipeline).exec();
    return result.map((item: { _id: string; count: number }) => ({ key: String(item._id || 'unknown'), count: item.count || 0 }));
  }

  async deleteById(id: string): Promise<{ deleted: boolean }> {
    const result = await this.dataRecordModel.findByIdAndDelete(id).lean().exec();
    if (!result) {
      throw new NotFoundException(`数据记录 ${id} 不存在`);
    }
    return { deleted: true };
  }

  async cleanup(query: CleanupDataRecordsDto): Promise<{ deletedCount: number }> {
    const filter: Record<string, unknown> = {};
    if (query.dataSourceId) {
      filter.dataSourceId = query.dataSourceId;
    }
    if (query.before) {
      const beforeDate = new Date(query.before);
      if (Number.isNaN(beforeDate.getTime())) {
        throw new BadRequestException('before 参数不是有效日期');
      }
      filter.collectedAt = { $lt: beforeDate };
    }

    if (!filter.dataSourceId && !filter.collectedAt) {
      throw new BadRequestException('至少需要 dataSourceId 或 before 过滤条件之一');
    }

    const result = await this.dataRecordModel.deleteMany(filter).exec();
    return { deletedCount: result.deletedCount || 0 };
  }
}
