import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  AddRequirementCommentDto,
  AssignRequirementDto,
  CreateRequirementDto,
  ListRequirementsDto,
  SyncRequirementToGithubDto,
  UpdateRequirementStatusDto,
} from '../dto';
import {
  EiRequirement,
  EiRequirementAssignment,
  EiRequirementComment,
  EiRequirementDocument,
  EiRequirementStatus,
  EiRequirementStatusEvent,
} from '../schemas/ei-requirement.schema';
import { RdProject, RdProjectDocument } from '../../../../src/shared/schemas/ei-project.schema';
import { EiGithubClientService } from './ei-github-client.service';

const REQ_AGENT_ASSIGN_FORBIDDEN_CODE = 'REQ_AGENT_ASSIGN_FORBIDDEN';
const REQ_AGENT_ASSIGN_FORBIDDEN_REASON = '已绑定计划且已分配负责人，不可重复分配';

@Injectable()
export class EiRequirementsService {
  private readonly requirementTransitions: Record<EiRequirementStatus, EiRequirementStatus[]> = {
    todo: ['assigned', 'blocked', 'done'],
    assigned: ['in_progress', 'todo', 'blocked', 'done'],
    in_progress: ['review', 'blocked', 'todo', 'done'],
    review: ['done', 'in_progress', 'blocked'],
    done: ['todo'],
    blocked: ['todo', 'assigned', 'in_progress', 'done'],
  };

  constructor(
    @InjectModel(EiRequirement.name)
    private readonly requirementModel: Model<EiRequirementDocument>,
    @InjectModel(RdProject.name)
    private readonly rdProjectModel: Model<RdProjectDocument>,
    private readonly githubClient: EiGithubClientService,
  ) {}

  private generateRequirementId(): string {
    return `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private generateEntityId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private normalizeStringList(value: string[] | undefined): string[] {
    return Array.from(new Set((value || []).map((item) => String(item || '').trim()).filter(Boolean)));
  }

  private validateStatusTransition(from: EiRequirementStatus, to: EiRequirementStatus): void {
    if (from === to) {
      return;
    }
    const allowed = this.requirementTransitions[from] || [];
    if (!allowed.includes(to)) {
      throw new BadRequestException(`invalid status transition: ${from} -> ${to}`);
    }
  }

  private toBoardColumn(status: EiRequirementStatus): EiRequirementStatus {
    return status;
  }

  private getAssignAgentState(requirement: Pick<EiRequirement, 'linkedPlanIds' | 'currentAssigneeAgentId'>) {
    const linkedPlanIds = Array.isArray(requirement.linkedPlanIds) ? requirement.linkedPlanIds : [];
    const hasLinkedPlan = linkedPlanIds.length > 0;
    const hasAssignedAgent = Boolean(String(requirement.currentAssigneeAgentId || '').trim());
    const canAssignAgent = !(hasLinkedPlan && hasAssignedAgent);

    return {
      canAssignAgent,
      assignAgentDisabledReason: canAssignAgent ? undefined : REQ_AGENT_ASSIGN_FORBIDDEN_REASON,
    };
  }

  private withAssignAgentState<T extends Pick<EiRequirement, 'linkedPlanIds' | 'currentAssigneeAgentId'>>(
    requirement: T,
  ): T & { canAssignAgent: boolean; assignAgentDisabledReason?: string } {
    return {
      ...requirement,
      ...this.getAssignAgentState(requirement),
    };
  }

  private async resolveRequirementGithubTarget(
    requirement: EiRequirementDocument,
    payload: SyncRequirementToGithubDto,
  ): Promise<{ owner: string; repo: string }> {
    const payloadOwner = String(payload.owner || '').trim();
    const payloadRepo = String(payload.repo || '').trim();
    if (payloadOwner && payloadRepo) {
      return { owner: payloadOwner, repo: payloadRepo };
    }

    const localProjectId = String(requirement.localProjectId || '').trim();
    if (!localProjectId) {
      throw new BadRequestException('Requirement has no local project binding');
    }

    const localProject = await this.rdProjectModel
      .findById(localProjectId)
      .populate('githubBindingId', 'githubOwner githubRepo sourceType')
      .lean()
      .exec();

    if (!localProject) {
      throw new BadRequestException('Bound local project not found');
    }

    const githubBinding = localProject.githubBindingId as
      | { githubOwner?: string; githubRepo?: string; sourceType?: string }
      | undefined;
    const owner = String(githubBinding?.githubOwner || '').trim();
    const repo = String(githubBinding?.githubRepo || '').trim();

    if (!owner || !repo) {
      throw new BadRequestException('Bound local project has no GitHub repository');
    }

    return { owner, repo };
  }

  private async patchGithubIssueState(requirement: EiRequirementDocument, state: 'open' | 'closed'): Promise<void> {
    const github = requirement.githubLink;
    if (!github?.owner || !github?.repo || !github?.issueNumber) {
      return;
    }

    const issue = await this.githubClient.githubRequest<{ state: 'open' | 'closed'; html_url?: string }>(
      `/repos/${encodeURIComponent(github.owner)}/${encodeURIComponent(github.repo)}/issues/${github.issueNumber}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ state }),
      },
    );

    requirement.githubLink = {
      ...github,
      issueState: issue.state,
      issueUrl: issue.html_url || github.issueUrl,
      syncedAt: new Date(),
      lastError: undefined,
    };
  }

  private async syncGithubIssueLifecycle(requirement: EiRequirementDocument, toStatus: EiRequirementStatus): Promise<void> {
    const github = requirement.githubLink;
    if (!github?.issueNumber) {
      return;
    }

    const shouldClose = toStatus === 'done';
    const nextState: 'open' | 'closed' = shouldClose ? 'closed' : 'open';
    const currentState = github.issueState || 'open';
    if (currentState === nextState) {
      return;
    }

    try {
      await this.patchGithubIssueState(requirement, nextState);
    } catch (error) {
      requirement.githubLink = {
        ...github,
        syncedAt: new Date(),
        lastError: error instanceof Error ? error.message : String(error),
      };
    }
  }

  createRequirement(payload: CreateRequirementDto) {
    const now = new Date();
    const requirementId = this.generateRequirementId();
    const title = String(payload.title || '').trim();
    const description = String(payload.description || '').trim();
    const labels = this.normalizeStringList(payload.labels);

    return this.requirementModel
      .create({
        requirementId,
        title,
        description,
        status: 'todo',
        priority: payload.priority || 'medium',
        category: payload.category || 'optimize',
        complexity: payload.complexity || 'low',
        labels,
        linkedPlanIds: [],
        createdById: payload.createdById ? String(payload.createdById).trim() : undefined,
        createdByName: payload.createdByName ? String(payload.createdByName).trim() : undefined,
        createdByType: payload.createdByType || 'human',
        localProjectId: payload.localProjectId ? String(payload.localProjectId).trim() : undefined,
        projectId: payload.projectId ? String(payload.projectId).trim() : undefined,
        comments: [],
        assignments: [],
        statusHistory: [
          {
            eventId: this.generateEntityId('evt'),
            fromStatus: 'todo',
            toStatus: 'todo',
            changedById: payload.createdById,
            changedByName: payload.createdByName,
            changedByType: payload.createdByType || 'human',
            note: 'requirement created',
            changedAt: now,
          },
        ],
        lastBoardEventAt: now,
      })
      .then((created) => created.toObject());
  }

  listRequirements(query: ListRequirementsDto) {
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
    const search = String(query.search || '').trim();
    const filters: Record<string, unknown> = {};

    if (query.status) {
      filters.status = query.status;
    }
    if (query.assigneeAgentId) {
      filters.currentAssigneeAgentId = String(query.assigneeAgentId).trim();
    }
    if (query.localProjectId) {
      filters.localProjectId = String(query.localProjectId).trim();
    }
    if (query.projectId !== undefined) {
      const trimmedProjectId = String(query.projectId || '').trim();
      filters.projectId = trimmedProjectId || { $in: [null, '', undefined] };
    }
    if (search) {
      filters.$or = [{ title: { $regex: search, $options: 'i' } }, { description: { $regex: search, $options: 'i' } }];
    }

    return this.requirementModel
      .find(filters)
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean()
      .exec()
      .then((requirements) => requirements.map((requirement) => this.withAssignAgentState(requirement as EiRequirement)));
  }

  getRequirementBoard() {
    return this.requirementModel
      .find({})
      .sort({ updatedAt: -1 })
      .lean()
      .exec()
      .then((requirements) => {
        const columns: Record<EiRequirementStatus, Array<Record<string, unknown>>> = {
          todo: [],
          assigned: [],
          in_progress: [],
          review: [],
          done: [],
          blocked: [],
        };

        for (const item of requirements as Array<Record<string, any>>) {
          const status = this.toBoardColumn((item.status || 'todo') as EiRequirementStatus);
          columns[status].push(
            this.withAssignAgentState(item as EiRequirement) as unknown as Record<string, unknown>,
          );
        }

        return {
          updatedAt: new Date().toISOString(),
          total: requirements.length,
          columns,
        };
      });
  }

  async deleteRequirement(requirementId: string) {
    const normalizedId = String(requirementId || '').trim();
    if (!normalizedId) {
      throw new BadRequestException('requirementId is required');
    }

    const result = await this.requirementModel.deleteOne({ requirementId: normalizedId }).exec();

    if (!result.deletedCount) {
      throw new NotFoundException('Requirement not found');
    }

    return {
      success: true,
      requirementId: normalizedId,
    };
  }

  async addRequirementComment(requirementId: string, payload: AddRequirementCommentDto) {
    const normalizedId = String(requirementId || '').trim();
    const requirement = await this.requirementModel.findOne({ requirementId: normalizedId }).exec();
    if (!requirement) {
      throw new NotFoundException('Requirement not found');
    }

    const comment: EiRequirementComment = {
      commentId: this.generateEntityId('cmt'),
      content: String(payload.content || '').trim(),
      authorId: payload.authorId ? String(payload.authorId).trim() : undefined,
      authorName: payload.authorName ? String(payload.authorName).trim() : undefined,
      authorType: payload.authorType || 'human',
      createdAt: new Date(),
    };

    requirement.comments = [...(requirement.comments || []), comment];
    requirement.lastBoardEventAt = new Date();
    await requirement.save();
    return requirement.toObject();
  }

  async assignRequirement(requirementId: string, payload: AssignRequirementDto) {
    const normalizedId = String(requirementId || '').trim();
    const requirement = await this.requirementModel.findOne({ requirementId: normalizedId }).exec();
    if (!requirement) {
      throw new NotFoundException('Requirement not found');
    }

    const assignAgentState = this.getAssignAgentState(requirement);
    if (!assignAgentState.canAssignAgent) {
      throw new BadRequestException(
        `${REQ_AGENT_ASSIGN_FORBIDDEN_CODE}: ${assignAgentState.assignAgentDisabledReason || REQ_AGENT_ASSIGN_FORBIDDEN_REASON}`,
      );
    }

    const assignment: EiRequirementAssignment = {
      assignmentId: this.generateEntityId('asn'),
      toAgentId: String(payload.toAgentId || '').trim(),
      toAgentName: payload.toAgentName ? String(payload.toAgentName).trim() : undefined,
      assignedById: payload.assignedById ? String(payload.assignedById).trim() : undefined,
      assignedByName: payload.assignedByName ? String(payload.assignedByName).trim() : undefined,
      reason: payload.reason ? String(payload.reason).trim() : undefined,
      assignedAt: new Date(),
    };

    const fromStatus = requirement.status;
    if (fromStatus !== 'assigned') {
      this.validateStatusTransition(fromStatus, 'assigned');
      requirement.status = 'assigned';
    }
    requirement.currentAssigneeAgentId = assignment.toAgentId;
    requirement.currentAssigneeAgentName = assignment.toAgentName;
    requirement.assignments = [...(requirement.assignments || []), assignment];

    const statusEvent: EiRequirementStatusEvent = {
      eventId: this.generateEntityId('evt'),
      fromStatus,
      toStatus: requirement.status,
      changedById: assignment.assignedById,
      changedByName: assignment.assignedByName,
      changedByType: 'agent',
      note: assignment.reason || 'assigned to agent',
      changedAt: new Date(),
    };
    requirement.statusHistory = [...(requirement.statusHistory || []), statusEvent];
    requirement.lastBoardEventAt = new Date();
    await requirement.save();
    return requirement.toObject();
  }

  async updateRequirementStatus(requirementId: string, payload: UpdateRequirementStatusDto) {
    const normalizedId = String(requirementId || '').trim();
    const requirement = await this.requirementModel.findOne({ requirementId: normalizedId }).exec();
    if (!requirement) {
      throw new NotFoundException('Requirement not found');
    }

    const fromStatus = requirement.status;
    const toStatus = payload.status;
    const forceComplete = payload.forceComplete === true && toStatus === 'done';
    if (!forceComplete) {
      this.validateStatusTransition(fromStatus, toStatus);
    }

    const nextAssigneeId = payload.toAgentId ? String(payload.toAgentId).trim() : '';
    const nextAssigneeName = payload.toAgentName ? String(payload.toAgentName).trim() : '';
    if (nextAssigneeId) {
      requirement.currentAssigneeAgentId = nextAssigneeId;
      requirement.currentAssigneeAgentName = nextAssigneeName || undefined;
    }

    if (payload.description !== undefined) {
      requirement.description = String(payload.description).trim();
    }

    requirement.status = toStatus;
    if (toStatus === 'todo') {
      requirement.currentAssigneeAgentId = undefined;
      requirement.currentAssigneeAgentName = undefined;
    }

    const statusEvent: EiRequirementStatusEvent = {
      eventId: this.generateEntityId('evt'),
      fromStatus,
      toStatus,
      changedById: payload.changedById ? String(payload.changedById).trim() : undefined,
      changedByName: payload.changedByName ? String(payload.changedByName).trim() : undefined,
      changedByType: payload.changedByType || 'human',
      note: payload.note ? String(payload.note).trim() : undefined,
      taskType: payload.taskType ? String(payload.taskType).trim() : undefined,
      executorAgentId: payload.executorAgentId ? String(payload.executorAgentId).trim() : undefined,
      executorAgentName: payload.executorAgentName ? String(payload.executorAgentName).trim() : undefined,
      planId: payload.planId ? String(payload.planId).trim() : undefined,
      taskTitle: payload.taskTitle ? String(payload.taskTitle).trim() : undefined,
      changedAt: new Date(),
    };

    requirement.statusHistory = [...(requirement.statusHistory || []), statusEvent];
    requirement.lastBoardEventAt = new Date();

    // 如果传了 planId，追加到 linkedPlanIds（去重）
    if (payload.planId) {
      const planIdStr = String(payload.planId).trim();
      const existing = requirement.linkedPlanIds || [];
      if (!existing.includes(planIdStr)) {
        requirement.linkedPlanIds = [...existing, planIdStr];
      }
    }

    await this.syncGithubIssueLifecycle(requirement, toStatus);

    await requirement.save();
    return requirement.toObject();
  }

  async syncRequirementToGithub(requirementId: string, payload: SyncRequirementToGithubDto) {
    const normalizedId = String(requirementId || '').trim();

    const requirement = await this.requirementModel.findOne({ requirementId: normalizedId }).exec();
    if (!requirement) {
      throw new NotFoundException('Requirement not found');
    }

    const { owner, repo } = await this.resolveRequirementGithubTarget(requirement, payload);

    const issueTitle = requirement.title;
    const issueBody = [
      requirement.description || '(no description)',
      '',
      '---',
      `EI Requirement ID: ${requirement.requirementId}`,
      `Status: ${requirement.status}`,
      `Priority: ${requirement.priority}`,
      requirement.currentAssigneeAgentId ? `Assignee Agent: ${requirement.currentAssigneeAgentId}` : 'Assignee Agent: -',
    ].join('\n');

    try {
      const issue = await this.githubClient.githubRequest<{
        id: number;
        number: number;
        html_url: string;
        state: 'open' | 'closed';
      }>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: issueTitle,
          body: issueBody,
          labels: this.normalizeStringList(payload.labels || requirement.labels || []),
        }),
      });

      requirement.githubLink = {
        owner,
        repo,
        issueNumber: issue.number,
        issueId: issue.id,
        issueUrl: issue.html_url,
        issueState: issue.state,
        syncedAt: new Date(),
        lastError: undefined,
      };
      requirement.lastBoardEventAt = new Date();
      await requirement.save();

      return {
        success: true,
        requirementId: requirement.requirementId,
        githubLink: requirement.githubLink,
      };
    } catch (error) {
      requirement.githubLink = {
        owner,
        repo,
        issueNumber: requirement.githubLink?.issueNumber || 0,
        issueId: requirement.githubLink?.issueId || 0,
        issueUrl: requirement.githubLink?.issueUrl || '',
        issueState: requirement.githubLink?.issueState || 'open',
        syncedAt: new Date(),
        lastError: error instanceof Error ? error.message : String(error),
      };
      await requirement.save();
      throw error;
    }
  }

  async getRequirementById(requirementId: string) {
    const normalized = String(requirementId || '').trim();
    const requirement = await this.requirementModel.findOne({ requirementId: normalized }).lean().exec();
    if (!requirement) {
      throw new NotFoundException('Requirement not found');
    }
    return this.withAssignAgentState(requirement as EiRequirement);
  }
}
