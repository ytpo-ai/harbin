import { Controller, Get, Post, Body, Param, Delete, Put, Query } from '@nestjs/common';
import { AgentService } from './agent.service';
import { Agent, Task, AIModel } from '../../../../../src/shared/types';

@Controller('agents')
export class AgentController {
  constructor(private readonly agentService: AgentService) {}

  private toBooleanFlag(value?: string): boolean {
    if (!value) return false;
    return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
  }

  private normalizeAgent(agent: any) {
    const plain = agent?.toObject ? agent.toObject() : agent;
    const normalizedId = plain?.id || plain?._id?.toString?.() || plain?._id;
    return {
      ...plain,
      id: normalizedId,
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
        type: a.type,
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

  @Get('mcp/profiles/:agentType')
  async getMcpProfile(@Param('agentType') agentType: string) {
    return this.agentService.getMcpProfile(agentType);
  }

  @Put('mcp/profiles/:agentType')
  async upsertMcpProfile(
    @Param('agentType') agentType: string,
    @Body() body: { role?: string; tools?: string[]; capabilities?: string[]; exposed?: boolean; description?: string },
  ) {
    return this.agentService.upsertMcpProfile(agentType, body);
  }

  @Get('mcp')
  async getMcpAgents(@Query('includeHidden') includeHidden?: string) {
    return this.agentService.getMcpAgents({ includeHidden: this.toBooleanFlag(includeHidden) });
  }

  @Get('mcp/:id')
  async getMcpAgent(@Param('id') id: string, @Query('includeHidden') includeHidden?: string) {
    return this.agentService.getMcpAgent(id, { includeHidden: this.toBooleanFlag(includeHidden) });
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
  async executeTask(@Param('id') id: string, @Body() body: { task: Task, context?: any }) {
    const result = await this.agentService.executeTaskDetailed(id, body.task, body.context);
    return result;
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
