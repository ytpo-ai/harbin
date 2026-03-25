import { IsArray, IsBoolean, IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateRequirementDto {
  @IsString()
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsIn(['low', 'medium', 'high', 'critical'])
  priority?: 'low' | 'medium' | 'high' | 'critical';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  labels?: string[];

  @IsOptional()
  @IsString()
  createdById?: string;

  @IsOptional()
  @IsString()
  createdByName?: string;

  @IsOptional()
  @IsIn(['human', 'agent', 'system'])
  createdByType?: 'human' | 'agent' | 'system';

  @IsOptional()
  @IsString()
  localProjectId?: string;
}

export class ListRequirementsDto {
  @IsOptional()
  @IsIn(['todo', 'assigned', 'in_progress', 'review', 'done', 'blocked'])
  status?: 'todo' | 'assigned' | 'in_progress' | 'review' | 'done' | 'blocked';

  @IsOptional()
  @IsString()
  assigneeAgentId?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  limit?: string;

  @IsOptional()
  @IsString()
  localProjectId?: string;
}

export class AddRequirementCommentDto {
  @IsString()
  @MaxLength(4000)
  content: string;

  @IsOptional()
  @IsString()
  authorId?: string;

  @IsOptional()
  @IsString()
  authorName?: string;

  @IsOptional()
  @IsIn(['human', 'agent', 'system'])
  authorType?: 'human' | 'agent' | 'system';
}

export class AssignRequirementDto {
  @IsString()
  toAgentId: string;

  @IsOptional()
  @IsString()
  toAgentName?: string;

  @IsOptional()
  @IsString()
  assignedById?: string;

  @IsOptional()
  @IsString()
  assignedByName?: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class UpdateRequirementStatusDto {
  @IsIn(['todo', 'assigned', 'in_progress', 'review', 'done', 'blocked'])
  status: 'todo' | 'assigned' | 'in_progress' | 'review' | 'done' | 'blocked';

  @IsOptional()
  @IsString()
  changedById?: string;

  @IsOptional()
  @IsString()
  changedByName?: string;

  @IsOptional()
  @IsIn(['human', 'agent', 'system'])
  changedByType?: 'human' | 'agent' | 'system';

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsString()
  toAgentId?: string;

  @IsOptional()
  @IsString()
  toAgentName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsBoolean()
  forceComplete?: boolean;
}

export class SyncRequirementToGithubDto {
  @IsString()
  owner: string;

  @IsString()
  repo: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  labels?: string[];

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
