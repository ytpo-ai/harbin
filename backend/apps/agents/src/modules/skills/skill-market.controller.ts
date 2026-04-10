import { Body, Controller, Delete, Get, Header, MessageEvent, Param, Post, Put, Query, Sse } from '@nestjs/common';
import { Observable } from 'rxjs';
import { SkillMarketService } from './skill-market.service';
import { SkillGithubRepoStatus } from '@agent/schemas/skill-github-repo.schema';
import { SkillMarketPlatformStatus } from '@agent/schemas/skill-market-platform.schema';

@Controller('skills/market')
export class SkillMarketController {
  constructor(private readonly skillMarketService: SkillMarketService) {}

  @Get('platforms')
  async listPlatforms() {
    return this.skillMarketService.listPlatforms();
  }

  @Post('platforms')
  async createPlatform(
    @Body()
    body: {
      name: string;
      url: string;
      priority?: number;
      status?: SkillMarketPlatformStatus;
      description?: string;
    },
  ) {
    return this.skillMarketService.createPlatform(body);
  }

  @Put('platforms/:id')
  async updatePlatform(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      priority?: number;
      status?: SkillMarketPlatformStatus;
      description?: string;
    },
  ) {
    return this.skillMarketService.updatePlatform(id, body);
  }

  @Delete('platforms/:id')
  async deletePlatform(@Param('id') id: string) {
    return this.skillMarketService.deletePlatform(id);
  }

  @Post('platforms/:id/index')
  async startIndexPlatform(@Param('id') id: string) {
    return this.skillMarketService.startIndexPlatform(id);
  }

  @Sse('index-tasks/:taskId/events')
  @Header('Cache-Control', 'no-cache, no-transform')
  @Header('Connection', 'keep-alive')
  @Header('X-Accel-Buffering', 'no')
  streamIndexTaskEvents(
    @Param('taskId') taskId: string,
  ): Observable<MessageEvent> {
    return this.skillMarketService.subscribeIndexTask(taskId);
  }

  @Get('index-tasks/:taskId')
  async getIndexTaskState(@Param('taskId') taskId: string) {
    const state = this.skillMarketService.getIndexTaskState(taskId);
    if (!state) {
      return { found: false };
    }
    return state;
  }

  @Get('repos')
  async listRepos(
    @Query('platformId') platformId?: string,
    @Query('status') status?: SkillGithubRepoStatus,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.skillMarketService.listRepos({
      platformId,
      status,
      search,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Put('repos/:id/skip')
  async skipRepo(@Param('id') id: string) {
    return this.skillMarketService.skipRepo(id);
  }

  @Post('repos/:id/import')
  async importRepo(@Param('id') id: string) {
    return this.skillMarketService.importRepo(id);
  }

  @Post('search')
  async searchMarket(
    @Body()
    body: {
      keyword: string;
      platformId?: string;
      page?: number;
      pageSize?: number;
    },
  ) {
    return this.skillMarketService.searchMarket(body);
  }
}
