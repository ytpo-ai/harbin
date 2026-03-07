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
  SparklesIcon,
  XMarkIcon,
  CheckCircleIcon,
  AdjustmentsHorizontalIcon,
  ArrowPathIcon
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
    topP: 1,
    reasoning: {
      enabled: false,
      effort: 'medium',
      verbosity: 'medium',
    },
  });

  const { data: models, isLoading, refetch } = useQuery('models', modelService.getAvailableModels);
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
        topP: 1,
        reasoning: {
          enabled: false,
          effort: 'medium',
          verbosity: 'medium',
        },
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

  const getProviderStyle = (provider: string) => {
    const styles: Record<string, { bg: string; border: string; text: string; accent: string }> = {
      'openai': { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', accent: 'bg-emerald-600' },
      'anthropic': { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700', accent: 'bg-orange-600' },
      'google': { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', accent: 'bg-blue-600' },
      'deepseek': { bg: 'bg-indigo-50', border: 'border-indigo-200', text: 'text-indigo-700', accent: 'bg-indigo-600' },
      'mistral': { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700', accent: 'bg-orange-600' },
      'meta': { bg: 'bg-sky-50', border: 'border-sky-200', text: 'text-sky-700', accent: 'bg-sky-600' },
      'alibaba': { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700', accent: 'bg-orange-600' },
      'moonshot': { bg: 'bg-zinc-50', border: 'border-zinc-200', text: 'text-zinc-700', accent: 'bg-zinc-600' },
      'baichuan': { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', accent: 'bg-blue-600' },
      'zhipu': { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', accent: 'bg-blue-600' },
      'xunfei': { bg: 'bg-sky-50', border: 'border-sky-200', text: 'text-sky-700', accent: 'bg-sky-600' },
      'minimax': { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', accent: 'bg-amber-600' },
      'microsoft': { bg: 'bg-sky-50', border: 'border-sky-200', text: 'text-sky-700', accent: 'bg-sky-600' }
    };
    return styles[provider] || { bg: 'bg-gray-50', border: 'border-gray-200', text: 'text-gray-700', accent: 'bg-gray-600' };
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

  const getProviderLogo = (provider: string) => {
    const logos: Record<string, string> = {
      'openai': '🤖',
      'anthropic': '🧠',
      'google': '🔷',
      'deepseek': '🔮',
      'mistral': '💨',
      'meta': '🔵',
      'alibaba': '🅰️',
      'moonshot': '🌙',
      'baichuan': '🦬',
      'zhipu': '⚡',
      'xunfei': '🗣️',
      'minimax': '🎯',
      'microsoft': '🪟'
    };
    return logos[provider] || '💻';
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="relative">
          <div className="animate-spin rounded-full h-12 w-12 border-2 border-transparent border-t-emerald-500 border-r-emerald-500"></div>
          <div className="absolute inset-0 animate-pulse rounded-full h-12 w-12 border border-emerald-500/20"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50/50 relative">
      <div className="px-6 py-8 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
          <div className="animate-[fadeIn_0.5s_ease-out]">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2.5 bg-white rounded-xl shadow-sm border border-gray-100">
                <CpuChipIcon className="h-6 w-6 text-emerald-600" />
              </div>
              <h1 className="text-2xl font-bold text-gray-900">
                模型管理
              </h1>
            </div>
            <p className="text-gray-500 text-sm ml-1">
              管理AI模型配置 · 共 <span className="text-emerald-600 font-semibold">{models?.length || 0}</span> 个模型
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => refetch()}
              className="p-2.5 bg-white text-gray-600 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl shadow-sm border border-gray-200 transition-all duration-300 hover:shadow-md"
              title="刷新"
            >
              <ArrowPathIcon className="h-5 w-5" />
            </button>
            <button
              onClick={() => handleOpenModal()}
              className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-xl shadow-sm hover:shadow-md transition-all duration-300 flex items-center gap-2"
            >
              <PlusIcon className="h-4 w-4" />
              添加模型
            </button>
          </div>
        </div>

        {/* Filters & Search */}
        <div className="flex flex-col lg:flex-row gap-4 mb-8">
          {/* Provider Filters */}
          <div className="flex items-center gap-2 flex-wrap animate-[fadeIn_0.5s_ease-out_0.3s_both]">
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-white rounded-lg border border-gray-200 shadow-sm">
              <AdjustmentsHorizontalIcon className="h-4 w-4 text-gray-400" />
              <span className="text-xs text-gray-500 font-medium">提供商</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {providers.map((provider, index) => {
                const style = provider !== 'all' ? getProviderStyle(provider) : { bg: 'bg-white', border: 'border-gray-200', text: 'text-gray-600', accent: 'bg-gray-600' };
                const isActive = selectedProvider === provider;
                return (
                  <button
                    key={provider}
                    onClick={() => setSelectedProvider(provider)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-300 border shadow-sm ${
                      isActive
                        ? `${style.bg} ${style.border} ${style.text}`
                        : 'bg-white border-gray-200 text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}
                    style={{ animationDelay: `${0.4 + index * 0.05}s` }}
                  >
                    {provider === 'all' ? '全部' : getProviderName(provider)}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Search */}
          <div className="flex-1 min-w-[180px] max-w-xl animate-[fadeIn_0.5s_ease-out_0.5s_both]">
            <div className="relative group">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <MagnifyingGlassIcon className="h-5 w-5 text-gray-400 group-focus-within:text-emerald-500 transition-colors" />
              </div>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-12 pr-4 py-3 bg-white border border-gray-200 rounded-xl text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 transition-all duration-300 shadow-sm"
                placeholder="搜索模型名称或ID..."
              />
            </div>
          </div>
        </div>

        {/* Models Grid */}
        {filteredModels.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredModels.map((model, index) => {
              const style = getProviderStyle(model.provider);
              return (
                <div
                  key={model.id}
                  className="group relative bg-white border border-gray-200 rounded-2xl p-5 hover:border-gray-300 hover:shadow-lg transition-all duration-500 hover:-translate-y-1 animate-[fadeIn_0.5s_ease-out_both]"
                  style={{ animationDelay: `${0.1 * (index % 6)}s` }}
                >
                  {/* Card Header */}
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl ${style.bg} border ${style.border} flex items-center justify-center text-lg`}>
                        {getProviderLogo(model.provider)}
                      </div>
                      <div>
                        <h3 className="text-gray-900 font-semibold text-sm group-hover:text-gray-800 transition-colors">
                          {model.name}
                        </h3>
                        <p className="text-gray-400 text-xs font-mono mt-0.5">{model.id}</p>
                      </div>
                    </div>
                    <span className={`px-2.5 py-1 rounded-full text-[10px] font-medium ${style.bg} ${style.text} border ${style.border}`}>
                      {getProviderName(model.provider)}
                    </span>
                  </div>

                  {model.reasoning?.enabled && (
                    <div className="mb-3 flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-violet-50 text-violet-700 border border-violet-200">
                        Reasoning
                      </span>
                      <span className="text-[11px] text-gray-500">
                        effort={model.reasoning.effort || 'default'} · verbosity={model.reasoning.verbosity || 'default'}
                      </span>
                    </div>
                  )}

                  {/* Model ID */}
                  <div className="mb-4 p-3 bg-gray-50 rounded-xl border border-gray-100">
                    <p className="text-gray-400 text-[10px] uppercase tracking-wider mb-1">Model ID</p>
                    <p className="text-gray-600 text-xs font-mono truncate">{model.model}</p>
                  </div>

                  {/* Parameters */}
                  <div className="grid grid-cols-3 gap-2 mb-4">
                    <div className="p-2.5 bg-gray-50 rounded-xl border border-gray-100">
                      <p className="text-gray-400 text-[10px] uppercase tracking-wider">Max Tokens</p>
                      <p className="text-gray-700 text-xs font-semibold mt-0.5">{model.maxTokens.toLocaleString()}</p>
                    </div>
                    <div className="p-2.5 bg-gray-50 rounded-xl border border-gray-100">
                      <p className="text-gray-400 text-[10px] uppercase tracking-wider">Temperature</p>
                      <p className="text-gray-700 text-xs font-semibold mt-0.5">{model.temperature}</p>
                    </div>
                    <div className="p-2.5 bg-gray-50 rounded-xl border border-gray-100">
                      <p className="text-gray-400 text-[10px] uppercase tracking-wider">Top P</p>
                      <p className="text-gray-700 text-xs font-semibold mt-0.5">{model.topP}</p>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-100">
                    <button
                      onClick={() => handleOpenModal(model)}
                      className="p-2 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all duration-300"
                    >
                      <PencilIcon className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(model)}
                      className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all duration-300"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 animate-[fadeIn_0.5s_ease-out]">
            <div className="w-20 h-20 mb-6 rounded-2xl bg-gray-100 border border-gray-200 flex items-center justify-center">
              <SparklesIcon className="h-10 w-10 text-gray-400" />
            </div>
            <h3 className="text-gray-700 font-medium mb-2">没有找到模型</h3>
            <p className="text-gray-500 text-sm">
              {searchQuery ? '请尝试其他搜索条件' : '点击"添加模型"创建第一个模型'}
            </p>
          </div>
        )}
      </div>

      {/* Modal Overlay */}
      {isModalOpen && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={handleCloseModal}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-[fadeIn_0.2s_ease-out]"></div>
          
          {/* Modal */}
          <div 
            className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl animate-[scaleIn_0.3s_ease-out]"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-50 rounded-xl border border-emerald-100">
                  {editingModel ? <PencilIcon className="h-5 w-5 text-emerald-600" /> : <PlusIcon className="h-5 w-5 text-emerald-600" />}
                </div>
                <h2 className="text-lg font-semibold text-gray-900">
                  {editingModel ? '编辑模型' : '添加新模型'}
                </h2>
              </div>
              <button
                onClick={handleCloseModal}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-all duration-300"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="p-6 space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">模型ID</label>
                  <input
                    type="text"
                    required
                    disabled={!!editingModel}
                    value={formData.id}
                    onChange={(e) => setFormData({ ...formData, id: e.target.value })}
                    className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 transition-all duration-300 disabled:opacity-60 disabled:cursor-not-allowed"
                    placeholder="gpt-4-turbo"
                  />
                  <p className="text-[10px] text-gray-400 mt-1.5">唯一标识符，创建后不可修改</p>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">显示名称</label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 transition-all duration-300"
                    placeholder="GPT-4 Turbo"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">提供商</label>
                <select
                  value={formData.provider}
                  onChange={(e) => setFormData({ ...formData, provider: e.target.value as AIModel['provider'] })}
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-700 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 transition-all duration-300 appearance-none cursor-pointer"
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
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">API模型名称</label>
                <input
                  type="text"
                  required
                  value={formData.model}
                  onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 transition-all duration-300"
                  placeholder="gpt-4-turbo-preview"
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">Max Tokens</label>
                  <input
                    type="number"
                    required
                    value={formData.maxTokens}
                    onChange={(e) => setFormData({ ...formData, maxTokens: Number(e.target.value) })}
                    className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-700 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 transition-all duration-300"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">Temperature</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="2"
                    value={formData.temperature}
                    onChange={(e) => setFormData({ ...formData, temperature: Number(e.target.value) })}
                    className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-700 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 transition-all duration-300"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">Top P</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="1"
                    value={formData.topP}
                    onChange={(e) => setFormData({ ...formData, topP: Number(e.target.value) })}
                    className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-700 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 transition-all duration-300"
                  />
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider">Reasoning</label>
                    <p className="text-[11px] text-gray-500 mt-1">适用于 reasoning 模型（如 OpenAI GPT-5 系列）</p>
                  </div>
                  <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={Boolean(formData.reasoning?.enabled)}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          reasoning: {
                            enabled: e.target.checked,
                            effort: formData.reasoning?.effort || 'medium',
                            verbosity: formData.reasoning?.verbosity || 'medium',
                          },
                        })
                      }
                      className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    启用
                  </label>
                </div>

                {formData.reasoning?.enabled && (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">Reasoning Effort</label>
                      <select
                        value={formData.reasoning?.effort || 'medium'}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            reasoning: {
                              enabled: true,
                              effort: e.target.value as NonNullable<AIModel['reasoning']>['effort'],
                              verbosity: formData.reasoning?.verbosity || 'medium',
                            },
                          })
                        }
                        className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm text-gray-700 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 transition-all duration-300"
                      >
                        <option value="none">none</option>
                        <option value="minimal">minimal</option>
                        <option value="low">low</option>
                        <option value="medium">medium</option>
                        <option value="high">high</option>
                        <option value="xhigh">xhigh</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">Text Verbosity</label>
                      <select
                        value={formData.reasoning?.verbosity || 'medium'}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            reasoning: {
                              enabled: true,
                              effort: formData.reasoning?.effort || 'medium',
                              verbosity: e.target.value as NonNullable<AIModel['reasoning']>['verbosity'],
                            },
                          })
                        }
                        className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm text-gray-700 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 transition-all duration-300"
                      >
                        <option value="low">low</option>
                        <option value="medium">medium</option>
                        <option value="high">high</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="px-5 py-2.5 text-sm font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-xl transition-all duration-300"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={createModelMutation.isLoading || updateModelMutation.isLoading}
                  className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-xl transition-all duration-300 hover:shadow-lg disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {createModelMutation.isLoading || updateModelMutation.isLoading ? (
                    <>
                      <div className="animate-spin h-4 w-4 border-2 border-white/30 border-t-white rounded-full"></div>
                      保存中...
                    </>
                  ) : editingModel ? (
                    <>
                      <CheckCircleIcon className="h-4 w-4" />
                      更新
                    </>
                  ) : (
                    <>
                      <PlusIcon className="h-4 w-4" />
                      创建
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes scaleIn {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
};

export default Models;
