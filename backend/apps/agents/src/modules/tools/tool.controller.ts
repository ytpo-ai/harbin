import { Controller, Get, Post, Body, Param, Delete, Put, Query } from '@nestjs/common';
import { ToolService } from './tool.service';
import { Tool } from '../../../../../src/shared/types';

@Controller('tools')
export class ToolController {
  constructor(private readonly toolService: ToolService) {}

  @Get()
  getAllTools() {
    return this.toolService.getAllToolsView();
  }

  @Get('registry')
  getToolRegistry(
    @Query('provider') provider?: string,
    @Query('executionChannel') executionChannel?: string,
    @Query('toolkitId') toolkitId?: string,
    @Query('namespace') namespace?: string,
    @Query('resource') resource?: string,
    @Query('action') action?: string,
    @Query('category') category?: string,
    @Query('capability') capability?: string,
    @Query('enabled') enabled?: string,
  ) {
    return this.toolService.getToolRegistry({
      provider,
      executionChannel,
      toolkitId,
      namespace,
      resource,
      action,
      category,
      capability,
      enabled,
    });
  }

  @Get('toolkits')
  getToolkits(
    @Query('provider') provider?: string,
    @Query('namespace') namespace?: string,
    @Query('status') status?: string,
  ) {
    return this.toolService.getToolkits({ provider, namespace, status });
  }

  @Get('toolkits/:id')
  getToolkit(@Param('id') id: string) {
    return this.toolService.getToolkit(id);
  }

  @Get('router/topk')
  getTopKRoutes(
    @Query('provider') provider?: string,
    @Query('domain') domain?: string,
    @Query('namespace') namespace?: string,
    @Query('resource') resource?: string,
    @Query('action') action?: string,
    @Query('capability') capability?: string,
    @Query('limit') limit?: string,
  ) {
    return this.toolService.getTopKToolRoutes({
      provider,
      domain,
      namespace,
      resource,
      action,
      capability,
      limit: limit ? Number(limit) : undefined,
    });
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
  async executeTool(
    @Param('id') id: string,
    @Body() body: {
      agentId: string;
      parameters: any;
      taskId?: string;
      executionContext?: any;
    }
  ) {
    const execution = await this.toolService.executeTool(id, body.agentId, body.parameters, body.taskId, body.executionContext);
    const executionPayload = (execution as any)?.toObject ? (execution as any).toObject() : execution;
    const resolvedToolId = executionPayload.resolvedToolId || executionPayload.toolId || id;
    return {
      ...executionPayload,
      requestedToolId: id,
      resolvedToolId,
    };
  }

  @Get('executions/history')
  getToolExecutions(@Query('agentId') agentId?: string, @Query('toolId') toolId?: string) {
    return this.toolService.getToolExecutions(agentId, toolId);
  }

  @Get('executions/stats')
  getToolExecutionStats() {
    return this.toolService.getToolExecutionStats();
  }

  @Get(':id')
  getTool(@Param('id') id: string) {
    return this.toolService.getToolView(id);
  }
}
