import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { SkillService } from './skill.service';
import { SkillSourceType, SkillStatus } from '../../schemas/skill.schema';
import { SkillSuggestionStatus } from '../../schemas/skill-suggestion.schema';

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
  ) {
    const numericPage = page ? Number(page) : undefined;
    const numericPageSize = pageSize ? Number(pageSize) : undefined;
    const shouldUsePaged = Boolean(search?.trim()) || Number.isFinite(numericPage) || Number.isFinite(numericPageSize);

    if (shouldUsePaged) {
      return this.skillService.getSkillsPaged({
        status,
        category,
        search,
        page: numericPage,
        pageSize: numericPageSize,
      });
    }

    return this.skillService.getAllSkills({ status, category, search });
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
    },
  ) {
    return this.skillService.createSkill(body);
  }

  @Get('agents/:agentId')
  async getAgentSkills(@Param('agentId') agentId: string) {
    return this.skillService.getAgentSkills(agentId);
  }

  @Post('assign')
  async assignSkillToAgent(
    @Body()
    body: {
      agentId: string;
      skillId: string;
      proficiencyLevel?: 'beginner' | 'intermediate' | 'advanced' | 'expert';
      assignedBy?: string;
      enabled?: boolean;
      note?: string;
    },
  ) {
    return this.skillService.assignSkillToAgent(body.agentId, body.skillId, {
      proficiencyLevel: body.proficiencyLevel,
      assignedBy: body.assignedBy,
      enabled: body.enabled,
      note: body.note,
    });
  }

  @Post('manager/discover')
  async discoverByAgentSkillManager(
    @Body() body: { query: string; maxResults?: number; sourceType?: SkillSourceType; dryRun?: boolean },
  ) {
    return this.skillService.discoverSkillsFromInternet(body);
  }

  @Post('manager/suggest/:agentId')
  async suggestByAgentSkillManager(
    @Param('agentId') agentId: string,
    @Body() body?: { contextTags?: string[]; topK?: number; persist?: boolean },
  ) {
    return this.skillService.suggestSkillsForAgent({
      agentId,
      contextTags: body?.contextTags || [],
      topK: body?.topK,
      persist: body?.persist,
    });
  }

  @Get('suggestions/agents/:agentId')
  async getSuggestionsForAgent(@Param('agentId') agentId: string, @Query('status') status?: SkillSuggestionStatus) {
    return this.skillService.getSuggestionsForAgent(agentId, status);
  }

  @Put('suggestions/:id')
  async reviewSuggestion(
    @Param('id') id: string,
    @Body() body: { status: SkillSuggestionStatus; note?: string },
  ) {
    return this.skillService.reviewSuggestion(id, body);
  }

  @Post('docs/rebuild')
  async rebuildDocs() {
    return this.skillService.rebuildSkillDocs();
  }

  @Get(':id')
  async getSkill(@Param('id') id: string) {
    return this.skillService.getSkillById(id);
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
