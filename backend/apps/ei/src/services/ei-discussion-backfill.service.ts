import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { encodeUserContext, signEncodedContext } from '@libs/auth';
import { GatewayUserContext } from '@libs/contracts';
import { unwrapResponseEnvelope } from '../../../../src/shared/common/utils/unwrap-response-envelope';
import { EiDataSource, EiDataSourceStatistics } from '../schemas/ei-data-source.schema';
import { EiDataRecord } from '../schemas/ei-data-record.schema';

export function extractPrimaryNumericValue(data?: Record<string, unknown>): number | null {
  if (!data || typeof data !== 'object') {
    return null;
  }
  const preferred = data.value;
  if (typeof preferred === 'number' && Number.isFinite(preferred)) {
    return preferred;
  }
  if (typeof preferred === 'string') {
    const parsed = Number(preferred);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  for (const value of Object.values(data)) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return null;
}

export function calcChangePercent(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || !Number.isFinite(current) || !Number.isFinite(previous)) {
    return null;
  }
  if (previous === 0) {
    return null;
  }
  return ((current - previous) / Math.abs(previous)) * 100;
}

@Injectable()
export class EiDiscussionBackfillService {
  private readonly logger = new Logger(EiDiscussionBackfillService.name);
  private readonly legacyBaseUrl = String(process.env.LEGACY_SERVICE_URL || 'http://localhost:3001').trim().replace(/\/+$/, '');
  private readonly contextSecret = process.env.INTERNAL_CONTEXT_SECRET || 'internal-context-secret';
  private readonly timeout = Number(process.env.LEGACY_SERVICE_TIMEOUT_MS || 20000);

  private buildSignedHeaders(): Record<string, string> {
    const now = Date.now();
    const context: GatewayUserContext = {
      employeeId: 'ei-service',
      role: 'system',
      issuedAt: now,
      expiresAt: now + 60 * 1000,
    };
    const encoded = encodeUserContext(context);
    const signature = signEncodedContext(encoded, this.contextSecret);
    return {
      'x-user-context': encoded,
      'x-user-signature': signature,
      'content-type': 'application/json',
    };
  }

  private async getDiscussionAutoAnalysisSetting(spaceId: string): Promise<{ enabled: boolean; rootThreadId?: string }> {
    try {
      const response = await axios.get(
        `${this.legacyBaseUrl}/api/discussions/${encodeURIComponent(spaceId)}`,
        {
          headers: this.buildSignedHeaders(),
          timeout: this.timeout,
        },
      );
      const data = unwrapResponseEnvelope(response.data) as Record<string, any>;
      return {
        enabled: Boolean(data?.settings?.autoAnalysisOnDataUpdate),
        rootThreadId: String(data?.rootThreadId || '').trim() || undefined,
      };
    } catch (_error) {
      return { enabled: false };
    }
  }

  private resolveSourceType(sourceType: EiDataSource['sourceType']): 'api' | 'web_search' | 'document' | 'user_input' {
    if (sourceType === 'api') {
      return 'api';
    }
    if (sourceType === 'manual') {
      return 'user_input';
    }
    if (sourceType === 'web_scrape') {
      return 'web_search';
    }
    return 'document';
  }

  private resolveCredibility(sourceType: EiDataSource['sourceType']): 'high' | 'medium' | 'low' | 'unverified' {
    if (sourceType === 'api') {
      return 'high';
    }
    if (sourceType === 'rss') {
      return 'medium';
    }
    if (sourceType === 'web_scrape') {
      return 'low';
    }
    return 'unverified';
  }

  private buildContent(source: EiDataSource, record: EiDataRecord): string {
    const lines = [
      `数据源：${source.name}`,
      `采集状态：${record.status}`,
      `采集时间：${new Date(record.collectedAt).toISOString()}`,
      `数据分类：${record.dataCategory}`,
      '',
      '采集数据：',
      '```json',
      JSON.stringify(record.data || {}, null, 2),
      '```',
    ];

    if (record.error) {
      lines.push('', `错误信息：${record.error}`);
    }

    return lines.join('\n');
  }

  async backfillRecordToDiscussion(input: {
    source: EiDataSource;
    record: EiDataRecord;
    nextStats: EiDataSourceStatistics;
    previousRecord?: EiDataRecord | null;
  }): Promise<{ skipped: boolean; reason?: string }> {
    const discussionSpaceId = String(input.source.discussionSpaceId || '').trim();
    if (!discussionSpaceId) {
      return { skipped: true, reason: 'missing_discussion_space' };
    }
    if (input.source.notifyDiscussion === false) {
      return { skipped: true, reason: 'notify_disabled' };
    }

    const threshold = Math.max(1, Number(input.source.notifyThreshold || 1));
    const nextTotalCollections = Number(input.nextStats.totalCollections || 0);
    if (threshold > 1 && nextTotalCollections % threshold !== 0) {
      return { skipped: true, reason: 'threshold_not_reached' };
    }

    const sourceUrl = String(input.source.config?.url || '').trim();
    const tags = Array.isArray(input.record.tags) ? input.record.tags.filter(Boolean) : [];
    const keywordTags = Array.from(new Set(Object.keys(input.record.data || {}).map((item) => String(item).trim()).filter(Boolean))).slice(0, 8);

    const payload = {
      participantId: 'system',
      title: `${input.source.name} 数据更新`,
      content: this.buildContent(input.source, input.record),
      summary: `${input.source.name} 于 ${new Date(input.record.collectedAt).toISOString()} 更新了 ${input.record.dataCategory} 数据`,
      outlineSectionId: input.source.outlineSectionId,
      entryType: 'data_point' as const,
      structuredData: {
        value:
          typeof (input.record.data as Record<string, unknown> | undefined)?.value === 'number' ||
          typeof (input.record.data as Record<string, unknown> | undefined)?.value === 'string'
            ? ((input.record.data as Record<string, unknown>).value as string | number)
            : undefined,
        unit:
          typeof (input.record.data as Record<string, unknown> | undefined)?.unit === 'string'
            ? String((input.record.data as Record<string, unknown>).unit)
            : undefined,
        measureDate: new Date(input.record.collectedAt).toISOString(),
      },
      metadata: {
        isStructuredData: true,
      },
      sourceUrl: sourceUrl || undefined,
      sourceType: this.resolveSourceType(input.source.sourceType),
      sourceName: input.source.name,
      domainTags: [input.source.sourceType],
      topicTags: [input.record.dataCategory, ...tags].slice(0, 8),
      keywordTags,
      credibility: this.resolveCredibility(input.source.sourceType),
      contentDate: new Date(input.record.collectedAt).toISOString(),
    };

    try {
      const response = await axios.post(
        `${this.legacyBaseUrl}/api/discussions/${encodeURIComponent(discussionSpaceId)}/knowledge`,
        payload,
        {
          headers: this.buildSignedHeaders(),
          timeout: this.timeout,
        },
      );
      unwrapResponseEnvelope(response.data);

      const autoAnalysis = await this.getDiscussionAutoAnalysisSetting(discussionSpaceId);
      if (autoAnalysis.enabled) {
        const currentValue = extractPrimaryNumericValue(input.record.data as Record<string, unknown> | undefined);
        const previousValue = extractPrimaryNumericValue(input.previousRecord?.data as Record<string, unknown> | undefined);
        const changePercent = calcChangePercent(currentValue, previousValue);
        const changeThresholdPercent = Math.max(1, Number(process.env.DISCUSSION_AUTO_ANALYSIS_CHANGE_THRESHOLD_PERCENT || 10));
        if (changePercent !== null && Math.abs(changePercent) >= changeThresholdPercent) {
          try {
            await axios.post(
              `${this.legacyBaseUrl}/api/discussions/${encodeURIComponent(discussionSpaceId)}/system/data-analysis`,
              {
                threadId: autoAnalysis.rootThreadId,
                sourceName: input.source.name,
                dataCategory: input.record.dataCategory,
                outlineSectionId: input.source.outlineSectionId,
                collectedAt: new Date(input.record.collectedAt).toISOString(),
                currentData: input.record.data || {},
                previousData: input.previousRecord?.data || {},
                changePercent,
              },
              {
                headers: this.buildSignedHeaders(),
                timeout: this.timeout,
              },
            );
          } catch (error) {
            this.logger.warn(
              `Discussion auto analysis trigger failed: sourceName=${input.source.name} discussionSpaceId=${discussionSpaceId} reason=${error instanceof Error ? error.message : 'unknown'}`,
            );
          }
        }
      }

      return { skipped: false };
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown_error';
      this.logger.warn(
        `Discussion backfill failed: sourceName=${input.source.name} discussionSpaceId=${discussionSpaceId} reason=${reason}`,
      );
      return { skipped: true, reason: 'backfill_failed' };
    }
  }
}
