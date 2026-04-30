import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsObject, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

export class RequirementDiscussionSourceDto {
  @IsString()
  spaceId: string;

  @IsString()
  @MaxLength(200)
  spaceTitle: string;

  @IsString()
  threadId: string;

  @IsString()
  @MaxLength(200)
  threadTitle: string;

  @IsString()
  messageId: string;

  @IsString()
  @MaxLength(200)
  messagePreview: string;
}

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
  @IsIn(['fix', 'feature', 'optimize'])
  category?: 'fix' | 'feature' | 'optimize';

  @IsOptional()
  @IsIn(['low', 'medium', 'high', 'very_high'])
  complexity?: 'low' | 'medium' | 'high' | 'very_high';

  @IsOptional()
  @IsString()
  localProjectId?: string;

  @IsOptional()
  @IsString()
  projectId?: string; // 所属孵化项目ID

  @IsOptional()
  @ValidateNested()
  @Type(() => RequirementDiscussionSourceDto)
  discussionSource?: RequirementDiscussionSourceDto;
}

export class ListRequirementsDto {
  @IsOptional()
  @IsIn(['requirement_to_develop'])
  mode?: 'requirement_to_develop';

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
  pageNo?: string;

  @IsOptional()
  @IsString()
  pageSize?: string;

  @IsOptional()
  @IsString()
  localProjectId?: string;

  @IsOptional()
  @IsString()
  projectId?: string; // 按孵化项目过滤

  @IsOptional()
  @IsIn(['priority', 'createdAt', 'updatedAt'])
  sortBy?: 'priority' | 'createdAt' | 'updatedAt';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
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

  @IsOptional()
  @IsString()
  planId?: string;

  @IsOptional()
  @IsString()
  taskType?: string;

  @IsOptional()
  @IsString()
  executorAgentId?: string;

  @IsOptional()
  @IsString()
  executorAgentName?: string;

  @IsOptional()
  @IsString()
  taskTitle?: string;
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
