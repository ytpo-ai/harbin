import { Controller, Get, Headers, Query, UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { OperationLogService, QueryOperationLogsParams } from './operation-log.service';

@Controller('operation-logs')
export class OperationLogController {
  constructor(
    private readonly authService: AuthService,
    private readonly operationLogService: OperationLogService,
  ) {}

  @Get()
  async getOperationLogs(
    @Headers('authorization') authHeader: string,
    @Query() query: QueryOperationLogsParams,
  ) {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('无效的Token');
    }

    const token = authHeader.replace('Bearer ', '');
    const employee = await this.authService.getEmployeeFromToken(token);
    if (!employee) {
      throw new UnauthorizedException('Token已过期或无效');
    }

    await this.operationLogService.assertHumanViewer(employee.id);
    const data = await this.operationLogService.queryAllHumanOperationLogs(query);
    return {
      success: true,
      data,
    };
  }
}
