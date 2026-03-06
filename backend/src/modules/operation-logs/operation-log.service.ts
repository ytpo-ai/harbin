import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { OperationLog, OperationLogDocument } from '../../shared/schemas/operation-log.schema';
import { Employee, EmployeeDocument, EmployeeType } from '../../shared/schemas/employee.schema';

export interface QueryOperationLogsParams {
  from?: string;
  to?: string;
  action?: string;
  resourceKeyword?: string;
  humanEmployeeId?: string;
  assistantAgentId?: string;
  success?: string;
  statusCode?: string;
  page?: string;
  pageSize?: string;
}

@Injectable()
export class OperationLogService {
  constructor(
    @InjectModel(OperationLog.name) private readonly operationLogModel: Model<OperationLogDocument>,
    @InjectModel(Employee.name) private readonly employeeModel: Model<EmployeeDocument>,
  ) {}

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private parseDate(value?: string): Date | undefined {
    if (!value) return undefined;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException('日期格式无效');
    }
    return parsed;
  }

  private parseBoolean(value?: string): boolean | undefined {
    if (typeof value !== 'string') return undefined;
    const normalized = value.trim().toLowerCase();
    if (!normalized) return undefined;
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
    return undefined;
  }

  async assertHumanViewer(employeeId: string): Promise<void> {
    const viewer = await this.employeeModel
      .findOne({ id: employeeId, type: EmployeeType.HUMAN })
      .select({ id: 1 })
      .lean()
      .exec();
    if (!viewer?.id) {
      throw new ForbiddenException('仅允许人类用户访问日志查询');
    }
  }

  async queryAllHumanOperationLogs(params: QueryOperationLogsParams) {
    const from = this.parseDate(params.from);
    const to = this.parseDate(params.to);
    if (from && to && from.getTime() > to.getTime()) {
      throw new BadRequestException('时间范围无效：from 必须早于 to');
    }

    const page = Math.max(1, Math.min(Number(params.page || 1), 10000));
    const pageSize = Math.max(1, Math.min(Number(params.pageSize || 20), 100));
    const skip = (page - 1) * pageSize;

    const filter: any = {};
    if (params.action?.trim()) {
      filter.action = { $regex: this.escapeRegex(params.action.trim()), $options: 'i' };
    }
    if (params.resourceKeyword?.trim()) {
      filter.resource = { $regex: this.escapeRegex(params.resourceKeyword.trim()), $options: 'i' };
    }
    if (params.humanEmployeeId?.trim()) {
      filter.humanEmployeeId = params.humanEmployeeId.trim();
    }
    if (params.assistantAgentId?.trim()) {
      filter.assistantAgentId = params.assistantAgentId.trim();
    }

    const success = this.parseBoolean(params.success);
    if (typeof success === 'boolean') {
      filter.success = success;
    }

    const statusCode = Number(params.statusCode);
    if (Number.isFinite(statusCode) && statusCode >= 100 && statusCode <= 599) {
      filter.statusCode = statusCode;
    }

    if (from || to) {
      filter.timestamp = {};
      if (from) filter.timestamp.$gte = from;
      if (to) filter.timestamp.$lte = to;
    }

    const [total, logs] = await Promise.all([
      this.operationLogModel.countDocuments(filter).exec(),
      this.operationLogModel.find(filter).sort({ timestamp: -1 }).skip(skip).limit(pageSize).lean().exec(),
    ]);

    const humanIds = Array.from(new Set(logs.map((item) => item.humanEmployeeId).filter(Boolean)));
    const humanList = await this.employeeModel
      .find({ id: { $in: humanIds } })
      .select({ id: 1, name: 1, email: 1 })
      .lean()
      .exec();
    const humanMap = new Map(humanList.map((item) => [item.id, item]));

    return {
      total,
      page,
      pageSize,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
      logs: logs.map((item) => {
        const human = humanMap.get(item.humanEmployeeId);
        return {
          id: item.id,
          humanEmployeeId: item.humanEmployeeId,
          humanName: human?.name || '',
          humanEmail: human?.email || '',
          assistantAgentId: item.assistantAgentId,
          action: item.action,
          resource: item.resource,
          httpMethod: item.httpMethod,
          statusCode: item.statusCode,
          success: item.success,
          requestId: item.requestId,
          ip: item.ip,
          userAgent: item.userAgent,
          query: item.query,
          payload: item.payload,
          responseSummary: item.responseSummary,
          sourceService: item.sourceService,
          durationMs: item.durationMs,
          timestamp: item.timestamp,
        };
      }),
      fetchedAt: new Date().toISOString(),
    };
  }
}
