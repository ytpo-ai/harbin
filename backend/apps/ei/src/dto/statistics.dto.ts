import { IsArray, IsIn, IsOptional, IsString } from 'class-validator';

export class CreateStatisticsSnapshotDto {
  @IsOptional()
  @IsIn(['all', 'docs', 'frontend', 'backend'])
  scope?: 'all' | 'docs' | 'frontend' | 'backend';

  @IsOptional()
  @IsIn(['estimate', 'exact'])
  tokenMode?: 'estimate' | 'exact';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  projectIds?: string[];

  @IsOptional()
  @IsString()
  triggeredBy?: string;

  @IsOptional()
  @IsString()
  receiverId?: string;
}
