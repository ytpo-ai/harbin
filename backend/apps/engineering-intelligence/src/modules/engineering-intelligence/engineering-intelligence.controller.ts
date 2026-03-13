import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { EngineeringIntelligenceService } from './engineering-intelligence.service';
import {
  AddRequirementCommentDto,
  AssignRequirementDto,
  CreateEngineeringRepositoryDto,
  CreateRequirementDto,
  CreateStatisticsSnapshotDto,
  ListRequirementsDto,
  SyncRequirementToGithubDto,
  UpdateEngineeringRepositoryDto,
  UpdateRequirementStatusDto,
} from './dto';

@Controller('engineering-intelligence')
export class EngineeringIntelligenceController {
  constructor(private readonly engineeringIntelligenceService: EngineeringIntelligenceService) {}

  @Post('repositories')
  async createRepository(@Body() dto: CreateEngineeringRepositoryDto) {
    return this.engineeringIntelligenceService.createRepository(dto);
  }

  @Get('repositories')
  async listRepositories() {
    return this.engineeringIntelligenceService.listRepositories();
  }

  @Put('repositories/:id')
  async updateRepository(
    @Param('id') id: string,
    @Body() dto: UpdateEngineeringRepositoryDto,
  ) {
    return this.engineeringIntelligenceService.updateRepository(id, dto);
  }

  @Delete('repositories/:id')
  async deleteRepository(@Param('id') id: string) {
    return this.engineeringIntelligenceService.deleteRepository(id);
  }

  @Post('repositories/:id/summarize')
  async summarizeRepository(@Param('id') id: string) {
    return this.engineeringIntelligenceService.summarizeRepository(id);
  }

  @Get('repositories/:id/docs/tree')
  async getDocsTree(@Param('id') id: string) {
    return this.engineeringIntelligenceService.getRepositoryDocsTree(id);
  }

  @Get('repositories/:id/docs/content')
  async getDocContent(
    @Param('id') id: string,
    @Query('path') path: string,
  ) {
    if (!path) {
      throw new BadRequestException('path is required');
    }
    return this.engineeringIntelligenceService.getRepositoryDocContent(id, path);
  }

  @Get('repositories/:id/docs/history')
  async getDocHistory(
    @Param('id') id: string,
    @Query('path') path: string,
    @Query('limit') limit: string,
  ) {
    if (!path) {
      throw new BadRequestException('path is required');
    }
    return this.engineeringIntelligenceService.getRepositoryDocHistory(
      id,
      path,
      limit ? Number(limit) : undefined,
    );
  }

  @Post('opencode/runs/sync')
  async syncOpenCodeRun(@Body() payload: unknown) {
    return this.engineeringIntelligenceService.syncOpenCodeRun(payload);
  }

  @Post('opencode/ingest/events')
  async ingestOpenCodeEvents(
    @Body() payload: unknown,
    @Headers('x-ei-node-signature') signature?: string,
    @Headers('x-ei-node-timestamp') timestamp?: string,
  ) {
    return this.engineeringIntelligenceService.ingestOpenCodeEvents({
      payload,
      signature,
      timestamp,
    });
  }

  @Post('statistics/snapshots')
  async createStatisticsSnapshot(@Body() payload: CreateStatisticsSnapshotDto) {
    return this.engineeringIntelligenceService.createStatisticsSnapshot(payload || {});
  }

  @Get('statistics/snapshots/latest')
  async getLatestStatisticsSnapshot() {
    return this.engineeringIntelligenceService.getLatestStatisticsSnapshot();
  }

  @Get('statistics/snapshots/:snapshotId')
  async getStatisticsSnapshotById(@Param('snapshotId') snapshotId: string) {
    return this.engineeringIntelligenceService.getStatisticsSnapshotById(snapshotId);
  }

  @Get('statistics/snapshots')
  async listStatisticsSnapshots(@Query('limit') limit?: string) {
    return this.engineeringIntelligenceService.listStatisticsSnapshots(limit ? Number(limit) : 20);
  }

  @Post('requirements')
  async createRequirement(@Body() payload: CreateRequirementDto) {
    return this.engineeringIntelligenceService.createRequirement(payload);
  }

  @Get('requirements')
  async listRequirements(@Query() query: ListRequirementsDto) {
    return this.engineeringIntelligenceService.listRequirements(query);
  }

  @Get('requirements/board')
  async getRequirementBoard() {
    return this.engineeringIntelligenceService.getRequirementBoard();
  }

  @Get('requirements/:requirementId')
  async getRequirementById(@Param('requirementId') requirementId: string) {
    return this.engineeringIntelligenceService.getRequirementById(requirementId);
  }

  @Post('requirements/:requirementId/comments')
  async addRequirementComment(
    @Param('requirementId') requirementId: string,
    @Body() payload: AddRequirementCommentDto,
  ) {
    return this.engineeringIntelligenceService.addRequirementComment(requirementId, payload);
  }

  @Post('requirements/:requirementId/assign')
  async assignRequirement(
    @Param('requirementId') requirementId: string,
    @Body() payload: AssignRequirementDto,
  ) {
    return this.engineeringIntelligenceService.assignRequirement(requirementId, payload);
  }

  @Post('requirements/:requirementId/status')
  async updateRequirementStatus(
    @Param('requirementId') requirementId: string,
    @Body() payload: UpdateRequirementStatusDto,
  ) {
    return this.engineeringIntelligenceService.updateRequirementStatus(requirementId, payload);
  }

  @Post('requirements/:requirementId/github/sync')
  async syncRequirementToGithub(
    @Param('requirementId') requirementId: string,
    @Body() payload: SyncRequirementToGithubDto,
  ) {
    return this.engineeringIntelligenceService.syncRequirementToGithub(requirementId, payload);
  }
}
