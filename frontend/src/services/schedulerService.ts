import api from './api';

export type ScheduleType = 'cron' | 'interval';
export type ScheduleStatus = 'idle' | 'running' | 'paused' | 'error';

export interface OrchestrationSchedule {
  _id: string;
  name: string;
  description?: string;
  schedule: {
    type: ScheduleType;
    expression?: string;
    intervalMs?: number;
    timezone?: string;
  };
  target?: {
    executorType: 'agent';
    executorId: string;
    executorName?: string;
  };
  message?: {
    eventType: string;
    title?: string;
  };
  input?: {
    prompt?: string;
    payload?: Record<string, unknown>;
  };
  enabled: boolean;
  status: ScheduleStatus;
  nextRunAt?: string;
  lastRun?: {
    startedAt?: string;
    completedAt?: string;
    success?: boolean;
    result?: string;
    error?: string;
    taskId?: string;
    sessionId?: string;
  };
  stats?: {
    totalRuns: number;
    successRuns: number;
    failedRuns: number;
    skippedRuns: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleRunHistory {
  _id: string;
  messageId?: string;
  triggerType?: 'manual' | 'auto';
  scheduleId?: string;
  eventType?: string;
  receiverAgentId?: string;
  status: 'sent' | 'delivered' | 'processing' | 'processed' | 'failed' | string;
  summary?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSchedulePayload {
  name: string;
  description?: string;
  schedule: {
    type: ScheduleType;
    expression?: string;
    intervalMs?: number;
    timezone?: string;
  };
  input?: {
    prompt?: string;
    payload?: Record<string, unknown>;
  };
  target: {
    executorId: string;
    executorName?: string;
  };
  message?: {
    eventType?: string;
    title?: string;
  };
  enabled?: boolean;
  projectId?: string;
}

export type UpdateSchedulePayload = Partial<CreateSchedulePayload>;

export interface TriggerEngineeringStatisticsPayload {
  receiverId?: string;
  scope?: 'all' | 'docs' | 'frontend' | 'backend';
  tokenMode?: 'estimate' | 'exact';
  projectIds?: string[];
  triggeredBy?: string;
}

export interface TriggerDocsHeatPayload {
  topN?: number;
  triggeredBy?: string;
}

export const schedulerService = {
  async createSchedule(payload: CreateSchedulePayload): Promise<OrchestrationSchedule> {
    const response = await api.post('/schedules', payload);
    return response.data;
  },

  async getSchedules(filters?: { projectId?: string }): Promise<OrchestrationSchedule[]> {
    const response = await api.get('/schedules', { params: filters });
    return response.data;
  },

  async getScheduleById(scheduleId: string): Promise<OrchestrationSchedule> {
    const response = await api.get(`/schedules/${scheduleId}`);
    return response.data;
  },

  async updateSchedule(scheduleId: string, payload: UpdateSchedulePayload): Promise<OrchestrationSchedule> {
    const response = await api.put(`/schedules/${scheduleId}`, payload);
    return response.data;
  },

  async deleteSchedule(scheduleId: string): Promise<{ success: boolean }> {
    const response = await api.delete(`/schedules/${scheduleId}`);
    return response.data;
  },

  async enableSchedule(scheduleId: string): Promise<OrchestrationSchedule> {
    const response = await api.post(`/schedules/${scheduleId}/enable`);
    return response.data;
  },

  async disableSchedule(scheduleId: string): Promise<OrchestrationSchedule> {
    const response = await api.post(`/schedules/${scheduleId}/disable`);
    return response.data;
  },

  async triggerSchedule(scheduleId: string): Promise<{ accepted: boolean; status: string }> {
    const response = await api.post(`/schedules/${scheduleId}/trigger`);
    return response.data;
  },

  async getSystemEngineeringStatisticsSchedule(): Promise<OrchestrationSchedule> {
    const response = await api.get('/schedules/system/engineering-statistics');
    return response.data;
  },

  async triggerSystemEngineeringStatistics(payload?: TriggerEngineeringStatisticsPayload): Promise<{
    accepted: boolean;
    status: string;
    scheduleId: string;
  }> {
    const response = await api.post('/schedules/system/engineering-statistics/trigger', payload || {});
    return response.data;
  },

  async getSystemDocsHeatSchedule(): Promise<OrchestrationSchedule> {
    const response = await api.get('/schedules/system/docs-heat');
    return response.data;
  },

  async triggerSystemDocsHeat(payload?: TriggerDocsHeatPayload): Promise<{
    accepted: boolean;
    status: string;
    scheduleId: string;
  }> {
    const response = await api.post('/schedules/system/docs-heat/trigger', payload || {});
    return response.data;
  },

  async getScheduleHistory(scheduleId: string, limit = 20): Promise<ScheduleRunHistory[]> {
    const response = await api.get(`/schedules/${scheduleId}/history`, {
      params: {
        limit,
      },
    });
    return response.data;
  },
};
