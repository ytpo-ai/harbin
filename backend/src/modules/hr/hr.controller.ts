import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { HRService } from './hr.service';

@Controller('hr')
export class HRController {
  constructor(private readonly hrService: HRService) {}

  @Get('performance/:agentId')
  generatePerformanceReport(@Param('agentId') agentId: string) {
    return this.hrService.generatePerformanceReport(agentId);
  }

  @Get('low-performers')
  identifyLowPerformers() {
    return this.hrService.identifyLowPerformers();
  }

  @Get('hiring-recommendations')
  recommendHiring() {
    return this.hrService.recommendHiring();
  }

  @Get('team-health')
  calculateTeamHealth() {
    return this.hrService.calculateTeamHealth();
  }

  @Post('batch-evaluation')
  async batchEvaluation(@Body() body: { agentIds: string[] }) {
    const reports = await Promise.all(
      body.agentIds.map(agentId => this.hrService.generatePerformanceReport(agentId))
    );
    return {
      totalEvaluated: reports.length,
      reports,
      summary: {
        avgScore: reports.reduce((sum, r) => sum + r.overallScore, 0) / reports.length,
        highPerformers: reports.filter(r => r.overallScore >= 85).length,
        averagePerformers: reports.filter(r => r.overallScore >= 65 && r.overallScore < 85).length,
        lowPerformers: reports.filter(r => r.overallScore < 65).length
      }
    };
  }
}
