import { Controller, Get, Post, Body, Param, Delete, Put, Query } from '@nestjs/common';
import { ToolService } from './tool.service';
import { Tool, ToolExecution } from '../../../../../src/shared/types';

@Controller('tools')
export class ToolController {
  constructor(private readonly toolService: ToolService) {}

  @Get()
  getAllTools() {
    return this.toolService.getAllTools();
  }

  @Get(':id')
  getTool(@Param('id') id: string) {
    return this.toolService.getTool(id);
  }

  @Post()
  createTool(@Body() toolData: Omit<Tool, 'id' | 'createdAt' | 'updatedAt'>) {
    return this.toolService.createTool(toolData);
  }

  @Put(':id')
  updateTool(@Param('id') id: string, @Body() updates: Partial<Tool>) {
    return this.toolService.updateTool(id, updates);
  }

  @Delete(':id')
  deleteTool(@Param('id') id: string) {
    return this.toolService.deleteTool(id);
  }

  @Post(':id/execute')
  executeTool(
    @Param('id') id: string,
    @Body() body: {
      agentId: string;
      parameters: any;
      taskId?: string
    }
  ) {
    return this.toolService.executeTool(id, body.agentId, body.parameters, body.taskId);
  }

  @Get('executions/history')
  getToolExecutions(@Query('agentId') agentId?: string, @Query('toolId') toolId?: string) {
    return this.toolService.getToolExecutions(agentId, toolId);
  }

  @Get('executions/stats')
  getToolExecutionStats() {
    return this.toolService.getToolExecutionStats();
  }
}
