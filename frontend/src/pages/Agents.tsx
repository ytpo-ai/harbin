import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { agentService } from '../services/agentService';
import type { AgentTestResult } from '../services/agentService';
import { modelService } from '../services/modelService';
import { apiKeyService } from '../services/apiKeyService';
import { Agent, AIModel } from '../types';
import { 
  PlusIcon, 
  PencilIcon, 
  TrashIcon, 
  PowerIcon, 
  UserGroupIcon,
  CpuChipIcon,
  BuildingOfficeIcon,
  CheckCircleIcon,
  LockClosedIcon,
  BeakerIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';

const Agents: React.FC = () => {
  const queryClient = useQueryClient();
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModelModalOpen, setIsEditModelModalOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);

  const getAgentId = (agent: Agent | null): string => {
    const withMongoId = agent as (Agent & { _id?: string }) | null;
    return withMongoId?.id || withMongoId?._id || '';
  };

  const { data: agents, isLoading } = useQuery('agents', agentService.getAgents);
  const { data: availableModels } = useQuery('models', modelService.getAvailableModels);

  const deleteAgentMutation = useMutation(agentService.deleteAgent, {
    onSuccess: () => {
      queryClient.invalidateQueries('agents');
    },
  });

  const toggleAgentMutation = useMutation(
    ({ id, isActive }: { id: string; isActive: boolean }) => 
      agentService.updateAgent(id, { isActive }),
    {
      onSuccess: () => {
        queryClient.invalidateQueries('agents');
      },
    }
  );

  const updateAgentModelMutation = useMutation(
    ({ id, model }: { id: string; model: AIModel }) => 
      agentService.updateAgent(id, { model }),
    {
      onSuccess: () => {
        queryClient.invalidateQueries('agents');
        setIsEditModelModalOpen(false);
        setEditingAgent(null);
      },
    }
  );

  const testAgentModelMutation = useMutation(
    ({ id, model }: { id: string; model: AIModel }) =>
      agentService.testAgent(id, { model }),
  );

  const handleDelete = (agent: Agent) => {
    const id = getAgentId(agent);
    if (!id) {
      alert('Agent ID 无效，无法删除');
      return;
    }
    if (window.confirm('确定要删除这个Agent吗？')) {
      deleteAgentMutation.mutate(id);
    }
  };

  const handleToggleActive = (agent: Agent) => {
    const id = getAgentId(agent);
    if (!id) {
      alert('Agent ID 无效，无法更新状态');
      return;
    }
    toggleAgentMutation.mutate({ id, isActive: !agent.isActive });
  };

  const handleEditModel = (agent: Agent) => {
    setEditingAgent(agent);
    setIsEditModelModalOpen(true);
  };

  const isFounder = (agent: Agent) => {
    return agent.type === 'ai-executive' || agent.name === 'Alex Chen' || agent.name === 'Sarah Kim';
  };

  const getFounderRole = (agent: Agent) => {
    if (agent.name === 'Alex Chen') return 'CEO';
    if (agent.name === 'Sarah Kim') return 'CTO';
    return null;
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
      {/* 页面标题和操作 */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Agent管理</h1>
          <p className="mt-1 text-sm text-gray-500">管理和配置AI Agent</p>
        </div>
        <button
          onClick={() => setIsCreateModalOpen(true)}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
        >
          <PlusIcon className="h-4 w-4 mr-2" />
          创建Agent
        </button>
      </div>

      {/* 创始人模型配置区域 */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-6">
        <div className="flex items-center mb-4">
          <BuildingOfficeIcon className="h-6 w-6 text-blue-600 mr-2" />
          <h2 className="text-lg font-semibold text-gray-900">创始人模型配置</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {agents?.filter(isFounder).map((agent) => (
            <div key={getAgentId(agent) || agent.name} className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center mr-3 ${
                    getFounderRole(agent) === 'CEO' ? 'bg-blue-100 text-blue-600' : 'bg-purple-100 text-purple-600'
                  }`}>
                    <span className="font-bold text-sm">{getFounderRole(agent)}</span>
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">{agent.name}</h3>
                    <p className="text-sm text-gray-500">{agent.description}</p>
                  </div>
                </div>
                <button
                  onClick={() => handleEditModel(agent)}
                  className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-xs font-medium rounded text-gray-700 bg-white hover:bg-gray-50"
                >
                  <CpuChipIcon className="h-3 w-3 mr-1" />
                  更换模型
                </button>
              </div>
              <div className="flex items-center justify-between p-2 bg-gray-50 rounded text-sm">
                <span className="text-gray-600">当前模型:</span>
                <div className="flex items-center">
                  <span className="font-medium text-gray-900">{agent.model?.name}</span>
                  <span className="ml-2 text-xs text-gray-500">({agent.model?.provider})</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Agent列表 */}
      <div className="bg-white shadow overflow-hidden sm:rounded-md">
        <ul className="divide-y divide-gray-200">
          {agents?.map((agent) => (
            <li key={getAgentId(agent) || agent.name}>
              <div className="px-4 py-4 flex items-center sm:px-6">
                <div className="min-w-0 flex-1 sm:flex sm:items-center sm:justify-between">
                  <div>
                    <div className="flex items-center text-sm">
                      <p className="font-medium text-gray-900 truncate">{agent.name}</p>
                      {isFounder(agent) && (
                        <span className={`ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          getFounderRole(agent) === 'CEO' 
                            ? 'bg-blue-100 text-blue-800' 
                            : 'bg-purple-100 text-purple-800'
                        }`}>
                          {getFounderRole(agent)}
                        </span>
                      )}
                      <span className={`ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        agent.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                      }`}>
                        {agent.isActive ? '活跃' : '非活跃'}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center text-sm text-gray-500">
                      <p className="truncate">{agent.description}</p>
                    </div>
                    <div className="mt-2 flex items-center space-x-4 text-sm text-gray-500">
                      <span>类型: {agent.type}</span>
                      <span className="flex items-center">
                        <CpuChipIcon className="h-3 w-3 mr-1" />
                        {agent.model?.name}
                      </span>
                      <span>能力: {agent.capabilities?.slice(0, 3).join(', ')}{agent.capabilities?.length > 3 ? '...' : ''}</span>
                    </div>
                  </div>
                  <div className="mt-4 flex-shrink-0 sm:mt-0 sm:ml-5">
                    <div className="flex space-x-2">
                      <button
                        onClick={() => handleToggleActive(agent)}
                        className="p-2 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                        title={agent.isActive ? '停用' : '启用'}
                      >
                        <PowerIcon className="h-5 w-5" />
                      </button>
                      <button
                        onClick={() => handleEditModel(agent)}
                        className="p-2 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                        title="编辑模型"
                      >
                        <CpuChipIcon className="h-5 w-5" />
                      </button>
                      <button
                        className="p-2 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                        title="编辑"
                      >
                        <PencilIcon className="h-5 w-5" />
                      </button>
                      <button
                        onClick={() => handleDelete(agent)}
                        className="p-2 rounded-md text-red-400 hover:text-red-600 hover:bg-red-50"
                        title="删除"
                      >
                        <TrashIcon className="h-5 w-5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
        
        {agents?.length === 0 && (
          <div className="text-center py-12">
            <UserGroupIcon className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-sm font-medium text-gray-900">没有Agent</h3>
            <p className="mt-1 text-sm text-gray-500">开始创建你的第一个AI Agent</p>
            <div className="mt-6">
              <button
                onClick={() => setIsCreateModalOpen(true)}
                className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
              >
                <PlusIcon className="h-4 w-4 mr-2" />
                创建Agent
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 创建Agent模态框 */}
      {isCreateModalOpen && (
        <CreateAgentModal 
          availableModels={availableModels || []}
          onClose={() => setIsCreateModalOpen(false)}
          onSuccess={() => {
            setIsCreateModalOpen(false);
            queryClient.invalidateQueries('agents');
          }}
        />
      )}

      {/* 编辑模型模态框 */}
      {isEditModelModalOpen && editingAgent && (
        <EditModelModal
          agent={editingAgent}
          availableModels={availableModels || []}
          onClose={() => {
            setIsEditModelModalOpen(false);
            setEditingAgent(null);
          }}
          onSave={(model) => {
            const id = getAgentId(editingAgent);
            if (!id) {
              alert('Agent ID 无效，无法保存模型');
              return;
            }
            updateAgentModelMutation.mutate({ id, model });
          }}
          onTest={async (model) => {
            const id = getAgentId(editingAgent);
            if (!id) {
              return {
                success: false,
                error: 'Agent ID 无效，无法测试',
                timestamp: new Date().toISOString(),
              };
            }
            return testAgentModelMutation.mutateAsync({ id, model });
          }}
          isLoading={updateAgentModelMutation.isLoading}
          isTesting={testAgentModelMutation.isLoading}
        />
      )}
    </div>
  );
};

// 创建Agent模态框组件
const CreateAgentModal: React.FC<{
  availableModels: AIModel[];
  onClose: () => void;
  onSuccess: () => void;
}> = ({ availableModels, onClose, onSuccess }) => {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    name: '',
    type: '',
    description: '',
    systemPrompt: '',
    capabilities: '',
    modelId: availableModels[0]?.id || '',
    apiKeyId: '',
  });

  const { data: apiKeys } = useQuery('apiKeys', apiKeyService.getAllApiKeys);
  const selectedModel = availableModels.find(m => m.id === formData.modelId);
  const filteredApiKeys = (apiKeys || []).filter((key) => {
    if (!selectedModel?.provider || !key?.provider) return false;
    return key.provider.toLowerCase() === selectedModel.provider.toLowerCase() && key.isActive;
  });

  const createAgentMutation = useMutation(agentService.createAgent, {
    onSuccess: () => {
      queryClient.invalidateQueries('agents');
      onSuccess();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!selectedModel) {
      alert('请选择一个模型');
      return;
    }

    const agentData = {
      name: formData.name,
      type: formData.type,
      description: formData.description,
      systemPrompt: formData.systemPrompt,
      capabilities: formData.capabilities.split(',').map(cap => cap.trim()).filter(Boolean),
      model: selectedModel,
      apiKeyId: formData.apiKeyId || undefined,
      isActive: true,
      tools: [],
      permissions: [],
      personality: {
        workEthic: 80,
        creativity: 75,
        leadership: 70,
        teamwork: 80
      },
      learningAbility: 80
    };

    createAgentMutation.mutate(agentData as any);
  };

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
      <div className="relative top-10 mx-auto p-6 border w-[600px] shadow-lg rounded-lg bg-white max-h-[90vh] overflow-y-auto">
        <div>
          <h3 className="text-xl font-semibold text-gray-900 mb-6">创建新Agent</h3>
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* 模型选择 - 放在最前面 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <CpuChipIcon className="h-4 w-4 inline mr-1" />
                选择AI模型 <span className="text-red-500">*</span>
              </label>
              <select
                required
                value={formData.modelId}
                onChange={(e) => setFormData({ ...formData, modelId: e.target.value, apiKeyId: '' })}
                className="block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              >
                <option value="">请选择模型...</option>
                {availableModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name} ({model.provider})
                  </option>
                ))}
              </select>
              {selectedModel && (
                <div className="mt-2 p-3 bg-gray-50 rounded-md text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Max Tokens:</span>
                    <span className="font-medium">{selectedModel.maxTokens.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-gray-600">Temperature:</span>
                    <span className="font-medium">{selectedModel.temperature}</span>
                  </div>
                </div>
              )}
            </div>

            {/* API Key选择 */}
            {selectedModel && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <LockClosedIcon className="h-4 w-4 inline mr-1" />
                  选择API密钥
                  <span className="text-xs text-gray-500 ml-1">(可选，使用环境变量作为默认)</span>
                </label>
                <select
                  value={formData.apiKeyId}
                  onChange={(e) => setFormData({ ...formData, apiKeyId: e.target.value })}
                  className="block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                >
                  <option value="">使用系统默认密钥</option>
                  {filteredApiKeys.map((key) => {
                    const keyId = key.id || key._id;
                    const masked = key.keyMasked || '****';
                    return (
                      <option key={keyId} value={keyId}>
                        {masked} ({key.provider})
                      </option>
                    );
                  })}
                </select>
                {filteredApiKeys.length === 0 && selectedModel && (
                  <p className="mt-2 text-sm text-amber-600">
                    未找到 {selectedModel.provider} 的活跃API密钥，将使用系统默认配置
                  </p>
                )}
                {filteredApiKeys.length > 0 && !formData.apiKeyId && (
                  <p className="mt-2 text-sm text-blue-600">
                    已配置 {filteredApiKeys.length} 个 {selectedModel.provider} API密钥可供选择
                  </p>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">名称 <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                  placeholder="例如: 智能助手"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">类型 <span className="text-red-500">*</span></label>
                <select
                  required
                  value={formData.type}
                  onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                  className="block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                >
                  <option value="">选择类型...</option>
                  <option value="ai-executive">执行官</option>
                  <option value="ai-technical">技术专家</option>
                  <option value="ai-developer">开发工程师</option>
                  <option value="ai-analyst">数据分析师</option>
                  <option value="ai-creative">创意设计师</option>
                  <option value="ai-support">客服支持</option>
                </select>
              </div>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">描述</label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                rows={2}
                placeholder="简要描述这个Agent的职责和能力..."
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">系统提示 (System Prompt)</label>
              <textarea
                required
                value={formData.systemPrompt}
                onChange={(e) => setFormData({ ...formData, systemPrompt: e.target.value })}
                className="block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500 font-mono text-sm"
                rows={4}
                placeholder="定义Agent的行为和角色，例如: 你是一位专业的软件工程师..."
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">能力 (逗号分隔)</label>
              <input
                type="text"
                value={formData.capabilities}
                onChange={(e) => setFormData({ ...formData, capabilities: e.target.value })}
                className="block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                placeholder="例如: 文本生成, 代码编写, 数据分析"
              />
            </div>
            
            <div className="flex justify-end space-x-3 pt-4 border-t">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={createAgentMutation.isLoading || !formData.modelId}
                className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
              >
                {createAgentMutation.isLoading ? '创建中...' : '创建Agent'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

// 编辑模型模态框
const EditModelModal: React.FC<{
  agent: Agent;
  availableModels: AIModel[];
  onClose: () => void;
  onSave: (model: AIModel) => void;
  onTest: (model: AIModel) => Promise<AgentTestResult>;
  isLoading: boolean;
  isTesting: boolean;
}> = ({ agent, availableModels, onClose, onSave, onTest, isLoading, isTesting }) => {
  const [selectedModelId, setSelectedModelId] = useState(agent.model?.id || '');
  const [testResult, setTestResult] = useState<AgentTestResult | null>(null);
  const [testedModelId, setTestedModelId] = useState<string | null>(null);
  
  const selectedModel = availableModels.find(m => m.id === selectedModelId);

  const handleSave = () => {
    if (selectedModel) {
      onSave(selectedModel);
    }
  };

  const handleTest = async () => {
    if (!selectedModel) return;
    try {
      const result = await onTest(selectedModel);
      setTestedModelId(selectedModel.id);
      setTestResult(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : '模型测试超时或失败';
      setTestedModelId(selectedModel.id);
      setTestResult({
        success: false,
        error: message,
        timestamp: new Date().toISOString(),
      });
    }
  };

  const getProviderColor = (provider: string) => {
    const colors: Record<string, string> = {
      'openai': '#10a37f',
      'anthropic': '#d97757',
      'google': '#4285f4',
      'deepseek': '#4f46e5',
      'mistral': '#ff7000',
      'meta': '#0668e1',
      'alibaba': '#ff6a00',
      'moonshot': '#000000',
      'baichuan': '#1a73e8',
      'zhipu': '#3b82f6',
      'xunfei': '#0ea5e9',
      'minimax': '#f59e0b',
      'microsoft': '#00a4ef'
    };
    return colors[provider] || '#6b7280';
  };

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
      <div className="relative top-20 mx-auto p-6 border w-[500px] shadow-lg rounded-lg bg-white">
        <div>
          <h3 className="text-xl font-semibold text-gray-900 mb-2">更换模型</h3>
          <p className="text-sm text-gray-500 mb-6">
            为 <span className="font-medium text-gray-900">{agent.name}</span> 选择一个新的AI模型
          </p>

          {/* 当前模型 */}
          <div className="mb-6 p-4 bg-gray-50 rounded-lg">
            <p className="text-sm text-gray-600 mb-1">当前模型</p>
            <div className="flex items-center">
              <span className="font-medium text-gray-900">{agent.model?.name}</span>
              <span 
                className="ml-2 px-2 py-0.5 rounded text-xs text-white"
                style={{ backgroundColor: getProviderColor(agent.model?.provider || '') }}
              >
                {agent.model?.provider}
              </span>
            </div>
          </div>

          {/* 模型选择 */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              选择新模型 <span className="text-red-500">*</span>
            </label>
            <select
              value={selectedModelId}
              onChange={(e) => {
                setSelectedModelId(e.target.value);
                setTestResult(null);
                setTestedModelId(null);
              }}
              className="block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
            >
              <option value="">请选择模型...</option>
              {availableModels.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name} ({model.provider})
                </option>
              ))}
            </select>
          </div>

          {/* 新模型信息 */}
          {selectedModel && (
            <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex items-center mb-3">
                <CheckCircleIcon className="h-5 w-5 text-blue-600 mr-2" />
                <span className="font-medium text-blue-900">新模型信息</span>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-blue-700">模型名称:</span>
                  <span className="font-medium text-blue-900">{selectedModel.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-blue-700">提供商:</span>
                  <span 
                    className="px-2 py-0.5 rounded text-xs text-white"
                    style={{ backgroundColor: getProviderColor(selectedModel.provider) }}
                  >
                    {selectedModel.provider}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-blue-700">Max Tokens:</span>
                  <span className="font-medium">{selectedModel.maxTokens.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-blue-700">Temperature:</span>
                  <span className="font-medium">{selectedModel.temperature}</span>
                </div>
              </div>
            </div>
          )}

          {/* 模型测试 */}
          <div className="mb-6">
            <button
              onClick={handleTest}
              disabled={isTesting || !selectedModel}
              className="inline-flex items-center px-4 py-2 border border-indigo-300 text-sm font-medium rounded-md text-indigo-700 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-50"
            >
              <BeakerIcon className="h-4 w-4 mr-1" />
              {isTesting ? '测试中...' : '测试模型连接'}
            </button>
            <p className="mt-2 text-xs text-gray-500">会用当前Agent设定向所选模型发送一条测试消息。</p>

            {testResult && testedModelId === selectedModelId && (
              <div className={`mt-3 p-3 rounded-md border ${testResult.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                <div className="flex items-center mb-1">
                  {testResult.success ? (
                    <CheckCircleIcon className="h-4 w-4 text-green-600 mr-1" />
                  ) : (
                    <XCircleIcon className="h-4 w-4 text-red-600 mr-1" />
                  )}
                  <span className={`text-sm font-medium ${testResult.success ? 'text-green-800' : 'text-red-800'}`}>
                    {testResult.success ? '模型连接成功' : '模型连接失败'}
                  </span>
                </div>
                <div className={`text-xs ${testResult.success ? 'text-green-700' : 'text-red-700'}`}>
                  {testResult.success ? (
                    <>
                      <p>耗时: {testResult.duration || '-'}</p>
                      <p>密钥来源: {testResult.keySource === 'custom' ? 'Agent绑定密钥' : '系统默认密钥'}</p>
                      {testResult.note && <p className="mt-1 break-words">说明: {testResult.note}</p>}
                      <p className="mt-1 break-words">响应: {testResult.response || '-'}</p>
                    </>
                  ) : (
                    <>
                      <p>密钥来源: {testResult.keySource === 'custom' ? 'Agent绑定密钥' : '系统默认密钥'}</p>
                      <p className="break-words">错误: {testResult.error || '未知错误'}</p>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 按钮 */}
          <div className="flex justify-end space-x-3">
            <button
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
            >
              取消
            </button>
            <button
              onClick={handleSave}
              disabled={isLoading || !selectedModelId || selectedModelId === agent.model?.id}
              className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
            >
              {isLoading ? '保存中...' : '确认更换'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Agents;
