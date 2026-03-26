import { useMemo, useState } from 'react';
import type { AgentToolPermissionSet } from '../../../services/agentService';
import type { AgentToolItem, GroupedToolItems } from '../types';
import { getToolKey, getToolNamespace, getToolProvider } from '../utils';

interface UseAgentToolFilterInput {
  availableTools: AgentToolItem[];
  toolPermissionSets: AgentToolPermissionSet[];
  selectedRoleCode: string;
}

export const useAgentToolFilter = ({ availableTools, toolPermissionSets, selectedRoleCode }: UseAgentToolFilterInput) => {
  const [toolProviderFilter, setToolProviderFilter] = useState('');
  const [toolNamespaceFilter, setToolNamespaceFilter] = useState('');

  const allowedToolIds = useMemo(() => {
    return new Set((toolPermissionSets.find((set) => set.roleCode === selectedRoleCode)?.tools || []).filter(Boolean));
  }, [selectedRoleCode, toolPermissionSets]);

  const allowedTools = useMemo(() => {
    return availableTools.filter((tool) => tool.enabled !== false && allowedToolIds.has(getToolKey(tool)));
  }, [allowedToolIds, availableTools]);

  const providerOptions = useMemo(() => {
    return Array.from(new Set(allowedTools.map((tool) => getToolProvider(tool)).filter(Boolean))).sort();
  }, [allowedTools]);

  const namespaceOptions = useMemo(() => {
    return Array.from(new Set(allowedTools.map((tool) => getToolNamespace(tool)).filter(Boolean))).sort();
  }, [allowedTools]);

  const groupedTools = useMemo<GroupedToolItems[]>(() => {
    const filtered = allowedTools
      .filter((tool) => !toolProviderFilter || getToolProvider(tool) === toolProviderFilter)
      .filter((tool) => !toolNamespaceFilter || getToolNamespace(tool) === toolNamespaceFilter);

    const grouped = new Map<string, AgentToolItem[]>();
    for (const tool of filtered) {
      const namespace = getToolNamespace(tool);
      if (!grouped.has(namespace)) grouped.set(namespace, []);
      grouped.get(namespace)!.push(tool);
    }

    return Array.from(grouped.entries())
      .map(([namespace, items]) => ({
        namespace,
        items: items.sort((a, b) => getToolKey(a).localeCompare(getToolKey(b))),
      }))
      .sort((a, b) => a.namespace.localeCompare(b.namespace));
  }, [allowedTools, toolNamespaceFilter, toolProviderFilter]);

  return {
    toolProviderFilter,
    setToolProviderFilter,
    toolNamespaceFilter,
    setToolNamespaceFilter,
    allowedToolIds,
    allowedTools,
    providerOptions,
    namespaceOptions,
    groupedTools,
  };
};
