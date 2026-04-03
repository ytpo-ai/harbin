import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  Put,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { decodeUserContext, verifyEncodedContext } from '@libs/auth';
import { GatewayUserContext } from '@libs/contracts';
import { AuthService } from '../auth/auth.service';
import { SchedulerService } from './scheduler.service';
import {
  CreateScheduleDto,
  ScheduleHistoryQueryDto,
  TriggerSystemEngineeringStatisticsDto,
  UpdateScheduleDto,
} from './dto';

@Controller(['schedules', 'orchestration/schedules'])
export class SchedulerController {
  private readonly contextSecret = process.env.INTERNAL_CONTEXT_SECRET || 'internal-context-secret';

  constructor(
    private readonly schedulerService: SchedulerService,
    private readonly authService: AuthService,
  ) {}

  private resolveUserFromInternalContext(encoded?: string, signature?: string): { id: string } | null {
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

    return { id: context.employeeId };
  }

  private async getUserFromAuthHeader(authHeader?: string, encodedContext?: string, signature?: string) {
    const internal = this.resolveUserFromInternalContext(encodedContext, signature);
    if (internal) {
      return internal;
    }

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('无效的Token');
    }

    const token = authHeader.replace('Bearer ', '');
    const employee = await this.authService.getEmployeeFromToken(token);

    if (!employee) {
      throw new UnauthorizedException('Token已过期或无效');
    }

    return { id: employee.id };
  }

  @Post()
  async create(
    @Body() dto: CreateScheduleDto,
    @Headers('authorization') authHeader: string,
    @Headers('x-user-context') internalContext?: string,
    @Headers('x-user-signature') internalSignature?: string,
  ) {
    const user = await this.getUserFromAuthHeader(authHeader, internalContext, internalSignature);
    return this.schedulerService.createSchedule(user.id, dto);
  }

  @Get()
  async list(
    @Headers('authorization') authHeader: string,
    @Headers('x-user-context') internalContext?: string,
    @Headers('x-user-signature') internalSignature?: string,
    @Query('projectId') projectId?: string,
  ) {
    await this.getUserFromAuthHeader(authHeader, internalContext, internalSignature);
    const filters = projectId !== undefined ? { projectId } : undefined;
    return this.schedulerService.listSchedules(filters);
  }

  @Get(':id')
  async detail(
    @Param('id') scheduleId: string,
    @Headers('authorization') authHeader: string,
    @Headers('x-user-context') internalContext?: string,
    @Headers('x-user-signature') internalSignature?: string,
  ) {
    await this.getUserFromAuthHeader(authHeader, internalContext, internalSignature);
    return this.schedulerService.getScheduleById(scheduleId);
  }

  @Put(':id')
  async update(
    @Param('id') scheduleId: string,
    @Body() dto: UpdateScheduleDto,
    @Headers('authorization') authHeader: string,
    @Headers('x-user-context') internalContext?: string,
    @Headers('x-user-signature') internalSignature?: string,
  ) {
    await this.getUserFromAuthHeader(authHeader, internalContext, internalSignature);
    return this.schedulerService.updateSchedule(scheduleId, dto);
  }

  @Delete(':id')
  async remove(@Param('id') scheduleId: string, @Headers('authorization') authHeader: string) {
    await this.getUserFromAuthHeader(authHeader);
    return this.schedulerService.deleteSchedule(scheduleId);
  }

  @Post(':id/enable')
  async enable(@Param('id') scheduleId: string, @Headers('authorization') authHeader: string) {
    await this.getUserFromAuthHeader(authHeader);
    return this.schedulerService.enableSchedule(scheduleId);
  }

  @Post(':id/disable')
  async disable(@Param('id') scheduleId: string, @Headers('authorization') authHeader: string) {
    await this.getUserFromAuthHeader(authHeader);
    return this.schedulerService.disableSchedule(scheduleId);
  }

  @Post(':id/trigger')
  async trigger(@Param('id') scheduleId: string, @Headers('authorization') authHeader: string) {
    await this.getUserFromAuthHeader(authHeader);
    return this.schedulerService.triggerSchedule(scheduleId);
  }

  @Post('system/engineering-statistics/trigger')
  async triggerSystemEngineeringStatistics(
    @Body() dto: TriggerSystemEngineeringStatisticsDto,
    @Headers('authorization') authHeader: string,
  ) {
    const user = await this.getUserFromAuthHeader(authHeader);
    return this.schedulerService.triggerSystemEngineeringStatistics({
      receiverId: dto?.receiverId || user.id,
      scope: dto?.scope,
      tokenMode: dto?.tokenMode,
      projectIds: dto?.projectIds,
      triggeredBy: dto?.triggeredBy || 'frontend-button',
    });
  }

  @Get('system/engineering-statistics')
  async getSystemEngineeringStatisticsSchedule(@Headers('authorization') authHeader: string) {
    await this.getUserFromAuthHeader(authHeader);
    return this.schedulerService.getOrCreateEngineeringStatisticsSchedule();
  }

  @Post('system/docs-heat/trigger')
  async triggerSystemDocsHeat(
    @Body() dto: Record<string, any>,
    @Headers('authorization') authHeader: string,
  ) {
    await this.getUserFromAuthHeader(authHeader);
    return this.schedulerService.triggerSystemDocsHeat({
      topN: dto?.topN,
      triggeredBy: dto?.triggeredBy || 'frontend-button',
    });
  }

  @Get('system/docs-heat')
  async getSystemDocsHeatSchedule(@Headers('authorization') authHeader: string) {
    await this.getUserFromAuthHeader(authHeader);
    return this.schedulerService.getOrCreateDocsHeatSchedule();
  }

  @Get(':id/history')
  async history(
    @Param('id') scheduleId: string,
    @Query() query: ScheduleHistoryQueryDto,
    @Headers('authorization') authHeader: string,
  ) {
    await this.getUserFromAuthHeader(authHeader);
    return this.schedulerService.getScheduleHistory(scheduleId, query.limit || 20);
  }
}
