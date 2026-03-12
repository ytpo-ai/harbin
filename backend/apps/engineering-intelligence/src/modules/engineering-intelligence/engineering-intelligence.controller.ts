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
import { CreateEngineeringRepositoryDto, UpdateEngineeringRepositoryDto } from './dto';

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
}
