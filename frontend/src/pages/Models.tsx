import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { modelService } from '../services/modelService';
import { AIModel } from '../types';
import { 
  CpuChipIcon, 
  PlusIcon, 
  PencilIcon, 
  TrashIcon,
  MagnifyingGlassIcon,
  FunnelIcon
} from '@heroicons/react/24/outline';

const Models: React.FC = () => {
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingModel, setEditingModel] = useState<AIModel | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [formData, setFormData] = useState<Partial<AIModel>>({
    id: '',
    name: '',
    provider: 'openai',
    model: '',
    maxTokens: 4096,
    temperature: 0.7,
    topP: 1
  });

  const { data: models, isLoading } = useQuery('models', modelService.getAvailableModels);
  const { data: categories } = useQuery('model-categories', modelService.getModelCategories);

  const createModelMutation = useMutation(modelService.createModel, {
    onSuccess: () => {
      queryClient.invalidateQueries('models');
      setIsModalOpen(false);
      resetForm();
    }
  });

  const updateModelMutation = useMutation(
    ({ id, data }: { id: string; data: Partial<AIModel> }) => modelService.updateModel(id, data),
    {
      onSuccess: () => {
        queryClient.invalidateQueries('models');
        setIsModalOpen(false);
        setEditingModel(null);
        resetForm();
      }
    }
  );

  const deleteModelMutation = useMutation(modelService.deleteModel, {
    onSuccess: () => {
      queryClient.invalidateQueries('models');
    }
  });

  const providers = ['all', ...(categories ? Object.keys(categories) : [])];

  const filteredModels = models?.filter(model => {
    const matchesProvider = selectedProvider === 'all' || model.provider === selectedProvider;
    const matchesSearch = searchQuery === '' || 
      model.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      model.id.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesProvider && matchesSearch;
  }) || [];

  const resetForm = () => {
    setFormData({
      id: '',
      name: '',
      provider: 'openai',
      model: '',
      maxTokens: 4096,
      temperature: 0.7,
      topP: 1
    });
  };

  const handleOpenModal = (model?: AIModel) => {
    if (model) {
      setEditingModel(model);
      setFormData({ ...model });
    } else {
      setEditingModel(null);
      resetForm();
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingModel(null);
    resetForm();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingModel) {
      updateModelMutation.mutate({ id: editingModel.id, data: formData });
    } else {
      createModelMutation.mutate(formData as Omit<AIModel, 'id'>);
    }
  };

  const handleDelete = (model: AIModel) => {
    if (window.confirm(`确定要删除模型 "${model.name}" 吗？`)) {
      deleteModelMutation.mutate(model.id);
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

  const getProviderName = (provider: string) => {
    const names: Record<string, string> = {
      'openai': 'OpenAI',
      'anthropic': 'Anthropic',
      'google': 'Google',
      'deepseek': 'DeepSeek',
      'mistral': 'Mistral AI',
      'meta': 'Meta AI',
      'alibaba': 'Alibaba',
      'moonshot': 'Kimi',
      'baichuan': 'Baichuan',
      'zhipu': 'Zhipu AI',
      'xunfei': 'Xunfei',
      'minimax': 'MiniMax',
      'microsoft': 'Microsoft'
    };
    return names[provider] || provider;
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">模型管理</h1>
          <p className="mt-1 text-sm text-gray-500">
            管理AI模型配置，共 {models?.length || 0} 个模型
          </p>
        </div>
        <button
          onClick={() => handleOpenModal()}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-primary-600 hover:bg-primary-700"
        >
          <PlusIcon className="h-4 w-4 mr-2" />
          添加模型
        </button>
      </div>

      {/* 筛选和搜索 */}
      <div className="flex flex-col sm:flex-row gap-4">
        {/* 提供商筛选 */}
        <div className="flex items-center space-x-2 flex-wrap">
          <FunnelIcon className="h-5 w-5 text-gray-400" />
          {providers.map((provider) => (
            <button
              key={provider}
              onClick={() => setSelectedProvider(provider)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                selectedProvider === provider
                  ? 'bg-primary-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {provider === 'all' ? '全部' : getProviderName(provider)}
            </button>
          ))}
        </div>

        {/* 搜索框 */}
        <div className="flex-1 max-w-md min-w-[300px]">
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <MagnifyingGlassIcon className="h-5 w-5 text-gray-400" />
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
              placeholder="搜索模型名称或ID..."
            />
          </div>
        </div>
      </div>

      {/* 模型列表 */}
      <div className="bg-white shadow rounded-lg overflow-hidden max-h-[600px] overflow-y-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                模型名称
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                提供商
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                模型ID
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                参数
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                操作
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {filteredModels.map((model) => (
              <tr key={model.id} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <CpuChipIcon className="h-5 w-5 text-gray-400 mr-2" />
                    <span className="text-sm font-medium text-gray-900">{model.name}</span>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span 
                    className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium text-white"
                    style={{ backgroundColor: getProviderColor(model.provider) }}
                  >
                    {getProviderName(model.provider)}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {model.model}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  <div className="space-y-1">
                    <div>Max Tokens: {model.maxTokens.toLocaleString()}</div>
                    <div>Temperature: {model.temperature}</div>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  <button
                    onClick={() => handleOpenModal(model)}
                    className="text-primary-600 hover:text-primary-900 mr-4"
                  >
                    <PencilIcon className="h-5 w-5" />
                  </button>
                  <button
                    onClick={() => handleDelete(model)}
                    className="text-red-600 hover:text-red-900"
                  >
                    <TrashIcon className="h-5 w-5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        
        {filteredModels.length === 0 && (
          <div className="text-center py-12">
            <CpuChipIcon className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-sm font-medium text-gray-900">没有找到模型</h3>
            <p className="mt-1 text-sm text-gray-500">
              {searchQuery ? '请尝试其他搜索条件' : '点击"添加模型"创建第一个模型'}
            </p>
          </div>
        )}
      </div>

      {/* 添加/编辑模型模态框 */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-[500px] shadow-lg rounded-md bg-white">
            <div className="mt-3">
              <h3 className="text-lg font-medium text-gray-900">
                {editingModel ? '编辑模型' : '添加新模型'}
              </h3>
              <form onSubmit={handleSubmit} className="mt-4 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">模型ID</label>
                  <input
                    type="text"
                    required
                    disabled={!!editingModel}
                    value={formData.id}
                    onChange={(e) => setFormData({ ...formData, id: e.target.value })}
                    className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500 disabled:bg-gray-100"
                    placeholder="例如: gpt-4-turbo"
                  />
                  <p className="mt-1 text-xs text-gray-500">唯一标识符，创建后不可修改</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">显示名称</label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                    placeholder="例如: GPT-4 Turbo"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">提供商</label>
                  <select
                    value={formData.provider}
                    onChange={(e) => setFormData({ ...formData, provider: e.target.value as AIModel['provider'] })}
                    className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                  >
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="google">Google</option>
                    <option value="deepseek">DeepSeek</option>
                    <option value="mistral">Mistral AI</option>
                    <option value="meta">Meta AI</option>
                    <option value="alibaba">Alibaba</option>
                    <option value="moonshot">Kimi (Moonshot)</option>
                    <option value="baichuan">Baichuan</option>
                    <option value="zhipu">Zhipu AI</option>
                    <option value="xunfei">Xunfei</option>
                    <option value="minimax">MiniMax</option>
                    <option value="microsoft">Microsoft</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">API模型名称</label>
                  <input
                    type="text"
                    required
                    value={formData.model}
                    onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                    className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                    placeholder="例如: gpt-4-turbo-preview"
                  />
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Max Tokens</label>
                    <input
                      type="number"
                      required
                      value={formData.maxTokens}
                      onChange={(e) => setFormData({ ...formData, maxTokens: Number(e.target.value) })}
                      className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Temperature</label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="2"
                      value={formData.temperature}
                      onChange={(e) => setFormData({ ...formData, temperature: Number(e.target.value) })}
                      className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Top P</label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="1"
                      value={formData.topP}
                      onChange={(e) => setFormData({ ...formData, topP: Number(e.target.value) })}
                      className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                    />
                  </div>
                </div>

                <div className="flex justify-end space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={handleCloseModal}
                    className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={createModelMutation.isLoading || updateModelMutation.isLoading}
                    className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
                  >
                    {createModelMutation.isLoading || updateModelMutation.isLoading
                      ? '保存中...'
                      : editingModel
                      ? '更新'
                      : '创建'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Models;
