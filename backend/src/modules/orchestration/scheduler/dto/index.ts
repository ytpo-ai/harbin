import {
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
  @IsEnum(['agent'])
  executorType: 'agent';

  @IsString()
  @IsNotEmpty()
  executorId: string;
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
