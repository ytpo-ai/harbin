import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { SkillMarketService } from './skill-market.service';
import { SkillGithubRepoStatus } from '@agent/schemas/skill-github-repo.schema';
import { SkillMarketPlatformStatus } from '@agent/schemas/skill-market-platform.schema';

@Controller('skills/market')
export class SkillMarketController {
  constructor(private readonly skillMarketService: SkillMarketService) {}

  // ── Platform CRUD ─────────────────────────────────────────────

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

  // ── Repo CRUD ─────────────────────────────────────────────────

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

  @Post('repos')
  async addRepo(
    @Body() body: { repoUrl: string; platformId?: string },
  ) {
    return this.skillMarketService.addRepoManually(body.repoUrl, body.platformId);
  }

  @Put('repos/:id/skip')
  async skipRepo(@Param('id') id: string) {
    return this.skillMarketService.skipRepo(id);
  }

  @Post('repos/:id/import')
  async importRepo(@Param('id') id: string, @Query('force') force?: string) {
    return this.skillMarketService.importRepo(id, { force: force === 'true' || force === '1' });
  }
}
