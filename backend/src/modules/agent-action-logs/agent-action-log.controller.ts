import { Body, Controller, Get, Headers, Post, Query, UnauthorizedException } from '@nestjs/common';
import { decodeUserContext, verifyEncodedContext } from '@libs/auth';
import { GatewayUserContext } from '@libs/contracts';
import { AuthService } from '../auth/auth.service';
import {
  AgentActionLogService,
  QueryAgentActionLogsParams,
  RuntimeHookEventInput,
} from './agent-action-log.service';

@Controller('agent-action-logs')
export class AgentActionLogController {
  private readonly contextSecret = process.env.INTERNAL_CONTEXT_SECRET || 'internal-context-secret';

  constructor(
    private readonly authService: AuthService,
    private readonly agentActionLogService: AgentActionLogService,
  ) {}

  private resolveInternalContext(encoded?: string, signature?: string): GatewayUserContext | null {
    if (!encoded || !signature) {
      return null;
    }
    if (!verifyEncodedContext(encoded, signature, this.contextSecret)) {
      return null;
    }
    const context = decodeUserContext(encoded) as GatewayUserContext;
    if (!context?.employeeId) {
      return null;
    }
    if (context.expiresAt <= Date.now()) {
      return null;
    }
    return context;
  }

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

  @Post('internal/runtime-hooks')
  async createRuntimeHookLog(
    @Headers('x-user-context') internalContext: string,
    @Headers('x-user-signature') internalSignature: string,
    @Body() event: RuntimeHookEventInput,
  ) {
    const caller = this.resolveInternalContext(internalContext, internalSignature);
    if (!caller) {
      throw new UnauthorizedException('Invalid internal context');
    }

    const role = String(caller.role || '').toLowerCase();
    if (role !== 'system') {
      throw new UnauthorizedException('Internal runtime hook write requires system role');
    }

    await this.agentActionLogService.recordRuntimeHookEvent(event);
    return {
      success: true,
    };
  }
}
