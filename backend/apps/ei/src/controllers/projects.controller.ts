import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Put, Query, UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../../../../src/modules/auth/auth.service';
import {
  BindGithubProjectDto,
  BindIncubationProjectDto,
  BindOpencodeProjectDto,
  CreateLocalRdProjectDto,
  CreateRdProjectDto,
  QueryRdProjectDto,
  SyncOpencodeContextDto,
  UnbindOpencodeProjectDto,
  UpdateRdProjectDto,
} from '../dto';
import { EiProjectsService } from '../services/projects.service';

@Controller('ei/projects')
export class EiProjectsController {
  constructor(
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

  @Post()
  async createProject(@Body() createDto: CreateRdProjectDto, @Headers('authorization') authHeader: string) {
    await this.getUserFromAuthHeader(authHeader);
    return this.projectsService.createProject(createDto);
  }

  @Post('local')
  async createLocalProject(@Body() createDto: CreateLocalRdProjectDto, @Headers('authorization') authHeader: string) {
    await this.getUserFromAuthHeader(authHeader);
    return this.projectsService.createLocalProject(createDto);
  }

  @Get()
  async findAllProjects(
    @Query() query: QueryRdProjectDto,
    @Headers('authorization') authHeader: string,
    @Query('syncedFromAgentId') syncedFromAgentId?: string,
  ) {
    await this.getUserFromAuthHeader(authHeader);
    return this.projectsService.findAllProjects({
      ...query,
      ...(syncedFromAgentId ? { syncedFromAgentId } : {}),
    });
  }

  @Get(':id')
  async findProjectById(@Param('id') projectId: string, @Headers('authorization') authHeader: string) {
    await this.getUserFromAuthHeader(authHeader);
    return this.projectsService.findProjectById(projectId);
  }

  @Put(':id')
  async updateProject(
    @Param('id') projectId: string,
    @Body() updateDto: UpdateRdProjectDto,
    @Headers('authorization') authHeader: string,
  ) {
    await this.getUserFromAuthHeader(authHeader);
    return this.projectsService.updateProject(projectId, updateDto);
  }

  @Delete(':id')
  async deleteProject(@Param('id') projectId: string, @Headers('authorization') authHeader: string) {
    await this.getUserFromAuthHeader(authHeader);
    return this.projectsService.deleteProject(projectId);
  }

  @Post('bind/opencode')
  async bindOpencodeProject(@Body() dto: BindOpencodeProjectDto, @Headers('authorization') authHeader: string) {
    await this.getUserFromAuthHeader(authHeader);
    return this.projectsService.bindOpencodeProject(dto);
  }

  @Post('bind/github')
  async bindGithubProject(@Body() dto: BindGithubProjectDto, @Headers('authorization') authHeader: string) {
    await this.getUserFromAuthHeader(authHeader);
    return this.projectsService.bindGithubProject(dto);
  }

  @Post(':id/unbind/opencode')
  async unbindOpencodeProject(
    @Param('id') localProjectId: string,
    @Body() dto: UnbindOpencodeProjectDto,
    @Headers('authorization') authHeader: string,
  ) {
    await this.getUserFromAuthHeader(authHeader);
    return this.projectsService.unbindOpencodeProject(localProjectId, dto);
  }

  @Post(':id/unbind/github')
  async unbindGithubProject(@Param('id') localProjectId: string, @Headers('authorization') authHeader: string) {
    await this.getUserFromAuthHeader(authHeader);
    return this.projectsService.unbindGithubProject(localProjectId);
  }

  @Patch(':id/incubation-binding')
  async bindIncubationProject(
    @Param('id') localProjectId: string,
    @Body() dto: BindIncubationProjectDto,
    @Headers('authorization') authHeader: string,
  ) {
    await this.getUserFromAuthHeader(authHeader);
    return this.projectsService.bindIncubationProject(localProjectId, dto);
  }

  @Post(':id/opencode/sync-current')
  async syncCurrentOpencodeToProject(
    @Param('id') projectId: string,
    @Headers('authorization') authHeader: string,
    @Body() syncDto: SyncOpencodeContextDto,
  ) {
    await this.getUserFromAuthHeader(authHeader);
    return this.projectsService.syncCurrentOpencodeToProject(projectId, syncDto || {});
  }
}
