import { Injectable } from '@nestjs/common';
import { InternalApiClient } from './internal-api-client.service';
import { ToolExecutionContext } from './tool-execution-context.type';

@Injectable()
export class OrchestrationToolHandler {
  constructor(private readonly internalApiClient: InternalApiClient) {}

  private resolveMeetingContext(executionContext?: ToolExecutionContext): {
    meetingId?: string;
    initiatorId?: string;
    taskType?: string;
    organizationId?: string;
    executionAgentId?: string;
  } {
    const collaborationContext = executionContext?.collaborationContext || {};
    return {
      meetingId:
        (typeof collaborationContext.meetingId === 'string' && collaborationContext.meetingId) ||
        (typeof executionContext?.teamId === 'string' && executionContext.teamId) ||
        undefined,
      initiatorId:
        (typeof collaborationContext.initiatorId === 'string' && collaborationContext.initiatorId) ||
        (typeof collaborationContext.triggeredBy === 'string' && collaborationContext.triggeredBy) ||
        undefined,
      taskType:
        executionContext?.taskType ||
        (typeof collaborationContext.meetingType === 'string' ? 'meeting' : undefined),
      organizationId:
        (typeof collaborationContext.organizationId === 'string' && collaborationContext.organizationId) ||
        (typeof collaborationContext.orgId === 'string' && collaborationContext.orgId) ||
        undefined,
      executionAgentId:
        (typeof collaborationContext.agentId === 'string' && collaborationContext.agentId) ||
        undefined,
    };
  }

  private assertExecutionContext(
    executionContext: ToolExecutionContext | undefined,
    options: {
      allowMeeting: boolean;
      allowAutonomous: boolean;
      fallbackAgentId?: string;
    },
  ): {
    mode: 'meeting' | 'autonomous';
    meetingId?: string;
    initiatorId?: string;
    organizationId?: string;
    agentId?: string;
  } {
    const context = this.resolveMeetingContext(executionContext);
    const meetingLike = context.taskType === 'meeting' || Boolean(context.meetingId);
    if (meetingLike && options.allowMeeting) {
      return {
        mode: 'meeting',
        meetingId: context.meetingId || 'unknown-meeting',
        initiatorId: context.initiatorId,
      };
    }

    const agentId = context.executionAgentId || options.fallbackAgentId;
    if (options.allowAutonomous && context.organizationId && agentId) {
      return {
        mode: 'autonomous',
        organizationId: context.organizationId,
        agentId,
        initiatorId: context.initiatorId,
      };
    }

    if (options.allowMeeting && options.allowAutonomous) {
      throw new Error('This tool requires meeting context OR autonomous context (organizationId + agentId)');
    }
    if (options.allowMeeting) {
      throw new Error('This tool is only available in meeting context');
    }
    throw new Error('This tool requires autonomous context (organizationId + agentId)');
  }

  private requireConfirm(params: any, action: string): void {
    if (params?.confirm === true) {
      return;
    }
    throw new Error(`${action} requires confirm=true`);
  }

  private async getOrchestrationPlanForSchedule(planId: string): Promise<any> {
    const normalizedPlanId = String(planId || '').trim();
    if (!normalizedPlanId) {
      throw new Error('planId is required');
    }
    const plan = await this.internalApiClient.callOrchestrationApi('GET', `/plans/${normalizedPlanId}`, undefined);
    if (!plan || typeof plan !== 'object') {
      throw new Error('plan not found');
    }
    return plan;
  }

  private resolvePlanExecutorId(plan: any): string {
    const plannerAgentId = String(plan?.strategy?.plannerAgentId || '').trim();
    if (plannerAgentId) {
      return plannerAgentId;
    }

    const taskAssignments = Array.isArray(plan?.tasks)
      ? plan.tasks
          .map((task: any) => ({
            executorType: String(task?.assignment?.executorType || ''),
            executorId: String(task?.assignment?.executorId || '').trim(),
          }))
          .filter((assignment: any) => assignment.executorType === 'agent' && assignment.executorId)
      : [];
    if (taskAssignments.length) {
      return taskAssignments[0].executorId;
    }

    throw new Error('plan has no executable agent context, please set plannerAgentId first');
  }

  private buildScheduleConfig(params: {
    scheduleType?: 'cron' | 'interval';
    expression?: string;
    intervalMs?: number;
    timezone?: string;
  }): { type: 'cron' | 'interval'; expression?: string; intervalMs?: number; timezone?: string } {
    const scheduleType = params?.scheduleType;
    if (scheduleType !== 'cron' && scheduleType !== 'interval') {
      throw new Error('scheduleType must be cron or interval');
    }
    if (scheduleType === 'cron' && !String(params?.expression || '').trim()) {
      throw new Error('expression is required when scheduleType=cron');
    }
    if (scheduleType === 'interval') {
      const intervalMs = Number(params?.intervalMs || 0);
      if (!Number.isFinite(intervalMs) || intervalMs < 60_000) {
        throw new Error('intervalMs must be >= 60000 when scheduleType=interval');
      }
    }

    return {
      type: scheduleType,
      expression: scheduleType === 'cron' ? String(params?.expression || '').trim() : undefined,
      intervalMs: scheduleType === 'interval' ? Number(params?.intervalMs) : undefined,
      timezone: String(params?.timezone || '').trim() || undefined,
    };
  }

  private buildScheduleUpdateConfig(params: {
    scheduleType?: 'cron' | 'interval';
    expression?: string;
    intervalMs?: number;
    timezone?: string;
  }): { schedule?: { type: 'cron' | 'interval'; expression?: string; intervalMs?: number; timezone?: string } } {
    const hasSchedulePatch =
      params?.scheduleType !== undefined ||
      params?.expression !== undefined ||
      params?.intervalMs !== undefined ||
      params?.timezone !== undefined;
    if (!hasSchedulePatch) {
      return {};
    }

    return {
      schedule: this.buildScheduleConfig({
        scheduleType: params.scheduleType,
        expression: params.expression,
        intervalMs: params.intervalMs,
        timezone: params.timezone,
      }),
    };
  }

  async createOrchestrationPlan(
    params: {
      prompt?: string;
      title?: string;
      mode?: 'sequential' | 'parallel' | 'hybrid';
      plannerAgentId?: string;
      autoRun?: boolean;
      requirementId?: string;
    },
    agentId?: string,
    executionContext?: ToolExecutionContext,
  ): Promise<any> {
    const executionInfo = this.assertExecutionContext(executionContext, {
      allowMeeting: true,
      allowAutonomous: true,
      fallbackAgentId: agentId,
    });
    if (!params?.prompt?.trim()) {
      throw new Error('orchestration_create_plan requires prompt');
    }
    const prompt = params.prompt.trim();
    const promptMaxLength = 4000;
    if (prompt.length > promptMaxLength) {
      throw new Error(
        `orchestration_create_plan prompt too long: ${prompt.length} characters (max ${promptMaxLength})`,
      );
    }
    const title = params.title?.trim();
    const titleMaxLength = 200;
    if (title && title.length > titleMaxLength) {
      throw new Error(
        `orchestration_create_plan title too long: ${title.length} characters (max ${titleMaxLength})`,
      );
    }
    const validModes: Array<'sequential' | 'parallel' | 'hybrid'> = ['sequential', 'parallel', 'hybrid'];
    if (params.mode && !validModes.includes(params.mode)) {
      throw new Error(
        `orchestration_create_plan invalid mode: ${params.mode}. allowed=${validModes.join('|')}`,
      );
    }
    const payload = {
      prompt,
      title,
      mode: params.mode,
      plannerAgentId: params.plannerAgentId,
      autoRun: params.autoRun === true,
      requirementId: params.requirementId,
    };
    const result = await this.internalApiClient.callOrchestrationApi('POST', '/plans/from-prompt', payload);
    return {
      action: 'create_plan',
      contextMode: executionInfo.mode,
      meetingId: executionInfo.meetingId,
      organizationId: executionInfo.organizationId,
      initiatorAgentId: agentId,
      result,
    };
  }

  async runOrchestrationPlan(
    params: { planId?: string; continueOnFailure?: boolean; confirm?: boolean },
    agentId?: string,
    executionContext?: ToolExecutionContext,
  ): Promise<any> {
    const executionInfo = this.assertExecutionContext(executionContext, {
      allowMeeting: true,
      allowAutonomous: true,
      fallbackAgentId: agentId,
    });
    if (!params?.planId?.trim()) {
      throw new Error('orchestration_run_plan requires planId');
    }
    this.requireConfirm(params, 'orchestration_run_plan');
    const result = await this.internalApiClient.callOrchestrationApi(
      'POST',
      `/plans/${params.planId.trim()}/run`,
      { continueOnFailure: params.continueOnFailure === true },
    );
    return {
      action: 'run_plan',
      contextMode: executionInfo.mode,
      meetingId: executionInfo.meetingId,
      organizationId: executionInfo.organizationId,
      initiatorAgentId: agentId,
      result,
    };
  }

  async updateOrchestrationPlan(
    params: {
      planId?: string;
      title?: string;
      prompt?: string;
      mode?: 'sequential' | 'parallel' | 'hybrid';
      plannerAgentId?: string;
      metadata?: Record<string, any>;
    },
    agentId?: string,
    executionContext?: ToolExecutionContext,
  ): Promise<any> {
    const executionInfo = this.assertExecutionContext(executionContext, {
      allowMeeting: true,
      allowAutonomous: true,
      fallbackAgentId: agentId,
    });
    const planId = String(params?.planId || '').trim();
    if (!planId) {
      throw new Error('orchestration_update_plan requires planId');
    }

    const payload: Record<string, any> = {};
    const title = params?.title?.trim();
    if (title !== undefined && title.length > 0) {
      if (title.length > 200) {
        throw new Error('orchestration_update_plan title too long: max 200 characters');
      }
      payload.title = title;
    }

    const sourcePrompt = params?.prompt?.trim();
    if (sourcePrompt !== undefined && sourcePrompt.length > 0) {
      if (sourcePrompt.length > 4000) {
        throw new Error('orchestration_update_plan prompt too long: max 4000 characters');
      }
      payload.sourcePrompt = sourcePrompt;
    }

    const validModes: Array<'sequential' | 'parallel' | 'hybrid'> = ['sequential', 'parallel', 'hybrid'];
    if (params?.mode !== undefined) {
      if (!validModes.includes(params.mode)) {
        throw new Error(`orchestration_update_plan invalid mode: ${params.mode}. allowed=${validModes.join('|')}`);
      }
      payload.mode = params.mode;
    }

    if (params?.plannerAgentId !== undefined) {
      payload.plannerAgentId = String(params.plannerAgentId || '').trim();
    }

    if (params?.metadata !== undefined) {
      if (!params.metadata || typeof params.metadata !== 'object' || Array.isArray(params.metadata)) {
        throw new Error('orchestration_update_plan metadata must be an object');
      }
      payload.metadata = params.metadata;
    }

    if (!Object.keys(payload).length) {
      throw new Error('orchestration_update_plan requires at least one field to update');
    }

    const result = await this.internalApiClient.callOrchestrationApi('PATCH', `/plans/${planId}`, payload);
    return {
      action: 'update_plan',
      contextMode: executionInfo.mode,
      meetingId: executionInfo.meetingId,
      organizationId: executionInfo.organizationId,
      initiatorAgentId: agentId,
      result,
    };
  }

  async getOrchestrationPlan(
    params: { planId?: string },
    agentId?: string,
    executionContext?: ToolExecutionContext,
  ): Promise<any> {
    const executionInfo = this.assertExecutionContext(executionContext, {
      allowMeeting: true,
      allowAutonomous: true,
      fallbackAgentId: agentId,
    });
    if (!params?.planId?.trim()) {
      throw new Error('orchestration_get_plan requires planId');
    }
    const result = await this.internalApiClient.callOrchestrationApi('GET', `/plans/${params.planId.trim()}`, undefined);
    return {
      action: 'get_plan',
      contextMode: executionInfo.mode,
      meetingId: executionInfo.meetingId,
      organizationId: executionInfo.organizationId,
      initiatorAgentId: agentId,
      result,
    };
  }

  async listOrchestrationPlans(
    agentId?: string,
    executionContext?: ToolExecutionContext,
  ): Promise<any> {
    const executionInfo = this.assertExecutionContext(executionContext, {
      allowMeeting: true,
      allowAutonomous: true,
      fallbackAgentId: agentId,
    });
    const result = await this.internalApiClient.callOrchestrationApi('GET', '/plans', undefined);
    return {
      action: 'list_plans',
      contextMode: executionInfo.mode,
      meetingId: executionInfo.meetingId,
      organizationId: executionInfo.organizationId,
      initiatorAgentId: agentId,
      result,
    };
  }

  async reassignOrchestrationTask(
    params: {
      taskId?: string;
      executorType?: 'agent' | 'employee' | 'unassigned';
      executorId?: string;
      reason?: string;
      confirm?: boolean;
    },
    agentId?: string,
    executionContext?: ToolExecutionContext,
  ): Promise<any> {
    const executionInfo = this.assertExecutionContext(executionContext, {
      allowMeeting: true,
      allowAutonomous: true,
      fallbackAgentId: agentId,
    });
    if (!params?.taskId?.trim()) {
      throw new Error('orchestration_reassign_task requires taskId');
    }
    if (!params?.executorType) {
      throw new Error('orchestration_reassign_task requires executorType');
    }
    this.requireConfirm(params, 'orchestration_reassign_task');
    const result = await this.internalApiClient.callOrchestrationApi(
      'POST',
      `/tasks/${params.taskId.trim()}/reassign`,
      {
        executorType: params.executorType,
        executorId: params.executorId,
        reason: params.reason,
        sourceAgentId: agentId,
      },
    );
    return {
      action: 'reassign_task',
      contextMode: executionInfo.mode,
      meetingId: executionInfo.meetingId,
      organizationId: executionInfo.organizationId,
      initiatorAgentId: agentId,
      result,
    };
  }

  async completeOrchestrationHumanTask(
    params: { taskId?: string; summary?: string; output?: string; confirm?: boolean },
    agentId?: string,
    executionContext?: ToolExecutionContext,
  ): Promise<any> {
    const executionInfo = this.assertExecutionContext(executionContext, {
      allowMeeting: true,
      allowAutonomous: true,
      fallbackAgentId: agentId,
    });
    if (!params?.taskId?.trim()) {
      throw new Error('orchestration_complete_human_task requires taskId');
    }
    this.requireConfirm(params, 'orchestration_complete_human_task');
    const result = await this.internalApiClient.callOrchestrationApi(
      'POST',
      `/tasks/${params.taskId.trim()}/complete-human`,
      {
        summary: params.summary,
        output: params.output,
      },
    );
    return {
      action: 'complete_human_task',
      contextMode: executionInfo.mode,
      meetingId: executionInfo.meetingId,
      organizationId: executionInfo.organizationId,
      initiatorAgentId: agentId,
      result,
    };
  }

  async createOrchestrationSchedule(
    params: {
      planId?: string;
      scheduleType?: 'cron' | 'interval';
      expression?: string;
      intervalMs?: number;
      timezone?: string;
      enabled?: boolean;
    },
    agentId?: string,
    executionContext?: ToolExecutionContext,
  ): Promise<any> {
    const executionInfo = this.assertExecutionContext(executionContext, {
      allowMeeting: true,
      allowAutonomous: true,
      fallbackAgentId: agentId,
    });
    const planId = String(params?.planId || '').trim();
    if (!planId) {
      throw new Error('orchestration_create_schedule requires planId');
    }

    const plan = await this.getOrchestrationPlanForSchedule(planId);
    const targetAgentId = this.resolvePlanExecutorId(plan);
    const planTitle = String(plan?.title || '').trim();
    const planPrompt = String(plan?.sourcePrompt || '').trim();

    const payload = {
      name: `plan-schedule:${planTitle || planId}`,
      description: `Schedule for orchestration plan ${planId}`,
      schedule: this.buildScheduleConfig({
        scheduleType: params.scheduleType,
        expression: params.expression,
        intervalMs: params.intervalMs,
        timezone: params.timezone,
      }),
      target: {
        executorType: 'agent' as const,
        executorId: targetAgentId,
      },
      input: {
        prompt: planPrompt || undefined,
        payload: {
          planId,
          source: 'mcp.orchestration.createSchedule',
        },
      },
      enabled: params?.enabled,
    };

    const result = await this.internalApiClient.callOrchestrationApi('POST', '/schedules', payload);
    return {
      action: 'create_schedule',
      contextMode: executionInfo.mode,
      meetingId: executionInfo.meetingId,
      organizationId: executionInfo.organizationId,
      initiatorAgentId: agentId,
      planId,
      result,
    };
  }

  async updateOrchestrationSchedule(
    params: {
      scheduleId?: string;
      scheduleType?: 'cron' | 'interval';
      expression?: string;
      intervalMs?: number;
      timezone?: string;
      enabled?: boolean;
    },
    agentId?: string,
    executionContext?: ToolExecutionContext,
  ): Promise<any> {
    const executionInfo = this.assertExecutionContext(executionContext, {
      allowMeeting: true,
      allowAutonomous: true,
      fallbackAgentId: agentId,
    });
    const scheduleId = String(params?.scheduleId || '').trim();
    if (!scheduleId) {
      throw new Error('orchestration_update_schedule requires scheduleId');
    }

    const schedulePatch = this.buildScheduleUpdateConfig({
      scheduleType: params.scheduleType,
      expression: params.expression,
      intervalMs: params.intervalMs,
      timezone: params.timezone,
    });

    const payload: Record<string, unknown> = {
      ...schedulePatch,
    };
    if (params?.enabled !== undefined) {
      payload.enabled = params.enabled === true;
    }

    if (!Object.keys(payload).length) {
      throw new Error('orchestration_update_schedule requires at least one field to update');
    }

    const result = await this.internalApiClient.callOrchestrationApi('PUT', `/schedules/${scheduleId}`, payload);
    return {
      action: 'update_schedule',
      contextMode: executionInfo.mode,
      meetingId: executionInfo.meetingId,
      organizationId: executionInfo.organizationId,
      initiatorAgentId: agentId,
      result,
    };
  }

  async debugOrchestrationTask(
    params: {
      taskId?: string;
      title?: string;
      description?: string;
      resetResult?: boolean;
    },
    agentId?: string,
    executionContext?: ToolExecutionContext,
  ): Promise<any> {
    const executionInfo = this.assertExecutionContext(executionContext, {
      allowMeeting: true,
      allowAutonomous: true,
      fallbackAgentId: agentId,
    });
    const taskId = String(params?.taskId || '').trim();
    if (!taskId) {
      throw new Error('orchestration_debug_task requires taskId');
    }

    const payload: Record<string, unknown> = {};
    if (params?.title !== undefined) {
      const title = String(params.title || '').trim();
      if (title.length > 200) {
        throw new Error('orchestration_debug_task title too long: max 200 characters');
      }
      payload.title = title;
    }
    if (params?.description !== undefined) {
      const description = String(params.description || '').trim();
      if (description.length > 4000) {
        throw new Error('orchestration_debug_task description too long: max 4000 characters');
      }
      payload.description = description;
    }
    if (params?.resetResult !== undefined) {
      payload.resetResult = params.resetResult === true;
    }

    const result = await this.internalApiClient.callOrchestrationApi('POST', `/tasks/${taskId}/debug-run`, payload);
    const execution = result?.execution || {};
    const task = result?.task || {};
    const recentLogs = Array.isArray(task?.runLogs) ? task.runLogs.slice(-5) : [];
    const debug = {
      status: execution?.status || task?.status || 'unknown',
      error: execution?.error || null,
      resultSnippet:
        typeof execution?.result === 'string' ? execution.result.slice(0, 800) : execution?.result ? JSON.stringify(execution.result).slice(0, 800) : null,
      recentLogs,
      suggestedNextAction:
        execution?.status === 'failed'
          ? 'Inspect error and dependency context, then retry debug with updated draft'
          : execution?.status === 'waiting_human'
            ? 'Hand off to human or complete manually via complete-human-task'
            : execution?.status === 'completed'
              ? 'Continue with downstream dependent tasks'
              : 'Review task status and decide next operation',
    };

    return {
      action: 'debug_task',
      contextMode: executionInfo.mode,
      meetingId: executionInfo.meetingId,
      organizationId: executionInfo.organizationId,
      initiatorAgentId: agentId,
      taskId,
      debug,
      result,
    };
  }
}
