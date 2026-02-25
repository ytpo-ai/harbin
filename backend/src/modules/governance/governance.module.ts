import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Proposal, ProposalSchema } from '../../shared/schemas/proposal.schema';
import { GovernanceService } from './governance.service';
import { GovernanceController } from './governance.controller';
import { OrganizationModule } from '../organization/organization.module';
import { AgentModule } from '../agents/agent.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Proposal.name, schema: ProposalSchema }]),
    OrganizationModule,
    AgentModule
  ],
  controllers: [GovernanceController],
  providers: [GovernanceService],
  exports: [GovernanceService],
})
export class GovernanceModule {}