import api from './api';

export type ScheduleType = 'cron' | 'interval';
export type ScheduleStatus = 'idle' | 'running' | 'paused' | 'error';

export interface OrchestrationSchedule {
  _id: string;
  name: string;
  description?: string;
  planId?: string;
  schedule: {
    type: ScheduleType;
    expression?: string;
    intervalMs?: number;
    timezone?: string;
  };
  target: {
    executorType: 'agent';
    executorId: string;
    executorName?: string;
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

export interface ScheduleTaskHistory {
  _id: string;
  mode: 'plan' | 'schedule';
  scheduleId?: string;
  title: string;
  status: 'pending' | 'assigned' | 'in_progress' | 'blocked' | 'waiting_human' | 'completed' | 'failed' | 'cancelled';
  result?: {
    output?: string;
    summary?: string;
    error?: string;
  };
  startedAt?: string;
  completedAt?: string;
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
  target: {
    executorType: 'agent';
    executorId: string;
  };
  input?: {
    prompt?: string;
    payload?: Record<string, unknown>;
  };
  enabled?: boolean;
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
    const response = await api.post('/orchestration/schedules', payload);
    return response.data;
  },

  async getSchedules(): Promise<OrchestrationSchedule[]> {
    const response = await api.get('/orchestration/schedules');
    return response.data;
  },

  async getScheduleById(scheduleId: string): Promise<OrchestrationSchedule> {
    const response = await api.get(`/orchestration/schedules/${scheduleId}`);
    return response.data;
  },

  async updateSchedule(scheduleId: string, payload: UpdateSchedulePayload): Promise<OrchestrationSchedule> {
    const response = await api.put(`/orchestration/schedules/${scheduleId}`, payload);
    return response.data;
  },

  async deleteSchedule(scheduleId: string): Promise<{ success: boolean }> {
    const response = await api.delete(`/orchestration/schedules/${scheduleId}`);
    return response.data;
  },

  async enableSchedule(scheduleId: string): Promise<OrchestrationSchedule> {
    const response = await api.post(`/orchestration/schedules/${scheduleId}/enable`);
    return response.data;
  },

  async disableSchedule(scheduleId: string): Promise<OrchestrationSchedule> {
    const response = await api.post(`/orchestration/schedules/${scheduleId}/disable`);
    return response.data;
  },

  async triggerSchedule(scheduleId: string): Promise<{ accepted: boolean; status: string }> {
    const response = await api.post(`/orchestration/schedules/${scheduleId}/trigger`);
    return response.data;
  },

  async getSystemEngineeringStatisticsSchedule(): Promise<OrchestrationSchedule> {
    const response = await api.get('/orchestration/schedules/system/engineering-statistics');
    return response.data;
  },

  async triggerSystemEngineeringStatistics(payload?: TriggerEngineeringStatisticsPayload): Promise<{
    accepted: boolean;
    status: string;
    scheduleId: string;
  }> {
    const response = await api.post('/orchestration/schedules/system/engineering-statistics/trigger', payload || {});
    return response.data;
  },

  async getSystemDocsHeatSchedule(): Promise<OrchestrationSchedule> {
    const response = await api.get('/orchestration/schedules/system/docs-heat');
    return response.data;
  },

  async triggerSystemDocsHeat(payload?: TriggerDocsHeatPayload): Promise<{
    accepted: boolean;
    status: string;
    scheduleId: string;
  }> {
    const response = await api.post('/orchestration/schedules/system/docs-heat/trigger', payload || {});
    return response.data;
  },

  async getScheduleHistory(scheduleId: string, limit = 20): Promise<ScheduleTaskHistory[]> {
    const response = await api.get(`/orchestration/schedules/${scheduleId}/history`, {
      params: {
        limit,
      },
    });
    return response.data;
  },

  async findSchedulesByPlanId(planId: string): Promise<OrchestrationSchedule[]> {
    const response = await api.get(`/orchestration/schedules/by-plan/${planId}`);
    return response.data;
  },
};
