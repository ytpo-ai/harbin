import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { OrchestrationService } from './orchestration.service';
import {
  ArchiveSessionDto,
  BatchAppendMessagesDto,
  CompleteHumanTaskDto,
  CreatePlanFromPromptDto,
  CreateSessionDto,
  ReassignTaskDto,
  RunPlanDto,
  SessionMessageDto,
  SessionQueryDto,
} from './dto';
import { SessionManagerService } from './session-manager.service';

@Controller('orchestration')
export class OrchestrationController {
  constructor(
    private readonly orchestrationService: OrchestrationService,
    private readonly sessionManagerService: SessionManagerService,
    private readonly authService: AuthService,
  ) {}

  private async getUserFromAuthHeader(authHeader: string) {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('无效的Token');
    }

    const token = authHeader.replace('Bearer ', '');
    const employee = await this.authService.getEmployeeFromToken(token);

    if (!employee) {
      throw new UnauthorizedException('Token已过期或无效');
    }

    return employee;
  }

  @Post('plans/from-prompt')
  async createPlanFromPrompt(
    @Body() dto: CreatePlanFromPromptDto,
    @Headers('authorization') authHeader: string,
  ) {
    const user = await this.getUserFromAuthHeader(authHeader);
    return this.orchestrationService.createPlanFromPrompt(user.organizationId, user.id, dto);
  }

  @Get('plans')
  async listPlans(@Headers('authorization') authHeader: string) {
    const user = await this.getUserFromAuthHeader(authHeader);
    return this.orchestrationService.listPlans(user.organizationId);
  }

  @Get('plans/:id')
  async getPlan(@Param('id') planId: string, @Headers('authorization') authHeader: string) {
    const user = await this.getUserFromAuthHeader(authHeader);
    return this.orchestrationService.getPlanById(user.organizationId, planId);
  }

  @Delete('plans/:id')
  async deletePlan(@Param('id') planId: string, @Headers('authorization') authHeader: string) {
    const user = await this.getUserFromAuthHeader(authHeader);
    return this.orchestrationService.deletePlan(user.organizationId, planId);
  }

  @Get('plans/:id/tasks')
  async listTasks(@Param('id') planId: string, @Headers('authorization') authHeader: string) {
    const user = await this.getUserFromAuthHeader(authHeader);
    return this.orchestrationService.listTasksByPlan(user.organizationId, planId);
  }

  @Post('plans/:id/run')
  async runPlan(
    @Param('id') planId: string,
    @Body() dto: RunPlanDto,
    @Headers('authorization') authHeader: string,
  ) {
    const user = await this.getUserFromAuthHeader(authHeader);
    return this.orchestrationService.runPlanAsync(user.organizationId, planId, dto || {});
  }

  @Post('tasks/:id/reassign')
  async reassignTask(
    @Param('id') taskId: string,
    @Body() dto: ReassignTaskDto,
    @Headers('authorization') authHeader: string,
  ) {
    const user = await this.getUserFromAuthHeader(authHeader);
    return this.orchestrationService.reassignTask(user.organizationId, taskId, dto);
  }

  @Post('tasks/:id/complete-human')
  async completeHumanTask(
    @Param('id') taskId: string,
    @Body() dto: CompleteHumanTaskDto,
    @Headers('authorization') authHeader: string,
  ) {
    const user = await this.getUserFromAuthHeader(authHeader);
    return this.orchestrationService.completeHumanTask(user.organizationId, taskId, dto);
  }

  @Post('tasks/:id/retry')
  async retryTask(@Param('id') taskId: string, @Headers('authorization') authHeader: string) {
    const user = await this.getUserFromAuthHeader(authHeader);
    return this.orchestrationService.retryTask(user.organizationId, taskId);
  }

  @Post('sessions')
  async createSession(@Body() dto: CreateSessionDto, @Headers('authorization') authHeader: string) {
    const user = await this.getUserFromAuthHeader(authHeader);
    return this.sessionManagerService.createSession(user.organizationId, dto);
  }

  @Get('sessions')
  async listSessions(
    @Query() query: SessionQueryDto,
    @Headers('authorization') authHeader: string,
  ) {
    const user = await this.getUserFromAuthHeader(authHeader);
    return this.sessionManagerService.listSessions(user.organizationId, query);
  }

  @Get('sessions/:id')
  async getSession(@Param('id') sessionId: string, @Headers('authorization') authHeader: string) {
    const user = await this.getUserFromAuthHeader(authHeader);
    return this.sessionManagerService.getSessionOrThrow(user.organizationId, sessionId);
  }

  @Post('sessions/:id/messages')
  async appendSessionMessage(
    @Param('id') sessionId: string,
    @Body() dto: SessionMessageDto,
    @Headers('authorization') authHeader: string,
  ) {
    const user = await this.getUserFromAuthHeader(authHeader);
    return this.sessionManagerService.appendMessage(user.organizationId, sessionId, dto);
  }

  @Post('sessions/:id/messages/batch')
  async appendSessionMessages(
    @Param('id') sessionId: string,
    @Body() dto: BatchAppendMessagesDto,
    @Headers('authorization') authHeader: string,
  ) {
    const user = await this.getUserFromAuthHeader(authHeader);
    return this.sessionManagerService.appendMessages(user.organizationId, sessionId, dto.messages);
  }

  @Post('sessions/:id/archive')
  async archiveSession(
    @Param('id') sessionId: string,
    @Body() dto: ArchiveSessionDto,
    @Headers('authorization') authHeader: string,
  ) {
    const user = await this.getUserFromAuthHeader(authHeader);
    return this.sessionManagerService.archiveSession(user.organizationId, sessionId, dto.summary);
  }

  @Post('sessions/:id/resume')
  async resumeSession(@Param('id') sessionId: string, @Headers('authorization') authHeader: string) {
    const user = await this.getUserFromAuthHeader(authHeader);
    return this.sessionManagerService.resumeSession(user.organizationId, sessionId);
  }
}
