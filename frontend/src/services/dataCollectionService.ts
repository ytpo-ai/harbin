import api from './api';

export type DataSourceType = 'api' | 'rss' | 'web_scrape' | 'manual';
export type DataCollectFrequency = 'hourly' | 'daily' | 'weekly' | 'monthly';
export type DataSourceStatus = 'active' | 'paused' | 'error' | 'archived';
export type DataRecordStatus = 'success' | 'partial' | 'error';
export type DataCategory =
  | 'industry_timeline'
  | 'company_profile'
  | 'person_profile'
  | 'trend_data'
  | 'market_data'
  | 'regulation'
  | 'general';

export interface DataSourceItem {
  _id: string;
  name: string;
  description?: string;
  projectId: string;
  sourceType: DataSourceType;
  collectFrequency: DataCollectFrequency;
  status: DataSourceStatus;
  lastCollectedAt?: string;
  lastError?: string;
  statistics?: {
    totalCollections?: number;
    successCount?: number;
    errorCount?: number;
    lastSuccessAt?: string;
  };
  notifyDiscussion?: boolean;
  notifyThreshold?: number;
}

export interface CreateDataSourcePayload {
  name: string;
  description?: string;
  projectId: string;
  sourceType: DataSourceType;
  config: Record<string, unknown>;
  collectFrequency?: DataCollectFrequency;
  status?: DataSourceStatus;
  outlineSectionId?: string;
  discussionSpaceId?: string;
  notifyThreshold?: number;
  executorAgentId: string;
  executorAgentName?: string;
}

export interface DataRecordItem {
  _id: string;
  dataSourceId: string;
  projectId: string;
  data: Record<string, unknown>;
  collectedAt: string;
  dataCategory: DataCategory;
  status: DataRecordStatus;
  tags?: string[];
  error?: string;
}

export interface DataAggregateBucket {
  key: string;
  count: number;
}

export const dataCollectionService = {
  async getDataSources(projectId: string): Promise<DataSourceItem[]> {
    const res = await api.get('/ei/data-sources', { params: { projectId } });
    const payload = res.data;
    if (Array.isArray(payload)) {
      return payload;
    }
    if (Array.isArray(payload?.data)) {
      return payload.data;
    }
    return [];
  },

  async triggerCollect(dataSourceId: string): Promise<{ sourceId: string; recordId: string; status: DataRecordStatus }> {
    const res = await api.post(`/ei/data-sources/${dataSourceId}/collect`);
    return res.data;
  },

  async createDataSource(payload: CreateDataSourcePayload): Promise<DataSourceItem> {
    const res = await api.post('/ei/data-sources', payload);
    return res.data;
  },

  async getDataRecords(projectId: string, params?: { dataCategory?: DataCategory; startDate?: string; endDate?: string }): Promise<DataRecordItem[]> {
    const res = await api.get('/ei/data-records', {
      params: {
        projectId,
        dataCategory: params?.dataCategory,
        startDate: params?.startDate,
        endDate: params?.endDate,
      },
    });
    const payload = res.data;
    if (Array.isArray(payload)) {
      return payload;
    }
    if (Array.isArray(payload?.data)) {
      return payload.data;
    }
    return [];
  },

  async getAggregate(projectId: string, groupBy: 'day' | 'dataCategory' | 'tag' = 'day'): Promise<DataAggregateBucket[]> {
    const res = await api.get('/ei/data-records/aggregate', { params: { projectId, groupBy } });
    const payload = res.data;
    if (Array.isArray(payload)) {
      return payload;
    }
    if (Array.isArray(payload?.data)) {
      return payload.data;
    }
    return [];
  },
};
