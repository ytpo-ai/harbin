import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Proposal, ProposalDocument } from '../../shared/schemas/proposal.schema';
import { OrganizationService } from '../organization/organization.service';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class GovernanceService {
  private readonly logger = new Logger(GovernanceService.name);

  constructor(
    @InjectModel(Proposal.name) private proposalModel: Model<ProposalDocument>,
    private readonly organizationService: OrganizationService,
  ) {}

  async createProposal(
    title: string,
    description: string,
    type: Proposal['type'],
    proposerId: string,
    metadata?: any
  ): Promise<Proposal> {
    const organization = await this.organizationService.getOrganization();
    if (!organization) {
      throw new Error('Organization not found');
    }

    // 计算投票截止时间
    const deadline = new Date();
    deadline.setHours(deadline.getHours() + organization.settings.votingRules.votingPeriod);

    const proposal: Proposal = {
      id: uuidv4(),
      title,
      description,
      type,
      proposerId,
      status: 'proposed',
      votes: [],
      deadline,
      createdAt: new Date(),
      metadata
    };

    const newProposal = new this.proposalModel(proposal);
    return newProposal.save();
  }

  async getAllProposals(): Promise<Proposal[]> {
    return this.proposalModel.find().sort({ createdAt: -1 }).exec();
  }

  async getProposal(proposalId: string): Promise<Proposal | null> {
    return this.proposalModel.findOne({ id: proposalId }).exec();
  }

  async castVote(
    proposalId: string,
    voterId: string,
    decision: 'for' | 'against' | 'abstain',
    reason: string
  ): Promise<any> {
    const proposal = await this.getProposal(proposalId);
    if (!proposal) {
      throw new Error(`Proposal not found: ${proposalId}`);
    }

    if (proposal.status !== 'proposed' && proposal.status !== 'voting') {
      throw new Error(`Proposal ${proposalId} is not in voting status`);
    }

    if (new Date() > proposal.deadline) {
      throw new Error('Voting deadline has passed');
    }

    // 检查是否已经投过票
    const existingVote = proposal.votes.find(v => v.voterId === voterId);
    if (existingVote) {
      throw new Error(`${voterId} has already voted on this proposal`);
    }

    // 获取投票者的股份数量
    const shares = await this.getVoterShares(voterId);
    if (shares === 0) {
      throw new Error(`${voterId} has no voting rights`);
    }

    // 添加投票
    const vote = {
      voterId,
      shares,
      decision,
      reason,
      timestamp: new Date()
    };

    proposal.votes.push(vote);

    // 如果这是第一票，将状态改为voting
    if (proposal.votes.length === 1) {
      proposal.status = 'voting';
    }

    await this.proposalModel.findOneAndUpdate(
      { id: proposalId },
      { 
        votes: proposal.votes,
        status: proposal.status 
      },
      { new: true }
    ).exec();

    this.logger.log(`${voterId} voted ${decision} on proposal ${proposalId}`);

    // 检查是否可以提前结束投票
    const result = await this.checkVotingResult(proposal);
    if (result) {
      return {
        vote,
        proposal: result.proposal,
        votingComplete: true,
        result: result.result
      };
    }

    return { vote, votingComplete: false };
  }

  private async getVoterShares(voterId: string): Promise<number> {
    const organization = await this.organizationService.getOrganization();
    if (!organization) {
      return 0;
    }

    // 如果是人类创始人
    if (voterId === organization.shareDistribution.founder.userId) {
      return organization.shareDistribution.founder.shares;
    }

    // 如果是联合创始Agent
    const cofounder = organization.shareDistribution.cofounders.find(cf => cf.agentId === voterId);
    if (cofounder) {
      return cofounder.shares;
    }

    // 如果是普通员工
    const employee = organization.employees.find(e => e.agentId === voterId);
    if (employee && employee.status === 'active') {
      return employee.totalShares;
    }

    return 0;
  }

  private async checkVotingResult(proposal: Proposal): Promise<any> {
    const organization = await this.organizationService.getOrganization();
    if (!organization) {
      return null;
    }

    const totalShares = organization.totalShares;
    const requiredQuorum = (totalShares * organization.settings.votingRules.requiredQuorum) / 100;
    const requiredApproval = (totalShares * organization.settings.votingRules.requiredApproval) / 100;

    // 统计投票
    const forShares = proposal.votes.filter(v => v.decision === 'for').reduce((sum, v) => sum + v.shares, 0);
    const againstShares = proposal.votes.filter(v => v.decision === 'against').reduce((sum, v) => sum + v.shares, 0);
    const abstainShares = proposal.votes.filter(v => v.decision === 'abstain').reduce((sum, v) => sum + v.shares, 0);
    const totalVotes = forShares + againstShares + abstainShares;

    // 检查是否达到法定人数
    if (totalVotes >= requiredQuorum) {
      // 检查是否通过
      if (forShares >= requiredApproval) {
        proposal.status = 'approved';
        await this.proposalModel.findOneAndUpdate(
          { id: proposal.id },
          { status: 'approved' },
          { new: true }
        ).exec();

        // 执行提案
        await this.executeProposal(proposal);

        return {
          proposal: await this.getProposal(proposal.id),
          result: 'approved',
          reason: `通过了 ${forShares} 票赞成，${againstShares} 票反对，${abstainShares} 票弃权`
        };
      } else {
        proposal.status = 'rejected';
        await this.proposalModel.findOneAndUpdate(
          { id: proposal.id },
          { status: 'rejected' },
          { new: true }
        ).exec();

        return {
          proposal: await this.getProposal(proposal.id),
          result: 'rejected',
          reason: `未通过 ${forShares} 票赞成，${againstShares} 票反对，${abstainShares} 票弃权`
        };
      }
    }

    return null;
  }

  private async executeProposal(proposal: Proposal): Promise<void> {
    this.logger.log(`执行提案: ${proposal.title}`);

    switch (proposal.type) {
      case 'hire':
        await this.executeHireProposal(proposal);
        break;
      case 'fire':
        await this.executeFireProposal(proposal);
        break;
      case 'tool_access':
        await this.executeToolAccessProposal(proposal);
        break;
      case 'strategy':
        await this.executeStrategyProposal(proposal);
        break;
      case 'budget':
        await this.executeBudgetProposal(proposal);
        break;
      case 'policy':
        await this.executePolicyProposal(proposal);
        break;
    }

    // 将状态更新为implemented
    await this.proposalModel.findOneAndUpdate(
      { id: proposal.id },
      { status: 'implemented' },
      { new: true }
    ).exec();
  }

  private async executeHireProposal(proposal: Proposal): Promise<void> {
    if (proposal.metadata?.agentId && proposal.metadata?.roleId) {
      await this.organizationService.hireAgent(
        proposal.metadata.agentId,
        proposal.metadata.roleId,
        proposal.proposerId
      );
    }
  }

  private async executeFireProposal(proposal: Proposal): Promise<void> {
    if (proposal.metadata?.agentId) {
      await this.organizationService.fireAgent(
        proposal.metadata.agentId,
        proposal.metadata?.reason || 'Performance issues'
      );
    }
  }

  private async executeToolAccessProposal(proposal: Proposal): Promise<void> {
    // 这里可以实现工具访问权限的更新
    this.logger.log(`Tool access proposal executed: ${proposal.metadata}`);
  }

  private async executeStrategyProposal(proposal: Proposal): Promise<void> {
    // 这里可以实现战略决策的执行
    this.logger.log(`Strategy proposal executed: ${proposal.metadata}`);
  }

  private async executeBudgetProposal(proposal: Proposal): Promise<void> {
    // 这里可以实现预算调整的执行
    this.logger.log(`Budget proposal executed: ${proposal.metadata}`);
  }

  private async executePolicyProposal(proposal: Proposal): Promise<void> {
    // 这里可以实现政策变更的执行
    this.logger.log(`Policy proposal executed: ${proposal.metadata}`);
  }

  async getVotingSummary(proposalId: string): Promise<any> {
    const proposal = await this.getProposal(proposalId);
    if (!proposal) {
      throw new Error(`Proposal not found: ${proposalId}`);
    }

    const organization = await this.organizationService.getOrganization();
    if (!organization) {
      throw new Error('Organization not found');
    }

    const totalShares = organization.totalShares;
    const requiredQuorum = (totalShares * organization.settings.votingRules.requiredQuorum) / 100;
    const requiredApproval = (totalShares * organization.settings.votingRules.requiredApproval) / 100;

    const forShares = proposal.votes.filter(v => v.decision === 'for').reduce((sum, v) => sum + v.shares, 0);
    const againstShares = proposal.votes.filter(v => v.decision === 'against').reduce((sum, v) => sum + v.shares, 0);
    const abstainShares = proposal.votes.filter(v => v.decision === 'abstain').reduce((sum, v) => sum + v.shares, 0);
    const totalVotes = forShares + againstShares + abstainShares;

    return {
      proposalId: proposal.id,
      title: proposal.title,
      status: proposal.status,
      deadline: proposal.deadline,
      votingProgress: {
        totalShares,
        requiredQuorum,
        requiredApproval,
        forVotes: forShares,
        againstVotes: againstShares,
        abstainVotes: abstainShares,
        totalVotes,
        quorumReached: totalVotes >= requiredQuorum,
        approvalReached: forShares >= requiredApproval,
        forPercentage: totalVotes > 0 ? Math.round((forShares / totalVotes) * 100 * 100) / 100 : 0,
        againstPercentage: totalVotes > 0 ? Math.round((againstShares / totalVotes) * 100 * 100) / 100 : 0,
        abstainPercentage: totalVotes > 0 ? Math.round((abstainShares / totalVotes) * 100 * 100) / 100 : 0
      },
      votes: proposal.votes.map(v => ({
        voterId: v.voterId,
        decision: v.decision,
        shares: v.shares,
        sharePercentage: Math.round((v.shares / totalShares) * 100 * 100) / 100,
        reason: v.reason,
        timestamp: v.timestamp
      })),
      timeRemaining: Math.max(0, proposal.deadline.getTime() - new Date().getTime())
    };
  }

  async checkExpiredProposals(): Promise<any> {
    const expiredProposals = await this.proposalModel.find({
      status: { $in: ['proposed', 'voting'] },
      deadline: { $lt: new Date() }
    }).exec();

    const results = [];
    for (const proposal of expiredProposals) {
      const result = await this.checkVotingResult(proposal);
      if (result) {
        results.push(result);
      }
    }

    return {
      expiredProcessed: expiredProposals.length,
      results
    };
  }
}
