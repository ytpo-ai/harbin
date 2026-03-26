import React, { useMemo, useState } from 'react';
import { PlusIcon, UserGroupIcon } from '@heroicons/react/24/outline';
import { useNavigate } from 'react-router-dom';
import { authService } from '../services/authService';
import { meetingService } from '../services/meetingService';
import type { Agent } from '../types';
import {
  AgentCard,
  AgentListHeader,
  CreateAgentModal,
  EditAgentModal,
  getRoleDisplayName,
  getTierBadgeClassName,
  getTierLabel,
  normalizeTier,
  type TierFilter,
  useAgentListData,
} from '../components/agents';

const Agents: React.FC = () => {
  const navigate = useNavigate();
  const {
    agents,
    isLoading,
    availableModels,
    availableTools,
    toolPermissionSets,
    businessRoles,
    roleMap,
    deleteAgentMutation,
    toggleAgentMutation,
    updateAgentMutation,
    createAgentMutation,
  } = useAgentListData();

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [startingChatAgentId, setStartingChatAgentId] = useState('');
  const [avatarLoadErrors, setAvatarLoadErrors] = useState<Record<string, boolean>>({});
  const [tierFilter, setTierFilter] = useState<TierFilter>('all');

  const getAgentId = (agent: Agent | null): string => {
    const withMongoId = agent as (Agent & { _id?: string }) | null;
    return withMongoId?.id || withMongoId?._id || '';
  };

  const getAgentCandidateIds = (agent: Agent): string[] => {
    const withMongoId = agent as Agent & { _id?: string };
    return Array.from(new Set([withMongoId.id, withMongoId._id].filter(Boolean) as string[]));
  };

  const filteredAgents = useMemo(() => {
    if (tierFilter === 'all') return agents;
    return agents.filter((agent) => {
      const role = roleMap.get(agent.roleId);
      const tier = normalizeTier(agent.tier || role?.tier);
      return tier === tierFilter;
    });
  }, [agents, roleMap, tierFilter]);

  const handleDelete = (agent: Agent) => {
    const id = getAgentId(agent);
    if (!id) {
      alert('Agent ID 无效，无法删除');
      return;
    }
    if (window.confirm('确定要删除这个Agent吗？')) {
      deleteAgentMutation.mutate(id);
    }
  };

  const handleToggleActive = (agent: Agent) => {
    const id = getAgentId(agent);
    if (!id) {
      alert('Agent ID 无效，无法更新状态');
      return;
    }
    toggleAgentMutation.mutate({ id, isActive: !agent.isActive });
  };

  const handleStartChat = async (agent: Agent) => {
    const agentId = getAgentId(agent);
    if (!agentId) {
      alert('Agent ID 无效，无法开始聊天');
      return;
    }
    if (!agent.isActive) {
      alert('该 Agent 当前未激活，请先启用后再开始聊天');
      return;
    }

    setStartingChatAgentId(agentId);
    try {
      const currentUser = await authService.getCurrentUser();
      if (!currentUser?.id) throw new Error('未获取到当前用户信息，请重新登录后重试');

      const meeting = await meetingService.getOrCreateOneToOneMeeting({
        employeeId: currentUser.id,
        employeeName: currentUser.name || currentUser.email || '用户',
        agentId,
        agentName: agent.name,
        agentCandidateIds: getAgentCandidateIds(agent),
      });

      navigate(`/meetings?meetingId=${encodeURIComponent(meeting.id)}`);
    } catch (error) {
      alert(error instanceof Error ? error.message : '创建一对一聊天失败');
    } finally {
      setStartingChatAgentId('');
    }
  };

  const handleViewDetail = (agent: Agent) => {
    const agentId = getAgentId(agent);
    if (!agentId) {
      alert('Agent ID 无效，无法查看详情');
      return;
    }
    navigate(`/agents/${encodeURIComponent(agentId)}`);
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
      <AgentListHeader
        tierFilter={tierFilter}
        onTierFilterChange={setTierFilter}
        onOpenCreate={() => setIsCreateModalOpen(true)}
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filteredAgents.map((agent) => {
          const agentId = getAgentId(agent) || agent.name;
          const role = roleMap.get(agent.roleId);
          const agentTier = normalizeTier(agent.tier || role?.tier);

          return (
            <AgentCard
              key={agentId}
              agent={agent}
              roleName={getRoleDisplayName(role)}
              tierLabel={getTierLabel(agentTier)}
              tierBadgeClassName={getTierBadgeClassName(agentTier)}
              isStartingChat={startingChatAgentId === getAgentId(agent)}
              hasAvatarLoadError={!!avatarLoadErrors[agentId]}
              onAvatarError={() => setAvatarLoadErrors((prev) => ({ ...prev, [agentId]: true }))}
              onStartChat={() => handleStartChat(agent)}
              onViewDetail={() => handleViewDetail(agent)}
              onToggleActive={() => handleToggleActive(agent)}
              onEdit={() => {
                setEditingAgent(agent);
                setIsEditModalOpen(true);
              }}
              onDelete={() => handleDelete(agent)}
            />
          );
        })}

        {agents.length > 0 && filteredAgents.length === 0 && (
          <div className="col-span-full py-12 text-center">
            <UserGroupIcon className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-sm font-medium text-gray-900">暂无匹配结果</h3>
            <p className="mt-1 text-sm text-gray-500">当前筛选条件下暂无 Agent</p>
          </div>
        )}

        {agents.length === 0 && (
          <div className="col-span-full py-12 text-center">
            <UserGroupIcon className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-sm font-medium text-gray-900">没有Agent</h3>
            <p className="mt-1 text-sm text-gray-500">开始创建你的第一个AI Agent</p>
            <div className="mt-6">
              <button
                onClick={() => setIsCreateModalOpen(true)}
                className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
              >
                <PlusIcon className="h-4 w-4 mr-2" />
                创建Agent
              </button>
            </div>
          </div>
        )}
      </div>

      {isCreateModalOpen && (
        <CreateAgentModal
          availableModels={availableModels}
          availableTools={availableTools}
          toolPermissionSets={toolPermissionSets}
          businessRoles={businessRoles}
          isLoading={createAgentMutation.isLoading}
          onClose={() => setIsCreateModalOpen(false)}
          onCreate={(payload) => {
            createAgentMutation.mutate(payload as any, {
              onSuccess: () => setIsCreateModalOpen(false),
            });
          }}
        />
      )}

      {isEditModalOpen && editingAgent && (
        <EditAgentModal
          agent={editingAgent}
          availableModels={availableModels}
          availableTools={availableTools}
          toolPermissionSets={toolPermissionSets}
          businessRoles={businessRoles}
          isLoading={updateAgentMutation.isLoading}
          onClose={() => {
            setIsEditModalOpen(false);
            setEditingAgent(null);
          }}
          onSave={(updates) => {
            const id = getAgentId(editingAgent);
            if (!id) {
              alert('Agent ID 无效，无法保存配置');
              return;
            }
            updateAgentMutation.mutate(
              { id, updates },
              {
                onSuccess: () => {
                  setIsEditModalOpen(false);
                  setEditingAgent(null);
                },
              },
            );
          }}
        />
      )}
    </div>
  );
};

export default Agents;
