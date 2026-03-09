import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from 'react-query';
import { toolService } from '../services/toolService';
import { agentService } from '../services/agentService';
import type { AgentToolPermissionSet } from '../services/agentService';
import { 
  WrenchScrewdriverIcon, 
  PlayIcon, 
  ClockIcon, 
  CheckCircleIcon, 
  XCircleIcon,
  CogIcon,
  PencilIcon,
} from '@heroicons/react/24/outline';
import type { Tool } from '../types';

const NAMESPACE_OPTIONS = [
  { value: 'sys-mg', label: '系统管理' },
  { value: 'communication', label: '通讯工具' },
  { value: 'web-retrieval', label: 'WEB信息检索收集' },
  { value: 'data-analysis', label: '数据分析' },
  { value: 'other', label: '其他' },
] as const;

const NAMESPACE_ALIAS_MAP: Record<string, string> = {
  'sys-mg': 'sys-mg',
  '系统管理': 'sys-mg',
  communication: 'communication',
  '通讯工具': 'communication',
  'web-retrieval': 'web-retrieval',
  'web信息检索收集': 'web-retrieval',
  'web信息检索搜集': 'web-retrieval',
  'web information retrieval': 'web-retrieval',
  'data-analysis': 'data-analysis',
  '数据分析': 'data-analysis',
  other: 'other',
  '其他': 'other',
};

const NAMESPACE_LABEL_MAP = NAMESPACE_OPTIONS.reduce<Record<string, string>>((acc, item) => {
  acc[item.value] = item.label;
  return acc;
}, {});

const getToolKey = (tool?: Partial<Tool> | null): string => {
  return String(tool?.toolId || tool?.id || '').trim();
};

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

const normalizeNamespace = (namespace?: string) => {
  const raw = String(namespace || '').trim();
  if (!raw) return '';
  return NAMESPACE_ALIAS_MAP[raw] || NAMESPACE_ALIAS_MAP[raw.toLowerCase()] || raw;
};

const getNamespaceLabel = (namespace?: string) => {
  const normalized = normalizeNamespace(namespace);
  return NAMESPACE_LABEL_MAP[normalized] || normalized || '—';
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

const getToolProvider = (tool?: Partial<Tool> | null) => {
  return String(tool?.provider || '').trim();
};

const Tools: React.FC = () => {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'tools' | 'logs' | 'permissionSets'>('tools');
  const [selectedTool, setSelectedTool] = useState<any>(null);
  const [executionModalOpen, setExecutionModalOpen] = useState(false);
  const [editingPermissionSet, setEditingPermissionSet] = useState<AgentToolPermissionSet | null>(null);
  const [providerFilter, setProviderFilter] = useState('');
  const [namespaceFilter, setNamespaceFilter] = useState('');
  const [toolkitFilter, setToolkitFilter] = useState('');
  const [searchKeyword, setSearchKeyword] = useState('');

  const { data: tools, isLoading } = useQuery(['tool-registry'], () => toolService.getToolRegistry());
  const { data: executions } = useQuery('tool-executions', () => toolService.getToolExecutions());
  const { data: stats } = useQuery('tool-stats', toolService.getToolExecutionStats);
  const { data: toolPermissionSets } = useQuery('agentToolPermissionSets', agentService.getToolPermissionSets);
  const { data: agents } = useQuery('agents', agentService.getAgents);

  const upsertPermissionSetMutation = useMutation(
    ({ roleCode, updates }: { roleCode: string; updates: Pick<AgentToolPermissionSet, 'tools' | 'capabilities' | 'exposed' | 'description'> }) =>
      agentService.upsertToolPermissionSet(roleCode, updates),
    {
      onSuccess: () => {
        queryClient.invalidateQueries('agentToolPermissionSets');
        setEditingPermissionSet(null);
      },
    },
  );

  const resetPermissionSetMutation = useMutation(agentService.resetToolPermissionSetsBySystemRoles, {
    onSuccess: (result) => {
      queryClient.invalidateQueries('agentToolPermissionSets');
      const missing = (result.missingRoleCodes || []).length
        ? `\n缺失角色: ${(result.missingRoleCodes || []).join(', ')}`
        : '';
      alert(`已按系统角色重置工具权限集。\n重置数量: ${result.resetCount}/${result.totalRoles}${missing}`);
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

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'code_execution': return 'bg-purple-100 text-purple-800';
      case 'web_search': return 'bg-blue-100 text-blue-800';
      case 'file_operation': return 'bg-green-100 text-green-800';
      case 'data_analysis': return 'bg-yellow-100 text-yellow-800';
      case 'video_editing': return 'bg-red-100 text-red-800';
      case 'api_call': return 'bg-indigo-100 text-indigo-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getTypeText = (type: string) => {
    switch (type) {
      case 'code_execution': return '代码执行';
      case 'web_search': return '网络搜索';
      case 'file_operation': return '文件操作';
      case 'data_analysis': return '数据分析';
      case 'video_editing': return '视频编辑';
      case 'api_call': return 'API调用';
      default: return '其他';
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
              const summary = executionSummaryByTool.get(getToolKey(tool));
              const successRate = summary && summary.count > 0 ? `${Math.round((summary.successCount / summary.count) * 100)}%` : '暂无';
              const toolkitValue = getToolkitValue(tool);
              return (
                <li key={getToolKey(tool) || tool.id}>
                  <div className="px-4 py-4 flex items-start sm:px-6">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center flex-wrap gap-2 mb-2">
                        <WrenchScrewdriverIcon className="h-5 w-5 text-gray-400" />
                        <p className="text-sm font-medium text-gray-900 truncate">{tool.name}</p>
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getTypeColor(tool.type)}`}>
                          {getTypeText(tool.type)}
                        </span>
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          tool.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                        }`}>
                          {tool.enabled ? '启用' : '禁用'}
                        </span>
                        {tool.status && (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                            {tool.status}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-500 mb-2">{tool.description}</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-xs text-gray-600">
                        <span>ID: {getToolKey(tool) || '—'}</span>
                        <span>Provider: {tool.provider || '—'}</span>
                        <span>Namespace: {getNamespaceLabel(tool.namespace)}</span>
                        <span>Toolkit: {getToolkitLabel(toolkitValue)}</span>
                        <span>Resource: {tool.resource || '—'}</span>
                        <span>Action: {tool.action || '—'}</span>
                        <span>分类: {tool.category || '—'}</span>
                        <span>能力标签: {tool.capabilitySet?.length || 0}</span>
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
                            setSelectedTool(tool);
                            setExecutionModalOpen(true);
                          }}
                          className="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded text-white bg-primary-600 hover:bg-primary-700"
                        >
                          <PlayIcon className="h-3 w-3 mr-1" />
                          执行
                        </button>
                        <button
                          className="p-2 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                          title="配置"
                        >
                          <CogIcon className="h-5 w-5" />
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
              <button
                onClick={() => resetPermissionSetMutation.mutate()}
                disabled={resetPermissionSetMutation.isLoading}
                className="inline-flex items-center px-3 py-1.5 border border-primary-200 text-xs font-medium rounded text-primary-700 bg-primary-50 hover:bg-primary-100 disabled:opacity-50"
              >
                {resetPermissionSetMutation.isLoading ? '重置中...' : '按系统角色重置数据'}
              </button>
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
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Capabilities</th>
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
                    <td className="px-4 py-3 text-gray-700">{set.capabilities?.length || 0}</td>
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

      {/* 工具执行模态框 */}
      {executionModalOpen && selectedTool && (
        <ToolExecutionModal
          tool={selectedTool}
          agents={agents || []}
          onClose={() => {
            setExecutionModalOpen(false);
            setSelectedTool(null);
          }}
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

const EditToolPermissionSetModal: React.FC<{
  permissionSet: AgentToolPermissionSet;
  availableTools: Array<{ id: string; toolId?: string; name: string; provider?: string; namespace?: string; enabled?: boolean }>;
  onClose: () => void;
  onSave: (updates: Pick<AgentToolPermissionSet, 'tools' | 'capabilities' | 'exposed' | 'description'>) => void;
  isSaving: boolean;
}> = ({ permissionSet, availableTools, onClose, onSave, isSaving }) => {
  const [description, setDescription] = useState(permissionSet.description || '');
  const [tools, setTools] = useState<string[]>(permissionSet.tools || []);
  const [capabilitiesText, setCapabilitiesText] = useState((permissionSet.capabilities || []).join(', '));
  const [exposed, setExposed] = useState(permissionSet.exposed === true);
  const [providerFilter, setProviderFilter] = useState('');
  const [namespaceFilter, setNamespaceFilter] = useState('');

  const toggleTool = (toolId: string, checked: boolean) => {
    setTools((prev) => (checked ? [...prev, toolId] : prev.filter((id) => id !== toolId)));
  };

  const capabilities = capabilitiesText
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

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
  }, [availableTools, providerFilter, namespaceFilter]);

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
      <div className="relative top-10 mx-auto p-6 border w-[720px] shadow-lg rounded-lg bg-white max-h-[90vh] overflow-y-auto">
        <h3 className="text-xl font-semibold text-gray-900 mb-2">编辑工具权限集</h3>
        <p className="text-sm text-gray-500 mb-5">
          系统角色: <span className="font-medium text-gray-900">{permissionSet.roleName}</span>
          <span className="ml-2 text-xs text-gray-400">({permissionSet.roleCode})</span>
        </p>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">描述</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Capabilities（逗号分隔）</label>
            <input
              type="text"
              value={capabilitiesText}
              onChange={(e) => setCapabilitiesText(e.target.value)}
              className="block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
            />
          </div>

          <div className="flex items-center">
            <input
              id="permission-set-exposed"
              type="checkbox"
              checked={exposed}
              onChange={(e) => setExposed(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
            <label htmlFor="permission-set-exposed" className="ml-2 text-sm text-gray-700">
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

        <div className="flex justify-end space-x-3 mt-6 pt-4 border-t">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
          >
            取消
          </button>
          <button
            onClick={() =>
              onSave({
                tools,
                capabilities,
                exposed,
                description: description.trim(),
              })
            }
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

// 工具执行模态框
const ToolExecutionModal: React.FC<{
  tool: any;
  agents: any[];
  onClose: () => void;
}> = ({ tool, agents, onClose }) => {
  const [parameters, setParameters] = useState<any>({});
  const [agentId, setAgentId] = useState('');
  const [isExecuting, setIsExecuting] = useState(false);
  const [result, setResult] = useState<any>(null);

  const handleExecute = async () => {
    setIsExecuting(true);
    try {
      const executionResult = await toolService.executeTool(getToolKey(tool), agentId, parameters);
      setResult({
        ...executionResult,
        success: executionResult.status === 'completed',
      });
    } catch (error) {
      setResult({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    } finally {
      setIsExecuting(false);
    }
  };

  const renderParameterInputs = () => {
    if (!tool.implementation?.parameters) return null;

    return Object.entries(tool.implementation.parameters).map(([key, config]: [string, any]) => (
      <div key={key} className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {key} {config.required && <span className="text-red-500">*</span>}
        </label>
        {config.type === 'string' ? (
          <input
            type="text"
            value={parameters[key] || ''}
            onChange={(e) => setParameters({ ...parameters, [key]: e.target.value })}
            className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
            placeholder={config.description || `Enter ${key}`}
          />
        ) : config.type === 'number' ? (
          <input
            type="number"
            value={parameters[key] || ''}
            onChange={(e) => setParameters({ ...parameters, [key]: Number(e.target.value) })}
            className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
            placeholder={config.description || `Enter ${key}`}
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
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
      <div className="relative top-20 mx-auto p-5 border w-[600px] shadow-lg rounded-md bg-white">
        <div className="mt-3">
          <h3 className="text-lg font-medium text-gray-900">执行工具: {tool.name}</h3>
          <p className="text-sm text-gray-600 mt-1">{tool.description}</p>
          
          <div className="mt-4 space-y-4">
            {/* Agent选择 */}
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

            {/* 参数输入 */}
            {renderParameterInputs()}

            {/* 执行结果 */}
            {result && (
              <div className={`p-3 rounded ${
                (result.success ?? result.status === 'completed') ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
              }`}>
                <h4 className={`font-medium ${(result.success ?? result.status === 'completed') ? 'text-green-800' : 'text-red-800'}`}>
                  {(result.success ?? result.status === 'completed') ? '执行成功' : '执行失败'}
                </h4>
                <pre className={`mt-2 text-sm ${(result.success ?? result.status === 'completed') ? 'text-green-700' : 'text-red-700'}`}>
                  {JSON.stringify(result, null, 2)}
                </pre>
              </div>
            )}

            {/* 执行状态 */}
            {isExecuting && (
              <div className="text-center py-4">
                <div className="inline-flex items-center">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-600 mr-2"></div>
                  <span className="text-sm text-gray-600">正在执行工具...</span>
                </div>
              </div>
            )}
          </div>

          {/* 操作按钮 */}
          <div className="flex justify-end space-x-3 pt-4">
            <button
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
            >
              关闭
            </button>
            <button
              onClick={handleExecute}
              disabled={!agentId || isExecuting}
              className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
            >
              {isExecuting ? '执行中...' : '开始执行'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Tools;
