import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { SkillMarketService } from './skill-market.service';
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
}
