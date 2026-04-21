import { Injectable, Logger } from '@nestjs/common';
import { InternalApiClient } from '../internal-api-client.service';
import { ToolExecutionContext } from '../tool-execution-context.type';

@Injectable()
export class RequirementToolHandler {
  private readonly logger = new Logger(RequirementToolHandler.name);

  constructor(private readonly internalApiClient: InternalApiClient) {}

  private isEiNotFoundError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error || '');
    return message.includes('ei_api_request_failed') && message.includes(' returned 404;');
  }

  private pickRequirementIdFromContext(executionContext?: ToolExecutionContext): string | undefined {
    const collaborationContext = (executionContext?.collaborationContext || {}) as Record<string, unknown>;
    const direct = String(collaborationContext.requirementId || '').trim();
    if (direct) {
      return direct;
    }
    const taskContext =
      collaborationContext.taskContext && typeof collaborationContext.taskContext === 'object'
        ? collaborationContext.taskContext as Record<string, unknown>
        : undefined;
    const nested = String(taskContext?.requirementId || '').trim();
    return nested || undefined;
  }

  private async resolveRequirementIdFromPlan(planId?: string): Promise<string | undefined> {
    const normalizedPlanId = String(planId || '').trim();
    if (!normalizedPlanId) {
      return undefined;
    }
    try {
      const plan = await this.internalApiClient.callOrchestrationApi('GET', `/plans/${encodeURIComponent(normalizedPlanId)}`);
      const metadata = plan?.metadata && typeof plan.metadata === 'object' ? plan.metadata as Record<string, unknown> : {};
      const taskContext =
        metadata.taskContext && typeof metadata.taskContext === 'object'
          ? metadata.taskContext as Record<string, unknown>
          : undefined;
      const taskContextRequirementId = String(taskContext?.requirementId || '').trim();
      if (taskContextRequirementId) {
        return taskContextRequirementId;
      }
      const metadataRequirementId = String(metadata.requirementId || '').trim();
      return metadataRequirementId || undefined;
    } catch (error) {
      this.logger.warn(
        `[requirement_id_fallback_skip] resolve plan requirementId failed: planId=${normalizedPlanId}, error=${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return undefined;
    }
  }

  private async resolveFallbackRequirementId(
    currentRequirementId: string,
    executionContext?: ToolExecutionContext,
    planId?: string,
  ): Promise<string | undefined> {
    const contextRequirementId = this.pickRequirementIdFromContext(executionContext);
    if (contextRequirementId && contextRequirementId !== currentRequirementId) {
      return contextRequirementId;
    }
    const planRequirementId = await this.resolveRequirementIdFromPlan(planId);
    if (planRequirementId && planRequirementId !== currentRequirementId) {
      return planRequirementId;
    }
    return undefined;
  }

  private buildRequirementQuery(params: {
    mode?: string;
    status?: string;
    assigneeAgentId?: string;
    localProjectId?: string;
    search?: string;
    limit?: number;
    sortBy?: string;
    sortOrder?: string;
  }): string {
    const query = new URLSearchParams();
    if (params?.mode) query.append('mode', String(params.mode).trim());
    const normalizedStatus = this.normalizeRequirementStatus(params?.status);
    if (normalizedStatus) query.append('status', normalizedStatus);
    if (params?.assigneeAgentId) query.append('assigneeAgentId', String(params.assigneeAgentId).trim());
    if (params?.localProjectId) query.append('localProjectId', String(params.localProjectId).trim());
    if (params?.search) query.append('search', String(params.search).trim());
    if (params?.limit !== undefined) {
      const limit = Math.max(1, Math.min(Number(params.limit || 50), 200));
      query.append('limit', String(limit));
    }
    if (params?.sortBy) query.append('sortBy', String(params.sortBy).trim());
    if (params?.sortOrder) query.append('sortOrder', String(params.sortOrder).trim());
    const text = query.toString();
    return text ? `?${text}` : '';
  }

  private normalizeRequirementStatus(status?: string):
    | 'todo'
    | 'assigned'
    | 'in_progress'
    | 'review'
    | 'done'
    | 'blocked'
    | undefined {
    const value = String(status || '')
      .trim()
      .toLowerCase();
    if (!value) return undefined;
    const aliases: Record<string, 'todo' | 'assigned' | 'in_progress' | 'review' | 'done' | 'blocked'> = {
      todo: 'todo',
      assigned: 'assigned',
      in_progress: 'in_progress',
      inprogress: 'in_progress',
      review: 'review',
      done: 'done',
      blocked: 'blocked',
    };
    return aliases[value];
  }

  async listRequirements(
    params: {
      view?: string;
      mode?: string;
      status?: string;
      assigneeAgentId?: string;
      localProjectId?: string;
      search?: string;
      limit?: number;
      sortBy?: string;
      sortOrder?: string;
    },
    agentId?: string,
    _executionContext?: ToolExecutionContext,
  ): Promise<any> {
    const view = String(params?.view || 'list')
      .trim()
      .toLowerCase();
    if (view === 'board') {
      const board = await this.internalApiClient.callEiApi('GET', '/requirements/board');
      return {
        action: 'requirement_list',
        view: 'board',
        initiatorAgentId: agentId,
        total: Number(board?.total || 0),
        board,
        fetchedAt: new Date().toISOString(),
      };
    }

    const query = this.buildRequirementQuery(params || {});
    const result = await this.internalApiClient.callEiApi('GET', `/requirements${query}`);
    const requirementsList = Array.isArray(result)
      ? result
      : Array.isArray(result?.list)
        ? result.list
        : Array.isArray(result?.requirements)
          ? result.requirements
          : [];
    return {
      action: 'requirement_list',
      view: 'list',
      initiatorAgentId: agentId,
      total: Number(result?.total ?? requirementsList.length ?? 0),
      requirements: result,
      fetchedAt: new Date().toISOString(),
    };
  }

  async getRequirement(
    params: { requirementId?: string },
    agentId?: string,
    _executionContext?: ToolExecutionContext,
  ): Promise<any> {
    const requirementId = String(params?.requirementId || '').trim();
    if (!requirementId) {
      throw new Error('requirement_get requires requirementId');
    }
    const result = await this.internalApiClient.callEiApi('GET', `/requirements/${encodeURIComponent(requirementId)}`);
    return {
      action: 'requirement_get',
      initiatorAgentId: agentId,
      requirement: result,
    };
  }

  async createRequirement(
    params: {
      title?: string;
      description?: string;
      priority?: 'low' | 'medium' | 'high' | 'critical';
      category?: 'fix' | 'feature' | 'optimize';
      complexity?: 'low' | 'medium' | 'high' | 'very_high';
      labels?: string[];
      createdById?: string;
      createdByName?: string;
      createdByType?: 'human' | 'agent' | 'system';
      localProjectId?: string;
      projectId?: string;
    },
    agentId?: string,
    executionContext?: ToolExecutionContext,
  ): Promise<any> {
    const title = String(params?.title || '').trim();
    if (!title) {
      throw new Error('requirement_create requires title');
    }
    const result = await this.internalApiClient.callEiApi('POST', '/requirements', {
      title,
      description: String(params?.description || '').trim(),
      priority: params?.priority,
      category: params?.category,
      complexity: params?.complexity,
      labels: Array.isArray(params?.labels) ? params.labels : undefined,
      createdById: String(params?.createdById || executionContext?.actor?.employeeId || agentId || '').trim() || undefined,
      createdByName: String(params?.createdByName || '').trim() || undefined,
      createdByType: params?.createdByType || 'agent',
      localProjectId: String(
        params?.localProjectId
        || (executionContext?.collaborationContext as any)?.projectBinding?.localProjectId
        || params?.projectId
        || executionContext?.projectId
        || (executionContext?.collaborationContext as any)?.projectId
        || '',
      ).trim() || undefined,
      projectId: String(params?.projectId || executionContext?.projectId || (executionContext?.collaborationContext as any)?.projectId || '').trim() || undefined,
    });
    return {
      action: 'requirement_create',
      initiatorAgentId: agentId,
      requirement: result,
      createdAt: new Date().toISOString(),
    };
  }

  async updateRequirementStatus(
    params: {
      requirementId?: string;
      status?: 'todo' | 'assigned' | 'in_progress' | 'review' | 'done' | 'blocked';
      changedById?: string;
      changedByName?: string;
      changedByType?: 'human' | 'agent' | 'system';
      note?: string;
      toAgentId?: string;
      toAgentName?: string;
      planId?: string;
      taskType?: string;
      executorAgentId?: string;
      executorAgentName?: string;
      taskTitle?: string;
    },
    agentId?: string,
    executionContext?: ToolExecutionContext,
  ): Promise<any> {
    const requirementId = String(params?.requirementId || '').trim();
    if (!requirementId) {
      throw new Error('requirement_update_status requires requirementId');
    }
    if (!params?.status) {
      throw new Error('requirement_update_status requires status');
    }

    // 自动从 collaborationContext 补充 planId（如果工具参数未显式传入）
    const planId = String(params?.planId || executionContext?.collaborationContext?.planId || '').trim() || undefined;

    const payload = {
      status: params.status,
      changedById: String(params?.changedById || executionContext?.actor?.employeeId || agentId || '').trim() || undefined,
      changedByName: String(params?.changedByName || '').trim() || undefined,
      changedByType: params?.changedByType || 'agent',
      note: String(params?.note || '').trim() || undefined,
      toAgentId: String(params?.toAgentId || '').trim() || undefined,
      toAgentName: String(params?.toAgentName || '').trim() || undefined,
      planId,
      taskType: String(params?.taskType || '').trim() || undefined,
      executorAgentId: String(params?.executorAgentId || '').trim() || undefined,
      executorAgentName: String(params?.executorAgentName || '').trim() || undefined,
      taskTitle: String(params?.taskTitle || '').trim() || undefined,
    };

    let effectiveRequirementId = requirementId;
    let result: any;
    try {
      result = await this.internalApiClient.callEiApi('POST', `/requirements/${encodeURIComponent(effectiveRequirementId)}/status`, payload);
    } catch (error) {
      if (!this.isEiNotFoundError(error)) {
        throw error;
      }
      const fallbackRequirementId = await this.resolveFallbackRequirementId(effectiveRequirementId, executionContext, planId);
      if (!fallbackRequirementId) {
        throw error;
      }
      this.logger.warn(
        `[requirement_id_fallback_retry] update-status 404, retry with fallback requirementId: from=${effectiveRequirementId}, to=${fallbackRequirementId}, planId=${planId || 'none'}`,
      );
      effectiveRequirementId = fallbackRequirementId;
      result = await this.internalApiClient.callEiApi('POST', `/requirements/${encodeURIComponent(effectiveRequirementId)}/status`, payload);
    }

    return {
      action: 'requirement_update_status',
      initiatorAgentId: agentId,
      requirementId: effectiveRequirementId,
      status: params.status,
      planId,
      requirement: result,
      updatedAt: new Date().toISOString(),
    };
  }

  async mutateRequirement(
    params: {
      action?: 'update_status' | 'assign' | 'comment';
      requirementId?: string;
      status?: 'todo' | 'assigned' | 'in_progress' | 'review' | 'done' | 'blocked';
      changedById?: string;
      changedByName?: string;
      changedByType?: 'human' | 'agent' | 'system';
      note?: string;
      toAgentId?: string;
      toAgentName?: string;
      assignedById?: string;
      assignedByName?: string;
      reason?: string;
      content?: string;
      authorId?: string;
      authorName?: string;
      authorType?: 'human' | 'agent' | 'system';
    },
    agentId?: string,
    executionContext?: ToolExecutionContext,
  ): Promise<any> {
    const action = String(params?.action || '')
      .trim()
      .toLowerCase();
    if (!action) {
      throw new Error('requirement_update requires action');
    }

    if (action === 'update_status') {
      return this.updateRequirementStatus(
        {
          requirementId: params?.requirementId,
          status: params?.status,
          changedById: params?.changedById,
          changedByName: params?.changedByName,
          changedByType: params?.changedByType,
          note: params?.note,
        },
        agentId,
        executionContext,
      );
    }

    if (action === 'assign') {
      return this.assignRequirement(
        {
          requirementId: params?.requirementId,
          toAgentId: params?.toAgentId,
          toAgentName: params?.toAgentName,
          assignedById: params?.assignedById,
          assignedByName: params?.assignedByName,
          reason: params?.reason,
        },
        agentId,
        executionContext,
      );
    }

    if (action === 'comment') {
      return this.commentRequirement(
        {
          requirementId: params?.requirementId,
          content: params?.content,
          authorId: params?.authorId,
          authorName: params?.authorName,
          authorType: params?.authorType,
        },
        agentId,
        executionContext,
      );
    }

    throw new Error('requirement_update requires action in [update_status, assign, comment]');
  }

  async assignRequirement(
    params: {
      requirementId?: string;
      toAgentId?: string;
      toAgentName?: string;
      assignedById?: string;
      assignedByName?: string;
      reason?: string;
    },
    agentId?: string,
    executionContext?: ToolExecutionContext,
  ): Promise<any> {
    const requirementId = String(params?.requirementId || '').trim();
    if (!requirementId) {
      throw new Error('requirement_assign requires requirementId');
    }
    const toAgentId = String(params?.toAgentId || '').trim();
    if (!toAgentId) {
      throw new Error('requirement_assign requires toAgentId');
    }
    const result = await this.internalApiClient.callEiApi('POST', `/requirements/${encodeURIComponent(requirementId)}/assign`, {
      toAgentId,
      toAgentName: String(params?.toAgentName || '').trim() || undefined,
      assignedById: String(params?.assignedById || executionContext?.actor?.employeeId || agentId || '').trim() || undefined,
      assignedByName: String(params?.assignedByName || '').trim() || undefined,
      reason: String(params?.reason || '').trim() || undefined,
    });
    return {
      action: 'requirement_assign',
      initiatorAgentId: agentId,
      requirementId,
      assigneeAgentId: toAgentId,
      requirement: result,
      updatedAt: new Date().toISOString(),
    };
  }

  async commentRequirement(
    params: {
      requirementId?: string;
      content?: string;
      authorId?: string;
      authorName?: string;
      authorType?: 'human' | 'agent' | 'system';
    },
    agentId?: string,
    executionContext?: ToolExecutionContext,
  ): Promise<any> {
    const requirementId = String(params?.requirementId || '').trim();
    if (!requirementId) {
      throw new Error('requirement_comment requires requirementId');
    }
    const content = String(params?.content || '').trim();
    if (!content) {
      throw new Error('requirement_comment requires content');
    }
    const result = await this.internalApiClient.callEiApi('POST', `/requirements/${encodeURIComponent(requirementId)}/comments`, {
      content,
      authorId: String(params?.authorId || executionContext?.actor?.employeeId || agentId || '').trim() || undefined,
      authorName: String(params?.authorName || '').trim() || undefined,
      authorType: params?.authorType || 'agent',
    });
    return {
      action: 'requirement_comment',
      initiatorAgentId: agentId,
      requirementId,
      requirement: result,
      updatedAt: new Date().toISOString(),
    };
  }

  async syncRequirementGithub(
    params: {
      requirementId?: string;
      owner?: string;
      repo?: string;
      labels?: string[];
    },
    agentId?: string,
  ): Promise<any> {
    const requirementId = String(params?.requirementId || '').trim();
    if (!requirementId) {
      throw new Error('requirement_sync_github requires requirementId');
    }
    const result = await this.internalApiClient.callEiApi('POST', `/requirements/${encodeURIComponent(requirementId)}/github/sync`, {
      owner: String(params?.owner || '').trim() || undefined,
      repo: String(params?.repo || '').trim() || undefined,
      labels: Array.isArray(params?.labels) ? params.labels : undefined,
    });
    return {
      action: 'requirement_sync_github',
      initiatorAgentId: agentId,
      requirementId,
      result,
      updatedAt: new Date().toISOString(),
    };
  }

}
