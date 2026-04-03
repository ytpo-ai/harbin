import { useMemo } from 'react';
import { useQuery } from 'react-query';
import { useNavigate } from 'react-router-dom';
import { agentService } from '../../../services/agentService';
import type { AgentBusinessRole } from '../../../services/agentService';
import { AGENT_DETAIL_QUERY_KEYS } from '../constants';
import { resolveAgentRoleDisplayName } from '../utils';

export const useAgentDetail = (agentId: string) => {
  const navigate = useNavigate();

  const agentQuery = useQuery(
    AGENT_DETAIL_QUERY_KEYS.detail(agentId),
    () => agentService.getAgent(agentId),
    { enabled: !!agentId },
  );

  const rolesQuery = useQuery(
    AGENT_DETAIL_QUERY_KEYS.roles,
    () => agentService.getRoles('all'),
    { enabled: !!agentId },
  );

  const roleMap = useMemo(() => {
    const map = new Map<string, AgentBusinessRole>();
    for (const role of rolesQuery.data || []) {
      const roleId = String(role?.id || '').trim();
      const roleCode = String(role?.code || '').trim();
      if (roleId) {
        map.set(roleId, role);
      }
      if (roleCode) {
        map.set(roleCode, role);
      }
    }
    return map;
  }, [rolesQuery.data]);

  const roleDisplayName = useMemo(() => {
    return resolveAgentRoleDisplayName(agentQuery.data?.roleId, roleMap);
  }, [agentQuery.data?.roleId, roleMap]);

  return {
    ...agentQuery,
    roleDisplayName,
    goBackToList: () => navigate('/agents'),
  };
};
