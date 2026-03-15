import { Controller, Get, Post, Body, Param, Delete, Put, Query, Req, Logger } from '@nestjs/common';
import { Request } from 'express';
import { GatewayUserContext } from '@libs/contracts';
import { AgentService } from './agent.service';
import { Agent, Task, AIModel } from '../../../../../src/shared/types';

@Controller('agents')
export class AgentController {
  private readonly logger = new Logger(AgentController.name);

  constructor(private readonly agentService: AgentService) {}

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

  @Post()
  async createAgent(@Body() agentData: Omit<Agent, 'id' | 'createdAt' | 'updatedAt'>) {
    const agent = await this.agentService.createAgent(agentData);
    return this.normalizeAgent(agent);
  }

  @Get()
  async getAllAgents() {
    const agents = await this.agentService.getAllAgents();
    return agents.map((agent) => this.normalizeAgent(agent));
  }

  @Get('active')
  async getActiveAgents() {
    const agents = await this.agentService.getActiveAgents();
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

  @Post('tool-permission-sets/reset-system-roles')
  async resetToolPermissionSetsBySystemRoles() {
    return this.agentService.resetToolPermissionSetsBySystemRoles();
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

    this.logger.log(
      `[agent_execute_ingress] requestId=${requestMeta.requestId || 'none'} agentId=${id} taskId=${body?.task?.id || 'unknown'} type=${body?.task?.type || 'unknown'} hasTeamContext=${Boolean(context?.teamContext)}`,
    );

    try {
      const result = await this.agentService.executeTaskDetailed(id, body.task, context);
      this.logger.log(
        `[agent_execute_egress] requestId=${requestMeta.requestId || 'none'} agentId=${id} taskId=${body?.task?.id || 'unknown'} status=success runId=${result.runId || 'none'} sessionId=${result.sessionId || 'none'} responseLength=${(result.response || '').length}`,
      );
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || 'Unknown error');
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
