import { Controller, Get, Headers, Query, UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { AgentActionLogService, QueryAgentActionLogsParams } from './agent-action-log.service';

@Controller('agent-action-logs')
export class AgentActionLogController {
  constructor(
    private readonly authService: AuthService,
    private readonly agentActionLogService: AgentActionLogService,
  ) {}

  @Get()
  async getAgentActionLogs(
    @Headers('authorization') authHeader: string,
    @Query() query: QueryAgentActionLogsParams,
  ) {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('无效的Token');
    }

    const token = authHeader.replace('Bearer ', '');
    const employee = await this.authService.getEmployeeFromToken(token);
    if (!employee) {
      throw new UnauthorizedException('Token已过期或无效');
    }

    const data = await this.agentActionLogService.queryAgentActionLogs(query);
    return {
      success: true,
      data,
    };
  }
}
