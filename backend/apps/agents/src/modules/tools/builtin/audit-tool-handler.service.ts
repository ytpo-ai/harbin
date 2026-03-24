import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Employee, EmployeeDocument, EmployeeType } from '../../../../../../src/shared/schemas/employee.schema';
import { OperationLog, OperationLogDocument } from '../../../../../../src/shared/schemas/operation-log.schema';

@Injectable()
export class AuditToolHandler {
  constructor(
    @InjectModel(Employee.name) private readonly employeeModel: Model<EmployeeDocument>,
    @InjectModel(OperationLog.name) private readonly operationLogModel: Model<OperationLogDocument>,
  ) {}

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private parseDateOrThrow(raw?: string, fieldName?: string): Date | undefined {
    if (!raw) return undefined;
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`Invalid ${fieldName || 'date'} format`);
    }
    return parsed;
  }

  private async getBoundHumanByAssistant(agentId: string): Promise<{ id: string; name?: string }> {
    if (!agentId) {
      throw new Error('human_operation_log_mcp_list requires assistant agentId');
    }

    const humanEmployees = await this.employeeModel
      .find({
        type: EmployeeType.HUMAN,
        exclusiveAssistantAgentId: agentId,
      })
      .select({ id: 1, name: 1 })
      .lean()
      .exec();

    if (humanEmployees.length === 0) {
      throw new Error('Current assistant is not bound to any human employee');
    }
    if (humanEmployees.length > 1) {
      throw new Error('Current assistant is bound to multiple humans, access denied');
    }

    const [human] = humanEmployees;
    if (!human?.id) {
      throw new Error('Bound human employee data is incomplete');
    }

    return {
      id: human.id,
      name: human.name,
    };
  }

  async listHumanOperationLogs(
    params: {
      from?: string;
      to?: string;
      action?: string;
      resourceKeyword?: string;
      success?: boolean;
      statusCode?: number;
      page?: number;
      pageSize?: number;
    },
    agentId?: string,
  ): Promise<any> {
    const boundHuman = await this.getBoundHumanByAssistant(agentId || '');
    const from = this.parseDateOrThrow(params?.from, 'from');
    const to = this.parseDateOrThrow(params?.to, 'to');

    if (from && to && from.getTime() > to.getTime()) {
      throw new Error('Invalid date range: from must be earlier than to');
    }

    const page = Math.max(1, Math.min(Number(params?.page || 1), 10000));
    const pageSize = Math.max(1, Math.min(Number(params?.pageSize || 20), 100));
    const skip = (page - 1) * pageSize;

    const filter: any = {
      humanEmployeeId: boundHuman.id,
    };

    if (params?.action?.trim()) {
      filter.action = { $regex: this.escapeRegex(params.action.trim()), $options: 'i' };
    }
    if (params?.resourceKeyword?.trim()) {
      filter.resource = { $regex: this.escapeRegex(params.resourceKeyword.trim()), $options: 'i' };
    }
    if (typeof params?.success === 'boolean') {
      filter.success = params.success;
    }

    const parsedStatusCode = Number(params?.statusCode);
    if (Number.isFinite(parsedStatusCode) && parsedStatusCode >= 100 && parsedStatusCode <= 599) {
      filter.statusCode = parsedStatusCode;
    }

    if (from || to) {
      filter.timestamp = {};
      if (from) filter.timestamp.$gte = from;
      if (to) filter.timestamp.$lte = to;
    }

    const [total, rows] = await Promise.all([
      this.operationLogModel.countDocuments(filter).exec(),
      this.operationLogModel
        .find(filter)
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(pageSize)
        .lean()
        .exec(),
    ]);

    return {
      humanEmployeeId: boundHuman.id,
      humanName: boundHuman.name || '',
      assistantAgentId: agentId,
      total,
      page,
      pageSize,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
      logs: rows.map((row) => ({
        id: row.id,
        action: row.action,
        resource: row.resource,
        httpMethod: row.httpMethod,
        statusCode: row.statusCode,
        success: row.success,
        sourceService: row.sourceService,
        durationMs: row.durationMs,
        ip: row.ip,
        userAgent: row.userAgent,
        requestId: row.requestId,
        query: row.query,
        payload: row.payload,
        responseSummary: row.responseSummary,
        timestamp: row.timestamp,
      })),
      fetchedAt: new Date().toISOString(),
    };
  }
}
