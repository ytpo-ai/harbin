import { Injectable } from '@nestjs/common';
import { InternalApiClient } from './internal-api-client.service';
import { ToolExecutionContext } from './tool-execution-context.type';

@Injectable()
export class RequirementToolHandler {
  constructor(private readonly internalApiClient: InternalApiClient) {}

  private buildRequirementQuery(params: {
    status?: string;
    assigneeAgentId?: string;
    localProjectId?: string;
    search?: string;
    limit?: number;
  }): string {
    const query = new URLSearchParams();
    if (params?.status) query.append('status', String(params.status).trim());
    if (params?.assigneeAgentId) query.append('assigneeAgentId', String(params.assigneeAgentId).trim());
    if (params?.localProjectId) query.append('localProjectId', String(params.localProjectId).trim());
    if (params?.search) query.append('search', String(params.search).trim());
    if (params?.limit !== undefined) {
      const limit = Math.max(1, Math.min(Number(params.limit || 50), 200));
      query.append('limit', String(limit));
    }
    const text = query.toString();
    return text ? `?${text}` : '';
  }

  async listRequirements(
    params: {
      status?: string;
      assigneeAgentId?: string;
      localProjectId?: string;
      search?: string;
      limit?: number;
    },
    agentId?: string,
    executionContext?: ToolExecutionContext,
  ): Promise<any> {
    const query = this.buildRequirementQuery(params || {});
    const result = await this.internalApiClient.callEiApi('GET', `/requirements${query}`);
    return {
      action: 'requirement_list',
      initiatorAgentId: agentId,
      organizationId: (executionContext?.teamContext || {}).organizationId,
      total: Array.isArray(result) ? result.length : 0,
      requirements: result,
      fetchedAt: new Date().toISOString(),
    };
  }

  async getRequirement(
    params: { requirementId?: string },
    agentId?: string,
    executionContext?: ToolExecutionContext,
  ): Promise<any> {
    const requirementId = String(params?.requirementId || '').trim();
    if (!requirementId) {
      throw new Error('requirement_get requires requirementId');
    }
    const result = await this.internalApiClient.callEiApi('GET', `/requirements/${encodeURIComponent(requirementId)}`);
    return {
      action: 'requirement_get',
      initiatorAgentId: agentId,
      organizationId: (executionContext?.teamContext || {}).organizationId,
      requirement: result,
    };
  }

  async createRequirement(
    params: {
      title?: string;
      description?: string;
      priority?: 'low' | 'medium' | 'high' | 'critical';
      labels?: string[];
      createdById?: string;
      createdByName?: string;
      createdByType?: 'human' | 'agent' | 'system';
      localProjectId?: string;
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
      labels: Array.isArray(params?.labels) ? params.labels : undefined,
      createdById: String(params?.createdById || executionContext?.actor?.employeeId || agentId || '').trim() || undefined,
      createdByName: String(params?.createdByName || '').trim() || undefined,
      createdByType: params?.createdByType || 'agent',
      localProjectId: String(params?.localProjectId || '').trim() || undefined,
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
    const result = await this.internalApiClient.callEiApi('POST', `/requirements/${encodeURIComponent(requirementId)}/status`, {
      status: params.status,
      changedById: String(params?.changedById || executionContext?.actor?.employeeId || agentId || '').trim() || undefined,
      changedByName: String(params?.changedByName || '').trim() || undefined,
      changedByType: params?.changedByType || 'agent',
      note: String(params?.note || '').trim() || undefined,
    });
    return {
      action: 'requirement_update_status',
      initiatorAgentId: agentId,
      requirementId,
      status: params.status,
      requirement: result,
      updatedAt: new Date().toISOString(),
    };
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

  async getRequirementBoard(agentId?: string): Promise<any> {
    const result = await this.internalApiClient.callEiApi('GET', '/requirements/board');
    return {
      action: 'requirement_board',
      initiatorAgentId: agentId,
      board: result,
      fetchedAt: new Date().toISOString(),
    };
  }
}
