import { IsString, IsOptional, IsEnum, IsObject } from 'class-validator';
import { IncubationProjectStatus } from '../schemas/incubation-project.schema';

export class CreateIncubationProjectDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  goal?: string;

  @IsOptional()
  startDate?: Date;

  @IsOptional()
  endDate?: Date;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

export class UpdateIncubationProjectDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  goal?: string;

  @IsOptional()
  @IsEnum(IncubationProjectStatus)
  status?: IncubationProjectStatus;

  @IsOptional()
  startDate?: Date;

  @IsOptional()
  endDate?: Date;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

export class QueryIncubationProjectDto {
  @IsOptional()
  @IsEnum(IncubationProjectStatus)
  status?: IncubationProjectStatus;
}
