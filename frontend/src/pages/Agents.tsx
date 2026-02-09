import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { agentService } from '../services/agentService';
import { Agent } from '../types';
import { PlusIcon, PencilIcon, TrashIcon, PowerIcon } from '@heroicons/react/24/outline';

const Agents: React.FC = () => {
  const queryClient = useQueryClient();
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  const { data: agents, isLoading } = useQuery('agents', agentService.getAgents);

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

  const handleDelete = (id: string) => {
    if (window.confirm('确定要删除这个Agent吗？')) {
      deleteAgentMutation.mutate(id);
    }
  };

  const handleToggleActive = (agent: Agent) => {
    toggleAgentMutation.mutate({ id: agent.id, isActive: !agent.isActive });
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

      {/* Agent列表 */}
      <div className="bg-white shadow overflow-hidden sm:rounded-md">
        <ul className="divide-y divide-gray-200">
          {agents?.map((agent) => (
            <li key={agent.id}>
              <div className="px-4 py-4 flex items-center sm:px-6">
                <div className="min-w-0 flex-1 sm:flex sm:items-center sm:justify-between">
                  <div>
                    <div className="flex items-center text-sm">
                      <p className="font-medium text-gray-900 truncate">{agent.name}</p>
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
                      <span>模型: {agent.model.name}</span>
                      <span>能力: {agent.capabilities.join(', ')}</span>
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
                        className="p-2 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                        title="编辑"
                      >
                        <PencilIcon className="h-5 w-5" />
                      </button>
                      <button
                        onClick={() => handleDelete(agent.id)}
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
          onClose={() => setIsCreateModalOpen(false)}
          onSuccess={() => {
            setIsCreateModalOpen(false);
            queryClient.invalidateQueries('agents');
          }}
        />
      )}
    </div>
  );
};

// 创建Agent模态框组件
const CreateAgentModal: React.FC<{
  onClose: () => void;
  onSuccess: () => void;
}> = ({ onClose, onSuccess }) => {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    name: '',
    type: '',
    description: '',
    systemPrompt: '',
    capabilities: '',
    modelId: '',
  });

  const createAgentMutation = useMutation(agentService.createAgent, {
    onSuccess: () => {
      queryClient.invalidateQueries('agents');
      onSuccess();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const agentData = {
      name: formData.name,
      type: formData.type,
      description: formData.description,
      systemPrompt: formData.systemPrompt,
      capabilities: formData.capabilities.split(',').map(cap => cap.trim()).filter(Boolean),
      model: {
        id: formData.modelId,
        name: 'GPT-4 Turbo', // 临时硬编码
        provider: 'openai' as const,
        model: 'gpt-4-turbo-preview',
        maxTokens: 4096,
        temperature: 0.7,
      },
      isActive: true,
    };

    createAgentMutation.mutate(agentData);
  };

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
      <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
        <div className="mt-3">
          <h3 className="text-lg font-medium text-gray-900">创建新Agent</h3>
          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">名称</label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700">类型</label>
              <input
                type="text"
                required
                value={formData.type}
                onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700">描述</label>
              <textarea
                required
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                rows={3}
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700">系统提示</label>
              <textarea
                required
                value={formData.systemPrompt}
                onChange={(e) => setFormData({ ...formData, systemPrompt: e.target.value })}
                className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                rows={4}
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700">能力 (逗号分隔)</label>
              <input
                type="text"
                value={formData.capabilities}
                onChange={(e) => setFormData({ ...formData, capabilities: e.target.value })}
                className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                placeholder="例如: 文本生成, 代码编写, 数据分析"
              />
            </div>
            
            <div className="flex justify-end space-x-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={createAgentMutation.isLoading}
                className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
              >
                {createAgentMutation.isLoading ? '创建中...' : '创建'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Agents;