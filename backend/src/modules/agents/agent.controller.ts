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

  @Get('active')
  getActiveAgents() {
    return this.agentService.getActiveAgents();
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

  @Post(':id/test')
  async testAgent(@Param('id') id: string) {
    const agent = await this.agentService.getAgent(id);
    if (!agent) {
      return { success: false, error: 'Agent not found' };
    }

    const testTask: Task = {
      title: 'Test Task',
      description: 'Please respond with "Agent Connected to AI Model Successfully"',
      type: 'test',
      priority: 'low',
      status: 'pending',
      assignedAgents: [id],
      teamId: 'test',
      messages: [
        {
          role: 'user',
          content: 'Please respond with exactly: "Agent Connected to AI Model Successfully"',
          timestamp: new Date()
        }
      ],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    try {
      const startTime = Date.now();
      const response = await this.agentService.executeTask(id, testTask);
      const duration = Date.now() - startTime;

      return {
        success: true,
        agent: agent.name,
        model: agent.model?.name,
        response,
        responseLength: response.length,
        duration: `${duration}ms`,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        success: false,
        agent: agent.name,
        model: agent.model?.name,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
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