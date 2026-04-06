import { Injectable } from '@nestjs/common';
import { InternalApiClient } from '../internal-api-client.service';

@Injectable()
export class RdIntelligenceToolHandler {
  constructor(private readonly internalApiClient: InternalApiClient) {}

  async runEngineeringStatistics(params: {
    receiverId?: string;
    scope?: 'all' | 'docs' | 'frontend' | 'backend';
    tokenMode?: 'estimate' | 'exact';
    projectIds?: string[];
    triggeredBy?: string;
  }): Promise<any> {
    const payload = {
      receiverId: params?.receiverId || undefined,
      scope: params?.scope || 'all',
      tokenMode: params?.tokenMode || 'estimate',
      projectIds: Array.isArray(params?.projectIds)
        ? params.projectIds.map((item) => String(item || '').trim()).filter(Boolean)
        : undefined,
      triggeredBy: params?.triggeredBy || 'agent-mcp',
    };

    const response = await this.internalApiClient.postEngineeringStatistics(payload);

    return {
      action: 'engineering_statistics_run',
      snapshot: response,
      fetchedAt: new Date().toISOString(),
    };
  }
  async runDocsHeat(params: {
    topN?: number;
    triggeredBy?: string;
  }): Promise<any> {
    const payload = {
      ...(Number.isFinite(Number(params?.topN)) && Number(params?.topN) > 0
        ? { topN: Math.floor(Number(params?.topN)) }
        : {}),
      triggeredBy: params?.triggeredBy || 'agent-mcp',
    };

    const response = await this.internalApiClient.postDocsHeatRefresh(payload);

    return {
      action: 'docs_heat_run',
      result: response,
      fetchedAt: new Date().toISOString(),
    };
  }
}
