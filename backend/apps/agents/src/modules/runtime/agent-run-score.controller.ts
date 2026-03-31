import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { AgentRunScoreService } from './agent-run-score.service';

@Controller('agents/runtime')
export class AgentRunScoreController {
  constructor(private readonly runScoreService: AgentRunScoreService) {}

  @Get('runs/:runId/score')
  async getRunScore(@Param('runId') runId: string) {
    const score = await this.runScoreService.getScoreByRunId(runId);
    if (!score) {
      throw new NotFoundException('Runtime run score not found');
    }
    return {
      success: true,
      runId,
      score,
    };
  }

  @Get('scores/stats')
  async getScoreStats(
    @Query('agentId') agentId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('topN') topN?: string,
  ) {
    const stats = await this.runScoreService.getAgentScoreStats(agentId?.trim() || undefined, {
      from: this.toDateOrUndefined(from),
      to: this.toDateOrUndefined(to),
      topN: this.toPositiveNumberOrUndefined(topN),
    });

    return {
      success: true,
      agentId: agentId?.trim() || undefined,
      from: this.toDateOrUndefined(from),
      to: this.toDateOrUndefined(to),
      stats,
    };
  }

  @Get('scores')
  async listScores(
    @Query('agentId') agentId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('minScore') minScore?: string,
    @Query('maxScore') maxScore?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const result = await this.runScoreService.getScoresByAgent(agentId?.trim() || undefined, {
      from: this.toDateOrUndefined(from),
      to: this.toDateOrUndefined(to),
      minScore: this.toNumberOrUndefined(minScore),
      maxScore: this.toNumberOrUndefined(maxScore),
      page: this.toPositiveNumberOrUndefined(page),
      pageSize: this.toPositiveNumberOrUndefined(pageSize),
    });

    return {
      success: true,
      agentId: agentId?.trim() || undefined,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      totalPages: Math.max(1, Math.ceil(result.total / result.pageSize)),
      items: result.items,
    };
  }

  private toDateOrUndefined(value?: string): Date | undefined {
    const normalized = String(value || '').trim();
    if (!normalized) {
      return undefined;
    }
    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) {
      return undefined;
    }
    return parsed;
  }

  private toNumberOrUndefined(value?: string): number | undefined {
    const normalized = String(value || '').trim();
    if (!normalized) {
      return undefined;
    }
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) {
      return undefined;
    }
    return parsed;
  }

  private toPositiveNumberOrUndefined(value?: string): number | undefined {
    const parsed = this.toNumberOrUndefined(value);
    if (typeof parsed !== 'number' || parsed <= 0) {
      return undefined;
    }
    return Math.floor(parsed);
  }
}
