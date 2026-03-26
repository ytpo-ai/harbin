import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from 'react-query';
import { agentService } from '../../../services/agentService';
import type { AgentBusinessRole } from '../../../services/agentService';
import type { Agent } from '../../../types';
import { modelService } from '../../../services/modelService';
import { toolService } from '../../../services/toolService';
import type { AgentToolItem } from '../types';

export const useAgentListData = () => {
  const queryClient = useQueryClient();

  const { data: agents, isLoading } = useQuery('agents', agentService.getAgents);
  const { data: availableModels } = useQuery('models', modelService.getAvailableModels);
  const { data: availableTools } = useQuery('tools', toolService.getTools);
  const { data: toolPermissionSets } = useQuery('agentToolPermissionSets', agentService.getToolPermissionSets);
  const { data: businessRoles } = useQuery('agentBusinessRoles', () => agentService.getRoles('all'));

  const roleMap = useMemo(() => {
    const map = new Map<string, AgentBusinessRole>();
    for (const role of businessRoles || []) {
      if (role?.id) {
        map.set(role.id, role);
      }
    }
    return map;
  }, [businessRoles]);

  const deleteAgentMutation = useMutation(agentService.deleteAgent, {
    onSuccess: () => {
      queryClient.invalidateQueries('agents');
    },
  });

  const toggleAgentMutation = useMutation(
    ({ id, isActive }: { id: string; isActive: boolean }) => agentService.updateAgent(id, { isActive }),
    {
      onSuccess: () => {
        queryClient.invalidateQueries('agents');
      },
    },
  );

  const updateAgentMutation = useMutation(
    ({ id, updates }: { id: string; updates: Partial<Agent> }) => agentService.updateAgent(id, updates),
    {
      onSuccess: () => {
        queryClient.invalidateQueries('agents');
      },
    },
  );

  const createAgentMutation = useMutation(agentService.createAgent, {
    onSuccess: () => {
      queryClient.invalidateQueries('agents');
    },
  });

  return {
    agents: agents || [],
    isLoading,
    availableModels: availableModels || [],
    availableTools: (availableTools || []) as AgentToolItem[],
    toolPermissionSets: toolPermissionSets || [],
    businessRoles: businessRoles || [],
    roleMap,
    deleteAgentMutation,
    toggleAgentMutation,
    updateAgentMutation,
    createAgentMutation,
  };
};
