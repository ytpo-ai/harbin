import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from 'react-query';
import { toolService } from '../services/toolService';
import { agentService } from '../services/agentService';
import type { AgentToolPermissionSet } from '../services/agentService';
import ToolPermissionSetEditor, { ToolPermissionSetEditorData } from '../components/agents/ToolPermissionSetEditor';
import { NAMESPACE_OPTIONS, getNamespaceLabel, getToolKey, normalizeNamespace } from '../components/agents/tool-utils';
import { 
  WrenchScrewdriverIcon, 
  PlayIcon, 
  ClockIcon, 
  CheckCircleIcon, 
  XCircleIcon,
  CogIcon,
  PencilIcon,
  ClipboardDocumentIcon,
  CheckIcon,
} from '@heroicons/react/24/outline';
import type { Tool } from '../types';

const formatDateTime = (value?: Date | string) => {
  if (!value) return '暂无';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '暂无';
  return date.toLocaleString();
};

const summarizeValue = (value: unknown, maxLength = 64) => {
  if (value === null || value === undefined) return '—';
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  if (!raw) return '—';
  return raw.length > maxLength ? `${raw.slice(0, maxLength)}...` : raw;
};

const getToolkitValue = (tool?: Partial<Tool> | null) => {
  const toolKey = getToolKey(tool);
  if (toolKey) {
    const parts = toolKey.split('.');
    if (parts.length === 5 && parts[3]) {
      return parts[3];
    }
  }
  const toolkitId = String(tool?.toolkitId || '').trim();
  if (toolkitId && !toolkitId.includes('.')) {
    return toolkitId;
  }
  return String(tool?.resource || '').trim();
};

const getToolkitLabel = (toolkit?: string) => {
  if (toolkit === 'rd-related') return 'RD Toolkit';
  return toolkit || '—';
};

const resolveToolPrompt = (tool?: Partial<Tool> | null): string => {
  const candidates = [
    (tool as any)?.prompt,
    (tool as any)?.systemPrompt,
    (tool as any)?.config?.prompt,
    (tool as any)?.metadata?.prompt,
    (tool as any)?.implementation?.prompt,
  ];
  const matched = candidates.find((item) => typeof item === 'string' && item.trim().length > 0);
  return typeof matched === 'string' ? matched : '';
};

const resolveToolInputSchema = (tool?: Partial<Tool> | null): Record<string, any> | null => {
  const explicitSchema = (tool as any)?.inputSchema;
  if (explicitSchema && typeof explicitSchema === 'object') {
    return explicitSchema as Record<string, any>;
  }

  const legacyParameters = (tool as any)?.implementation?.parameters;
  if (!legacyParameters || typeof legacyParameters !== 'object') {
    return null;
  }

  const properties: Record<string, any> = {};
  const required: string[] = [];
  for (const [key, rawConfig] of Object.entries(legacyParameters as Record<string, any>)) {
    if (!rawConfig || typeof rawConfig !== 'object') continue;
    properties[key] = {
      type: rawConfig.type || 'string',
      description: rawConfig.description,
      enum: Array.isArray(rawConfig.enum) ? rawConfig.enum : undefined,
      default: rawConfig.default,
    };
    if (rawConfig.required) {
      required.push(key);
    }
  }

  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  };
};

const parseSchemaText = (value: string, label: string): Record<string, any> => {
  const raw = value.trim();
  if (!raw) {
    return { type: 'object', properties: {} };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${label} 不是合法 JSON`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} 必须是 JSON 对象`);
  }
  return parsed as Record<string, any>;
};

const stringifySchema = (value: unknown): string => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return JSON.stringify({ type: 'object', properties: {} }, null, 2);
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return JSON.stringify({ type: 'object', properties: {} }, null, 2);
  }
};

const normalizeExecutionParameters = (parameters: Record<string, any>, schema?: Record<string, any> | null) => {
  if (!schema || typeof schema !== 'object') {
    return parameters;
  }

  const properties = schema.properties;
  if (!properties || typeof properties !== 'object') {
    return parameters;
  }

  const normalized: Record<string, any> = { ...parameters };
  for (const [key, rawConfig] of Object.entries(properties as Record<string, any>)) {
    const current = normalized[key];
    if (typeof current !== 'string') continue;
    if (!rawConfig || typeof rawConfig !== 'object') continue;

    const type = Array.isArray(rawConfig.type) ? rawConfig.type[0] : rawConfig.type;
    if (type === 'object' || type === 'array') {
      const trimmed = current.trim();
      if (!trimmed) continue;
      try {
        normalized[key] = JSON.parse(trimmed);
      } catch {
        throw new Error(`参数 ${key} 需要合法 JSON`);
      }
    }
  }

  return normalized;
};

const Tools: React.FC = () => {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'tools' | 'logs' | 'permissionSets'>('tools');
  const [activeTool, setActiveTool] = useState<Tool | null>(null);
  const [drawerTab, setDrawerTab] = useState<'execute' | 'edit'>('execute');
  const [editingPermissionSet, setEditingPermissionSet] = useState<AgentToolPermissionSet | null>(null);
  const [providerFilter, setProviderFilter] = useState('');
  const [namespaceFilter, setNamespaceFilter] = useState('');
  const [toolkitFilter, setToolkitFilter] = useState('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [copiedToolId, setCopiedToolId] = useState('');

  const { data: tools, isLoading, refetch: refetchTools } = useQuery(['tool-registry'], () => toolService.getToolRegistry());
  const { data: executions, refetch: refetchExecutions } = useQuery('tool-executions', () => toolService.getToolExecutions());
  const { data: stats, refetch: refetchStats } = useQuery('tool-stats', toolService.getToolExecutionStats);
  const { data: toolPermissionSets, refetch: refetchToolPermissionSets } = useQuery(
    'agentToolPermissionSets',
    agentService.getToolPermissionSets,
  );
  const { data: agents } = useQuery('agents', () => agentService.getAgents());

  useEffect(() => {
    if (activeTab === 'tools') {
      void refetchTools();
      void refetchExecutions();
      void refetchStats();
      return;
    }
    if (activeTab === 'logs') {
      void refetchExecutions();
      void refetchStats();
      return;
    }
    if (activeTab === 'permissionSets') {
      void refetchToolPermissionSets();
    }
  }, [activeTab, refetchExecutions, refetchStats, refetchToolPermissionSets, refetchTools]);

  const upsertPermissionSetMutation = useMutation(
    ({ roleCode, updates }: { roleCode: string; updates: Pick<AgentToolPermissionSet, 'tools' | 'permissions' | 'exposed' | 'description'> }) =>
      agentService.upsertToolPermissionSet(roleCode, updates),
    {
      onSuccess: () => {
        queryClient.invalidateQueries('agentToolPermissionSets');
        setEditingPermissionSet(null);
      },
    },
  );

  const updateToolMutation = useMutation(
    ({ toolId, updates }: { toolId: string; updates: Partial<Tool> }) => toolService.updateTool(toolId, updates),
    {
      onSuccess: () => {
        queryClient.invalidateQueries(['tool-registry']);
        setActiveTool(null);
      },
    },
  );

  const deprecateToolMutation = useMutation((toolId: string) => toolService.deprecateTool(toolId), {
    onSuccess: () => {
      queryClient.invalidateQueries(['tool-registry']);
    },
  });

  const providerOptions = useMemo(() => {
    return Array.from(new Set((tools || []).map((tool) => String(tool.provider || '').trim()).filter(Boolean))).sort();
  }, [tools]);

  const filteredTools = useMemo(() => {
    const keyword = searchKeyword.trim().toLowerCase();
    return (tools || []).filter((tool) => {
      const namespace = normalizeNamespace(tool.namespace);
      const toolkit = getToolkitValue(tool);
      const matchesProvider = !providerFilter || String(tool.provider || '').trim() === providerFilter;
      const matchesNamespace = !namespaceFilter || namespace === namespaceFilter;
      const matchesToolkit = !toolkitFilter || toolkit === toolkitFilter;
      if (!matchesProvider || !matchesNamespace || !matchesToolkit) return false;
      if (!keyword) return true;

      const searchBucket = [
        tool.name,
        tool.description,
        getToolKey(tool),
        tool.provider,
        namespace,
        getNamespaceLabel(namespace),
        toolkit,
        tool.toolkitId,
        tool.resource,
        tool.action,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return searchBucket.includes(keyword);
    });
  }, [tools, providerFilter, namespaceFilter, toolkitFilter, searchKeyword]);

  const toolkitCandidateTools = useMemo(() => {
    return (tools || []).filter((tool) => {
      const namespace = normalizeNamespace(tool.namespace);
      const matchesProvider = !providerFilter || String(tool.provider || '').trim() === providerFilter;
      const matchesNamespace = !namespaceFilter || namespace === namespaceFilter;
      return matchesProvider && matchesNamespace;
    });
  }, [tools, providerFilter, namespaceFilter]);

  const toolkitOptions = useMemo(() => {
    return Array.from(
      new Set(
        toolkitCandidateTools
          .map((tool) => getToolkitValue(tool))
          .filter(Boolean),
      ),
    ).sort();
  }, [toolkitCandidateTools]);

  const toolNameMap = useMemo(() => {
    const map = new Map<string, string>();
    (tools || []).forEach((tool) => {
      const key = getToolKey(tool);
      if (key) {
        map.set(key, tool.name);
      }
    });
    return map;
  }, [tools]);

  const executionSummaryByTool = useMemo(() => {
    const summary = new Map<string, { count: number; successCount: number; lastStatus: string; lastTimestamp?: Date | string }>();
    (executions || []).forEach((execution) => {
      const key = String(execution.toolId || '').trim();
      if (!key) return;
      const current = summary.get(key) || { count: 0, successCount: 0, lastStatus: 'pending', lastTimestamp: undefined };
      current.count += 1;
      if (execution.status === 'completed') {
        current.successCount += 1;
      }
      const currentTime = current.lastTimestamp ? new Date(current.lastTimestamp).getTime() : 0;
      const nextTime = new Date(execution.timestamp).getTime();
      if (!current.lastTimestamp || nextTime >= currentTime) {
        current.lastStatus = execution.status;
        current.lastTimestamp = execution.timestamp;
      }
      summary.set(key, current);
    });
    return summary;
  }, [executions]);

  const enabledToolsCount = useMemo(() => {
    return filteredTools.filter((tool) => tool.enabled).length;
  }, [filteredTools]);

  const executionLast24hCount = useMemo(() => {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    return (executions || []).filter((execution) => now - new Date(execution.timestamp).getTime() <= dayMs).length;
  }, [executions]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending':
        return <ClockIcon className="h-4 w-4 text-yellow-500" />;
      case 'executing':
        return <PlayIcon className="h-4 w-4 text-blue-500" />;
      case 'completed':
        return <CheckCircleIcon className="h-4 w-4 text-green-500" />;
      case 'failed':
        return <XCircleIcon className="h-4 w-4 text-red-500" />;
      default:
        return <ClockIcon className="h-4 w-4 text-gray-500" />;
    }
  };

  const getCategoryText = (category?: string) => {
    const value = String(category || '').trim();
    return value || '未分类';
  };

  const hasToolPrompt = (tool: Tool) => {
    return resolveToolPrompt(tool).trim().length > 0;
  };

  const handleCopyToolId = async (toolId: string) => {
    if (!toolId) return;
    try {
      await navigator.clipboard.writeText(toolId);
      setCopiedToolId(toolId);
      window.setTimeout(() => {
        setCopiedToolId((current) => (current === toolId ? '' : current));
      }, 1500);
    } catch {
      alert('复制失败，请手动复制');
    }
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
          <h1 className="text-2xl font-semibold text-gray-900">工具管理</h1>
          <p className="mt-1 text-sm text-gray-500">管理AI Agent可使用的工具和权限</p>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-1 inline-flex">
        <button
          onClick={() => setActiveTab('tools')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeTab === 'tools' ? 'bg-primary-600 text-white' : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          工具
        </button>
        <button
          onClick={() => setActiveTab('logs')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeTab === 'logs' ? 'bg-primary-600 text-white' : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          调用日志
        </button>
        <button
          onClick={() => setActiveTab('permissionSets')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeTab === 'permissionSets' ? 'bg-primary-600 text-white' : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          工具权限集管理
        </button>
      </div>

      {/* 工具统计 */}
      {stats && (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <WrenchScrewdriverIcon className="h-6 w-6 text-blue-600" aria-hidden="true" />
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">总工具数</dt>
                    <dd className="text-lg font-medium text-gray-900">{tools?.length || 0}</dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>
          
          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <PlayIcon className="h-6 w-6 text-green-600" aria-hidden="true" />
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">总执行次数</dt>
                    <dd className="text-lg font-medium text-gray-900">
                      {stats.reduce((sum: number, stat: any) => sum + stat.totalExecutions, 0)}
                    </dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <CheckCircleIcon className="h-6 w-6 text-green-600" aria-hidden="true" />
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">成功率</dt>
                    <dd className="text-lg font-medium text-gray-900">
                      {stats.length > 0 ? 
                        Math.round((stats.reduce((sum: number, stat: any) => sum + stat.successRate, 0) / stats.length) * 100) / 100 
                        : 0}%
                    </dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <CogIcon className="h-6 w-6 text-yellow-600" aria-hidden="true" />
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">24小时调用</dt>
                    <dd className="text-lg font-medium text-gray-900">
                      {executionLast24hCount}
                    </dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'tools' && (
        <div className="bg-white shadow overflow-hidden sm:rounded-md">
          <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <input
                type="text"
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                className="border border-gray-300 rounded-md px-3 py-2 text-sm"
                placeholder="搜索工具名称/ID/描述"
              />
              <select
                value={providerFilter}
                onChange={(e) => setProviderFilter(e.target.value)}
                className="border border-gray-300 rounded-md px-3 py-2 text-sm"
              >
                <option value="">全部 Provider</option>
                {providerOptions.map((provider) => (
                  <option key={provider} value={provider}>{provider}</option>
                ))}
              </select>
              <select
                value={namespaceFilter}
                onChange={(e) => setNamespaceFilter(e.target.value)}
                className="border border-gray-300 rounded-md px-3 py-2 text-sm"
              >
                <option value="">全部 Namespace</option>
                {NAMESPACE_OPTIONS.map((namespace) => (
                  <option key={namespace.value} value={namespace.value}>{namespace.label}</option>
                ))}
              </select>
              <select
                value={toolkitFilter}
                onChange={(e) => setToolkitFilter(e.target.value)}
                className="border border-gray-300 rounded-md px-3 py-2 text-sm"
              >
                <option value="">全部 Toolkit</option>
                {toolkitOptions.map((toolkit) => (
                  <option key={toolkit} value={toolkit}>{getToolkitLabel(toolkit)}</option>
                ))}
              </select>
            </div>
            <div className="mt-3 text-xs text-gray-500 flex flex-wrap gap-x-4 gap-y-1">
              <span>启用工具: {enabledToolsCount}</span>
              <span>Provider: {providerOptions.length}</span>
              <span>Namespace: {NAMESPACE_OPTIONS.length}</span>
              <span>结果数: {filteredTools.length}</span>
            </div>
          </div>
          <ul className="divide-y divide-gray-200">
            {filteredTools.map((tool) => {
              const toolKey = getToolKey(tool);
              const summary = executionSummaryByTool.get(toolKey);
              const successRate = summary && summary.count > 0 ? `${Math.round((summary.successCount / summary.count) * 100)}%` : '暂无';
              const toolkitValue = getToolkitValue(tool);
              return (
                <li key={toolKey || tool.id}>
                  <div className="px-4 py-4 flex items-start sm:px-6">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center flex-wrap gap-2 mb-2">
                        <WrenchScrewdriverIcon className="h-5 w-5 text-gray-400" />
                        <div className="w-full flex items-center gap-2 text-xs text-gray-500">
                          <span className="font-mono">ID: {toolKey || '—'}</span>
                          {toolKey && (
                            <button
                              type="button"
                              onClick={() => handleCopyToolId(toolKey)}
                              className="inline-flex items-center text-gray-500 hover:text-gray-700"
                              title="复制ID"
                            >
                              {copiedToolId === toolKey ? <CheckIcon className="h-3.5 w-3.5" /> : <ClipboardDocumentIcon className="h-3.5 w-3.5" />}
                            </button>
                          )}
                        </div>
                        <p className="text-sm font-medium text-gray-900 truncate">{tool.name}</p>
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                          {getCategoryText(tool.category)}
                        </span>
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          tool.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                        }`}>
                          {tool.enabled ? '启用' : '禁用'}
                        </span>
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          hasToolPrompt(tool) ? 'bg-indigo-100 text-indigo-800' : 'bg-gray-100 text-gray-700'
                        }`}>
                          {hasToolPrompt(tool) ? '有提示词' : '无提示词'}
                        </span>
                        {tool.status && (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                            {tool.status}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-500 mb-2">{tool.description}</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-xs text-gray-600">
                        <span>Provider: {tool.provider || '—'}</span>
                        <span>Namespace: {getNamespaceLabel(tool.namespace)}</span>
                        <span>Toolkit: {getToolkitLabel(toolkitValue)}</span>
                        <span>Action: {tool.action || '—'}</span>
                      </div>
                      <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                        <div className="rounded-md bg-gray-50 px-3 py-2 text-gray-600">调用次数: {summary?.count || 0}</div>
                        <div className="rounded-md bg-gray-50 px-3 py-2 text-gray-600">成功率: {successRate}</div>
                        <div className="rounded-md bg-gray-50 px-3 py-2 text-gray-600">最后调用: {formatDateTime(summary?.lastTimestamp)}</div>
                      </div>
                      {tool.requiredPermissions && tool.requiredPermissions.length > 0 && (
                        <div className="mt-2">
                          <p className="text-xs text-gray-500 mb-1">所需权限:</p>
                          <div className="flex flex-wrap gap-1">
                            {tool.requiredPermissions.map((perm, index) => (
                              <span key={index} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                                {perm.name}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="mt-4 flex-shrink-0 sm:mt-0 sm:ml-5">
                      <div className="flex space-x-2">
                        <button
                          onClick={() => {
                            setActiveTool(tool);
                            setDrawerTab('edit');
                          }}
                          className="inline-flex items-center px-3 py-1.5 border border-gray-200 text-xs font-medium rounded text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
                          title="编辑工具"
                        >
                          <PencilIcon className="h-3 w-3 mr-1" />
                          编辑
                        </button>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          {filteredTools.length === 0 && (
            <div className="text-center py-12">
              <WrenchScrewdriverIcon className="mx-auto h-12 w-12 text-gray-400" />
              <h3 className="mt-2 text-sm font-medium text-gray-900">未找到匹配工具</h3>
              <p className="mt-1 text-sm text-gray-500">请尝试调整筛选或搜索关键词</p>
            </div>
          )}
        </div>
      )}

      {activeTab === 'logs' && (
        <div className="bg-white shadow rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">工具调用日志</h3>
            {!executions || executions.length === 0 ? (
              <p className="text-sm text-gray-500">暂无执行日志</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">工具</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">触发来源</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">状态</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">参数摘要</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">结果摘要</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">时间</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {executions.slice(0, 20).map((execution) => (
                      <tr key={execution.id}>
                        <td className="px-6 py-4 text-sm font-medium text-gray-900">
                          <div>{toolNameMap.get(execution.toolId) || execution.toolId}</div>
                          {execution.legacyToolId && execution.legacyToolId !== execution.toolId && (
                            <div className="text-xs text-gray-400">legacy: {execution.legacyToolId}</div>
                          )}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-500">
                          <div>{execution.taskId ? '任务触发' : '手动触发'}</div>
                          <div className="text-xs text-gray-400">Agent: {execution.agentId || '—'}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            {getStatusIcon(execution.status)}
                            <span className="ml-2 text-sm text-gray-500">{execution.status}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-500 max-w-xs">{summarizeValue(execution.parameters)}</td>
                        <td className="px-6 py-4 text-sm text-gray-500 max-w-xs">
                          {execution.error ? summarizeValue(execution.error) : summarizeValue(execution.result)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{formatDateTime(execution.timestamp)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'permissionSets' && (
        <div className="bg-white shadow overflow-hidden sm:rounded-md">
          <div className="px-4 py-4 border-b border-gray-200 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">工具权限集管理</h2>
              <p className="mt-1 text-sm text-gray-500">按系统角色管理工具白名单与能力集合</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-500">共 {toolPermissionSets?.length || 0} 个权限集</span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">系统角色</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Role Code</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Exposed</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Tools</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Permissions</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(toolPermissionSets || []).map((set) => (
                  <tr key={set.roleCode}>
                    <td className="px-4 py-3 font-medium text-gray-900">{set.roleName || '-'}</td>
                    <td className="px-4 py-3 text-gray-700">{set.roleCode || '-'}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          set.exposed ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {set.exposed ? '是' : '否'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{set.tools?.length || 0}</td>
                    <td className="px-4 py-3 text-gray-700">{set.permissions?.length || set.capabilities?.length || 0}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => setEditingPermissionSet(set)}
                        className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-xs font-medium rounded text-gray-700 bg-white hover:bg-gray-50"
                      >
                        <PencilIcon className="h-3 w-3 mr-1" />
                        编辑权限集
                      </button>
                    </td>
                  </tr>
                ))}
                {(toolPermissionSets || []).length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                      暂无工具权限集
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTool && (
        <ToolActionDrawer
          tool={activeTool}
          agents={agents || []}
          tab={drawerTab}
          onTabChange={setDrawerTab}
          onClose={() => setActiveTool(null)}
          onSave={(updates) => {
            const toolId = getToolKey(activeTool);
            if (!toolId) {
              alert('工具ID无效，无法保存');
              return;
            }
            updateToolMutation.mutate(
              {
                toolId,
                updates,
              },
              {
                onError: (error) => {
                  alert(`保存失败: ${error instanceof Error ? error.message : '未知错误'}`);
                },
              },
            );
          }}
          onDeprecate={() => {
            const toolId = getToolKey(activeTool);
            if (!toolId) {
              alert('工具ID无效，无法弃用');
              return;
            }
            deprecateToolMutation.mutate(toolId, {
              onSuccess: () => {
                setActiveTool(null);
              },
              onError: (error) => {
                alert(`弃用失败: ${error instanceof Error ? error.message : '未知错误'}`);
              },
            });
          }}
          isSaving={updateToolMutation.isLoading}
          isDeprecating={deprecateToolMutation.isLoading}
        />
      )}

      {editingPermissionSet && (
        <EditToolPermissionSetModal
          permissionSet={editingPermissionSet}
          availableTools={tools || []}
          onClose={() => setEditingPermissionSet(null)}
          onSave={(updates) => {
            upsertPermissionSetMutation.mutate({
              roleCode: editingPermissionSet.roleCode,
              updates,
            });
          }}
          isSaving={upsertPermissionSetMutation.isLoading}
        />
      )}
    </div>
  );
};

const ToolActionDrawer: React.FC<{
  tool: Tool;
  agents: any[];
  tab: 'execute' | 'edit';
  onTabChange: (tab: 'execute' | 'edit') => void;
  onClose: () => void;
  onSave: (updates: Partial<Tool>) => void;
  onDeprecate: () => void;
  isSaving: boolean;
  isDeprecating: boolean;
}> = ({ tool, agents, tab, onTabChange, onClose, onSave, onDeprecate, isSaving, isDeprecating }) => {
  const toolKey = getToolKey(tool);
  const { data: toolDetail, isFetching: isLoadingToolDetail } = useQuery(
    ['tool-detail', toolKey],
    () => toolService.getTool(toolKey),
    {
      enabled: Boolean(toolKey),
      staleTime: 0,
    },
  );

  const effectiveTool = toolDetail || tool;
  const inputSchema = resolveToolInputSchema(effectiveTool);

  const [parameters, setParameters] = useState<any>({});
  const [agentId, setAgentId] = useState('');
  const [isExecuting, setIsExecuting] = useState(false);
  const [result, setResult] = useState<any>(null);

  const [name, setName] = useState(effectiveTool.name || '');
  const [description, setDescription] = useState(effectiveTool.description || '');
  const [category, setCategory] = useState(effectiveTool.category || '');
  const [type, setType] = useState(effectiveTool.type || 'custom');
  const [enabled, setEnabled] = useState(effectiveTool.enabled !== false);
  const [status, setStatus] = useState<Tool['status']>(effectiveTool.status || 'active');
  const [prompt, setPrompt] = useState(resolveToolPrompt(effectiveTool));
  const [inputSchemaText, setInputSchemaText] = useState(stringifySchema(inputSchema));
  const [outputSchemaText, setOutputSchemaText] = useState(stringifySchema((effectiveTool as any)?.outputSchema));

  useEffect(() => {
    setParameters({});
    setAgentId('');
    setIsExecuting(false);
    setResult(null);

    setName(effectiveTool.name || '');
    setDescription(effectiveTool.description || '');
    setCategory(effectiveTool.category || '');
    setType(effectiveTool.type || 'custom');
    setEnabled(effectiveTool.enabled !== false);
    setStatus(effectiveTool.status || 'active');
    setPrompt(resolveToolPrompt(effectiveTool));
    setInputSchemaText(stringifySchema(resolveToolInputSchema(effectiveTool)));
    setOutputSchemaText(stringifySchema((effectiveTool as any)?.outputSchema));
  }, [effectiveTool]);

  const handleExecute = async () => {
    setIsExecuting(true);
    try {
      const executionParameters = normalizeExecutionParameters(parameters, inputSchema);
      const executionResult = await toolService.executeTool(getToolKey(effectiveTool), agentId, executionParameters);
      setResult({
        ...executionResult,
        success: executionResult.status === 'completed',
      });
    } catch (error) {
      setResult({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setIsExecuting(false);
    }
  };

  const renderParameterInputs = () => {
    if (!inputSchema?.properties || typeof inputSchema.properties !== 'object') {
      return (
        <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 px-3 py-2 text-xs text-gray-500">
          当前工具未声明参数 Schema，可直接执行空参数。
        </div>
      );
    }

    const required = new Set(Array.isArray(inputSchema.required) ? inputSchema.required.map((item: unknown) => String(item)) : []);
    return Object.entries(inputSchema.properties as Record<string, any>).map(([key, config]) => (
      <div key={key} className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {key} {required.has(key) && <span className="text-red-500">*</span>}
        </label>
        {Array.isArray(config.enum) && config.enum.length > 0 ? (
          <select
            value={parameters[key] ?? ''}
            onChange={(e) => setParameters({ ...parameters, [key]: e.target.value })}
            className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
          >
            <option value="">请选择</option>
            {config.enum.map((item: unknown) => {
              const value = String(item);
              return (
                <option key={value} value={value}>
                  {value}
                </option>
              );
            })}
          </select>
        ) : config.type === 'boolean' ? (
          <label className="inline-flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={Boolean(parameters[key])}
              onChange={(e) => setParameters({ ...parameters, [key]: e.target.checked })}
              className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
            {config.description || '布尔值'}
          </label>
        ) : config.type === 'string' ? (
          <input
            type="text"
            value={parameters[key] || ''}
            onChange={(e) => setParameters({ ...parameters, [key]: e.target.value })}
            className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
            placeholder={config.description || `Enter ${key}`}
          />
        ) : config.type === 'number' || config.type === 'integer' ? (
          <input
            type="number"
            value={parameters[key] || ''}
            onChange={(e) => setParameters({ ...parameters, [key]: Number(e.target.value) })}
            className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
            placeholder={config.description || `Enter ${key}`}
          />
        ) : config.type === 'object' || config.type === 'array' ? (
          <textarea
            value={parameters[key] || ''}
            onChange={(e) => setParameters({ ...parameters, [key]: e.target.value })}
            className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500 font-mono text-xs"
            rows={4}
            placeholder={config.description || `请输入 ${key} 的 JSON`}
          />
        ) : (
          <textarea
            value={parameters[key] || ''}
            onChange={(e) => setParameters({ ...parameters, [key]: e.target.value })}
            className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
            rows={3}
            placeholder={config.description || `Enter ${key}`}
          />
        )}
      </div>
    ));
  };

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-gray-600 bg-opacity-40" onClick={onClose} />
      <aside className="absolute right-0 top-0 h-full w-full max-w-2xl bg-white shadow-2xl border-l border-gray-200 overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">{effectiveTool.name}</h3>
              <p className="text-xs text-gray-500 mt-1">{getToolKey(effectiveTool) || '—'}</p>
            </div>
            <button onClick={onClose} className="px-3 py-1.5 text-sm border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50">
              关闭
            </button>
          </div>
          <div className="mt-4 inline-flex rounded-md border border-gray-200 p-1 bg-gray-50">
            <button
              onClick={() => onTabChange('execute')}
              className={`px-4 py-1.5 text-sm rounded ${tab === 'execute' ? 'bg-primary-600 text-white' : 'text-gray-600 hover:bg-white'}`}
            >
              执行
            </button>
            <button
              onClick={() => onTabChange('edit')}
              className={`px-4 py-1.5 text-sm rounded ${tab === 'edit' ? 'bg-primary-600 text-white' : 'text-gray-600 hover:bg-white'}`}
            >
              修改
            </button>
          </div>
        </div>

        <div className="p-6">
          {tab === 'execute' ? (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">{effectiveTool.description}</p>
              {isLoadingToolDetail && (
                <p className="text-xs text-gray-500">正在同步工具详情...</p>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">选择执行Agent</label>
                <select
                  value={agentId}
                  onChange={(e) => setAgentId(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                >
                  <option value="">选择Agent...</option>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </select>
              </div>
              {renderParameterInputs()}
              {result && (
                <div className={`p-3 rounded ${(result.success ?? result.status === 'completed') ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                  <h4 className={`font-medium ${(result.success ?? result.status === 'completed') ? 'text-green-800' : 'text-red-800'}`}>
                    {(result.success ?? result.status === 'completed') ? '执行成功' : '执行失败'}
                  </h4>
                  <pre className={`mt-2 text-sm ${(result.success ?? result.status === 'completed') ? 'text-green-700' : 'text-red-700'}`}>
                    {JSON.stringify(result, null, 2)}
                  </pre>
                </div>
              )}
              <div className="flex justify-end">
                <button
                  onClick={handleExecute}
                  disabled={!agentId || isExecuting || isSaving || isDeprecating}
                  className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
                >
                  {isExecuting ? '执行中...' : '开始执行'}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-gray-600">
                <div className="rounded-md bg-gray-50 px-3 py-2">Provider: {effectiveTool.provider || '—'}</div>
                <div className="rounded-md bg-gray-50 px-3 py-2">Namespace: {getNamespaceLabel(effectiveTool.namespace)}</div>
                <div className="rounded-md bg-gray-50 px-3 py-2">Toolkit: {getToolkitLabel(getToolkitValue(effectiveTool))}</div>
                <div className="rounded-md bg-gray-50 px-3 py-2">Action: {effectiveTool.action || '—'}</div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">名称</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">描述</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className="block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">分类</label>
                  <input
                    type="text"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">类型</label>
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value as Tool['type'])}
                    className="block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                  >
                    <option value="code_execution">代码执行</option>
                    <option value="web_search">网络搜索</option>
                    <option value="file_operation">文件操作</option>
                    <option value="data_analysis">数据分析</option>
                    <option value="video_editing">视频编辑</option>
                    <option value="api_call">API调用</option>
                    <option value="custom">自定义</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">状态</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as Tool['status'])}
                    className="block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                  >
                    <option value="active">active</option>
                    <option value="hidden">hidden</option>
                    <option value="deprecated">deprecated</option>
                  </select>
                </div>
                <div className="flex items-center pt-6">
                  <input
                    id="edit-tool-enabled"
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => setEnabled(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  <label htmlFor="edit-tool-enabled" className="ml-2 text-sm text-gray-700">
                    启用工具
                  </label>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Prompt（可选）</label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={4}
                  className="block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">输入参数 Schema（JSON）</label>
                <textarea
                  value={inputSchemaText}
                  onChange={(e) => setInputSchemaText(e.target.value)}
                  rows={8}
                  className="block w-full border border-gray-300 rounded-md px-3 py-2 font-mono text-xs focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">输出参数 Schema（JSON，可选）</label>
                <textarea
                  value={outputSchemaText}
                  onChange={(e) => setOutputSchemaText(e.target.value)}
                  rows={6}
                  className="block w-full border border-gray-300 rounded-md px-3 py-2 font-mono text-xs focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                />
              </div>

              <div className="mt-2 p-4 border border-red-200 rounded-md bg-red-50">
                <h4 className="text-sm font-semibold text-red-800">危险操作</h4>
                <p className="mt-1 text-xs text-red-700">弃用后将自动设置为 `status=deprecated` 且 `enabled=false`。</p>
                <button
                  onClick={() => {
                    const confirmed = window.confirm(`确认弃用工具「${tool.name}」吗？\n弃用后该工具将被标记为 deprecated 且禁用。`);
                    if (!confirmed) return;
                    onDeprecate();
                  }}
                  disabled={isSaving || isDeprecating || isExecuting}
                  className="mt-3 inline-flex items-center px-3 py-1.5 border border-red-200 text-xs font-medium rounded text-red-700 bg-white hover:bg-red-100 disabled:opacity-50"
                >
                  <XCircleIcon className="h-3 w-3 mr-1" />
                  {isDeprecating ? '弃用中...' : '弃用工具'}
                </button>
              </div>

              <div className="flex justify-end">
                <button
                  onClick={() => {
                    let nextInputSchema: Record<string, any>;
                    let nextOutputSchema: Record<string, any>;
                    try {
                      nextInputSchema = parseSchemaText(inputSchemaText, '输入参数 Schema');
                      nextOutputSchema = parseSchemaText(outputSchemaText, '输出参数 Schema');
                    } catch (error) {
                      alert(error instanceof Error ? error.message : 'Schema 格式错误');
                      return;
                    }

                    const updates: Partial<Tool> & Record<string, any> = {
                      name: name.trim(),
                      description: description.trim(),
                      category: category.trim(),
                      type,
                      enabled,
                      status,
                      prompt: prompt.trim() || undefined,
                      inputSchema: nextInputSchema,
                      outputSchema: nextOutputSchema,
                    };
                    onSave(updates);
                  }}
                  disabled={isSaving || isDeprecating || isExecuting || !name.trim() || !description.trim()}
                  className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
                >
                  {isSaving ? '保存中...' : '保存'}
                </button>
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
};

const EditToolPermissionSetModal: React.FC<{
  permissionSet: AgentToolPermissionSet;
  availableTools: Array<{ id: string; toolId?: string; name: string; provider?: string; namespace?: string; enabled?: boolean }>;
  onClose: () => void;
  onSave: (updates: Pick<AgentToolPermissionSet, 'tools' | 'permissions' | 'exposed' | 'description'>) => void;
  isSaving: boolean;
}> = ({ permissionSet, availableTools, onClose, onSave, isSaving }) => {
  const editorInitialData = useMemo(
    () => ({
      description: permissionSet.description || '',
      tools: permissionSet.tools || [],
      permissions: permissionSet.permissions || permissionSet.capabilities || [],
      exposed: permissionSet.exposed === true,
    }),
    [permissionSet],
  );

  const [editorData, setEditorData] = useState<ToolPermissionSetEditorData>({
    description: permissionSet.description || '',
    tools: permissionSet.tools || [],
    permissions: permissionSet.permissions || permissionSet.capabilities || [],
    exposed: permissionSet.exposed === true,
  });

  useEffect(() => {
    setEditorData(editorInitialData);
  }, [editorInitialData]);

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
      <div className="relative top-10 mx-auto p-6 border w-[720px] shadow-lg rounded-lg bg-white max-h-[90vh] overflow-y-auto">
        <h3 className="text-xl font-semibold text-gray-900 mb-2">编辑工具权限集</h3>
        <p className="text-sm text-gray-500 mb-5">
          系统角色: <span className="font-medium text-gray-900">{permissionSet.roleName}</span>
          <span className="ml-2 text-xs text-gray-400">({permissionSet.roleCode})</span>
        </p>

        <ToolPermissionSetEditor
          initialData={editorInitialData}
          availableTools={availableTools}
          onChange={setEditorData}
        />

        <div className="flex justify-end space-x-3 mt-6 pt-4 border-t">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
          >
            取消
          </button>
          <button
            onClick={() => onSave(editorData)}
            disabled={isSaving}
            className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
          >
            {isSaving ? '保存中...' : '保存 Profile'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Tools;
