import { IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateDataSourceDto {
  @IsString()
  @MaxLength(200)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsString()
  projectId: string;

  @IsIn(['api', 'rss', 'web_scrape', 'manual'])
  sourceType: 'api' | 'rss' | 'web_scrape' | 'manual';

  @IsObject()
  config: Record<string, unknown>;

  @IsOptional()
  @IsIn(['hourly', 'daily', 'weekly', 'monthly'])
  collectFrequency?: 'hourly' | 'daily' | 'weekly' | 'monthly';

  @IsOptional()
  @IsString()
  cronExpression?: string;

  @IsOptional()
  @IsString()
  requirementId?: string;

  @IsOptional()
  @IsString()
  outlineSectionId?: string;

  @IsOptional()
  @IsString()
  discussionSpaceId?: string;

  @IsString()
  executorAgentId: string;

  @IsOptional()
  @IsString()
  executorAgentName?: string;

  @IsOptional()
  @IsIn(['active', 'paused', 'error', 'archived'])
  status?: 'active' | 'paused' | 'error' | 'archived';

  @IsOptional()
  @IsInt()
  @Min(1)
  notifyThreshold?: number;

  @IsOptional()
  @IsBoolean()
  notifyDiscussion?: boolean;
}

export class UpdateDataSourceDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
  @IsIn(['api', 'rss', 'web_scrape', 'manual'])
  sourceType?: 'api' | 'rss' | 'web_scrape' | 'manual';

  @IsOptional()
  @IsIn(['hourly', 'daily', 'weekly', 'monthly'])
  collectFrequency?: 'hourly' | 'daily' | 'weekly' | 'monthly';

  @IsOptional()
  @IsString()
  cronExpression?: string;

  @IsOptional()
  @IsIn(['active', 'paused', 'error', 'archived'])
  status?: 'active' | 'paused' | 'error' | 'archived';

  @IsOptional()
  @IsInt()
  @Min(1)
  notifyThreshold?: number;

  @IsOptional()
  @IsBoolean()
  notifyDiscussion?: boolean;

  @IsOptional()
  @IsString()
  executorAgentId?: string;

  @IsOptional()
  @IsString()
  executorAgentName?: string;
}

export class QueryDataSourcesDto {
  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsIn(['api', 'rss', 'web_scrape', 'manual'])
  sourceType?: 'api' | 'rss' | 'web_scrape' | 'manual';

  @IsOptional()
  @IsIn(['active', 'paused', 'error', 'archived'])
  status?: 'active' | 'paused' | 'error' | 'archived';
}

export class TestDataSourceDto {
  @IsOptional()
  @IsIn(['head', 'summary'])
  mode?: 'head' | 'summary';
}

export class CollectDataSourceDto {
  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  rawData?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsIn(['success', 'partial', 'error'])
  status?: 'success' | 'partial' | 'error';

  @IsOptional()
  @IsString()
  error?: string;

  @IsOptional()
  @IsIn(['industry_timeline', 'company_profile', 'person_profile', 'trend_data', 'market_data', 'regulation', 'general'])
  dataCategory?:
    | 'industry_timeline'
    | 'company_profile'
    | 'person_profile'
    | 'trend_data'
    | 'market_data'
    | 'regulation'
    | 'general';
}

export class QueryDataRecordsDto {
  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsString()
  dataSourceId?: string;

  @IsOptional()
  @IsIn(['industry_timeline', 'company_profile', 'person_profile', 'trend_data', 'market_data', 'regulation', 'general'])
  dataCategory?:
    | 'industry_timeline'
    | 'company_profile'
    | 'person_profile'
    | 'trend_data'
    | 'market_data'
    | 'regulation'
    | 'general';

  @IsOptional()
  @IsIn(['success', 'partial', 'error'])
  status?: 'success' | 'partial' | 'error';

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @IsString()
  tag?: string;
}

export class AggregateDataRecordsDto {
  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsIn(['industry_timeline', 'company_profile', 'person_profile', 'trend_data', 'market_data', 'regulation', 'general'])
  dataCategory?:
    | 'industry_timeline'
    | 'company_profile'
    | 'person_profile'
    | 'trend_data'
    | 'market_data'
    | 'regulation'
    | 'general';

  @IsOptional()
  @IsIn(['day', 'dataCategory', 'tag'])
  groupBy?: 'day' | 'dataCategory' | 'tag';

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;
}

export class CleanupDataRecordsDto {
  @IsOptional()
  @IsString()
  dataSourceId?: string;

  @IsOptional()
  @IsString()
  before?: string;
}
