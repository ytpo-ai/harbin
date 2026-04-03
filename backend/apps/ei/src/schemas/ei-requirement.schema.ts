import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type EiRequirementDocument = EiRequirement & Document;

export type EiRequirementStatus = 'todo' | 'assigned' | 'in_progress' | 'review' | 'done' | 'blocked';
export type EiRequirementPriority = 'low' | 'medium' | 'high' | 'critical';
export type EiRequirementCategory = 'fix' | 'feature' | 'optimize';
export type EiRequirementComplexity = 'low' | 'medium' | 'high' | 'very_high';
export type EiActorType = 'human' | 'agent' | 'system';

export type EiRequirementComment = {
  commentId: string;
  content: string;
  authorId?: string;
  authorName?: string;
  authorType: EiActorType;
  createdAt: Date;
};

export type EiRequirementAssignment = {
  assignmentId: string;
  toAgentId: string;
  toAgentName?: string;
  assignedById?: string;
  assignedByName?: string;
  reason?: string;
  assignedAt: Date;
};

export type EiRequirementStatusEvent = {
  eventId: string;
  fromStatus: EiRequirementStatus;
  toStatus: EiRequirementStatus;
  changedById?: string;
  changedByName?: string;
  changedByType: EiActorType;
  note?: string;
  /** 编排上下文：任务类型（如 development.plan / development.exec / development.review） */
  taskType?: string;
  /** 编排上下文：执行该任务的 Agent ID */
  executorAgentId?: string;
  /** 编排上下文：执行该任务的 Agent 名称 */
  executorAgentName?: string;
  /** 编排上下文：关联的计划 ID */
  planId?: string;
  /** 编排上下文：任务标题 */
  taskTitle?: string;
  changedAt: Date;
};

export type EiRequirementGithubLink = {
  owner: string;
  repo: string;
  issueNumber: number;
  issueId: number;
  issueUrl: string;
  issueState: 'open' | 'closed';
  syncedAt: Date;
  lastError?: string;
};

@Schema({ timestamps: true, collection: 'ei_requirements' })
export class EiRequirement {
  @Prop({ required: true, unique: true })
  requirementId: string;

  @Prop({ required: true })
  title: string;

  @Prop({ default: '' })
  description: string;

  @Prop({ required: true, enum: ['todo', 'assigned', 'in_progress', 'review', 'done', 'blocked'], default: 'todo' })
  status: EiRequirementStatus;

  @Prop({ required: true, enum: ['low', 'medium', 'high', 'critical'], default: 'medium' })
  priority: EiRequirementPriority;

  @Prop({ enum: ['fix', 'feature', 'optimize'], default: 'optimize' })
  category?: EiRequirementCategory;

  @Prop({ enum: ['low', 'medium', 'high', 'very_high'], default: 'low' })
  complexity?: EiRequirementComplexity;

  @Prop({ type: [String], default: [] })
  labels: string[];

  @Prop({ type: [String], default: [] })
  linkedPlanIds: string[];

  @Prop()
  currentAssigneeAgentId?: string;

  @Prop()
  currentAssigneeAgentName?: string;

  @Prop()
  createdById?: string;

  @Prop()
  createdByName?: string;

  @Prop({ required: true, enum: ['human', 'agent', 'system'], default: 'human' })
  createdByType: EiActorType;

  @Prop()
  localProjectId?: string;

  @Prop({ index: true })
  projectId?: string; // 统一项目ID，逐步替代 localProjectId

  @Prop({ type: [Object], default: [] })
  comments: EiRequirementComment[];

  @Prop({ type: [Object], default: [] })
  assignments: EiRequirementAssignment[];

  @Prop({ type: [Object], default: [] })
  statusHistory: EiRequirementStatusEvent[];

  @Prop({ type: Object })
  githubLink?: EiRequirementGithubLink;

  @Prop({ type: Date })
  lastBoardEventAt?: Date;

  createdAt?: Date;
  updatedAt?: Date;
}

export const EiRequirementSchema = SchemaFactory.createForClass(EiRequirement);

EiRequirementSchema.index({ requirementId: 1 }, { unique: true });
EiRequirementSchema.index({ status: 1, updatedAt: -1 });
EiRequirementSchema.index({ currentAssigneeAgentId: 1, status: 1, updatedAt: -1 });
EiRequirementSchema.index({ localProjectId: 1, status: 1, updatedAt: -1 });
EiRequirementSchema.index({ projectId: 1, status: 1, updatedAt: -1 });
EiRequirementSchema.index({ title: 'text', description: 'text' });
EiRequirementSchema.index({ linkedPlanIds: 1 });
