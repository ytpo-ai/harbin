import { Injectable } from '@nestjs/common';
import { InternalApiClient } from '../internal-api-client.service';
import { ToolExecutionContext } from '../tool-execution-context.type';

@Injectable()
export class DataCollectionToolHandler {
  constructor(private readonly internalApiClient: InternalApiClient) {}

  private resolveSourceId(params: { sourceId?: string; dataSourceId?: string }): string {
    const sourceId = String(params?.sourceId || params?.dataSourceId || '').trim();
    if (!sourceId) {
      throw new Error('data-collection tool requires sourceId');
    }
    return sourceId;
  }

  async getSourceConfig(
    params: { sourceId?: string; dataSourceId?: string },
    agentId?: string,
    _executionContext?: ToolExecutionContext,
  ): Promise<any> {
    const sourceId = this.resolveSourceId(params || {});
    const source = await this.internalApiClient.callEiApi('GET', `/data-sources/${encodeURIComponent(sourceId)}`);
    return {
      action: 'data_collection_get_source_config',
      initiatorAgentId: agentId,
      source,
      fetchedAt: new Date().toISOString(),
    };
  }

  async writeRecord(
    params: {
      sourceId?: string;
      dataSourceId?: string;
      data?: Record<string, unknown>;
      rawData?: string;
      tags?: string[];
      status?: 'success' | 'partial' | 'error';
      error?: string;
      dataCategory?:
        | 'industry_timeline'
        | 'company_profile'
        | 'person_profile'
        | 'trend_data'
        | 'market_data'
        | 'regulation'
        | 'general';
    },
    agentId?: string,
    _executionContext?: ToolExecutionContext,
  ): Promise<any> {
    const sourceId = this.resolveSourceId(params || {});
    const payload = {
      data: params?.data,
      rawData: String(params?.rawData || '').trim() || undefined,
      tags: Array.isArray(params?.tags) ? params?.tags : undefined,
      status: params?.status,
      error: String(params?.error || '').trim() || undefined,
      dataCategory: params?.dataCategory,
    };
    const result = await this.internalApiClient.callEiApi(
      'POST',
      `/data-sources/${encodeURIComponent(sourceId)}/collect`,
      payload,
    );

    return {
      action: 'data_collection_write_record',
      initiatorAgentId: agentId,
      sourceId,
      result,
      writtenAt: new Date().toISOString(),
    };
  }
}
