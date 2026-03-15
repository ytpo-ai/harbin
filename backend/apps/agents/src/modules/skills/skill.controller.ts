import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { SkillService } from './skill.service';
import { SkillSourceType, SkillStatus } from '../../schemas/agent-skill.schema';

@Controller('skills')
export class SkillController {
  constructor(private readonly skillService: SkillService) {}

  @Get()
  async getSkills(
    @Query('status') status?: SkillStatus,
    @Query('category') category?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('includeContent') includeContent?: string,
    @Query('includeMetadata') includeMetadata?: string,
  ) {
    const numericPage = page ? Number(page) : undefined;
    const numericPageSize = pageSize ? Number(pageSize) : undefined;
    const shouldUsePaged = Boolean(search?.trim()) || Number.isFinite(numericPage) || Number.isFinite(numericPageSize);
    const shouldIncludeContent = includeContent === 'true' || includeContent === '1';
    const shouldIncludeMetadata = includeMetadata === 'true' || includeMetadata === '1';

    if (shouldUsePaged) {
      return this.skillService.getSkillsPaged({
        status,
        category,
        search,
        page: numericPage,
        pageSize: numericPageSize,
      }, {
        includeContent: shouldIncludeContent,
        includeMetadata: shouldIncludeMetadata,
      });
    }

    return this.skillService.getAllSkills(
      { status, category, search },
      { includeContent: shouldIncludeContent, includeMetadata: shouldIncludeMetadata },
    );
  }

  @Post()
  async createSkill(
    @Body()
    body: {
      name: string;
      slug?: string;
      description: string;
      category?: string;
      tags?: string[];
      sourceType?: SkillSourceType;
      sourceUrl?: string;
      provider?: string;
      version?: string;
      status?: SkillStatus;
      confidenceScore?: number;
      discoveredBy?: string;
      metadata?: Record<string, any>;
      content?: string;
      contentType?: string;
    },
  ) {
    return this.skillService.createSkill(body);
  }

  @Get(':id/content')
  async getSkillContent(@Param('id') id: string) {
    return this.skillService.getSkillContentById(id);
  }

  @Get('agents/:agentId')
  async getAgentSkills(@Param('agentId') agentId: string) {
    return this.skillService.getAgentSkills(agentId);
  }

  @Get('skills/:skillId/agents')
  async getSkillAgents(@Param('skillId') skillId: string) {
    return this.skillService.getSkillAgents(skillId);
  }

  @Get('all-skill-agents')
  async getAllSkillAgents() {
    return this.skillService.getAllSkillAgents();
  }

  @Post('assign')
  async assignSkillToAgent(
    @Body()
    body: {
      agentId: string;
      skillId: string;
      enabled?: boolean;
    },
  ) {
    return this.skillService.assignSkillToAgent(body.agentId, body.skillId, {
      enabled: body.enabled,
    });
  }

  @Post('manager/discover')
  async discoverByAgentSkillManager(
    @Body() body: { query: string; maxResults?: number; sourceType?: SkillSourceType; dryRun?: boolean },
  ) {
    return this.skillService.discoverSkillsFromInternet(body);
  }

  @Post('docs/rebuild')
  async rebuildDocs() {
    return this.skillService.rebuildSkillDocs();
  }

  @Get(':id')
  async getSkill(@Param('id') id: string, @Query('includeContent') includeContent?: string) {
    const shouldIncludeContent = includeContent === 'true' || includeContent === '1';
    return this.skillService.getSkillById(id, { includeContent: shouldIncludeContent });
  }

  @Put(':id')
  async updateSkill(@Param('id') id: string, @Body() updates: Record<string, any>) {
    return this.skillService.updateSkill(id, updates);
  }

  @Delete(':id')
  async deleteSkill(@Param('id') id: string) {
    return this.skillService.deleteSkill(id);
  }
}
