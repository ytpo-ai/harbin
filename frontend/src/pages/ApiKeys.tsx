import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { apiKeyService } from '../services/apiKeyService';
import { 
  KeyIcon, 
  PlusIcon, 
  PencilIcon, 
  TrashIcon,
  ShieldCheckIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  BuildingOfficeIcon
} from '@heroicons/react/24/outline';

import { ApiKey } from '../services/apiKeyService';

const PROVIDERS = [
  { id: 'openai', name: 'OpenAI', color: '#10a37f', category: 'LLM' },
  { id: 'anthropic', name: 'Anthropic', color: '#d97757', category: 'LLM' },
  { id: 'google', name: 'Google', color: '#4285f4', category: 'LLM' },
  { id: 'deepseek', name: 'DeepSeek', color: '#4f46e5', category: 'LLM' },
  { id: 'mistral', name: 'Mistral AI', color: '#ff7000', category: 'LLM' },
  { id: 'meta', name: 'Meta AI', color: '#0668e1', category: 'LLM' },
  { id: 'alibaba', name: 'Alibaba', color: '#ff6a00', category: 'LLM' },
  { id: 'moonshot', name: 'Kimi', color: '#000000', category: 'LLM' },
  { id: 'baichuan', name: 'Baichuan', color: '#1a73e8', category: 'LLM' },
  { id: 'zhipu', name: 'Zhipu AI', color: '#3b82f6', category: 'LLM' },
  { id: 'xunfei', name: 'Xunfei', color: '#0ea5e9', category: 'LLM' },
  { id: 'minimax', name: 'MiniMax', color: '#f59e0b', category: 'LLM' },
  { id: 'microsoft', name: 'Microsoft', color: '#00a4ef', category: 'LLM' },
  { id: 'github', name: 'GitHub', color: '#24292e', category: 'OTHER' },
  { id: 'github-enterprise', name: 'GitHub Enterprise', color: '#0366d6', category: 'OTHER' },
];

const ApiKeys: React.FC = () => {
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingKey, setEditingKey] = useState<ApiKey | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<string>('all');
  const [selectedCategory, setSelectedCategory] = useState<'LLM' | 'OTHER' | 'all'>('all');

  const { data: apiKeys, isLoading } = useQuery('api-keys', apiKeyService.getAllApiKeys);
  const { data: stats } = useQuery('api-key-stats', apiKeyService.getApiKeyStats);

  const createMutation = useMutation(apiKeyService.createApiKey, {
    onSuccess: () => {
      queryClient.invalidateQueries('api-keys');
      queryClient.invalidateQueries('api-key-stats');
      setIsModalOpen(false);
    }
  });

  const updateMutation = useMutation(
    ({ id, data }: { id: string; data: Partial<ApiKey> }) => apiKeyService.updateApiKey(id, data),
    {
      onSuccess: () => {
        queryClient.invalidateQueries('api-keys');
        setIsModalOpen(false);
        setEditingKey(null);
      }
    }
  );

  const deleteMutation = useMutation(apiKeyService.deleteApiKey, {
    onSuccess: () => {
      queryClient.invalidateQueries('api-keys');
      queryClient.invalidateQueries('api-key-stats');
    }
  });

  const filteredKeys = apiKeys?.filter(key => 
    (selectedProvider === 'all' || key.provider === selectedProvider) &&
    (selectedCategory === 'all' || (key.category || 'LLM') === selectedCategory)
  ) || [];

  const getProviderInfo = (providerId: string) => {
    return PROVIDERS.find(p => p.id === providerId) || { name: providerId, color: '#6b7280' };
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
          <h1 className="text-2xl font-semibold text-gray-900">API Key 管理</h1>
          <p className="mt-1 text-sm text-gray-500">
            管理不同AI提供商的API密钥，共 {apiKeys?.length || 0} 个密钥
          </p>
        </div>
        <button
          onClick={() => {
            setEditingKey(null);
            setIsModalOpen(true);
          }}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-primary-600 hover:bg-primary-700"
        >
          <PlusIcon className="h-4 w-4 mr-2" />
          添加 API Key
        </button>
      </div>

      {/* 统计卡片 */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-lg shadow p-4">
            <div className="flex items-center">
              <KeyIcon className="h-8 w-8 text-blue-600" />
              <div className="ml-3">
                <p className="text-sm text-gray-500">总密钥数</p>
                <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="flex items-center">
              <CheckCircleIcon className="h-8 w-8 text-green-600" />
              <div className="ml-3">
                <p className="text-sm text-gray-500">活跃密钥</p>
                <p className="text-2xl font-bold text-gray-900">{stats.active}</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="flex items-center">
              <ShieldCheckIcon className="h-8 w-8 text-purple-600" />
              <div className="ml-3">
                <p className="text-sm text-gray-500">提供商数量</p>
                <p className="text-2xl font-bold text-gray-900">{stats.byProvider?.length || 0}</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="flex items-center">
              <BuildingOfficeIcon className="h-8 w-8 text-orange-600" />
              <div className="ml-3">
                <p className="text-sm text-gray-500">总调用次数</p>
                <p className="text-2xl font-bold text-gray-900">
                  {apiKeys?.reduce((sum, key) => sum + key.useCount, 0) || 0}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 分类切换 */}
      <div className="bg-white rounded-lg shadow p-4">
        <h3 className="text-sm font-medium text-gray-700 mb-3">分类</h3>
        <div className="flex gap-2">
          <button
            onClick={() => setSelectedCategory('all')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              selectedCategory === 'all'
                ? 'bg-primary-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            全部
          </button>
          <button
            onClick={() => setSelectedCategory('LLM')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              selectedCategory === 'LLM'
                ? 'bg-primary-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            LLM
          </button>
          <button
            onClick={() => setSelectedCategory('OTHER')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              selectedCategory === 'OTHER'
                ? 'bg-primary-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            其他
          </button>
        </div>
      </div>

      {/* 提供商分布 */}
      <div className="bg-white rounded-lg shadow p-4">
        <h3 className="text-sm font-medium text-gray-700 mb-3">按提供商分布</h3>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setSelectedProvider('all')}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              selectedProvider === 'all'
                ? 'bg-primary-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            全部
          </button>
          {stats?.byProvider?.map((item: any) => {
            const provider = getProviderInfo(item._id);
            return (
              <button
                key={item._id}
                onClick={() => setSelectedProvider(item._id)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors flex items-center ${
                  selectedProvider === item._id
                    ? 'bg-primary-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <span 
                  className="w-2 h-2 rounded-full mr-2"
                  style={{ backgroundColor: provider.color }}
                ></span>
                {provider.name}
                <span className="ml-1 text-xs opacity-75">({item.count})</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* API Key 列表 */}
      <div className="bg-white shadow rounded-lg overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                名称
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                提供商
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                分类
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                API Key
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                状态
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                使用统计
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                操作
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {filteredKeys.map((apiKey) => {
              const provider = getProviderInfo(apiKey.provider);
              
              return (
                <tr key={apiKey.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <KeyIcon className="h-5 w-5 text-gray-400 mr-2" />
                      <div>
                        <div className="text-sm font-medium text-gray-900">{apiKey.name}</div>
                        {apiKey.description && (
                          <div className="text-xs text-gray-500">{apiKey.description}</div>
                        )}
                      </div>
                    </div>
                  </td>
                   <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <span 
                          className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium text-white"
                          style={{ backgroundColor: provider.color }}
                        >
                          {provider.name}
                        </span>
                        {apiKey.isDefault && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                            默认
                          </span>
                        )}
                        {apiKey.isDeprecated && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-200 text-gray-700">
                            已弃用
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        apiKey.category === 'LLM' 
                          ? 'bg-blue-100 text-blue-800' 
                          : 'bg-purple-100 text-purple-800'
                      }`}>
                        {apiKey.category === 'LLM' ? 'LLM' : '其他'}
                      </span>
                    </td>
                   <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center space-x-2">
                      <code className="text-sm bg-gray-100 px-2 py-1 rounded">
                        {apiKey.keyMasked}
                      </code>
                      <span 
                        className="text-xs text-gray-400"
                        title="API Key已加密存储，无法直接查看"
                      >
                        (加密)
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      apiKey.isActive 
                        ? 'bg-green-100 text-green-800' 
                        : 'bg-gray-100 text-gray-800'
                    }`}>
                      {apiKey.isActive ? '活跃' : '已停用'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    <div>调用次数: {apiKey.useCount}</div>
                    {apiKey.lastUsedAt && (
                      <div className="text-xs">
                        最后使用: {new Date(apiKey.lastUsedAt).toLocaleString()}
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button
                      onClick={() => {
                        setEditingKey(apiKey);
                        setIsModalOpen(true);
                      }}
                      className="text-primary-600 hover:text-primary-900 mr-4"
                      title="编辑"
                    >
                      <PencilIcon className="h-5 w-5" />
                    </button>
                    <button
                      onClick={() => {
                        if (window.confirm(`确定要删除 API Key "${apiKey.name}" 吗？`)) {
                          deleteMutation.mutate(apiKey.id);
                        }
                      }}
                      className="text-red-600 hover:text-red-900"
                      title="删除"
                    >
                      <TrashIcon className="h-5 w-5" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {filteredKeys.length === 0 && (
          <div className="text-center py-12">
            <KeyIcon className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-sm font-medium text-gray-900">暂无 API Key</h3>
            <p className="mt-1 text-sm text-gray-500">
              {selectedProvider !== 'all' 
                ? '该提供商下没有API Key' 
                : '点击"添加 API Key"创建第一个密钥'}
            </p>
          </div>
        )}
      </div>

      {/* 安全提示 */}
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-start">
        <ExclamationTriangleIcon className="h-5 w-5 text-yellow-600 mr-3 mt-0.5 flex-shrink-0" />
        <div>
          <h4 className="text-sm font-medium text-yellow-800">安全提示</h4>
          <p className="mt-1 text-sm text-yellow-700">
            API Key 是敏感信息，请妥善保管。建议定期轮换密钥，并为不同用途创建不同的密钥。
            在生产环境中，请确保使用 HTTPS 传输 API Key。
          </p>
        </div>
      </div>

      {/* 添加/编辑模态框 */}
      {isModalOpen && (
        <ApiKeyModal
          apiKey={editingKey}
          onClose={() => {
            setIsModalOpen(false);
            setEditingKey(null);
          }}
          onSave={(data) => {
            if (editingKey) {
              updateMutation.mutate({ id: editingKey.id, data });
            } else {
              createMutation.mutate(data);
            }
          }}
          isLoading={createMutation.isLoading || updateMutation.isLoading}
        />
      )}
    </div>
  );
};

// API Key 模态框组件
const ApiKeyModal: React.FC<{
  apiKey: ApiKey | null;
  onClose: () => void;
  onSave: (data: any) => void;
  isLoading: boolean;
}> = ({ apiKey, onClose, onSave, isLoading }) => {
   const [formData, setFormData] = useState({
     name: apiKey?.name || '',
     provider: apiKey?.provider || 'openai',
     key: '',
     description: apiKey?.description || '',
     isActive: apiKey?.isActive ?? true,
     isDefault: apiKey?.isDefault ?? false,
     isDeprecated: apiKey?.isDeprecated ?? false,
     category: apiKey?.category || 'LLM',
   });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.provider || (!apiKey && !formData.key)) {
      return;
    }
    onSave(formData);
  };

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
      <div className="relative top-20 mx-auto p-6 border w-[500px] shadow-lg rounded-lg bg-white">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          {apiKey ? '编辑 API Key' : '添加 API Key'}
        </h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              名称 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              placeholder="例如: OpenAI 生产环境"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              提供商 <span className="text-red-500">*</span>
            </label>
            <select
              required
              value={formData.provider}
              onChange={(e) => setFormData({ ...formData, provider: e.target.value })}
              className="block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
            >
              {PROVIDERS.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-500">修改提供商将影响默认归属</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              分类 <span className="text-red-500">*</span>
            </label>
            <select
              required
              value={formData.category}
              onChange={(e) => setFormData({ ...formData, category: e.target.value as 'LLM' | 'OTHER' })}
              className="block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
            >
              <option value="LLM">LLM (大语言模型)</option>
              <option value="OTHER">其他</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              API Key <span className="text-red-500">*</span>
            </label>
            <input
              type="password"
              required={!apiKey}
              value={formData.key}
              onChange={(e) => setFormData({ ...formData, key: e.target.value })}
              className="block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              placeholder={apiKey ? '留空表示不修改' : 'sk-...'}
            />
            <p className="mt-1 text-xs text-gray-500">
              {apiKey 
                ? '留空表示不修改，填写将重新加密保存'
                : '请输入完整的 API Key，将被安全存储'}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              描述
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              rows={2}
              placeholder="用途说明..."
            />
          </div>

          <div className="flex items-center">
            <input
              type="checkbox"
              id="isActive"
              checked={formData.isActive}
              onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
              className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
            />
            <label htmlFor="isActive" className="ml-2 block text-sm text-gray-900">
              启用此 API Key
            </label>
          </div>

          <div className="flex items-center">
            <input
              type="checkbox"
              id="isDefault"
              checked={formData.isDefault}
              onChange={(e) => setFormData({ ...formData, isDefault: e.target.checked })}
              className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
            />
            <label htmlFor="isDefault" className="ml-2 block text-sm text-gray-900">
              设为该提供商默认 API Key
            </label>
          </div>

          <div className="flex items-center">
            <input
              type="checkbox"
              id="isDeprecated"
              checked={formData.isDeprecated}
              onChange={(e) => setFormData({ ...formData, isDeprecated: e.target.checked })}
              className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
            />
            <label htmlFor="isDeprecated" className="ml-2 block text-sm text-gray-900">
              标记为已弃用
            </label>
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
              disabled={isLoading}
              className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
            >
              {isLoading ? '保存中...' : apiKey ? '更新' : '创建'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ApiKeys;
