import { Body, Controller, ForbiddenException, Get, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { GatewayUserContext } from '@libs/contracts';
import {
  AgentActionLogService,
  QueryAgentActionLogsParams,
  RuntimeHookEventInput,
} from './agent-action-log.service';

@Controller('agent-action-logs')
export class AgentActionLogController {
  constructor(private readonly agentActionLogService: AgentActionLogService) {}

  private getUserContext(req: Request & { userContext?: GatewayUserContext }): GatewayUserContext {
    const context = req.userContext;
    if (!context) {
      throw new ForbiddenException('Missing user context');
    }
    return context;
  }

  @Get()
  async getAgentActionLogs(@Req() req: Request & { userContext?: GatewayUserContext }, @Query() query: QueryAgentActionLogsParams) {
    this.getUserContext(req);
    const data = await this.agentActionLogService.queryAgentActionLogs(query);
    return {
      success: true,
      data,
    };
  }

  @Post('internal/runtime-hooks')
  async createRuntimeHookLog(
    @Req() req: Request & { userContext?: GatewayUserContext },
    @Body() event: RuntimeHookEventInput,
  ) {
    const caller = this.getUserContext(req);
    const role = String(caller.role || '').toLowerCase();
    if (role !== 'system') {
      throw new ForbiddenException('Internal runtime hook write requires system role');
    }

    await this.agentActionLogService.recordRuntimeHookEvent(event);
    return {
      success: true,
    };
  }

}
