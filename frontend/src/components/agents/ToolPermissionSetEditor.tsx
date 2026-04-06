import React, { useEffect, useMemo, useState } from 'react';
import type { Tool } from '../../types';
import { getNamespaceLabel, getToolKey, getToolProvider, normalizeNamespace } from './tool-utils';

export interface ToolPermissionSetEditorData {
  description: string;
  permissions: string[];
  exposed: boolean;
  tools: string[];
}

interface ToolPermissionSetEditorProps {
  initialData: {
    description?: string;
    permissions: string[];
    exposed: boolean;
    tools: string[];
  };
  availableTools: Array<Pick<Tool, 'id' | 'name'> & { toolId?: string; provider?: string; namespace?: string; enabled?: boolean }>;
  onChange: (data: ToolPermissionSetEditorData) => void;
}

const toUniqueList = (items: string[]): string[] => {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
};

const ToolPermissionSetEditor: React.FC<ToolPermissionSetEditorProps> = ({ initialData, availableTools, onChange }) => {
  const initialDataKey = useMemo(() => {
    return JSON.stringify({
      description: (initialData.description || '').trim(),
      permissions: toUniqueList(initialData.permissions || []),
      exposed: initialData.exposed === true,
      tools: toUniqueList(initialData.tools || []),
    });
  }, [initialData.description, initialData.exposed, initialData.permissions, initialData.tools]);

  const parsedInitialData = useMemo(() => {
    return JSON.parse(initialDataKey) as ToolPermissionSetEditorData;
  }, [initialDataKey]);

  const description = parsedInitialData.description || '';
  const [permissionsText, setPermissionsText] = useState((parsedInitialData.permissions || []).join(', '));
  const [exposed, setExposed] = useState(parsedInitialData.exposed === true);
  const [tools, setTools] = useState<string[]>(toUniqueList(parsedInitialData.tools || []));
  const [providerFilter, setProviderFilter] = useState('');
  const [namespaceFilter, setNamespaceFilter] = useState('');

  useEffect(() => {
    setPermissionsText((parsedInitialData.permissions || []).join(', '));
    setExposed(parsedInitialData.exposed === true);
    setTools(toUniqueList(parsedInitialData.tools || []));
    setProviderFilter('');
    setNamespaceFilter('');
  }, [parsedInitialData]);

  const permissions = useMemo(() => {
    return toUniqueList(permissionsText.split(','));
  }, [permissionsText]);

  useEffect(() => {
    onChange({
      description: description.trim(),
      permissions,
      exposed,
      tools,
    });
  }, [description, permissions, exposed, tools, onChange]);

  const toggleTool = (toolId: string, checked: boolean) => {
    setTools((prev) => {
      if (checked) {
        return toUniqueList([...prev, toolId]);
      }
      return prev.filter((id) => id !== toolId);
    });
  };

  const providerOptions = useMemo(() => {
    return Array.from(
      new Set(availableTools.filter((tool) => tool.enabled !== false).map((tool) => getToolProvider(tool)).filter(Boolean)),
    ).sort();
  }, [availableTools]);

  const namespaceOptions = useMemo(() => {
    return Array.from(
      new Set(availableTools.filter((tool) => tool.enabled !== false).map((tool) => normalizeNamespace(tool.namespace)).filter(Boolean)),
    ).sort();
  }, [availableTools]);

  const groupedTools = useMemo(() => {
    const filtered = availableTools
      .filter((tool) => tool.enabled !== false)
      .filter((tool) => !providerFilter || getToolProvider(tool) === providerFilter)
      .filter((tool) => !namespaceFilter || normalizeNamespace(tool.namespace) === namespaceFilter);

    const grouped = new Map<string, typeof filtered>();
    for (const tool of filtered) {
      const namespace = normalizeNamespace(tool.namespace) || 'other';
      if (!grouped.has(namespace)) grouped.set(namespace, []);
      grouped.get(namespace)!.push(tool);
    }

    return Array.from(grouped.entries())
      .map(([namespace, items]) => ({
        namespace,
        items: items.sort((a, b) => getToolKey(a).localeCompare(getToolKey(b))),
      }))
      .sort((a, b) => a.namespace.localeCompare(b.namespace));
  }, [availableTools, namespaceFilter, providerFilter]);

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Permissions（逗号分隔）</label>
        <input
          type="text"
          value={permissionsText}
          onChange={(e) => setPermissionsText(e.target.value)}
          className="block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
        />
      </div>

      <div className="flex items-center">
        <input
          id="tool-permission-set-exposed"
          type="checkbox"
          checked={exposed}
          onChange={(e) => setExposed(e.target.checked)}
          className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
        />
        <label htmlFor="tool-permission-set-exposed" className="ml-2 text-sm text-gray-700">
          Exposed（在 MCP 可见列表中展示）
        </label>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Tools</label>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-2">
          <select
            value={providerFilter}
            onChange={(e) => setProviderFilter(e.target.value)}
            className="border border-gray-300 rounded-md px-2 py-1.5 text-xs"
          >
            <option value="">全部 Provider</option>
            {providerOptions.map((provider) => (
              <option key={provider} value={provider}>{provider}</option>
            ))}
          </select>
          <select
            value={namespaceFilter}
            onChange={(e) => setNamespaceFilter(e.target.value)}
            className="border border-gray-300 rounded-md px-2 py-1.5 text-xs"
          >
            <option value="">全部 Namespace</option>
            {namespaceOptions.map((namespace) => (
              <option key={namespace} value={namespace}>{getNamespaceLabel(namespace)}</option>
            ))}
          </select>
        </div>
        <div className="max-h-64 overflow-y-auto border border-gray-200 rounded-md p-3 space-y-2">
          {groupedTools.map((group) => (
            <div key={group.namespace} className="space-y-1">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{getNamespaceLabel(group.namespace)}</p>
              {group.items.map((tool) => {
                const toolId = getToolKey(tool);
                const checked = tools.includes(toolId);
                return (
                  <label key={toolId} className="flex items-center justify-between text-sm text-gray-700 pl-1">
                    <span>
                      {tool.name}
                      <span className="ml-2 text-xs text-gray-400">{toolId}</span>
                    </span>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => toggleTool(toolId, e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                    />
                  </label>
                );
              })}
            </div>
          ))}
          {groupedTools.length === 0 && (
            <p className="text-xs text-gray-500">当前筛选条件下暂无可配置工具</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default ToolPermissionSetEditor;
