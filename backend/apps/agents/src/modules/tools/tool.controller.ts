import { Controller, Get, Post, Body, Param, Delete, Put, Query, Req, UseGuards, UnauthorizedException } from '@nestjs/common';
import { ToolService } from './tool.service';
import { Tool } from '../../../../../src/shared/types';
import { AgentToolAuthService } from './agent-tool-auth.service';
import { AgentToolAuthGuard } from './agent-tool-auth.guard';
import { AgentActionLogService } from '../action-logs/agent-action-log.service';
import { AgentActionContextType } from '../../schemas/agent-action-log.schema';

@Controller('tools')
export class ToolController {
  constructor(
    private readonly toolService: ToolService,
    private readonly agentToolAuthService: AgentToolAuthService,
    private readonly agentActionLogService: AgentActionLogService,
  ) {}

  private resolveContextType(context?: any): AgentActionContextType {
    const collaborationContext = context?.collaborationContext;
    if (!collaborationContext) return 'chat';
    if (collaborationContext.planId) return 'orchestration';
    if (collaborationContext.taskId || collaborationContext.orchestrationTaskId || collaborationContext.taskKey) return 'orchestration';
    return 'chat';
  }

  private resolveContextId(context?: any, fallbackTaskId?: string): string | undefined {
    const collaborationContext = context?.collaborationContext;
    if (collaborationContext?.meetingId) return collaborationContext.meetingId;
    if (collaborationContext?.planId) return collaborationContext.planId;
    if (collaborationContext?.taskId) return collaborationContext.taskId;
    if (collaborationContext?.orchestrationTaskId) return collaborationContext.orchestrationTaskId;
    if (collaborationContext?.taskKey) return collaborationContext.taskKey;
    if (fallbackTaskId) return fallbackTaskId;
    return undefined;
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

  private shouldRecordChatToolAction(executionContext?: any): boolean {
    const source = String(executionContext?.source || '').trim().toLowerCase();
    const executionMode = String(executionContext?.executionMode || '').trim().toLowerCase();
    return source === 'chat_query' || executionMode === 'chat';
  }

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
    const startedAt = Date.now();
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
    const shouldRecordAction = this.shouldRecordChatToolAction(executionContext);
    const actionContextType = this.resolveContextType(executionContext);
    const actionContextId = this.resolveContextId(executionContext, body.taskId);
    const actionSessionId = this.resolveAgentSessionId(executionContext);
    const chatTitle = this.resolveChatTitle(executionContext);
    const source = String(executionContext?.source || 'chat_query');

    if (shouldRecordAction) {
      await this.agentActionLogService.record({
        agentId: resolvedAgentId,
        contextType: actionContextType,
        contextId: actionContextId,
        action: 'chat_tool_call',
        status: 'started',
        details: {
          toolId: id,
          source,
          executionMode: 'chat',
          agentSessionId: actionSessionId,
          meetingTitle: chatTitle,
        },
      });
    }

    try {
      const execution = await this.toolService.executeTool(id, resolvedAgentId, body.parameters, body.taskId, executionContext);
      const executionPayload = (execution as any)?.toObject ? (execution as any).toObject() : execution;
      const resolvedToolId = executionPayload.resolvedToolId || executionPayload.toolId || id;

      if (shouldRecordAction) {
        await this.agentActionLogService.record({
          agentId: resolvedAgentId,
          contextType: actionContextType,
          contextId: actionContextId,
          action: 'chat_tool_call',
          status: 'completed',
          durationMs: Date.now() - startedAt,
          details: {
            toolId: resolvedToolId,
            source,
            executionMode: 'chat',
            agentSessionId: actionSessionId,
            meetingTitle: chatTitle,
          },
        });
      }

      return {
        ...executionPayload,
        requestedToolId: id,
        resolvedToolId,
      };
    } catch (error) {
      if (shouldRecordAction) {
        const message = error instanceof Error ? error.message : String(error || 'Unknown error');
        await this.agentActionLogService.record({
          agentId: resolvedAgentId,
          contextType: actionContextType,
          contextId: actionContextId,
          action: 'chat_tool_call',
          status: 'failed',
          durationMs: Date.now() - startedAt,
          details: {
            toolId: id,
            source,
            executionMode: 'chat',
            agentSessionId: actionSessionId,
            meetingTitle: chatTitle,
            error: message,
          },
        });
      }
      throw error;
    }
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
