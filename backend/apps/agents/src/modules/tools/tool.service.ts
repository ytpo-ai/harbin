import { Injectable } from '@nestjs/common';
import { ToolExecutionContext } from './tool-execution-context.type';
import { ToolExecutionService } from './tool-execution.service';
import { ToolRegistryService } from './tool-registry.service';

@Injectable()
export class ToolService {
  constructor(
    private readonly registry: ToolRegistryService,
    private readonly execution: ToolExecutionService,
  ) {}

  async seedBuiltinTools(mode: 'sync' | 'append' = 'sync'): Promise<void> {
    return this.registry.seedBuiltinTools(mode);
  }

  async getAllTools() {
    return this.registry.getAllTools();
  }

  async getAllToolsView() {
    return this.registry.getAllToolsView();
  }

  async getToolkits(query?: any) {
    return this.registry.getToolkits(query);
  }

  async getToolkit(id: string) {
    return this.registry.getToolkit(id);
  }

  async getToolRegistry(query: any) {
    return this.registry.getToolRegistry(query);
  }

  async getTopKToolRoutes(query: any) {
    return this.registry.getTopKToolRoutes(query);
  }

  async getTool(toolId: string) {
    return this.registry.getTool(toolId);
  }

  async getToolView(toolId: string) {
    return this.registry.getToolView(toolId);
  }

  async getToolInputContract(toolId: string) {
    return this.registry.getToolInputContract(toolId);
  }

  async getToolsByIds(toolIds: string[]) {
    return this.registry.getToolsByIds(toolIds);
  }

  async createTool(data: any) {
    return this.registry.createTool(data);
  }

  async updateTool(toolId: string, updates: any) {
    return this.registry.updateTool(toolId, updates);
  }

  async deleteTool(toolId: string) {
    return this.registry.deleteTool(toolId);
  }

  async executeTool(toolId: string, agentId: string, params: any, taskId?: string, executionContext?: ToolExecutionContext) {
    return this.execution.executeTool(toolId, agentId, params, taskId, executionContext);
  }

  async getToolExecutions(agentId?: string, toolId?: string) {
    return this.registry.getToolExecutions(agentId, toolId);
  }

  async getToolExecutionStats() {
    return this.registry.getToolExecutionStats();
  }
}
