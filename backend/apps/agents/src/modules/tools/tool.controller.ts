import { Controller, Get, Post, Body, Param, Delete, Put, Query, Req, UseGuards, UnauthorizedException } from '@nestjs/common';
import { ToolService } from './tool.service';
import { Tool } from '../../../../../src/shared/types';
import { AgentToolAuthService } from './agent-tool-auth.service';
import { AgentToolAuthGuard } from './agent-tool-auth.guard';

@Controller('tools')
export class ToolController {
  constructor(
    private readonly toolService: ToolService,
    private readonly agentToolAuthService: AgentToolAuthService,
  ) {}

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
  @UseGuards(AgentToolAuthGuard)
  async executeTool(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: {
      agentId: string;
      parameters: any;
      taskId?: string;
      executionContext?: any;
    }
  ) {
    const authContext = req.agentToolAuth as
      | {
          mode?: 'jwt' | 'internal-context' | 'legacy';
          agentId?: string;
          scopes?: string[];
          permissions?: string[];
          jti?: string;
          originSessionId?: string;
        }
      | undefined;
    const resolvedAgentId = String(authContext?.agentId || body.agentId || '').trim();
    if (!resolvedAgentId) {
      throw new UnauthorizedException('Missing agentId for tool execution');
    }
    const executionContext = {
      ...(body.executionContext || {}),
      auth: {
        ...(body.executionContext?.auth || {}),
        mode: authContext?.mode || body.executionContext?.auth?.mode,
        scopes: authContext?.scopes || body.executionContext?.auth?.scopes || [],
        permissions: authContext?.permissions || body.executionContext?.auth?.permissions || [],
        jti: authContext?.jti || body.executionContext?.auth?.jti,
      },
      originSessionId: authContext?.originSessionId || body.executionContext?.originSessionId,
      actor: {
        ...(body.executionContext?.actor || {}),
        employeeId: body.executionContext?.actor?.employeeId || authContext?.agentId,
        role: body.executionContext?.actor?.role || (authContext?.mode === 'jwt' ? 'agent-token' : 'system'),
      },
    };

    const execution = await this.toolService.executeTool(id, resolvedAgentId, body.parameters, body.taskId, executionContext);
    const executionPayload = (execution as any)?.toObject ? (execution as any).toObject() : execution;
    const resolvedToolId = executionPayload.resolvedToolId || executionPayload.toolId || id;
    return {
      ...executionPayload,
      requestedToolId: id,
      resolvedToolId,
    };
  }

  @Post('auth/credentials')
  async createAgentCredential(
    @Req() req: any,
    @Body()
    body: {
      agentId: string;
      label?: string;
      scopeTemplate?: string[];
      expiresAt?: string;
    },
  ) {
    const createdBy = String(req?.userContext?.employeeId || '').trim() || undefined;
    return this.agentToolAuthService.createCredential({
      agentId: body.agentId,
      label: body.label,
      scopeTemplate: body.scopeTemplate,
      expiresAt: body.expiresAt,
      createdBy,
    });
  }

  @Post('auth/credentials/revoke')
  async revokeAgentCredential(
    @Body()
    body: {
      credentialId?: string;
      keyId?: string;
    },
  ) {
    return this.agentToolAuthService.revokeCredential(body);
  }

  @Post('auth/credentials/rotate')
  async rotateAgentCredential(
    @Body()
    body: {
      credentialId?: string;
      keyId?: string;
      expiresAt?: string;
    },
  ) {
    return this.agentToolAuthService.rotateCredential(body);
  }

  @Post('auth/agent-token')
  async issueAgentToken(
    @Body()
    body: {
      agentKeyId: string;
      agentSecret: string;
      requestedScopes?: string[];
      originSessionId?: string;
    },
  ) {
    return this.agentToolAuthService.issueToken(body);
  }

  @Post('auth/tokens/revoke')
  async revokeToken(
    @Body()
    body: {
      token?: string;
      jti?: string;
      agentId?: string;
      reason?: string;
      expiresAt?: string;
    },
  ) {
    return this.agentToolAuthService.revokeToken(body);
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
