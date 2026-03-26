import { useCallback } from 'react';
import type { AgentBusinessRole, AgentToolPermissionSet } from '../../../services/agentService';
import type { AgentFormSyncInput, AgentFormSyncResult } from '../types';
import { normalizeTier, shouldApplyNextDefault } from '../utils';

interface UseAgentFormSyncInput {
  businessRoles: AgentBusinessRole[];
  toolPermissionSets: AgentToolPermissionSet[];
}

export const useAgentFormSync = ({ businessRoles, toolPermissionSets }: UseAgentFormSyncInput) => {
  const getAllowedToolIdsByRoleCode = useCallback(
    (roleCode: string) => {
      return new Set((toolPermissionSets.find((set) => set.roleCode === roleCode)?.tools || []).filter(Boolean));
    },
    [toolPermissionSets],
  );

  const getRoleCodeByRoleId = useCallback(
    (roleId: string) => {
      return (businessRoles.find((role) => role.id === roleId)?.code || '').trim();
    },
    [businessRoles],
  );

  const syncRoleChange = useCallback(
    (input: AgentFormSyncInput): AgentFormSyncResult => {
      const previousRole = businessRoles.find((role) => role.id === input.currentRoleId);
      const nextRole = businessRoles.find((role) => role.id === input.nextRoleId);
      const nextRoleCode = (nextRole?.code || '').trim();
      const nextAllowedToolIds = getAllowedToolIdsByRoleCode(nextRoleCode);

      const nextPrompt = shouldApplyNextDefault(input.currentSystemPrompt, previousRole?.promptTemplate)
        ? (nextRole?.promptTemplate || (input.emptyPromptFallback === 'empty' ? '' : input.currentSystemPrompt))
        : input.currentSystemPrompt;

      return {
        tier: normalizeTier(nextRole?.tier),
        systemPrompt: nextPrompt,
        selectedTools: input.currentSelectedTools.filter((toolId) => nextAllowedToolIds.has(toolId)),
      };
    },
    [businessRoles, getAllowedToolIdsByRoleCode],
  );

  return {
    getRoleCodeByRoleId,
    syncRoleChange,
  };
};
