import React, { useState, useMemo } from 'react';
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
  ArrowPathIcon,
  Squares2X2Icon,
  TableCellsIcon,
  ChevronUpIcon,
  ChevronDownIcon,
} from '@heroicons/react/24/outline';

// ---------------------------------------------------------------------------
// Provider config helpers
// ---------------------------------------------------------------------------
const PROVIDER_CONFIG: Record<string, { name: string; logo: string; bg: string; border: string; text: string; accent: string }> = {
  openai:     { name: 'OpenAI',          logo: '🤖', bg: 'bg-emerald-50',  border: 'border-emerald-200', text: 'text-emerald-700', accent: 'bg-emerald-600' },
  anthropic:  { name: 'Anthropic',       logo: '🧠', bg: 'bg-orange-50',   border: 'border-orange-200',  text: 'text-orange-700',  accent: 'bg-orange-600' },
  google:     { name: 'Google',          logo: '🔷', bg: 'bg-blue-50',     border: 'border-blue-200',    text: 'text-blue-700',    accent: 'bg-blue-600' },
  deepseek:   { name: 'DeepSeek',        logo: '🔮', bg: 'bg-indigo-50',   border: 'border-indigo-200',  text: 'text-indigo-700',  accent: 'bg-indigo-600' },
  mistral:    { name: 'Mistral AI',      logo: '💨', bg: 'bg-amber-50',    border: 'border-amber-200',   text: 'text-amber-700',   accent: 'bg-amber-600' },
  alibaba:    { name: 'Alibaba',         logo: '🅰️', bg: 'bg-orange-50',   border: 'border-orange-200',  text: 'text-orange-700',  accent: 'bg-orange-600' },
  moonshotai: { name: 'Kimi (Moonshot)', logo: '🌙', bg: 'bg-violet-50',   border: 'border-violet-200',  text: 'text-violet-700',  accent: 'bg-violet-600' },
  xai:        { name: 'xAI (Grok)',      logo: '⚡', bg: 'bg-zinc-50',     border: 'border-zinc-200',    text: 'text-zinc-700',    accent: 'bg-zinc-600' },
  minimax:    { name: 'MiniMax',         logo: '🎯', bg: 'bg-amber-50',    border: 'border-amber-200',   text: 'text-amber-700',   accent: 'bg-amber-600' },
  zhipuai:    { name: 'Zhipu AI',        logo: '💎', bg: 'bg-sky-50',      border: 'border-sky-200',     text: 'text-sky-700',     accent: 'bg-sky-600' },
};

const DEFAULT_STYLE = { name: 'Unknown', logo: '💻', bg: 'bg-gray-50', border: 'border-gray-200', text: 'text-gray-700', accent: 'bg-gray-600' };

const getProviderConfig = (provider: string) => PROVIDER_CONFIG[provider] || DEFAULT_STYLE;

// ---------------------------------------------------------------------------
// Price helpers
// ---------------------------------------------------------------------------
/** Returns a color from green (0) → amber (0.5) → red (1) based on ratio 0..1 */
const priceColor = (ratio: number): string => {
  const r = Math.min(1, Math.max(0, ratio));
  if (r < 0.25) return 'bg-emerald-400';
  if (r < 0.5) return 'bg-lime-400';
  if (r < 0.7) return 'bg-amber-400';
  if (r < 0.85) return 'bg-orange-400';
  return 'bg-red-400';
};

const priceTextColor = (ratio: number): string => {
  const r = Math.min(1, Math.max(0, ratio));
  if (r < 0.25) return 'text-emerald-600';
  if (r < 0.5) return 'text-lime-600';
  if (r < 0.7) return 'text-amber-600';
  if (r < 0.85) return 'text-orange-600';
  return 'text-red-600';
};

const formatPrice = (val?: number): string => {
  if (val == null || !Number.isFinite(val)) return '-';
  if (val === 0) return '$0';
  if (val < 0.01) return `$${val.toFixed(4)}`;
  if (val < 1) return `$${val.toFixed(3)}`;
  return `$${val.toFixed(2)}`;
};

// ---------------------------------------------------------------------------
// Price bar component for cards
// ---------------------------------------------------------------------------
const PriceBar: React.FC<{ label: string; value?: number; maxValue: number }> = ({ label, value, maxValue }) => {
  if (value == null || !Number.isFinite(value)) return null;
  const ratio = maxValue > 0 ? value / maxValue : 0;
  const widthPercent = Math.max(2, ratio * 100);
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-gray-400 uppercase tracking-wider w-10 shrink-0 text-right">{label}</span>
      <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden relative">
        <div
          className={`h-full rounded-full transition-all duration-700 ${priceColor(ratio)}`}
          style={{ width: `${widthPercent}%` }}
        />
      </div>
      <span className={`text-[11px] font-mono font-semibold w-16 text-right shrink-0 ${priceTextColor(ratio)}`}>
        {formatPrice(value)}
      </span>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Sort types for table view
// ---------------------------------------------------------------------------
type SortKey = 'name' | 'provider' | 'input' | 'output' | 'cache_read' | 'reasoning' | 'maxTokens';
type SortDir = 'asc' | 'desc';

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------
const Models: React.FC = () => {
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingModel, setEditingModel] = useState<AIModel | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'card' | 'table'>('card');
  const [sortKey, setSortKey] = useState<SortKey>('output');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [formData, setFormData] = useState<Partial<AIModel>>({
    id: '',
    name: '',
    description: '',
    availability: '',
    deprecated: false,
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
    onSuccess: () => { queryClient.invalidateQueries('models'); setIsModalOpen(false); resetForm(); },
  });
  const updateModelMutation = useMutation(
    ({ id, data }: { id: string; data: Partial<AIModel> }) => modelService.updateModel(id, data),
    { onSuccess: () => { queryClient.invalidateQueries('models'); setIsModalOpen(false); setEditingModel(null); resetForm(); } },
  );
  const deleteModelMutation = useMutation(modelService.deleteModel, {
    onSuccess: () => { queryClient.invalidateQueries('models'); },
  });

  const providers = ['all', ...(categories ? Object.keys(categories) : [])];

  const filteredModels = useMemo(() => {
    return (models || []).filter((model) => {
      const matchesProvider = selectedProvider === 'all' || model.provider === selectedProvider;
      const q = searchQuery.toLowerCase();
      const matchesSearch = !q || model.name.toLowerCase().includes(q) || model.id.toLowerCase().includes(q);
      return matchesProvider && matchesSearch;
    });
  }, [models, selectedProvider, searchQuery]);

  // Compute global max prices for relative bar widths (across filtered set)
  const { maxInput, maxOutput } = useMemo(() => {
    let mi = 0;
    let mo = 0;
    for (const m of filteredModels) {
      if (m.cost?.input != null && Number.isFinite(m.cost.input)) mi = Math.max(mi, m.cost.input);
      if (m.cost?.output != null && Number.isFinite(m.cost.output)) mo = Math.max(mo, m.cost.output);
    }
    return { maxInput: mi, maxOutput: mo };
  }, [filteredModels]);

  // Sort models for table view
  const sortedModels = useMemo(() => {
    if (viewMode !== 'table') return filteredModels;
    const list = [...filteredModels];
    const dir = sortDir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      let va: number | string = 0;
      let vb: number | string = 0;
      switch (sortKey) {
        case 'name':     va = a.name.toLowerCase(); vb = b.name.toLowerCase(); break;
        case 'provider': va = a.provider; vb = b.provider; break;
        case 'input':    va = a.cost?.input ?? -1; vb = b.cost?.input ?? -1; break;
        case 'output':   va = a.cost?.output ?? -1; vb = b.cost?.output ?? -1; break;
        case 'cache_read': va = a.cost?.cache_read ?? -1; vb = b.cost?.cache_read ?? -1; break;
        case 'reasoning': va = a.cost?.reasoning ?? -1; vb = b.cost?.reasoning ?? -1; break;
        case 'maxTokens': va = a.maxTokens; vb = b.maxTokens; break;
      }
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
    return list;
  }, [filteredModels, viewMode, sortKey, sortDir]);

  const resetForm = () => {
    setFormData({
      id: '', name: '', description: '', availability: '', deprecated: false,
      provider: 'openai', model: '', maxTokens: 4096, temperature: 0.7, topP: 1,
      reasoning: { enabled: false, effort: 'medium', verbosity: 'medium' },
    });
  };

  const handleOpenModal = (model?: AIModel) => {
    if (model) { setEditingModel(model); setFormData({ ...model }); }
    else { setEditingModel(null); resetForm(); }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => { setIsModalOpen(false); setEditingModel(null); resetForm(); };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingModel) updateModelMutation.mutate({ id: editingModel.id, data: formData });
    else createModelMutation.mutate(formData as Omit<AIModel, 'id'>);
  };

  const handleDelete = (model: AIModel) => {
    if (window.confirm(`确定要删除模型 "${model.name}" 吗？`)) deleteModelMutation.mutate(model.id);
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('desc'); }
  };

  const SortIcon: React.FC<{ field: SortKey }> = ({ field }) => {
    if (sortKey !== field) return <ChevronDownIcon className="h-3 w-3 text-gray-300" />;
    return sortDir === 'asc'
      ? <ChevronUpIcon className="h-3 w-3 text-emerald-600" />
      : <ChevronDownIcon className="h-3 w-3 text-emerald-600" />;
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="relative">
          <div className="animate-spin rounded-full h-12 w-12 border-2 border-transparent border-t-emerald-500 border-r-emerald-500" />
          <div className="absolute inset-0 animate-pulse rounded-full h-12 w-12 border border-emerald-500/20" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50/50 relative">
      <div className="px-6 py-8 max-w-7xl mx-auto">
        {/* ── Header ────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
          <div className="animate-[fadeIn_0.5s_ease-out]">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2.5 bg-white rounded-xl shadow-sm border border-gray-100">
                <CpuChipIcon className="h-6 w-6 text-emerald-600" />
              </div>
              <h1 className="text-2xl font-bold text-gray-900">模型管理</h1>
            </div>
            <p className="text-gray-500 text-sm ml-1">
              管理AI模型配置 · 共 <span className="text-emerald-600 font-semibold">{models?.length || 0}</span> 个模型
              {filteredModels.length !== (models?.length || 0) && (
                <span className="text-gray-400"> · 当前筛选 {filteredModels.length} 个</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* View toggle */}
            <div className="flex items-center bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
              <button
                onClick={() => setViewMode('card')}
                className={`p-2.5 transition-all duration-300 ${viewMode === 'card' ? 'bg-emerald-50 text-emerald-600' : 'text-gray-400 hover:text-gray-600'}`}
                title="卡片视图"
              >
                <Squares2X2Icon className="h-5 w-5" />
              </button>
              <button
                onClick={() => setViewMode('table')}
                className={`p-2.5 transition-all duration-300 ${viewMode === 'table' ? 'bg-emerald-50 text-emerald-600' : 'text-gray-400 hover:text-gray-600'}`}
                title="表格对比视图"
              >
                <TableCellsIcon className="h-5 w-5" />
              </button>
            </div>
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

        {/* ── Filters & Search ──────────────────────────────────── */}
        <div className="flex flex-col lg:flex-row gap-4 mb-8">
          <div className="flex items-center gap-2 flex-wrap animate-[fadeIn_0.5s_ease-out_0.3s_both]">
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-white rounded-lg border border-gray-200 shadow-sm">
              <AdjustmentsHorizontalIcon className="h-4 w-4 text-gray-400" />
              <span className="text-xs text-gray-500 font-medium">提供商</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {providers.map((provider) => {
                const cfg = provider !== 'all' ? getProviderConfig(provider) : DEFAULT_STYLE;
                const isActive = selectedProvider === provider;
                return (
                  <button
                    key={provider}
                    onClick={() => setSelectedProvider(provider)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-300 border shadow-sm ${
                      isActive ? `${cfg.bg} ${cfg.border} ${cfg.text}` : 'bg-white border-gray-200 text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}
                  >
                    {provider === 'all' ? '全部' : cfg.name}
                  </button>
                );
              })}
            </div>
          </div>
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

        {/* ── Price Legend ───────────────────────────────────────── */}
        <div className="flex items-center gap-3 mb-6 animate-[fadeIn_0.5s_ease-out_0.6s_both]">
          <span className="text-[10px] text-gray-400 uppercase tracking-wider">价格色阶</span>
          <div className="flex items-center gap-0.5">
            <div className="w-6 h-2 rounded-l-full bg-emerald-400" />
            <div className="w-6 h-2 bg-lime-400" />
            <div className="w-6 h-2 bg-amber-400" />
            <div className="w-6 h-2 bg-orange-400" />
            <div className="w-6 h-2 rounded-r-full bg-red-400" />
          </div>
          <span className="text-[10px] text-gray-400">便宜 → 昂贵</span>
          <span className="text-[10px] text-gray-300 ml-2">单位: USD / 1M tokens</span>
        </div>

        {/* ── Content ───────────────────────────────────────────── */}
        {filteredModels.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 animate-[fadeIn_0.5s_ease-out]">
            <div className="w-20 h-20 mb-6 rounded-2xl bg-gray-100 border border-gray-200 flex items-center justify-center">
              <SparklesIcon className="h-10 w-10 text-gray-400" />
            </div>
            <h3 className="text-gray-700 font-medium mb-2">没有找到模型</h3>
            <p className="text-gray-500 text-sm">
              {searchQuery ? '请尝试其他搜索条件' : '点击"添加模型"创建第一个模型'}
            </p>
          </div>
        ) : viewMode === 'card' ? (
          /* ── Card Grid ────────────────────────────────────────── */
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredModels.map((model, index) => {
              const cfg = getProviderConfig(model.provider);
              const hasCost = model.cost && (Number.isFinite(model.cost.input) || Number.isFinite(model.cost.output));
              return (
                <div
                  key={model.id}
                  className="group relative bg-white border border-gray-200 rounded-2xl p-5 hover:border-gray-300 hover:shadow-lg transition-all duration-500 hover:-translate-y-1 animate-[fadeIn_0.5s_ease-out_both]"
                  style={{ animationDelay: `${0.05 * (index % 9)}s` }}
                >
                  {/* Card Header */}
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl ${cfg.bg} border ${cfg.border} flex items-center justify-center text-lg`}>
                        {cfg.logo}
                      </div>
                      <div>
                        <h3 className="text-gray-900 font-semibold text-sm">{model.name}</h3>
                        <p className="text-gray-400 text-xs font-mono mt-0.5">{model.id}</p>
                      </div>
                    </div>
                    <span className={`px-2.5 py-1 rounded-full text-[10px] font-medium ${cfg.bg} ${cfg.text} border ${cfg.border}`}>
                      {cfg.name}
                    </span>
                  </div>

                  {model.description && <p className="mb-3 text-xs text-gray-600 leading-relaxed">{model.description}</p>}

                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    {model.availability && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-50 text-blue-700 border border-blue-200">{model.availability}</span>
                    )}
                    {model.deprecated && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-rose-50 text-rose-700 border border-rose-200">Deprecated</span>
                    )}
                  </div>

                  {model.reasoning?.enabled && (
                    <div className="mb-3 flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-violet-50 text-violet-700 border border-violet-200">Reasoning</span>
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
                      <p className="text-gray-400 text-[10px] uppercase tracking-wider">Temp</p>
                      <p className="text-gray-700 text-xs font-semibold mt-0.5">{model.temperature}</p>
                    </div>
                    <div className="p-2.5 bg-gray-50 rounded-xl border border-gray-100">
                      <p className="text-gray-400 text-[10px] uppercase tracking-wider">Top P</p>
                      <p className="text-gray-700 text-xs font-semibold mt-0.5">{model.topP}</p>
                    </div>
                  </div>

                  {/* ── Price Bars ─────────────────────────────────── */}
                  {hasCost ? (
                    <div className="mb-4 p-3 rounded-xl border border-gray-100 bg-gray-50/50 space-y-1.5">
                      <p className="text-gray-400 text-[10px] uppercase tracking-wider mb-1">Token 价格 (USD / 1M)</p>
                      <PriceBar label="Input" value={model.cost!.input} maxValue={maxInput} />
                      <PriceBar label="Output" value={model.cost!.output} maxValue={maxOutput} />
                      {model.cost!.cache_read != null && (
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-gray-400 uppercase tracking-wider w-10 shrink-0 text-right">Cache</span>
                          <span className="text-[11px] text-gray-500 font-mono">{formatPrice(model.cost!.cache_read)}</span>
                        </div>
                      )}
                      {model.cost!.reasoning != null && (
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-gray-400 uppercase tracking-wider w-10 shrink-0 text-right">Think</span>
                          <span className="text-[11px] text-gray-500 font-mono">{formatPrice(model.cost!.reasoning)}</span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="mb-4 p-3 rounded-xl border border-dashed border-gray-200 bg-gray-50/30 flex items-center justify-center">
                      <span className="text-[11px] text-gray-400">暂无价格数据</span>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-100">
                    <button onClick={() => handleOpenModal(model)} className="p-2 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all duration-300">
                      <PencilIcon className="h-4 w-4" />
                    </button>
                    <button onClick={() => handleDelete(model)} className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all duration-300">
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* ── Table View ───────────────────────────────────────── */
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden animate-[fadeIn_0.4s_ease-out]">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/80">
                    <th className="text-left px-4 py-3">
                      <button onClick={() => toggleSort('name')} className="flex items-center gap-1 text-[11px] text-gray-500 uppercase tracking-wider font-semibold hover:text-gray-700">
                        模型 <SortIcon field="name" />
                      </button>
                    </th>
                    <th className="text-left px-4 py-3">
                      <button onClick={() => toggleSort('provider')} className="flex items-center gap-1 text-[11px] text-gray-500 uppercase tracking-wider font-semibold hover:text-gray-700">
                        Provider <SortIcon field="provider" />
                      </button>
                    </th>
                    <th className="text-right px-4 py-3">
                      <button onClick={() => toggleSort('input')} className="flex items-center justify-end gap-1 text-[11px] text-gray-500 uppercase tracking-wider font-semibold hover:text-gray-700 ml-auto">
                        Input <SortIcon field="input" />
                      </button>
                    </th>
                    <th className="text-right px-4 py-3">
                      <button onClick={() => toggleSort('output')} className="flex items-center justify-end gap-1 text-[11px] text-gray-500 uppercase tracking-wider font-semibold hover:text-gray-700 ml-auto">
                        Output <SortIcon field="output" />
                      </button>
                    </th>
                    <th className="text-right px-4 py-3">
                      <button onClick={() => toggleSort('cache_read')} className="flex items-center justify-end gap-1 text-[11px] text-gray-500 uppercase tracking-wider font-semibold hover:text-gray-700 ml-auto">
                        Cache <SortIcon field="cache_read" />
                      </button>
                    </th>
                    <th className="text-right px-4 py-3">
                      <button onClick={() => toggleSort('reasoning')} className="flex items-center justify-end gap-1 text-[11px] text-gray-500 uppercase tracking-wider font-semibold hover:text-gray-700 ml-auto">
                        Reasoning <SortIcon field="reasoning" />
                      </button>
                    </th>
                    <th className="text-right px-4 py-3">
                      <button onClick={() => toggleSort('maxTokens')} className="flex items-center justify-end gap-1 text-[11px] text-gray-500 uppercase tracking-wider font-semibold hover:text-gray-700 ml-auto">
                        Max Tokens <SortIcon field="maxTokens" />
                      </button>
                    </th>
                    <th className="px-4 py-3 w-20"></th>
                  </tr>
                </thead>
                <tbody>
                  {sortedModels.map((model) => {
                    const cfg = getProviderConfig(model.provider);
                    const inputRatio = maxInput > 0 ? (model.cost?.input ?? 0) / maxInput : 0;
                    const outputRatio = maxOutput > 0 ? (model.cost?.output ?? 0) / maxOutput : 0;
                    return (
                      <tr
                        key={model.id}
                        className="border-b border-gray-50 hover:bg-gray-50/60 transition-colors duration-200"
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <span className="text-base">{cfg.logo}</span>
                            <div>
                              <p className="text-gray-900 font-medium text-sm">{model.name}</p>
                              <p className="text-gray-400 text-[11px] font-mono">{model.model}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${cfg.bg} ${cfg.text} border ${cfg.border}`}>
                            {cfg.name}
                          </span>
                        </td>
                        {/* Input price cell with inline bar */}
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div className={`h-full rounded-full ${priceColor(inputRatio)}`} style={{ width: `${Math.max(2, inputRatio * 100)}%` }} />
                            </div>
                            <span className={`font-mono text-xs font-medium ${model.cost?.input != null ? priceTextColor(inputRatio) : 'text-gray-300'}`}>
                              {formatPrice(model.cost?.input)}
                            </span>
                          </div>
                        </td>
                        {/* Output price cell with inline bar */}
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div className={`h-full rounded-full ${priceColor(outputRatio)}`} style={{ width: `${Math.max(2, outputRatio * 100)}%` }} />
                            </div>
                            <span className={`font-mono text-xs font-medium ${model.cost?.output != null ? priceTextColor(outputRatio) : 'text-gray-300'}`}>
                              {formatPrice(model.cost?.output)}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="font-mono text-xs text-gray-500">{formatPrice(model.cost?.cache_read)}</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="font-mono text-xs text-gray-500">{formatPrice(model.cost?.reasoning)}</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="text-xs text-gray-600 font-medium">{model.maxTokens.toLocaleString()}</span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => handleOpenModal(model)} className="p-1.5 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all duration-300">
                              <PencilIcon className="h-3.5 w-3.5" />
                            </button>
                            <button onClick={() => handleDelete(model)} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all duration-300">
                              <TrashIcon className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ── Modal ────────────────────────────────────────────────── */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={handleCloseModal}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-[fadeIn_0.2s_ease-out]" />
          <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl animate-[scaleIn_0.3s_ease-out]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-50 rounded-xl border border-emerald-100">
                  {editingModel ? <PencilIcon className="h-5 w-5 text-emerald-600" /> : <PlusIcon className="h-5 w-5 text-emerald-600" />}
                </div>
                <h2 className="text-lg font-semibold text-gray-900">{editingModel ? '编辑模型' : '添加新模型'}</h2>
              </div>
              <button onClick={handleCloseModal} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-all duration-300">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">模型ID</label>
                  <input type="text" required disabled={!!editingModel} value={formData.id} onChange={(e) => setFormData({ ...formData, id: e.target.value })}
                    className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 transition-all duration-300 disabled:opacity-60 disabled:cursor-not-allowed"
                    placeholder="gpt-4o" />
                  <p className="text-[10px] text-gray-400 mt-1.5">唯一标识符，创建后不可修改</p>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">显示名称</label>
                  <input type="text" required value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 transition-all duration-300"
                    placeholder="GPT-4o" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">Description</label>
                <textarea value={formData.description || ''} onChange={(e) => setFormData({ ...formData, description: e.target.value })} rows={3}
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 transition-all duration-300"
                  placeholder="模型定位、特点与适用场景" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">Availability</label>
                  <input type="text" value={formData.availability || ''} onChange={(e) => setFormData({ ...formData, availability: e.target.value })}
                    className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 transition-all duration-300"
                    placeholder="API and ChatGPT, released March 2026" />
                </div>
                <div className="flex items-end">
                  <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                    <input type="checkbox" checked={Boolean(formData.deprecated)} onChange={(e) => setFormData({ ...formData, deprecated: e.target.checked })}
                      className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500" />
                    标记为 Deprecated
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">提供商</label>
                <select value={formData.provider} onChange={(e) => setFormData({ ...formData, provider: e.target.value as AIModel['provider'] })}
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-700 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 transition-all duration-300 appearance-none cursor-pointer">
                  {Object.entries(PROVIDER_CONFIG).map(([key, cfg]) => (
                    <option key={key} value={key}>{cfg.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">API模型名称</label>
                <input type="text" required value={formData.model} onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 transition-all duration-300"
                  placeholder="gpt-4o" />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">Max Tokens</label>
                  <input type="number" required value={formData.maxTokens} onChange={(e) => setFormData({ ...formData, maxTokens: Number(e.target.value) })}
                    className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-700 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 transition-all duration-300" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">Temperature</label>
                  <input type="number" step="0.1" min="0" max="2" value={formData.temperature} onChange={(e) => setFormData({ ...formData, temperature: Number(e.target.value) })}
                    className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-700 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 transition-all duration-300" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">Top P</label>
                  <input type="number" step="0.01" min="0" max="1" value={formData.topP} onChange={(e) => setFormData({ ...formData, topP: Number(e.target.value) })}
                    className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-700 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 transition-all duration-300" />
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider">Reasoning</label>
                    <p className="text-[11px] text-gray-500 mt-1">适用于 reasoning 模型（如 OpenAI GPT-5 系列）</p>
                  </div>
                  <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                    <input type="checkbox" checked={Boolean(formData.reasoning?.enabled)}
                      onChange={(e) => setFormData({ ...formData, reasoning: { enabled: e.target.checked, effort: formData.reasoning?.effort || 'medium', verbosity: formData.reasoning?.verbosity || 'medium' } })}
                      className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500" />
                    启用
                  </label>
                </div>
                {formData.reasoning?.enabled && (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">Reasoning Effort</label>
                      <select value={formData.reasoning?.effort || 'medium'}
                        onChange={(e) => setFormData({ ...formData, reasoning: { enabled: true, effort: e.target.value as NonNullable<AIModel['reasoning']>['effort'], verbosity: formData.reasoning?.verbosity || 'medium' } })}
                        className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm text-gray-700 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 transition-all duration-300">
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
                      <select value={formData.reasoning?.verbosity || 'medium'}
                        onChange={(e) => setFormData({ ...formData, reasoning: { enabled: true, effort: formData.reasoning?.effort || 'medium', verbosity: e.target.value as NonNullable<AIModel['reasoning']>['verbosity'] } })}
                        className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm text-gray-700 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 transition-all duration-300">
                        <option value="low">low</option>
                        <option value="medium">medium</option>
                        <option value="high">high</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-3 pt-4">
                <button type="button" onClick={handleCloseModal} className="px-5 py-2.5 text-sm font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-xl transition-all duration-300">
                  取消
                </button>
                <button type="submit" disabled={createModelMutation.isLoading || updateModelMutation.isLoading}
                  className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-xl transition-all duration-300 hover:shadow-lg disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2">
                  {createModelMutation.isLoading || updateModelMutation.isLoading ? (
                    <><div className="animate-spin h-4 w-4 border-2 border-white/30 border-t-white rounded-full" />保存中...</>
                  ) : editingModel ? (
                    <><CheckCircleIcon className="h-4 w-4" />更新</>
                  ) : (
                    <><PlusIcon className="h-4 w-4" />创建</>
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
