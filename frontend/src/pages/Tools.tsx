import React, { useState } from 'react';
import { useQuery } from 'react-query';
import { toolService } from '../services/toolService';
import { 
  WrenchScrewdriverIcon, 
  PlayIcon, 
  ClockIcon, 
  CheckCircleIcon, 
  XCircleIcon,
  PlusIcon,
  CogIcon
} from '@heroicons/react/24/outline';

const Tools: React.FC = () => {
  const [selectedTool, setSelectedTool] = useState<any>(null);
  const [executionModalOpen, setExecutionModalOpen] = useState(false);

  const { data: tools, isLoading } = useQuery('tools', toolService.getTools);
  const { data: executions } = useQuery('tool-executions', () => toolService.getToolExecutions());
  const { data: stats } = useQuery('tool-stats', toolService.getToolExecutionStats);

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
                    <dt className="text-sm font-medium text-gray-500 truncate">平均执行时间</dt>
                    <dd className="text-lg font-medium text-gray-900">
                      {stats.length > 0 ? 
                        Math.round((stats.reduce((sum: number, stat: any) => sum + stat.avgExecutionTime, 0) / stats.length)) 
                        : 0}ms
                    </dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 工具列表 */}
      <div className="bg-white shadow overflow-hidden sm:rounded-md">
        <ul className="divide-y divide-gray-200">
          {tools?.map((tool) => (
            <li key={tool.id}>
              <div className="px-4 py-4 flex items-center sm:px-6">
                <div className="min-w-0 flex-1 sm:flex sm:items-center sm:justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-3 mb-2">
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
                    </div>
                    <p className="text-sm text-gray-500 mb-2">{tool.description}</p>
                    <div className="flex items-center space-x-4 text-sm text-gray-500">
                      <span>分类: {tool.category}</span>
                      <span>Token成本: {tool.tokenCost || 0}</span>
                      <span>执行时间: {tool.executionTime || 0}ms</span>
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
              </div>
            </li>
          ))}
        </ul>
        
        {tools?.length === 0 && (
          <div className="text-center py-12">
            <WrenchScrewdriverIcon className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-sm font-medium text-gray-900">没有工具</h3>
            <p className="mt-1 text-sm text-gray-500">添加第一个工具开始使用</p>
          </div>
        )}
      </div>

      {/* 执行历史 */}
      {executions && executions.length > 0 && (
        <div className="bg-white shadow rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">最近执行历史</h3>
            <div className="overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      工具
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Agent
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      状态
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Token消耗
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      执行时间
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      时间
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {executions.slice(0, 10).map((execution) => (
                    <tr key={execution.id}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {execution.toolId}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {execution.agentId}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          {getStatusIcon(execution.status)}
                          <span className="ml-2 text-sm text-gray-500">{execution.status}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {execution.tokenCost}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {execution.executionTime}ms
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {new Date(execution.timestamp).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 工具执行模态框 */}
      {executionModalOpen && selectedTool && (
        <ToolExecutionModal
          tool={selectedTool}
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
  onClose: () => void;
}> = ({ tool, onClose }) => {
  const [parameters, setParameters] = useState<any>({});
  const [agentId, setAgentId] = useState('');
  const [isExecuting, setIsExecuting] = useState(false);
  const [result, setResult] = useState<any>(null);

  const handleExecute = async () => {
    setIsExecuting(true);
    try {
      // 这里应该调用实际的工具执行API
      console.log('Executing tool:', tool.id, 'with parameters:', parameters);
      
      // 模拟执行结果
      setTimeout(() => {
        setResult({
          success: true,
          output: `工具 ${tool.name} 执行成功`,
          executionTime: Math.random() * 1000,
          tokenCost: tool.tokenCost || 0
        });
        setIsExecuting(false);
      }, 2000);
    } catch (error) {
      setResult({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
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
                {/* 这里应该加载实际的Agent列表 */}
                <option value="agent-1">Agent 1</option>
                <option value="agent-2">Agent 2</option>
              </select>
            </div>

            {/* 参数输入 */}
            {renderParameterInputs()}

            {/* 执行结果 */}
            {result && (
              <div className={`p-3 rounded ${
                result.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
              }`}>
                <h4 className={`font-medium ${result.success ? 'text-green-800' : 'text-red-800'}`}>
                  {result.success ? '执行成功' : '执行失败'}
                </h4>
                <pre className={`mt-2 text-sm ${result.success ? 'text-green-700' : 'text-red-700'}`}>
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