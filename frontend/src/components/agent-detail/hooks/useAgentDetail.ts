import { useQuery } from 'react-query';
import { useNavigate } from 'react-router-dom';
import { agentService } from '../../../services/agentService';
import { AGENT_DETAIL_QUERY_KEYS } from '../constants';

export const useAgentDetail = (agentId: string) => {
  const navigate = useNavigate();

  const agentQuery = useQuery(
    AGENT_DETAIL_QUERY_KEYS.detail(agentId),
    () => agentService.getAgent(agentId),
    { enabled: !!agentId },
  );

  return {
    ...agentQuery,
    goBackToList: () => navigate('/agents'),
  };
};
