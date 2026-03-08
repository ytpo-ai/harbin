import React, { useMemo, useState } from 'react';
import { useQuery } from 'react-query';
import { toolService } from '../services/toolService';
import { agentService } from '../services/agentService';
import { 
  WrenchScrewdriverIcon, 
  PlayIcon, 
  ClockIcon, 
  CheckCircleIcon, 
  XCircleIcon,
  PlusIcon,
  CogIcon
} from '@heroicons/react/24/outline';
import type { Tool } from '../types';

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

const Tools: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'tools' | 'logs'>('tools');
  const [selectedTool, setSelectedTool] = useState<any>(null);
  const [executionModalOpen, setExecutionModalOpen] = useState(false);
  const [providerFilter, setProviderFilter] = useState('');
  const [namespaceFilter, setNamespaceFilter] = useState('');
  const [toolkitIdFilter, setToolkitIdFilter] = useState('');

  const { data: tools, isLoading } = useQuery(
    ['tool-registry', providerFilter, namespaceFilter, toolkitIdFilter],
    () =>
      toolService.getToolRegistry({
        provider: providerFilter || undefined,
        namespace: namespaceFilter || undefined,
        toolkitId: toolkitIdFilter || undefined,
      }),
  );
  const { data: executions } = useQuery('tool-executions', () => toolService.getToolExecutions());
  const { data: stats } = useQuery('tool-stats', toolService.getToolExecutionStats);
  const { data: agents } = useQuery('agents', agentService.getAgents);

  const providerOptions = useMemo(() => {
    return Array.from(new Set((tools || []).map((tool) => String(tool.provider || '').trim()).filter(Boolean))).sort();
  }, [tools]);

  const namespaceOptions = useMemo(() => {
    return Array.from(new Set((tools || []).map((tool) => String(tool.namespace || '').trim()).filter(Boolean))).sort();
  }, [tools]);

  const toolkitIdOptions = useMemo(() => {
    return Array.from(new Set((tools || []).map((tool) => String(tool.toolkitId || '').trim()).filter(Boolean))).sort();
  }, [tools]);

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
    return (tools || []).filter((tool) => tool.enabled).length;
  }, [tools]);

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
        <button
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
        >
          <PlusIcon className="h-4 w-4 mr-2" />
          添加工具
        </button>
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
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
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
                {namespaceOptions.map((namespace) => (
                  <option key={namespace} value={namespace}>{namespace}</option>
                ))}
              </select>
              <select
                value={toolkitIdFilter}
                onChange={(e) => setToolkitIdFilter(e.target.value)}
                className="border border-gray-300 rounded-md px-3 py-2 text-sm"
              >
                <option value="">全部 Toolkit</option>
                {toolkitIdOptions.map((toolkitId) => (
                  <option key={toolkitId} value={toolkitId}>{toolkitId}</option>
                ))}
              </select>
            </div>
            <div className="mt-3 text-xs text-gray-500 flex flex-wrap gap-x-4 gap-y-1">
              <span>启用工具: {enabledToolsCount}</span>
              <span>Provider: {providerOptions.length}</span>
              <span>Namespace: {namespaceOptions.length}</span>
            </div>
          </div>
          <ul className="divide-y divide-gray-200">
            {tools?.map((tool) => {
              const summary = executionSummaryByTool.get(getToolKey(tool));
              const successRate = summary && summary.count > 0 ? `${Math.round((summary.successCount / summary.count) * 100)}%` : '暂无';
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
                        <span>Namespace: {tool.namespace || '—'}</span>
                        <span>Toolkit: {tool.toolkitId || '—'}</span>
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

          {tools?.length === 0 && (
            <div className="text-center py-12">
              <WrenchScrewdriverIcon className="mx-auto h-12 w-12 text-gray-400" />
              <h3 className="mt-2 text-sm font-medium text-gray-900">没有工具</h3>
              <p className="mt-1 text-sm text-gray-500">添加第一个工具开始使用</p>
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
