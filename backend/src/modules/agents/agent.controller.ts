import { Controller, Get, Post, Body, Param, Delete, Put } from '@nestjs/common';
import { AgentService } from './agent.service';
import { Agent, Task, ChatMessage } from '../../shared/types';

@Controller('agents')
export class AgentController {
  constructor(private readonly agentService: AgentService) {}

  @Post()
  async createAgent(@Body() agentData: Omit<Agent, 'id' | 'createdAt' | 'updatedAt'>) {
    return this.agentService.createAgent(agentData);
  }

  @Get()
  getAllAgents() {
    return this.agentService.getAllAgents();
  }

  @Get(':id')
  getAgent(@Param('id') id: string) {
    return this.agentService.getAgent(id);
  }

  @Put(':id')
  updateAgent(@Param('id') id: string, @Body() updates: Partial<Agent>) {
    return this.agentService.updateAgent(id, updates);
  }

  @Delete(':id')
  deleteAgent(@Param('id') id: string) {
    return this.agentService.deleteAgent(id);
  }

  @Post(':id/execute')
  async executeTask(@Param('id') id: string, @Body() body: { task: Task, context?: any }) {
    const response = await this.agentService.executeTask(id, body.task, body.context);
    return { response };
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