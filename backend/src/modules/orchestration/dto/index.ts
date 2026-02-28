import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
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
  @IsBoolean()
  autoRun?: boolean;
}

export class RunPlanDto {
  @IsOptional()
  @IsBoolean()
  continueOnFailure?: boolean;
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
}

export class CompleteHumanTaskDto {
  @IsOptional()
  @IsString()
  summary?: string;

  @IsOptional()
  @IsString()
  output?: string;
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
