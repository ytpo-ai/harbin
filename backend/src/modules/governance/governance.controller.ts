import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { GovernanceService } from './governance.service';

@Controller('governance')
export class GovernanceController {
  constructor(private readonly governanceService: GovernanceService) {}

  @Post('proposals')
  async createProposal(@Body() body: {
    title: string;
    description: string;
    type: 'hire' | 'fire' | 'tool_access' | 'strategy' | 'budget' | 'policy';
    proposerId: string;
    metadata?: any;
  }) {
    return this.governanceService.createProposal(
      body.title,
      body.description,
      body.type,
      body.proposerId,
      body.metadata
    );
  }

  @Get('proposals')
  getAllProposals() {
    return this.governanceService.getAllProposals();
  }

  @Get('proposals/:id')
  getProposal(@Param('id') id: string) {
    return this.governanceService.getProposal(id);
  }

  @Post('proposals/:id/vote')
  async castVote(
    @Param('id') id: string,
    @Body() body: {
      voterId: string;
      decision: 'for' | 'against' | 'abstain';
      reason: string;
    }
  ) {
    return this.governanceService.castVote(
      id,
      body.voterId,
      body.decision,
      body.reason
    );
  }

  @Get('proposals/:id/summary')
  getVotingSummary(@Param('id') id: string) {
    return this.governanceService.getVotingSummary(id);
  }

  @Post('check-expired')
  async checkExpiredProposals() {
    return this.governanceService.checkExpiredProposals();
  }
}