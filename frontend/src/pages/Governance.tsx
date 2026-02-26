import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { governanceService } from '../services/governanceService';
import { organizationService } from '../services/organizationService';
import { 
  ScaleIcon, 
  ClockIcon, 
  CheckCircleIcon,
  XCircleIcon,
  PlusIcon,
  ChatBubbleLeftRightIcon
} from '@heroicons/react/24/outline';

const Governance: React.FC = () => {
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedProposal, setSelectedProposal] = useState<any>(null);
  const [votingModalOpen, setVotingModalOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: proposals, isLoading } = useQuery('proposals', governanceService.getAllProposals);
  const { data: organization } = useQuery('organization', organizationService.getOrganization);

  const createProposalMutation = useMutation(governanceService.createProposal, {
    onSuccess: () => {
      queryClient.invalidateQueries('proposals');
      setIsCreateModalOpen(false);
    },
  });

  const castVoteMutation = useMutation(governanceService.castVote, {
    onSuccess: () => {
      queryClient.invalidateQueries('proposals');
      setVotingModalOpen(false);
      setSelectedProposal(null);
    },
  });

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'proposed':
        return <ClockIcon className="h-5 w-5 text-yellow-500" />;
      case 'voting':
        return <ChatBubbleLeftRightIcon className="h-5 w-5 text-blue-500" />;
      case 'approved':
        return <CheckCircleIcon className="h-5 w-5 text-green-500" />;
      case 'rejected':
        return <XCircleIcon className="h-5 w-5 text-red-500" />;
      case 'implemented':
        return <CheckCircleIcon className="h-5 w-5 text-green-600" />;
      default:
        return <ClockIcon className="h-5 w-5 text-gray-500" />;
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'hire': return 'bg-green-100 text-green-800';
      case 'fire': return 'bg-red-100 text-red-800';
      case 'tool_access': return 'bg-blue-100 text-blue-800';
      case 'strategy': return 'bg-purple-100 text-purple-800';
      case 'budget': return 'bg-yellow-100 text-yellow-800';
      case 'policy': return 'bg-gray-100 text-gray-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getTypeText = (type: string) => {
    switch (type) {
      case 'hire': return '招聘';
      case 'fire': return '解雇';
      case 'tool_access': return '工具权限';
      case 'strategy': return '战略';
      case 'budget': return '预算';
      case 'policy': return '政策';
      default: return '其他';
    }
  };

  const handleCreateProposal = (proposalData: any) => {
    createProposalMutation.mutate(proposalData);
  };

  const handleCastVote = (proposalId: string, decision: 'for' | 'against' | 'abstain', reason: string) => {
    // 这里应该使用当前用户的ID，现在临时使用创始人ID
    const voterId = organization?.shareDistribution.founder.userId || 'human-founder';
    castVoteMutation.mutate({
      proposalId,
      voterId,
      decision,
      reason
    });
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">公司治理</h1>
          <p className="mt-1 text-sm text-gray-500">管理公司决策和投票系统</p>
        </div>
        <button
          onClick={() => setIsCreateModalOpen(true)}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
        >
          <PlusIcon className="h-4 w-4 mr-2" />
          创建提案
        </button>
      </div>

      {/* 股权分布和投票权说明 */}
      {organization && (
        <div className="bg-white shadow rounded-lg p-6">
          <div className="flex items-center mb-4">
            <ScaleIcon className="h-6 w-6 text-primary-600 mr-2" />
            <h2 className="text-lg font-semibold text-gray-900">投票权分布</h2>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 bg-gray-50 rounded">
              <div className="flex items-center">
                <div className="w-3 h-3 bg-primary-600 rounded-full mr-3"></div>
                <span className="font-medium">创始人 (你)</span>
              </div>
              <div className="text-right">
                <span className="font-semibold">{organization.shareDistribution.founder.percentage}%</span>
                <span className="text-sm text-gray-500 ml-2">
                  ({organization.shareDistribution.founder.shares.toLocaleString()} 股)
                </span>
              </div>
            </div>
            
            {organization.shareDistribution.cofounders.map((cofounder, index) => (
              <div key={cofounder.agentId} className="flex items-center justify-between p-3 bg-gray-50 rounded">
                <div className="flex items-center">
                  <div className="w-3 h-3 bg-blue-600 rounded-full mr-3"></div>
                  <span className="font-medium">联合创始人 {index + 1}</span>
                </div>
                <div className="text-right">
                  <span className="font-semibold">{cofounder.percentage}%</span>
                  <span className="text-sm text-gray-500 ml-2">
                    ({cofounder.shares.toLocaleString()} 股)
                  </span>
                </div>
              </div>
            ))}

            <div className="flex items-center justify-between p-3 bg-gray-50 rounded">
              <div className="flex items-center">
                <div className="w-3 h-3 bg-green-600 rounded-full mr-3"></div>
                <span className="font-medium">员工期权池</span>
              </div>
              <div className="text-right">
                <span className="font-semibold">{organization.shareDistribution.employeePool.percentage}%</span>
                <span className="text-sm text-gray-500 ml-2">
                  ({organization.shareDistribution.employeePool.availableShares.toLocaleString()} 可用)
                </span>
              </div>
            </div>
          </div>

          <div className="mt-4 p-3 bg-blue-50 rounded">
            <p className="text-sm text-blue-800">
              <strong>投票规则:</strong> 需要至少 {organization.settings.votingRules.requiredQuorum}% 的股份参与投票，
              并且 {organization.settings.votingRules.requiredApproval}% 的同意票才能通过提案。
            </p>
          </div>
        </div>
      )}

      {/* 提案列表 */}
      <div className="bg-white shadow overflow-hidden sm:rounded-md">
        <ul className="divide-y divide-gray-200">
          {proposals?.map((proposal) => (
            <li key={proposal.id}>
              <div className="px-4 py-4 flex items-center sm:px-6">
                <div className="min-w-0 flex-1 sm:flex sm:items-center sm:justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-3 mb-2">
                      {getStatusIcon(proposal.status)}
                      <p className="text-sm font-medium text-gray-900 truncate">{proposal.title}</p>
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getTypeColor(proposal.type)}`}>
                        {getTypeText(proposal.type)}
                      </span>
                    </div>
                    <p className="text-sm text-gray-500 mb-2">{proposal.description}</p>
                    <div className="flex items-center space-x-4 text-sm text-gray-500">
                      <span>创建时间: {new Date(proposal.createdAt).toLocaleString()}</span>
                      <span>截止时间: {new Date(proposal.deadline).toLocaleString()}</span>
                      <span>投票数: {proposal.votes.length}</span>
                    </div>
                    
                    {/* 投票进度 */}
                    {proposal.votes.length > 0 && (
                      <div className="mt-3">
                        <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                          <span>赞成: {proposal.votes.filter(v => v.decision === 'for').length}</span>
                          <span>反对: {proposal.votes.filter(v => v.decision === 'against').length}</span>
                          <span>弃权: {proposal.votes.filter(v => v.decision === 'abstain').length}</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div 
                            className="bg-green-600 h-2 rounded-full" 
                            style={{ 
                              width: `${proposal.votes.length > 0 ? (proposal.votes.filter(v => v.decision === 'for').length / proposal.votes.length) * 100 : 0}%` 
                            }}
                          ></div>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="mt-4 flex-shrink-0 sm:mt-0 sm:ml-5">
                    <div className="flex space-x-2">
                      {(proposal.status === 'proposed' || proposal.status === 'voting') && (
                        <button
                          onClick={() => {
                            setSelectedProposal(proposal);
                            setVotingModalOpen(true);
                          }}
                          className="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded text-white bg-primary-600 hover:bg-primary-700"
                        >
                          投票
                        </button>
                      )}
                      <button
                        onClick={() => setSelectedProposal(proposal)}
                        className="p-2 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                        title="查看详情"
                      >
                        <ScaleIcon className="h-5 w-5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
        
        {proposals?.length === 0 && (
          <div className="text-center py-12">
            <ScaleIcon className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-sm font-medium text-gray-900">没有提案</h3>
            <p className="mt-1 text-sm text-gray-500">创建第一个提案开始公司治理</p>
            <div className="mt-6">
              <button
                onClick={() => setIsCreateModalOpen(true)}
                className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
              >
                <PlusIcon className="h-4 w-4 mr-2" />
                创建提案
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 创建提案模态框 */}
      {isCreateModalOpen && (
        <CreateProposalModal 
          onClose={() => setIsCreateModalOpen(false)}
          onSuccess={(proposalData) => handleCreateProposal(proposalData)}
        />
      )}

      {/* 投票模态框 */}
      {votingModalOpen && selectedProposal && (
        <VotingModal
          proposal={selectedProposal}
          onClose={() => {
            setVotingModalOpen(false);
            setSelectedProposal(null);
          }}
          onVote={(decision, reason) => handleCastVote(selectedProposal.id, decision, reason)}
        />
      )}
    </div>
  );
};

// 创建提案模态框
const CreateProposalModal: React.FC<{
  onClose: () => void;
  onSuccess: (data: any) => void;
}> = ({ onClose, onSuccess }) => {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    type: 'hire' as const,
    proposerId: 'human-founder', // 临时硬编码
    metadata: {}
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSuccess(formData);
  };

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
      <div className="relative top-20 mx-auto p-5 border w-[600px] shadow-lg rounded-md bg-white">
        <div className="mt-3">
          <h3 className="text-lg font-medium text-gray-900">创建新提案</h3>
          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">提案标题</label>
              <input
                type="text"
                required
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700">提案类型</label>
              <select
                value={formData.type}
                onChange={(e) => setFormData({ ...formData, type: e.target.value as any })}
                className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              >
                <option value="hire">招聘</option>
                <option value="fire">解雇</option>
                <option value="tool_access">工具权限</option>
                <option value="strategy">战略</option>
                <option value="budget">预算</option>
                <option value="policy">政策</option>
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700">详细描述</label>
              <textarea
                required
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                rows={4}
              />
            </div>
            
            <div className="flex justify-end space-x-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700"
              >
                创建提案
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

// 投票模态框
const VotingModal: React.FC<{
  proposal: any;
  onClose: () => void;
  onVote: (decision: 'for' | 'against' | 'abstain', reason: string) => void;
}> = ({ proposal, onClose, onVote }) => {
  const [decision, setDecision] = useState<'for' | 'against' | 'abstain'>('for');
  const [reason, setReason] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onVote(decision, reason);
  };

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
      <div className="relative top-20 mx-auto p-5 border w-[500px] shadow-lg rounded-md bg-white">
        <div className="mt-3">
          <h3 className="text-lg font-medium text-gray-900">投票: {proposal.title}</h3>
          <p className="text-sm text-gray-600 mt-1">{proposal.description}</p>
          
          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">你的决定</label>
              <div className="mt-2 space-y-2">
                <label className="flex items-center">
                  <input
                    type="radio"
                    value="for"
                    checked={decision === 'for'}
                    onChange={(e) => setDecision(e.target.value as any)}
                    className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300"
                  />
                  <span className="ml-2 text-sm text-green-600 font-medium">赞成</span>
                </label>
                <label className="flex items-center">
                  <input
                    type="radio"
                    value="against"
                    checked={decision === 'against'}
                    onChange={(e) => setDecision(e.target.value as any)}
                    className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300"
                  />
                  <span className="ml-2 text-sm text-red-600 font-medium">反对</span>
                </label>
                <label className="flex items-center">
                  <input
                    type="radio"
                    value="abstain"
                    checked={decision === 'abstain'}
                    onChange={(e) => setDecision(e.target.value as any)}
                    className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300"
                  />
                  <span className="ml-2 text-sm text-gray-600 font-medium">弃权</span>
                </label>
              </div>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700">投票理由</label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="请说明你的投票理由..."
                className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                rows={3}
              />
            </div>
            
            <div className="flex justify-end space-x-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700"
              >
                提交投票
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Governance;
