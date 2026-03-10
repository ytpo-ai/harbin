import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { decodeUserContext, verifyEncodedContext } from '@libs/auth';
import { GatewayUserContext } from '@libs/contracts';
import { AuthService } from '../auth/auth.service';
import { OrchestrationService } from './orchestration.service';
import {
  ArchiveSessionDto,
  BatchAppendMessagesDto,
  DebugTaskStepDto,
  ReplanPlanDto,
  CompleteHumanTaskDto,
  CreatePlanFromPromptDto,
  CreateSessionDto,
  ReassignTaskDto,
  RunPlanDto,
  SessionMessageDto,
  SessionQueryDto,
  UpdatePlanDto,
  UpdateTaskDraftDto,
} from './dto';
import { SessionManagerService } from './session-manager.service';

@Controller('orchestration')
export class OrchestrationController {
  private readonly contextSecret = process.env.INTERNAL_CONTEXT_SECRET || 'internal-context-secret';

  constructor(
    private readonly orchestrationService: OrchestrationService,
    private readonly sessionManagerService: SessionManagerService,
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

    return {
      id: context.employeeId,
    };
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

  @Post('plans/from-prompt')
  async createPlanFromPrompt(
    @Body() dto: CreatePlanFromPromptDto,
    @Headers('authorization') authHeader: string,
    @Headers('x-user-context') internalContext?: string,
    @Headers('x-user-signature') internalSignature?: string,
  ) {
    const user = await this.getUserFromAuthHeader(authHeader, internalContext, internalSignature);
    return this.orchestrationService.createPlanFromPrompt(user.id, dto);
  }

  @Get('plans')
  async listPlans(
    @Headers('authorization') authHeader: string,
    @Headers('x-user-context') internalContext?: string,
    @Headers('x-user-signature') internalSignature?: string,
  ) {
    const user = await this.getUserFromAuthHeader(authHeader, internalContext, internalSignature);
    return this.orchestrationService.listPlans();
  }

  @Get('plans/:id')
  async getPlan(
    @Param('id') planId: string,
    @Headers('authorization') authHeader: string,
    @Headers('x-user-context') internalContext?: string,
    @Headers('x-user-signature') internalSignature?: string,
  ) {
    const user = await this.getUserFromAuthHeader(authHeader, internalContext, internalSignature);
    return this.orchestrationService.getPlanById(planId);
  }

  @Patch('plans/:id')
  async updatePlan(
    @Param('id') planId: string,
    @Body() dto: UpdatePlanDto,
    @Headers('authorization') authHeader: string,
    @Headers('x-user-context') internalContext?: string,
    @Headers('x-user-signature') internalSignature?: string,
  ) {
    const user = await this.getUserFromAuthHeader(authHeader, internalContext, internalSignature);
    return this.orchestrationService.updatePlan(planId, dto);
  }

  @Delete('plans/:id')
  async deletePlan(@Param('id') planId: string, @Headers('authorization') authHeader: string) {
    const user = await this.getUserFromAuthHeader(authHeader);
    return this.orchestrationService.deletePlan(planId);
  }

  @Get('plans/:id/tasks')
  async listTasks(@Param('id') planId: string, @Headers('authorization') authHeader: string) {
    const user = await this.getUserFromAuthHeader(authHeader);
    return this.orchestrationService.listTasksByPlan(planId);
  }

  @Post('plans/:id/run')
  async runPlan(
    @Param('id') planId: string,
    @Body() dto: RunPlanDto,
    @Headers('authorization') authHeader: string,
    @Headers('x-user-context') internalContext?: string,
    @Headers('x-user-signature') internalSignature?: string,
  ) {
    const user = await this.getUserFromAuthHeader(authHeader, internalContext, internalSignature);
    return this.orchestrationService.runPlanAsync(planId, dto || {});
  }

  @Post('plans/:id/replan')
  async replanPlan(
    @Param('id') planId: string,
    @Body() dto: ReplanPlanDto,
    @Headers('authorization') authHeader: string,
    @Headers('x-user-context') internalContext?: string,
    @Headers('x-user-signature') internalSignature?: string,
  ) {
    const user = await this.getUserFromAuthHeader(authHeader, internalContext, internalSignature);
    return this.orchestrationService.replanPlan(planId, dto);
  }

  @Post('tasks/:id/reassign')
  async reassignTask(
    @Param('id') taskId: string,
    @Body() dto: ReassignTaskDto,
    @Headers('authorization') authHeader: string,
    @Headers('x-user-context') internalContext?: string,
    @Headers('x-user-signature') internalSignature?: string,
  ) {
    const user = await this.getUserFromAuthHeader(authHeader, internalContext, internalSignature);
    return this.orchestrationService.reassignTask(taskId, dto);
  }

  @Post('tasks/:id/complete-human')
  async completeHumanTask(
    @Param('id') taskId: string,
    @Body() dto: CompleteHumanTaskDto,
    @Headers('authorization') authHeader: string,
    @Headers('x-user-context') internalContext?: string,
    @Headers('x-user-signature') internalSignature?: string,
  ) {
    const user = await this.getUserFromAuthHeader(authHeader, internalContext, internalSignature);
    return this.orchestrationService.completeHumanTask(taskId, dto);
  }

  @Post('tasks/:id/retry')
  async retryTask(@Param('id') taskId: string, @Headers('authorization') authHeader: string) {
    const user = await this.getUserFromAuthHeader(authHeader);
    return this.orchestrationService.retryTask(taskId);
  }

  @Post('tasks/:id/draft')
  async updateTaskDraft(
    @Param('id') taskId: string,
    @Body() dto: UpdateTaskDraftDto,
    @Headers('authorization') authHeader: string,
  ) {
    const user = await this.getUserFromAuthHeader(authHeader);
    return this.orchestrationService.updateTaskDraft(taskId, dto);
  }

  @Post('tasks/:id/debug-run')
  async debugTaskStep(
    @Param('id') taskId: string,
    @Body() dto: DebugTaskStepDto,
    @Headers('authorization') authHeader: string,
    @Headers('x-user-context') internalContext?: string,
    @Headers('x-user-signature') internalSignature?: string,
  ) {
    const user = await this.getUserFromAuthHeader(authHeader, internalContext, internalSignature);
    return this.orchestrationService.debugTaskStep(taskId, dto);
  }

  @Post('sessions')
  async createSession(@Body() dto: CreateSessionDto) {
    return this.sessionManagerService.createSession(dto);
  }

  @Get('sessions')
  async listSessions(@Query() query: SessionQueryDto) {
    return this.sessionManagerService.listSessions(query);
  }

  @Get('sessions/:id')
  async getSession(@Param('id') sessionId: string) {
    return this.sessionManagerService.getSessionOrThrow(sessionId);
  }

  @Post('sessions/:id/messages')
  async appendSessionMessage(
    @Param('id') sessionId: string,
    @Body() dto: SessionMessageDto,
  ) {
    return this.sessionManagerService.appendMessage(sessionId, dto);
  }

  @Post('sessions/:id/messages/batch')
  async appendSessionMessages(
    @Param('id') sessionId: string,
    @Body() dto: BatchAppendMessagesDto,
  ) {
    return this.sessionManagerService.appendMessages(sessionId, dto.messages);
  }

  @Post('sessions/:id/archive')
  async archiveSession(
    @Param('id') sessionId: string,
    @Body() dto: ArchiveSessionDto,
  ) {
    return this.sessionManagerService.archiveSession(sessionId, dto.summary);
  }

  @Post('sessions/:id/resume')
  async resumeSession(@Param('id') sessionId: string) {
    return this.sessionManagerService.resumeSession(sessionId);
  }

}
