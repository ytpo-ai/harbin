import { IsArray, IsBoolean, IsIn, IsObject, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class OutlineTemplateSectionDto {
  @IsOptional()
  @IsString()
  key?: string;

  @IsString()
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsString()
  parentSectionKey?: string;

  @IsOptional()
  order?: number;

  @IsOptional()
  depth?: number;

  @IsOptional()
  @IsObject()
  metadata?: {
    suggestedDataSources?: string[];
    collectFrequency?: string;
    isStructuredData?: boolean;
  };
}

class SuggestedDataSourceDto {
  @IsString()
  @MaxLength(200)
  name: string;

  @IsIn(['api', 'rss', 'web_scrape', 'manual'])
  sourceType: 'api' | 'rss' | 'web_scrape' | 'manual';

  @IsObject()
  config: Record<string, unknown>;

  @IsIn(['hourly', 'daily', 'weekly', 'monthly'])
  collectFrequency: 'hourly' | 'daily' | 'weekly' | 'monthly';
}

export class CreateOutlineTemplateDto {
  @IsString()
  @MaxLength(200)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsIn(['industry_observation', 'product_analysis', 'technical_review'])
  templateType: 'industry_observation' | 'product_analysis' | 'technical_review';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  applicableIndustries?: string[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OutlineTemplateSectionDto)
  sections: OutlineTemplateSectionDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SuggestedDataSourceDto)
  suggestedDataSources?: SuggestedDataSourceDto[];

  @IsOptional()
  @IsBoolean()
  isSystem?: boolean;

  @IsOptional()
  @IsString()
  createdBy?: string;
}

export class UpdateOutlineTemplateDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsIn(['industry_observation', 'product_analysis', 'technical_review'])
  templateType?: 'industry_observation' | 'product_analysis' | 'technical_review';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  applicableIndustries?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OutlineTemplateSectionDto)
  sections?: OutlineTemplateSectionDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SuggestedDataSourceDto)
  suggestedDataSources?: SuggestedDataSourceDto[];

  @IsOptional()
  @IsBoolean()
  isSystem?: boolean;
}

export class QueryOutlineTemplatesDto {
  @IsOptional()
  @IsIn(['industry_observation', 'product_analysis', 'technical_review'])
  type?: 'industry_observation' | 'product_analysis' | 'technical_review';

  @IsOptional()
  @IsString()
  industry?: string;
}

export class ApplyOutlineTemplateDto {
  @IsString()
  spaceId: string;

  @IsOptional()
  @IsString()
  outlineTitle?: string;
}
