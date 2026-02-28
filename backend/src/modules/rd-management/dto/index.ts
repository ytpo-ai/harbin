import { IsString, IsOptional, IsEnum, IsMongoId, IsObject, IsArray, IsNumber } from 'class-validator';
import { RdTaskStatus, RdTaskPriority } from '../../../shared/schemas/rd-task.schema';

export class CreateRdTaskDto {
  @IsString()
  title: string;

  @IsString()
  description: string;

  @IsOptional()
  @IsEnum(RdTaskPriority)
  priority?: RdTaskPriority;

  @IsMongoId()
  assignee: string;

  @IsOptional()
  @IsMongoId()
  projectId?: string;

  @IsOptional()
  @IsNumber()
  estimatedHours?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;

  @IsOptional()
  @IsString()
  opencodeProjectPath?: string;

  @IsOptional()
  @IsObject()
  opencodeConfig?: Record<string, any>;
}

export class UpdateRdTaskDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(RdTaskStatus)
  status?: RdTaskStatus;

  @IsOptional()
  @IsEnum(RdTaskPriority)
  priority?: RdTaskPriority;

  @IsOptional()
  @IsMongoId()
  assignee?: string;

  @IsOptional()
  @IsNumber()
  estimatedHours?: number;

  @IsOptional()
  @IsNumber()
  actualHours?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;

  @IsOptional()
  @IsObject()
  result?: Record<string, any>;

  @IsOptional()
  startedAt?: Date;

  @IsOptional()
  completedAt?: Date;
}

export class SendOpencodePromptDto {
  @IsString()
  prompt: string;

  @IsOptional()
  @IsString()
  projectPath?: string;

  @IsOptional()
  @IsObject()
  model?: { providerID: string; modelID: string };

  @IsOptional()
  @IsObject()
  config?: Record<string, any>;
}

export class SyncOpencodeContextDto {
  @IsOptional()
  @IsString()
  sessionId?: string;

  @IsOptional()
  @IsString()
  projectPath?: string;
}

export class CreateOpencodeSessionDto {
  @IsString()
  projectPath: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, any>;
}

export class PromptOpencodeSessionDto {
  @IsString()
  prompt: string;

  @IsOptional()
  @IsObject()
  model?: { providerID: string; modelID: string };
}

export class ImportOpencodeProjectDto {
  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsString()
  projectPath?: string;

  @IsOptional()
  @IsString()
  name?: string;
}

export class CreateRdProjectDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsMongoId()
  manager?: string;

  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  members?: string[];

  @IsOptional()
  @IsString()
  opencodeProjectPath?: string;

  @IsOptional()
  @IsObject()
  opencodeConfig?: Record<string, any>;

  @IsOptional()
  @IsString()
  repositoryUrl?: string;

  @IsOptional()
  @IsString()
  branch?: string;

  @IsOptional()
  startDate?: Date;

  @IsOptional()
  endDate?: Date;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

export class UpdateRdProjectDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(['active', 'paused', 'completed', 'archived'])
  status?: string;

  @IsOptional()
  @IsMongoId()
  manager?: string;

  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  members?: string[];

  @IsOptional()
  @IsString()
  opencodeProjectPath?: string;

  @IsOptional()
  @IsObject()
  opencodeConfig?: Record<string, any>;

  @IsOptional()
  @IsString()
  repositoryUrl?: string;

  @IsOptional()
  @IsString()
  branch?: string;

  @IsOptional()
  startDate?: Date;

  @IsOptional()
  endDate?: Date;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

export class QueryRdTaskDto {
  @IsOptional()
  @IsEnum(RdTaskStatus)
  status?: RdTaskStatus;

  @IsOptional()
  @IsMongoId()
  assignee?: string;

  @IsOptional()
  @IsEnum(RdTaskPriority)
  priority?: RdTaskPriority;

  @IsOptional()
  @IsMongoId()
  projectId?: string;
}
