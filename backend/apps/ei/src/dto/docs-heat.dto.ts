import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class RefreshDocsHeatDto {
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(200)
  topN?: number;

  @IsOptional()
  @IsString()
  triggeredBy?: string;
}

export class DocsHeatRankingQueryDto {
  @IsOptional()
  @IsIn(['8h', '1d', '7d'])
  window?: '8h' | '1d' | '7d';

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(200)
  topN?: number;
}

export class UpdateDocsHeatWeightDto {
  @IsString()
  pattern: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.1)
  @Max(3)
  weight: number;

  @IsOptional()
  @IsString()
  label?: string;
}

export class UpdateDocsHeatConfigDto {
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => UpdateDocsHeatWeightDto)
  weights: UpdateDocsHeatWeightDto[];

  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  excludes: string[];

  @Type(() => Number)
  @IsNumber()
  @Min(0.1)
  @Max(3)
  defaultWeight: number;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(200)
  topN: number;

  @IsOptional()
  @IsString()
  updatedBy?: string;
}
