import { Controller, Get, Post, Body, Param, Delete, Put, Query, Req, Logger } from '@nestjs/common';
import { Request } from 'express';
import { GatewayUserContext } from '@libs/contracts';
import { AgentService } from './agent.service';
import { Agent, Task, AIModel } from '../../../../../src/shared/types';
import { AgentActionLogService } from '../action-logs/agent-action-log.service';
import { AgentActionContextType } from '../../schemas/agent-action-log.schema';
import { AgentRoleTier } from '../../../../../src/shared/role-tier';

@Controller('agents')
export class AgentController {
  private readonly logger = new Logger(AgentController.name);

  constructor(
    private readonly agentService: AgentService,
    private readonly agentActionLogService: AgentActionLogService,
  ) {}

  private toBooleanFlag(value?: string): boolean {
    if (!value) return false;
    return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
  }

  private normalizeAgent(agent: any) {
    const plain = agent?.toObject ? agent.toObject() : agent;
    const normalizedId = plain?.id || plain?._id?.toString?.() || plain?._id;
    const rawConfig = plain?.config;
    const normalizedConfig =
      rawConfig && typeof rawConfig === 'object' && !Array.isArray(rawConfig)
        ? rawConfig
        : {};
    return {
      ...plain,
      id: normalizedId,
      config: normalizedConfig,
    };
  }

  private resolveContextType(context?: any): AgentActionContextType {
    const collaborationContext = context?.collaborationContext;
    if (!collaborationContext) return 'chat';
    if (collaborationContext.planId) return 'orchestration';
    if (collaborationContext.taskId || collaborationContext.orchestrationTaskId || collaborationContext.taskKey) return 'orchestration';
    return 'chat';
  }

  private resolveContextId(context?: any, task?: Task): string | undefined {
    const collaborationContext = context?.collaborationContext;
    if (collaborationContext?.meetingId) return collaborationContext.meetingId;
    if (collaborationContext?.planId) return collaborationContext.planId;
    if (collaborationContext?.taskId) return collaborationContext.taskId;
    if (collaborationContext?.orchestrationTaskId) return collaborationContext.orchestrationTaskId;
    if (collaborationContext?.taskKey) return collaborationContext.taskKey;
    if (task?.id) return task.id;
    const rawTask = task as { _id?: { toString?: () => string } } | undefined;
    return rawTask?._id?.toString ? rawTask._id.toString() : undefined;
  }

  private resolveExecutionMode(context?: any): 'chat' | 'task' {
    const mode = String(context?.executionMode || '').toLowerCase();
    return mode === 'chat' ? 'chat' : 'task';
  }

  private resolveAgentSessionId(context?: any): string | undefined {
    const candidates = [
      context?.agentSessionId,
      context?.sessionId,
      context?.collaborationContext?.agentSessionId,
      context?.collaborationContext?.sessionId,
    ];
    for (const value of candidates) {
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
    return undefined;
  }

  private resolveChatTitle(context?: any): string | undefined {
    const candidates = [
      context?.collaborationContext?.meetingTitle,
      context?.collaborationContext?.title,
    ];
    for (const value of candidates) {
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
    return undefined;
  }

  private buildActionLabel(task: Task, contextType: AgentActionContextType, mode: 'chat' | 'task'): string {
    const taskType = task?.type ? task.type : 'task';
    const action = mode === 'chat' ? 'chat_execution' : 'task_execution';
    return `${action}:${contextType}:${taskType}`;
  }

  @Post()
  async createAgent(@Body() agentData: Omit<Agent, 'id' | 'createdAt' | 'updatedAt'>) {
    const agent = await this.agentService.createAgent(agentData);
    return this.normalizeAgent(agent);
  }

  @Get()
  async getAllAgents(@Query('projectId') projectId?: string) {
    const filters = projectId !== undefined ? { projectId } : undefined;
    const agents = await this.agentService.getAllAgents(filters);
    return agents.map((agent) => this.normalizeAgent(agent));
  }

  @Get('active')
  async getActiveAgents(@Query('projectId') projectId?: string) {
    const filters = projectId !== undefined ? { projectId } : undefined;
    const agents = await this.agentService.getActiveAgents(filters);
    return agents.map((agent) => this.normalizeAgent(agent));
  }

  @Get('debug/status')
  async getDebugStatus() {
    const agents = await this.agentService.getAllAgents();
    return {
      totalAgents: agents.length,
      activeAgents: agents.filter(a => a.isActive).length,
      agents: agents.map(a => ({
        id: a.id,
        name: a.name,
        roleId: a.roleId,
        isActive: a.isActive,
        model: a.model?.name,
        modelProvider: a.model?.provider
      })),
      timestamp: new Date().toISOString()
    };
  }

  @Get('mcp/map')
  async getAgentsMcpMap() {
    return this.agentService.getAgentsMcpMap();
  }

  @Get('mcp/profiles')
  async getMcpProfiles() {
    return this.agentService.getMcpProfiles();
  }

  @Get('mcp/profiles/:roleCode')
  async getMcpProfile(@Param('roleCode') roleCode: string) {
    return this.agentService.getMcpProfile(roleCode);
  }

  @Put('mcp/profiles/:roleCode')
  async upsertMcpProfile(
    @Param('roleCode') roleCode: string,
    @Body() body: { role?: string; tools?: string[]; permissions?: string[]; capabilities?: string[]; exposed?: boolean; description?: string },
  ) {
    return this.agentService.upsertMcpProfile(roleCode, body);
  }

  @Get('tool-permission-sets')
  async getToolPermissionSets() {
    return this.agentService.getToolPermissionSets();
  }

  @Put('tool-permission-sets/:roleCode')
  async upsertToolPermissionSet(
    @Param('roleCode') roleCode: string,
    @Body() body: { tools?: string[]; permissions?: string[]; capabilities?: string[]; exposed?: boolean; description?: string },
  ) {
    return this.agentService.upsertToolPermissionSet(roleCode, body);
  }

  @Post('mcp/migrate-tool-ids')
  async migrateMcpToolIdsToCanonical() {
    return this.agentService.migrateAllToolIdsToCanonical();
  }

  @Get('mcp')
  async getMcpAgents(@Query('includeHidden') includeHidden?: string) {
    return this.agentService.getMcpAgents({ includeHidden: this.toBooleanFlag(includeHidden) });
  }

  @Get('mcp/:id')
  async getMcpAgent(@Param('id') id: string, @Query('includeHidden') includeHidden?: string) {
    return this.agentService.getMcpAgent(id, { includeHidden: this.toBooleanFlag(includeHidden) });
  }

  @Get('roles')
  async getAvailableRoles(@Query('status') status?: 'active' | 'inactive') {
    return this.agentService.getAvailableRoles({ status });
  }

  @Get('roles/:id')
  async getRoleById(@Param('id') id: string) {
    return this.agentService.getRoleById(id);
  }

  @Post('roles')
  async createRole(
    @Body()
    body: {
      code: string;
      name: string;
      description?: string;
      capabilities?: string[];
      tools?: string[];
      promptTemplate?: string;
      status?: 'active' | 'inactive';
      tier?: AgentRoleTier;
    },
  ) {
    return this.agentService.createRole(body);
  }

  @Put('roles/:id')
  async updateRole(
    @Param('id') id: string,
    @Body()
    body: {
      code?: string;
      name?: string;
      description?: string;
      capabilities?: string[];
      tools?: string[];
      promptTemplate?: string;
      status?: 'active' | 'inactive';
      tier?: AgentRoleTier;
    },
  ) {
    return this.agentService.updateRole(id, body);
  }

  @Delete('roles/:id')
  async deleteRole(@Param('id') id: string) {
    return this.agentService.deleteRole(id);
  }

  @Get(':id')
  async getAgent(@Param('id') id: string) {
    const agent = await this.agentService.getAgent(id);
    return agent ? this.normalizeAgent(agent) : null;
  }

  @Put(':id')
  async updateAgent(@Param('id') id: string, @Body() updates: Partial<Agent>) {
    const agent = await this.agentService.updateAgent(id, updates);
    return agent ? this.normalizeAgent(agent) : null;
  }

  @Delete(':id')
  deleteAgent(@Param('id') id: string) {
    return this.agentService.deleteAgent(id);
  }

  @Post(':id/execute')
  async executeTask(
    @Param('id') id: string,
    @Body() body: { task: Task; context?: any },
    @Req() req: Request & { userContext?: GatewayUserContext },
  ) {
    const startedAt = Date.now();
    const requestIdHeader = req.headers['x-request-id'];
    const requestId = Array.isArray(requestIdHeader)
      ? String(requestIdHeader[0] || '').trim()
      : String(requestIdHeader || '').trim();
    const actor = {
      employeeId: req.userContext?.employeeId,
      role: req.userContext?.role,
    };
    const requestMeta = {
      requestId: requestId || body?.context?.requestMeta?.requestId,
      source: body?.context?.requestMeta?.source || 'unknown',
    };
    const context = {
      ...(body.context || {}),
      actor,
      requestMeta,
    };
    const contextType = this.resolveContextType(context);
    const contextId = this.resolveContextId(context, body.task);
    const executionMode = this.resolveExecutionMode(context);
    const contextSessionId = this.resolveAgentSessionId(context);
    const chatTitle = this.resolveChatTitle(context);
    const actionLabel = this.buildActionLabel(body.task, contextType, executionMode);

    this.logger.log(
      `[agent_execute_ingress] requestId=${requestMeta.requestId || 'none'} agentId=${id} taskId=${body?.task?.id || 'unknown'} type=${body?.task?.type || 'unknown'} hasCollaborationContext=${Boolean(context?.collaborationContext)}`,
    );

    await this.agentActionLogService.record({
      agentId: id,
      contextType,
      contextId,
      action: actionLabel,
      status: 'started',
      details: {
        taskId: body?.task?.id,
        taskTitle: body?.task?.title,
        taskType: body?.task?.type,
        executionMode,
        agentSessionId: contextSessionId,
        meetingTitle: chatTitle,
      },
    });

    try {
      const result = await this.agentService.executeTaskDetailed(id, body.task, context);
      await this.agentActionLogService.record({
        agentId: id,
        contextType,
        contextId,
        action: actionLabel,
        status: 'completed',
        durationMs: Date.now() - startedAt,
        details: {
          taskId: body?.task?.id,
          taskTitle: body?.task?.title,
          taskType: body?.task?.type,
          executionMode,
          agentSessionId: result.sessionId || contextSessionId,
          meetingTitle: chatTitle,
          runId: result.runId,
          sessionId: result.sessionId,
        },
      });
      this.logger.log(
        `[agent_execute_egress] requestId=${requestMeta.requestId || 'none'} agentId=${id} taskId=${body?.task?.id || 'unknown'} status=success runId=${result.runId || 'none'} sessionId=${result.sessionId || 'none'} responseLength=${(result.response || '').length}`,
      );
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || 'Unknown error');
      await this.agentActionLogService.record({
        agentId: id,
        contextType,
        contextId,
        action: actionLabel,
        status: 'failed',
        durationMs: Date.now() - startedAt,
        details: {
          taskId: body?.task?.id,
          taskTitle: body?.task?.title,
          taskType: body?.task?.type,
          executionMode,
          agentSessionId: contextSessionId,
          meetingTitle: chatTitle,
          error: message,
        },
      });
      this.logger.error(
        `[agent_execute_error] requestId=${requestMeta.requestId || 'none'} agentId=${id} taskId=${body?.task?.id || 'unknown'} error=${message}`,
      );
      throw error;
    }
  }

  @Post(':id/test')
  async testAgent(
    @Param('id') id: string,
    @Body() body?: { model?: AIModel; apiKeyId?: string },
  ) {
    return this.agentService.testAgentConnection(id, body);
  }

  @Get(':id/capabilities')
  getCapabilities(@Param('id') id: string) {
    return this.agentService.getAgentCapabilities(id);
  }

  @Get(':id/available')
  isAvailable(@Param('id') id: string) {
    return this.agentService.isAgentAvailable(id);
  }
}
