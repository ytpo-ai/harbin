import api from './api';
import { Proposal } from '../types';

export const governanceService = {
  // 创建提案
  async createProposal(
    title: string,
    description: string,
    type: Proposal['type'],
    proposerId: string,
    metadata?: any
  ): Promise<Proposal> {
    const response = await api.post('/governance/proposals', {
      title,
      description,
      type,
      proposerId,
      metadata
    });
    return response.data;
  },

  // 获取所有提案
  async getAllProposals(): Promise<Proposal[]> {
    const response = await api.get('/governance/proposals');
    return response.data;
  },

  // 获取单个提案
  async getProposal(proposalId: string): Promise<Proposal | null> {
    const response = await api.get(`/governance/proposals/${proposalId}`);
    return response.data;
  },

  // 投票
  async castVote(
    proposalId: string,
    voterId: string,
    decision: 'for' | 'against' | 'abstain',
    reason: string
  ): Promise<any> {
    const response = await api.post(`/governance/proposals/${proposalId}/vote`, {
      voterId,
      decision,
      reason
    });
    return response.data;
  },

  // 获取投票汇总
  async getVotingSummary(proposalId: string): Promise<any> {
    const response = await api.get(`/governance/proposals/${proposalId}/summary`);
    return response.data;
  },

  // 检查过期提案
  async checkExpiredProposals(): Promise<any> {
    const response = await api.post('/governance/check-expired');
    return response.data;
  }
};