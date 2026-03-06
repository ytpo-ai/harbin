import api from '../lib/axios';

export interface OperationLogQuery {
  from?: string;
  to?: string;
  action?: string;
  resourceKeyword?: string;
  humanEmployeeId?: string;
  assistantAgentId?: string;
  success?: 'true' | 'false' | '';
  statusCode?: string;
  page?: number;
  pageSize?: number;
}

export interface OperationLogItem {
  id: string;
  humanEmployeeId: string;
  humanName: string;
  humanEmail: string;
  assistantAgentId?: string;
  action: string;
  resource: string;
  httpMethod: string;
  statusCode: number;
  success: boolean;
  requestId?: string;
  ip?: string;
  userAgent?: string;
  query?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  responseSummary?: Record<string, unknown>;
  sourceService?: string;
  durationMs: number;
  timestamp: string;
}

export interface OperationLogListResponse {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  logs: OperationLogItem[];
  fetchedAt: string;
}

class OperationLogService {
  async getOperationLogs(query: OperationLogQuery): Promise<OperationLogListResponse> {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return;
      params.append(key, String(value));
    });

    const response = await api.get(`/operation-logs?${params.toString()}`);
    return response.data.data;
  }
}

export const operationLogService = new OperationLogService();
