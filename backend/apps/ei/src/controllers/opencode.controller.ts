import {
  Body,
  Controller,
  Get,
  Headers,
  MessageEvent,
  Param,
  Post,
  Query,
  Sse,
  UnauthorizedException,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { AuthService } from '../../../../src/modules/auth/auth.service';
import {
  CreateOpencodeSessionDto,
  ImportOpencodeProjectDto,
  PromptOpencodeSessionDto,
  QueryOpencodeProjectsDto,
  QueryOpencodeSessionsDto,
  SendOpencodePromptDto,
  SyncAgentOpencodeProjectsDto,
  SyncOpencodeContextDto,
} from '../dto';
import { EiOpencodeService } from '../services/opencode.service';
import { EiProjectsService } from '../services/projects.service';

@Controller('ei')
export class EiOpencodeController {
  constructor(
    private readonly opencodeService: EiOpencodeService,
    private readonly projectsService: EiProjectsService,
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

  @Post('tasks/:id/opencode/prompt')
  async sendOpencodePrompt(
    @Param('id') taskId: string,
    @Body() promptDto: SendOpencodePromptDto,
    @Headers('authorization') authHeader: string,
  ) {
    await this.getUserFromAuthHeader(authHeader);
    return this.opencodeService.sendOpencodePrompt(taskId, promptDto);
  }

  @Post('tasks/:id/opencode/session')
  async createOpencodeSession(
    @Param('id') taskId: string,
    @Body('projectPath') projectPath: string,
    @Headers('authorization') authHeader: string,
  ) {
    await this.getUserFromAuthHeader(authHeader);
    return this.opencodeService.createOpencodeSession(taskId, projectPath);
  }

  @Get('tasks/:id/opencode/history')
  async getOpencodeHistory(@Param('id') taskId: string, @Headers('authorization') authHeader: string) {
    await this.getUserFromAuthHeader(authHeader);
    return this.opencodeService.getOpencodeHistory(taskId);
  }

  @Get('opencode/current')
  getCurrentOpencodeContext() {
    return this.opencodeService.getCurrentOpencodeContext();
  }

  @Get('opencode/projects')
  async getOpencodeProjects(
    @Query() query: QueryOpencodeProjectsDto,
    @Headers('authorization') authHeader: string,
  ) {
    await this.getUserFromAuthHeader(authHeader);
    return this.opencodeService.getOpencodeProjects({
      endpoint: query?.endpoint,
      endpointRef: query?.endpointRef,
      authEnable: query?.auth_enable,
    });
  }

  @Post('opencode/projects/import')
  async importOpencodeProject(@Body() dto: ImportOpencodeProjectDto, @Headers('authorization') authHeader: string) {
    await this.getUserFromAuthHeader(authHeader);
    return this.projectsService.importOpencodeProject(dto);
  }

  @Post('agents/:agentId/opencode/projects/sync')
  async syncAgentOpencodeProjects(
    @Param('agentId') agentId: string,
    @Body() dto: SyncAgentOpencodeProjectsDto,
    @Headers('authorization') authHeader: string,
  ) {
    await this.getUserFromAuthHeader(authHeader);
    return this.projectsService.syncAgentOpencodeProjects(agentId, dto || {});
  }

  @Get('opencode/sessions')
  async getOpencodeSessions(
    @Query() query: QueryOpencodeSessionsDto,
    @Headers('authorization') authHeader: string,
  ) {
    await this.getUserFromAuthHeader(authHeader);
    return this.opencodeService.getOpencodeSessions(query?.directory, {
      endpoint: query?.endpoint,
      endpointRef: query?.endpointRef,
      authEnable: query?.auth_enable,
    });
  }

  @Get('opencode/sessions/:id')
  async getOpencodeSession(@Param('id') sessionId: string, @Headers('authorization') authHeader: string) {
    await this.getUserFromAuthHeader(authHeader);
    return this.opencodeService.getOpencodeSession(sessionId);
  }

  @Get('opencode/sessions/:id/messages')
  async getOpencodeSessionMessages(@Param('id') sessionId: string, @Headers('authorization') authHeader: string) {
    await this.getUserFromAuthHeader(authHeader);
    return this.opencodeService.getOpencodeSessionMessages(sessionId);
  }

  @Post('opencode/sessions')
  async createOpencodeSessionStandalone(
    @Body() dto: CreateOpencodeSessionDto,
    @Headers('authorization') authHeader: string,
  ) {
    await this.getUserFromAuthHeader(authHeader);
    return this.opencodeService.createOpencodeSessionStandalone(dto);
  }

  @Post('opencode/sessions/:id/prompt')
  async promptOpencodeSession(
    @Param('id') sessionId: string,
    @Body() dto: PromptOpencodeSessionDto,
    @Headers('authorization') authHeader: string,
  ) {
    await this.getUserFromAuthHeader(authHeader);
    return this.opencodeService.promptOpencodeSession(sessionId, dto);
  }

  @Sse('opencode/events')
  async streamOpencodeEvents(
    @Query('token') token: string,
    @Query() query: QueryOpencodeSessionsDto,
  ): Promise<Observable<MessageEvent>> {
    return this.opencodeService.streamOpencodeEvents(
      token,
      (authHeader) => this.getUserFromAuthHeader(authHeader),
      {
        endpoint: query?.endpoint,
        endpointRef: query?.endpointRef,
        authEnable: query?.auth_enable,
      },
    );
  }

  @Post('tasks/:id/opencode/sync-current')
  async syncCurrentOpencodeToTask(
    @Param('id') taskId: string,
    @Headers('authorization') authHeader: string,
    @Body() syncDto: SyncOpencodeContextDto,
  ) {
    await this.getUserFromAuthHeader(authHeader);
    return this.opencodeService.syncCurrentOpencodeToTask(taskId, syncDto || {});
  }
}
