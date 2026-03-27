import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Min,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreatePlanFromPromptDto {
  @IsString()
  @MaxLength(4000)
  prompt: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  plannerAgentId?: string;

  @IsOptional()
  @IsEnum(['sequential', 'parallel', 'hybrid'])
  mode?: 'sequential' | 'parallel' | 'hybrid';

  @IsOptional()
  @IsEnum(['once', 'multi'])
  runMode?: 'once' | 'multi';

  @IsOptional()
  @IsBoolean()
  autoRun?: boolean;

  @IsOptional()
  @IsBoolean()
  autoGenerate?: boolean;

  @IsOptional()
  @IsString()
  requirementId?: string;

  @IsEnum(['general', 'development', 'research'])
  domainType: 'general' | 'development' | 'research' = 'general';
}

export class RunPlanDto {
  @IsOptional()
  @IsBoolean()
  continueOnFailure?: boolean;
}

export class CancelRunDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class ReplanPlanDto {
  @IsString()
  @MaxLength(4000)
  prompt: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  plannerAgentId?: string;

  @IsOptional()
  @IsEnum(['sequential', 'parallel', 'hybrid'])
  mode?: 'sequential' | 'parallel' | 'hybrid';

  @IsOptional()
  @IsEnum(['once', 'multi'])
  runMode?: 'once' | 'multi';

  @IsOptional()
  @IsBoolean()
  autoRun?: boolean;

  @IsOptional()
  @IsBoolean()
  autoGenerate?: boolean;

  @IsOptional()
  @IsEnum(['general', 'development', 'research'])
  domainType?: 'general' | 'development' | 'research';
}

export class UpdatePlanDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  sourcePrompt?: string;

  @IsOptional()
  @IsEnum(['sequential', 'parallel', 'hybrid'])
  mode?: 'sequential' | 'parallel' | 'hybrid';

  @IsOptional()
  @IsEnum(['once', 'multi'])
  runMode?: 'once' | 'multi';

  @IsOptional()
  @IsString()
  plannerAgentId?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;

  @IsOptional()
  @IsEnum(['general', 'development', 'research'])
  domainType?: 'general' | 'development' | 'research';
}

export class ReassignTaskDto {
  @IsEnum(['agent', 'employee', 'unassigned'])
  executorType: 'agent' | 'employee' | 'unassigned';

  @IsOptional()
  @IsString()
  executorId?: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  sourceAgentId?: string;
}

export class CompleteHumanTaskDto {
  @IsOptional()
  @IsString()
  summary?: string;

  @IsOptional()
  @IsString()
  output?: string;
}

export class UpdateTaskDraftDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @IsOptional()
  @IsEnum([
    'research',
    'development.plan',
    'development.exec',
    'development.review',
    'general',
    'auto',
  ])
  runtimeTaskType?:
    | 'research'
    | 'development.plan'
    | 'development.exec'
    | 'development.review'
    | 'general'
    | 'auto';
}

export class TaskAssignmentDto {
  @IsEnum(['agent', 'employee', 'unassigned'])
  executorType: 'agent' | 'employee' | 'unassigned';

  @IsOptional()
  @IsString()
  executorId?: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class AddTaskToPlanDto {
  @IsString()
  @MaxLength(200)
  title: string;

  @IsString()
  @MaxLength(4000)
  description: string;

  @IsOptional()
  @IsEnum(['low', 'medium', 'high', 'urgent'])
  priority?: 'low' | 'medium' | 'high' | 'urgent';

  @IsOptional()
  @IsString()
  insertAfterTaskId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  dependencyTaskIds?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => TaskAssignmentDto)
  assignment?: TaskAssignmentDto;
}

export class UpdateTaskFullDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @IsOptional()
  @IsEnum(['low', 'medium', 'high', 'urgent'])
  priority?: 'low' | 'medium' | 'high' | 'urgent';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  dependencyTaskIds?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => TaskAssignmentDto)
  assignment?: TaskAssignmentDto;
}

export class ReorderPlanTasksDto {
  @IsArray()
  @IsString({ each: true })
  taskIds: string[];
}

export class BatchUpdateTaskItemDto extends UpdateTaskFullDto {
  @IsString()
  taskId: string;
}

export class BatchUpdateTasksDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BatchUpdateTaskItemDto)
  updates: BatchUpdateTaskItemDto[];
}

export class RunHistoryQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}

export class DebugTaskStepDto extends UpdateTaskDraftDto {
  @IsOptional()
  @IsBoolean()
  resetResult?: boolean;

  @IsOptional()
  @IsEnum([
    'research',
    'development.plan',
    'development.exec',
    'development.review',
    'general',
  ])
  runtimeTaskTypeOverride?:
    | 'research'
    | 'development.plan'
    | 'development.exec'
    | 'development.review'
    | 'general';
}

export class CreateSessionDto {
  @IsEnum(['agent', 'employee', 'system'])
  ownerType: 'agent' | 'employee' | 'system';

  @IsString()
  ownerId: string;

  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  linkedPlanId?: string;

  @IsOptional()
  @IsString()
  linkedTaskId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

export class SessionMessageDto {
  @IsEnum(['user', 'assistant', 'system'])
  role: 'user' | 'assistant' | 'system';

  @IsString()
  @MaxLength(12000)
  content: string;
}

export class SessionQueryDto {
  @IsOptional()
  @IsEnum(['agent', 'employee', 'system'])
  ownerType?: 'agent' | 'employee' | 'system';

  @IsOptional()
  @IsEnum(['active', 'archived', 'closed'])
  status?: 'active' | 'archived' | 'closed';

  @IsOptional()
  @IsString()
  ownerId?: string;

  @IsOptional()
  @IsString()
  linkedPlanId?: string;
}

export class ArchiveSessionDto {
  @IsOptional()
  @IsString()
  summary?: string;
}

export class BatchAppendMessagesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SessionMessageDto)
  messages: SessionMessageDto[];
}
