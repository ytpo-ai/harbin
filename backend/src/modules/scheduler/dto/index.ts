import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class ScheduleConfigDto {
  @IsEnum(['cron', 'interval'])
  type: 'cron' | 'interval';

  @IsOptional()
  @IsString()
  expression?: string;

  @IsOptional()
  @IsInt()
  @Min(60_000)
  intervalMs?: number;

  @IsOptional()
  @IsString()
  timezone?: string;
}

class ScheduleTargetDto {
  @IsString()
  @IsNotEmpty()
  executorId: string;

  @IsOptional()
  @IsString()
  executorName?: string;
}

class ScheduleInputDto {
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  prompt?: string;

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}

class ScheduleMessageDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  eventType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;
}

export class CreateScheduleDto {
  @IsString()
  @MaxLength(200)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ValidateNested()
  @Type(() => ScheduleConfigDto)
  schedule: ScheduleConfigDto;

  @ValidateNested()
  @Type(() => ScheduleTargetDto)
  target: ScheduleTargetDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ScheduleInputDto)
  input?: ScheduleInputDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ScheduleMessageDto)
  message?: ScheduleMessageDto;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateScheduleDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ScheduleConfigDto)
  schedule?: ScheduleConfigDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ScheduleTargetDto)
  target?: ScheduleTargetDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ScheduleInputDto)
  input?: ScheduleInputDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ScheduleMessageDto)
  message?: ScheduleMessageDto;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class ScheduleHistoryQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}

export class TriggerSystemEngineeringStatisticsDto {
  @IsOptional()
  @IsString()
  receiverId?: string;

  @IsOptional()
  @IsEnum(['all', 'docs', 'frontend', 'backend'])
  scope?: 'all' | 'docs' | 'frontend' | 'backend';

  @IsOptional()
  @IsEnum(['estimate', 'exact'])
  tokenMode?: 'estimate' | 'exact';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  projectIds?: string[];

  @IsOptional()
  @IsString()
  triggeredBy?: string;
}
