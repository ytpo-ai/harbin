import { Controller, Get, Post, Put, Delete, Body, Param, Query, Headers, UnauthorizedException, MessageEvent, Sse } from '@nestjs/common';
import { RdManagementService } from './rd-management.service';
import { CreateRdTaskDto, UpdateRdTaskDto, CreateRdProjectDto, UpdateRdProjectDto, SendOpencodePromptDto, QueryRdTaskDto, SyncOpencodeContextDto, CreateOpencodeSessionDto, PromptOpencodeSessionDto, ImportOpencodeProjectDto } from './dto';
import { AuthService } from '../auth/auth.service';
import { Observable } from 'rxjs';

@Controller('rd-management')
export class RdManagementController {
  constructor(
    private readonly rdManagementService: RdManagementService,
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

  // ========== 任务管理 ==========

  @Post('tasks')
  async createTask(
    @Body() createDto: CreateRdTaskDto,
    @Headers('authorization') authHeader: string,
  ) {
    const user = await this.getUserFromAuthHeader(authHeader);
    const userId = user.id;
    return this.rdManagementService.createTask(createDto, userId);
  }

  @Get('tasks')
  async findAllTasks(
    @Query() query: QueryRdTaskDto,
    @Headers('authorization') authHeader: string,
  ) {
    const user = await this.getUserFromAuthHeader(authHeader);
    return this.rdManagementService.findAllTasks(query);
  }

  @Get('tasks/:id')
  async findTaskById(
    @Param('id') taskId: string,
    @Headers('authorization') authHeader: string,
  ) {
    const user = await this.getUserFromAuthHeader(authHeader);
    return this.rdManagementService.findTaskById(taskId);
  }

  @Put('tasks/:id')
  async updateTask(
    @Param('id') taskId: string,
    @Body() updateDto: UpdateRdTaskDto,
    @Headers('authorization') authHeader: string,
  ) {
    const user = await this.getUserFromAuthHeader(authHeader);
    return this.rdManagementService.updateTask(taskId, updateDto);
  }

  @Delete('tasks/:id')
  async deleteTask(
    @Param('id') taskId: string,
    @Headers('authorization') authHeader: string,
  ) {
    const user = await this.getUserFromAuthHeader(authHeader);
    return this.rdManagementService.deleteTask(taskId);
  }

  // ========== 项目管理 ==========

  @Post('projects')
  async createProject(
    @Body() createDto: CreateRdProjectDto,
    @Headers('authorization') authHeader: string,
  ) {
    const user = await this.getUserFromAuthHeader(authHeader);
    return this.rdManagementService.createProject(createDto);
  }

  @Get('projects')
  async findAllProjects(@Headers('authorization') authHeader: string) {
    const user = await this.getUserFromAuthHeader(authHeader);
    return this.rdManagementService.findAllProjects();
  }

  @Get('projects/:id')
  async findProjectById(
    @Param('id') projectId: string,
    @Headers('authorization') authHeader: string,
  ) {
    const user = await this.getUserFromAuthHeader(authHeader);
    return this.rdManagementService.findProjectById(projectId);
  }

  @Put('projects/:id')
  async updateProject(
    @Param('id') projectId: string,
    @Body() updateDto: UpdateRdProjectDto,
    @Headers('authorization') authHeader: string,
  ) {
    const user = await this.getUserFromAuthHeader(authHeader);
    return this.rdManagementService.updateProject(projectId, updateDto);
  }

  @Delete('projects/:id')
  async deleteProject(
    @Param('id') projectId: string,
    @Headers('authorization') authHeader: string,
  ) {
    const user = await this.getUserFromAuthHeader(authHeader);
    return this.rdManagementService.deleteProject(projectId);
  }

  // ========== OpenCode 集成 ==========

  @Post('tasks/:id/opencode/prompt')
  async sendOpencodePrompt(
    @Param('id') taskId: string,
    @Body() promptDto: SendOpencodePromptDto,
    @Headers('authorization') authHeader: string,
  ) {
    const user = await this.getUserFromAuthHeader(authHeader);
    return this.rdManagementService.sendOpencodePrompt(taskId, promptDto);
  }

  @Post('tasks/:id/opencode/session')
  async createOpencodeSession(
    @Param('id') taskId: string,
    @Body('projectPath') projectPath: string,
    @Headers('authorization') authHeader: string,
  ) {
    const user = await this.getUserFromAuthHeader(authHeader);
    return this.rdManagementService.createOpencodeSession(taskId, projectPath);
  }

  @Get('tasks/:id/opencode/history')
  async getOpencodeHistory(
    @Param('id') taskId: string,
    @Headers('authorization') authHeader: string,
  ) {
    const user = await this.getUserFromAuthHeader(authHeader);
    return this.rdManagementService.getOpencodeSessionHistory(taskId);
  }

  @Get('opencode/current')
  async getCurrentOpencodeContext() {
    return this.rdManagementService.getCurrentOpencodeContext();
  }

  @Get('opencode/projects')
  async getOpencodeProjects(@Headers('authorization') authHeader: string) {
    await this.getUserFromAuthHeader(authHeader);
    return this.rdManagementService.listOpencodeProjects();
  }

  @Post('opencode/projects/import')
  async importOpencodeProject(
    @Body() dto: ImportOpencodeProjectDto,
    @Headers('authorization') authHeader: string,
  ) {
    const user = await this.getUserFromAuthHeader(authHeader);
    return this.rdManagementService.importOpencodeProject(dto);
  }

  @Get('opencode/sessions')
  async getOpencodeSessions(@Headers('authorization') authHeader: string) {
    await this.getUserFromAuthHeader(authHeader);
    return this.rdManagementService.listOpencodeSessions();
  }

  @Get('opencode/sessions/:id')
  async getOpencodeSession(
    @Param('id') sessionId: string,
    @Headers('authorization') authHeader: string,
  ) {
    await this.getUserFromAuthHeader(authHeader);
    return this.rdManagementService.getOpencodeSession(sessionId);
  }

  @Get('opencode/sessions/:id/messages')
  async getOpencodeSessionMessages(
    @Param('id') sessionId: string,
    @Headers('authorization') authHeader: string,
  ) {
    await this.getUserFromAuthHeader(authHeader);
    return this.rdManagementService.getOpencodeSessionMessages(sessionId);
  }

  @Post('opencode/sessions')
  async createOpencodeSessionStandalone(
    @Body() dto: CreateOpencodeSessionDto,
    @Headers('authorization') authHeader: string,
  ) {
    await this.getUserFromAuthHeader(authHeader);
    return this.rdManagementService.createStandaloneOpencodeSession(dto);
  }

  @Post('opencode/sessions/:id/prompt')
  async promptOpencodeSession(
    @Param('id') sessionId: string,
    @Body() dto: PromptOpencodeSessionDto,
    @Headers('authorization') authHeader: string,
  ) {
    await this.getUserFromAuthHeader(authHeader);
    return this.rdManagementService.promptOpencodeSession({
      sessionId,
      prompt: dto.prompt,
      model: dto.model,
    });
  }

  @Sse('opencode/events')
  async streamOpencodeEvents(@Query('token') token: string): Promise<Observable<MessageEvent>> {
    const authHeader = token ? `Bearer ${token}` : '';
    await this.getUserFromAuthHeader(authHeader);

    return new Observable<MessageEvent>((subscriber) => {
      let cleanup: (() => void) | null = null;

      this.rdManagementService
        .subscribeOpencodeEvents({
          onEvent: (event) => {
            subscriber.next({ data: event });
          },
          onError: (error) => {
            subscriber.next({
              data: {
                type: 'error',
                message: error?.message || 'OpenCode event stream error',
              },
            });
          },
          onComplete: () => {
            subscriber.complete();
          },
        })
        .then((fn) => {
          cleanup = fn;
        })
        .catch((error) => {
          subscriber.next({
            data: {
              type: 'error',
              message: error?.message || 'Failed to subscribe OpenCode events',
            },
          });
          subscriber.complete();
        });

      return () => {
        if (cleanup) {
          cleanup();
        }
      };
    });
  }

  @Post('tasks/:id/opencode/sync-current')
  async syncCurrentOpencodeToTask(
    @Param('id') taskId: string,
    @Headers('authorization') authHeader: string,
    @Body() syncDto: SyncOpencodeContextDto,
  ) {
    const user = await this.getUserFromAuthHeader(authHeader);
    return this.rdManagementService.syncOpencodeToTask(taskId, syncDto || {});
  }

  @Post('projects/:id/opencode/sync-current')
  async syncCurrentOpencodeToProject(
    @Param('id') projectId: string,
    @Headers('authorization') authHeader: string,
    @Body() syncDto: SyncOpencodeContextDto,
  ) {
    const user = await this.getUserFromAuthHeader(authHeader);
    return this.rdManagementService.syncOpencodeToProject(projectId, syncDto || {});
  }

  @Post('tasks/:id/complete')
  async completeTask(
    @Param('id') taskId: string,
    @Body('result') result: any,
    @Headers('authorization') authHeader: string,
  ) {
    const user = await this.getUserFromAuthHeader(authHeader);
    return this.rdManagementService.completeTask(taskId, result);
  }
}
