import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from 'react-query';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowPathIcon,
  BookOpenIcon,
  CheckCircleIcon,
  EllipsisVerticalIcon,
  EyeIcon,
  ExclamationTriangleIcon,
  LightBulbIcon,
  PlusIcon,
  TrashIcon,
  WrenchScrewdriverIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { skillService, SkillPagedResponse } from '../services/skillService';
import { agentService } from '../services/agentService';
import { Skill, SkillSuggestion } from '../types';

const statusOptions: Array<Skill['status']> = ['active', 'experimental', 'deprecated', 'disabled'];
const sourceOptions: Array<Skill['sourceType']> = ['manual', 'github', 'web', 'internal'];
const skillCategoryOptions = ['会议', '计划', '通用'] as const;

const statusLabelMap: Record<Skill['status'], string> = {
  active: '启用',
  experimental: '实验',
  deprecated: '弃用',
  disabled: '停用',
};

const categoryLabelMap: Record<string, string> = {
  meeting: '会议',
  plan: '计划',
  general: '通用',
  会议: '会议',
  计划: '计划',
  通用: '通用',
};

type SkillFormPayload = {
  name: string;
  description: string;
  category: string;
  tags: string[];
  sourceType: Skill['sourceType'];
  sourceUrl?: string;
  provider: string;
  version: string;
  status: Skill['status'];
  confidenceScore: number;
  discoveredBy?: string;
  metadata?: Record<string, any>;
  content?: string;
  contentType?: string;
};

type SkillQueryCache = SkillPagedResponse | Skill[] | undefined;

const formatCategory = (category: string) => {
  if (!category) return '未分类';
  return categoryLabelMap[category] || category;
};

const extractMetadataMarkdown = (metadata: Skill['metadata']) => {
  if (metadata && typeof metadata === 'object' && typeof (metadata as any).markdown === 'string') {
    return String((metadata as any).markdown || '');
  }
  return '';
};

const patchSkillInCache = (cached: SkillQueryCache, skillId: string, updates: Partial<Skill>): SkillQueryCache => {
  if (!cached) return cached;
  if (Array.isArray(cached)) {
    return cached.map((item) => (item.id === skillId ? { ...item, ...updates } : item));
  }
  if (!Array.isArray(cached.items)) return cached;
  return {
    ...cached,
    items: cached.items.map((item) => (item.id === skillId ? { ...item, ...updates } : item)),
  };
};

const Skills: React.FC = () => {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const [statusFilter, setStatusFilter] = useState<string>(searchParams.get('status') || '');
  const [categoryFilter, setCategoryFilter] = useState(searchParams.get('category') || '');
  const [searchKeyword, setSearchKeyword] = useState(searchParams.get('search') || '');
  const [debouncedSearchKeyword, setDebouncedSearchKeyword] = useState('');
  const [currentPage, setCurrentPage] = useState(() => {
    const page = Number(searchParams.get('page') || '1');
    return Number.isFinite(page) && page > 0 ? page : 1;
  });
  const [pageSize, setPageSize] = useState(() => {
    const size = Number(searchParams.get('pageSize') || '10');
    return [10, 20, 50].includes(size) ? size : 10;
  });
  const [suggestionAgentId, setSuggestionAgentId] = useState('');
  const [contextTagsInput, setContextTagsInput] = useState('');
  const [highlightedSkillId, setHighlightedSkillId] = useState('');
  const [activeSkillId, setActiveSkillId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'detail' | 'binding'>('detail');
  const [bindingAgentId, setBindingAgentId] = useState('');
  const [isDiscoverDrawerOpen, setIsDiscoverDrawerOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [operationMenuOpen, setOperationMenuOpen] = useState(false);
  const operationMenuRef = useRef<HTMLDivElement | null>(null);
  const operationMenuButtonRef = useRef<HTMLButtonElement | null>(null);

  const { data: agents = [] } = useQuery('agents', agentService.getAgents);
  const { data: allSkills = [] } = useQuery('skills-all', () => skillService.getSkills());
  const { data: allSkillAgents = {} } = useQuery('all-skill-agents', () => skillService.getAllSkillAgents());
  const { data: skillsPagedRaw, isLoading: skillsLoading, isError: skillsError, error: skillsErrorDetail } = useQuery(
    ['skills-paged', statusFilter, categoryFilter, debouncedSearchKeyword, currentPage, pageSize],
    () => skillService.getSkillsPaged({
      status: statusFilter || undefined,
      category: categoryFilter || undefined,
      search: debouncedSearchKeyword || undefined,
      page: currentPage,
      pageSize,
    }),
    { keepPreviousData: true },
  );

  const normalizedSkillsPaged = useMemo(() => {
    if (Array.isArray(skillsPagedRaw)) {
      return {
        items: skillsPagedRaw,
        total: skillsPagedRaw.length,
        page: currentPage,
        pageSize,
        totalPages: Math.max(1, Math.ceil(skillsPagedRaw.length / pageSize)),
      };
    }
    return skillsPagedRaw;
  }, [skillsPagedRaw, currentPage, pageSize]);

  const skills = normalizedSkillsPaged?.items || [];
  const total = normalizedSkillsPaged?.total || 0;
  const totalPages = normalizedSkillsPaged?.totalPages || 1;
  const hasActiveSkillFilters = Boolean(statusFilter || categoryFilter || searchKeyword.trim());
  const pageRangeStart = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const pageRangeEnd = Math.min(currentPage * pageSize, total);

  const categoryOptions = useMemo(() => [...skillCategoryOptions], []);

  const skillNameMap = useMemo(() => new Map(allSkills.map((skill) => [skill.id, skill.name])), [allSkills]);

  const { data: activeSkillDetail, isFetching: activeSkillLoading } = useQuery(
    ['skill-detail', activeSkillId],
    () => skillService.getSkillById(activeSkillId as string, { includeContent: true }),
    { enabled: !!activeSkillId },
  );

  const { data: suggestions = [] } = useQuery(
    ['skill-suggestions', suggestionAgentId],
    () => skillService.getSuggestionsForAgent(suggestionAgentId),
    { enabled: !!suggestionAgentId },
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearchKeyword(searchKeyword.trim().toLowerCase());
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchKeyword]);

  useEffect(() => {
    setCurrentPage(1);
  }, [statusFilter, categoryFilter, debouncedSearchKeyword, pageSize]);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  useEffect(() => {
    if (!normalizedSkillsPaged) return;
    if (normalizedSkillsPaged.total > 0 && normalizedSkillsPaged.items.length === 0 && currentPage > 1) {
      setCurrentPage(1);
    }
  }, [normalizedSkillsPaged, currentPage]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);
    if (categoryFilter) params.set('category', categoryFilter);
    if (searchKeyword.trim()) params.set('search', searchKeyword.trim());
    if (currentPage > 1) params.set('page', String(currentPage));
    if (pageSize !== 10) params.set('pageSize', String(pageSize));
    const next = params.toString();
    if (next !== searchParams.toString()) setSearchParams(params, { replace: true });
  }, [statusFilter, categoryFilter, searchKeyword, currentPage, pageSize, searchParams, setSearchParams]);

  useEffect(() => {
    if (!activeSkillId || bindingAgentId || agents.length === 0) return;
    setBindingAgentId(agents[0].id);
  }, [activeSkillId, bindingAgentId, agents]);

  useEffect(() => {
    if (!operationMenuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (operationMenuRef.current?.contains(target) || operationMenuButtonRef.current?.contains(target)) return;
      setOperationMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOperationMenuOpen(false);
        operationMenuButtonRef.current?.focus();
      }
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [operationMenuOpen]);

  const createSkillMutation = useMutation(skillService.createSkill, {
    onSuccess: () => {
      queryClient.invalidateQueries('skills-paged');
      queryClient.invalidateQueries('skills-all');
      setIsCreateModalOpen(false);
    },
  });

  const updateSkillMutation = useMutation(
    ({ id, updates }: { id: string; updates: Partial<Skill> }) => skillService.updateSkill(id, updates),
    {
      onMutate: async ({ id, updates }) => {
        await queryClient.cancelQueries('skills-paged');
        await queryClient.cancelQueries('skills-all');
        await queryClient.cancelQueries(['skill-detail', id]);

        const pagedSnapshots = queryClient.getQueriesData<SkillQueryCache>('skills-paged');
        const allSkillsSnapshot = queryClient.getQueryData<Skill[]>('skills-all');
        const detailSnapshot = queryClient.getQueryData<Skill>(['skill-detail', id]);

        pagedSnapshots.forEach(([queryKey, cached]) => {
          queryClient.setQueryData(queryKey, patchSkillInCache(cached, id, updates));
        });
        queryClient.setQueryData<Skill[]>('skills-all', (cached = []) => (
          cached.map((item) => (item.id === id ? { ...item, ...updates } : item))
        ));
        queryClient.setQueryData(['skill-detail', id], detailSnapshot ? { ...detailSnapshot, ...updates } : detailSnapshot);

        return { pagedSnapshots, allSkillsSnapshot, detailSnapshot };
      },
      onError: (_error, variables, context) => {
        context?.pagedSnapshots.forEach(([queryKey, snapshot]) => {
          queryClient.setQueryData(queryKey, snapshot);
        });
        queryClient.setQueryData('skills-all', context?.allSkillsSnapshot);
        queryClient.setQueryData(['skill-detail', variables.id], context?.detailSnapshot);
      },
      onSettled: (_result, _error, variables) => {
        queryClient.invalidateQueries('skills-paged');
        queryClient.invalidateQueries('skills-all');
        queryClient.invalidateQueries(['skill-detail', variables.id]);
      },
    },
  );

  const deleteSkillMutation = useMutation(skillService.deleteSkill, {
    onSuccess: () => {
      queryClient.invalidateQueries('skills-paged');
      queryClient.invalidateQueries('skills-all');
      if (bindingAgentId) queryClient.invalidateQueries(['agent-skills', bindingAgentId]);
      if (suggestionAgentId) queryClient.invalidateQueries(['skill-suggestions', suggestionAgentId]);
      if (activeSkillId) setActiveSkillId(null);
    },
  });

  const assignSkillMutation = useMutation(skillService.assignSkillToAgent, {
    onSuccess: () => {
      if (bindingAgentId) queryClient.invalidateQueries(['agent-skills', bindingAgentId]);
      queryClient.invalidateQueries('all-skill-agents');
      alert('Agent 绑定已保存');
    },
  });

  const discoverMutation = useMutation(skillService.discoverSkills, {
    onSuccess: (result) => {
      queryClient.invalidateQueries('skills-paged');
      queryClient.invalidateQueries('skills-all');
      alert(`检索完成：found=${result.totalFound}, added=${result.added}, updated=${result.updated}`);
      setIsDiscoverDrawerOpen(false);
    },
  });

  const suggestMutation = useMutation(skillService.suggestSkillsForAgent, {
    onSuccess: () => {
      if (suggestionAgentId) queryClient.invalidateQueries(['skill-suggestions', suggestionAgentId]);
    },
  });

  const reviewMutation = useMutation(
    ({ id, status }: { id: string; status: SkillSuggestion['status'] }) => skillService.reviewSuggestion(id, { status }),
    {
      onSuccess: () => {
        if (suggestionAgentId) queryClient.invalidateQueries(['skill-suggestions', suggestionAgentId]);
      },
    },
  );

  const rebuildDocsMutation = useMutation(skillService.rebuildDocs, {
    onSuccess: (result) => {
      alert(`文档重建完成：skills=${result.skills}, suggestions=${result.suggestions}`);
    },
  });

  const locateSkill = (skillId: string) => {
    const target = allSkills.find((skill) => skill.id === skillId);
    if (!target) return;
    setStatusFilter('');
    setCategoryFilter(target.category || '');
    setSearchKeyword(target.name);
    setCurrentPage(1);
    setHighlightedSkillId(skillId);
    window.setTimeout(() => setHighlightedSkillId(''), 2200);
    const section = document.getElementById('skills-library-section');
    if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const resetSkillFilters = () => {
    setStatusFilter('');
    setCategoryFilter('');
    setSearchKeyword('');
    setCurrentPage(1);
    setPageSize(10);
  };

  const handleSuggest = () => {
    if (!suggestionAgentId) {
      alert('请先选择一个 Agent');
      return;
    }
    suggestMutation.mutate({
      agentId: suggestionAgentId,
      contextTags: contextTagsInput.split(',').map((tag) => tag.trim()).filter(Boolean),
      topK: 5,
      persist: true,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Skills 管理</h1>
          <p className="mt-1 text-sm text-gray-500">管理技能库、Agent 绑定与 AgentSkillManager 建议流</p>
        </div>
        <div className="relative flex items-center gap-2">
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="inline-flex items-center rounded-md border border-green-300 bg-green-50 px-4 py-2 text-sm font-medium text-green-700 hover:bg-green-100"
          >
            <PlusIcon className="mr-2 h-4 w-4" />
            新增 Skill
          </button>
          <button
            ref={operationMenuButtonRef}
            onClick={() => setOperationMenuOpen((prev) => !prev)}
            className="inline-flex items-center rounded-md border border-gray-300 bg-white p-2 text-gray-600 hover:bg-gray-50"
            aria-haspopup="menu"
            aria-expanded={operationMenuOpen}
            aria-label="Skill 检索和文档操作"
          >
            <EllipsisVerticalIcon className="h-5 w-5" />
          </button>
          {operationMenuOpen && (
            <div
              ref={operationMenuRef}
              className="absolute right-0 top-11 z-20 min-w-[220px] rounded-md border border-gray-200 bg-white p-1 shadow-lg"
              role="menu"
            >
              <button
                onClick={() => {
                  setOperationMenuOpen(false);
                  setIsDiscoverDrawerOpen(true);
                }}
                className="flex w-full items-center rounded px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                role="menuitem"
              >
                <ArrowPathIcon className="mr-2 h-4 w-4" />
                AgentSkillManager 检索
              </button>
              <button
                onClick={() => {
                  setOperationMenuOpen(false);
                  rebuildDocsMutation.mutate();
                }}
                disabled={rebuildDocsMutation.isLoading}
                className="flex w-full items-center rounded px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-60"
                role="menuitem"
              >
                <BookOpenIcon className="mr-2 h-4 w-4" />
                {rebuildDocsMutation.isLoading ? '重建中...' : '重建 Skills 文档'}
              </button>
            </div>
          )}
        </div>
      </div>

      <section id="skills-library-section" className="rounded-lg bg-white p-5 shadow">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center">
            <WrenchScrewdriverIcon className="mr-2 h-5 w-5 text-primary-600" />
            <h2 className="text-lg font-medium text-gray-900">技能库</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <input
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                placeholder="搜索 name/description/tags"
              />
              {searchKeyword && (
                <button
                  onClick={() => setSearchKeyword('')}
                  className="rounded-md border border-gray-300 px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
                >
                  清空
                </button>
              )}
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
            >
              <option value="">全部状态</option>
              {statusOptions.map((status) => (
                <option key={status} value={status}>{statusLabelMap[status]}</option>
              ))}
            </select>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
            >
              <option value="">全部分类</option>
              {categoryOptions.map((category) => (
                <option key={category} value={category}>{formatCategory(category)}</option>
              ))}
            </select>
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
            >
              <option value={10}>每页 10 条</option>
              <option value={20}>每页 20 条</option>
              <option value={50}>每页 50 条</option>
            </select>
          </div>
        </div>

        <div className="mb-3 text-xs text-gray-500">共 {total} 条，当前显示 {pageRangeStart}-{pageRangeEnd}</div>

        {skillsError ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            技能列表加载失败：{(skillsErrorDetail as any)?.response?.data?.message || (skillsErrorDetail as Error)?.message || 'Unknown error'}
          </div>
        ) : skillsLoading ? (
          <div className="py-8 text-center text-sm text-gray-500">加载技能中...</div>
        ) : total === 0 ? (
          <div className="py-8 text-center text-sm text-gray-500">
            {hasActiveSkillFilters ? '未找到匹配的技能记录。' : '当前没有技能记录。'}
            {hasActiveSkillFilters && (
              <div className="mt-3">
                <button
                  onClick={resetSkillFilters}
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
                >
                  清空筛选条件
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {skills.map((skill) => (
              <div
                key={skill.id}
                className={`rounded-md border p-3 ${highlightedSkillId === skill.id ? 'border-primary-500 bg-primary-50/50' : 'border-gray-200'}`}
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2 rounded-md bg-gray-50 px-2 py-1.5">
                    <div className="flex min-w-0 items-center gap-2">
                      <p className="truncate font-medium text-gray-900">{skill.name}</p>
                      <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{formatCategory(skill.category)}</span>
                      <span className="rounded bg-blue-50 px-2 py-0.5 text-xs text-blue-700">{statusLabelMap[skill.status as Skill['status']]}</span>
                    </div>
                    <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setActiveSkillId(skill.id);
                        setActiveTab('detail');
                      }}
                      className="rounded-md border border-blue-200 bg-blue-50 p-2 text-blue-600 hover:bg-blue-100"
                      title="查看详情"
                      aria-label="查看详情"
                    >
                      <EyeIcon className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => {
                        if (window.confirm(`确认删除 skill ${skill.name} ?`)) deleteSkillMutation.mutate(skill.id);
                      }}
                      className="rounded-md border border-red-200 bg-red-50 p-2 text-red-600 hover:bg-red-100"
                      title="删除"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                    </div>
                  </div>
                  <div className="min-w-0 md:max-w-3xl">
                    <div className="relative">
                      <p className="max-h-12 overflow-hidden text-sm text-gray-600">{skill.description}</p>
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-5 bg-gradient-to-t from-white to-transparent" />
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <p className="text-xs text-gray-500">
                        provider={skill.provider} · version={skill.version} · confidence={skill.confidenceScore}
                      </p>
                      {allSkillAgents[skill.id] && allSkillAgents[skill.id].length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {allSkillAgents[skill.id].map((bound) => (
                            <span key={bound.agentId} className="rounded bg-primary-50 px-1.5 py-0.5 text-xs text-primary-700">
                              {bound.agentName}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {!skillsLoading && total > 0 && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-3">
            <p className="text-xs text-gray-500">第 {currentPage}/{totalPages} 页</p>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setCurrentPage(1)} disabled={currentPage === 1} className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 disabled:opacity-50">首页</button>
              <button onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))} disabled={currentPage === 1} className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 disabled:opacity-50">上一页</button>
              <button onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))} disabled={currentPage === totalPages} className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 disabled:opacity-50">下一页</button>
              <button onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages} className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 disabled:opacity-50">末页</button>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-lg bg-white p-5 shadow">
        <h2 className="mb-4 text-lg font-medium text-gray-900">Skill 建议与审核</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <select
            value={suggestionAgentId}
            onChange={(e) => setSuggestionAgentId(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="">选择 Agent</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>{agent.name}</option>
            ))}
          </select>
          <input
            value={contextTagsInput}
            onChange={(e) => setContextTagsInput(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            placeholder="context tags: security,typescript"
          />
        </div>
        <button
          onClick={handleSuggest}
          disabled={suggestMutation.isLoading}
          className="mt-3 inline-flex items-center rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-60"
        >
          <LightBulbIcon className="mr-2 h-4 w-4" />
          {suggestMutation.isLoading ? '生成中...' : '生成建议'}
        </button>

        <div className="mt-4 space-y-2">
          {suggestionAgentId && suggestions.length === 0 && (
            <p className="text-sm text-gray-500">暂无建议记录，点击“生成建议”开始分析。</p>
          )}
          {suggestions.map((suggestion) => (
            <div key={suggestion.id} className="rounded-md border border-gray-200 p-3">
              <div className="flex items-center justify-between gap-2">
                <button
                  onClick={() => locateSkill(suggestion.skillId)}
                  className="text-left text-sm font-medium text-primary-700 hover:underline"
                >
                  {skillNameMap.get(suggestion.skillId) || `skillId=${suggestion.skillId}`}
                </button>
                <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{suggestion.priority} · {suggestion.status}</span>
              </div>
              <p className="mt-1 text-xs text-gray-600">{suggestion.reason}</p>
              <p className="mt-1 text-xs text-gray-500">score={suggestion.score}</p>
              {suggestion.status === 'pending' && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <button onClick={() => reviewMutation.mutate({ id: suggestion.id, status: 'accepted' })} className="inline-flex items-center rounded border border-green-300 bg-green-50 px-2 py-1 text-xs text-green-700 hover:bg-green-100"><CheckCircleIcon className="mr-1 h-3.5 w-3.5" /> 接受</button>
                  <button onClick={() => reviewMutation.mutate({ id: suggestion.id, status: 'rejected' })} className="inline-flex items-center rounded border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-700 hover:bg-red-100"><ExclamationTriangleIcon className="mr-1 h-3.5 w-3.5" /> 拒绝</button>
                  <button onClick={() => reviewMutation.mutate({ id: suggestion.id, status: 'applied' })} className="inline-flex items-center rounded border border-primary-300 bg-primary-50 px-2 py-1 text-xs text-primary-700 hover:bg-primary-100">立即应用</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <SkillDetailDrawer
        open={!!activeSkillId}
        skill={activeSkillDetail || null}
        loading={activeSkillLoading}
        agents={agents}
        activeTab={activeTab}
        onChangeTab={setActiveTab}
        bindingAgentId={bindingAgentId}
        onChangeBindingAgentId={setBindingAgentId}
        skillAgentsData={activeSkillId && allSkillAgents[activeSkillId] ? allSkillAgents[activeSkillId] : []}
        saving={updateSkillMutation.isLoading}
        bindingSaving={assignSkillMutation.isLoading}
        onClose={() => setActiveSkillId(null)}
        onSave={async (updates) => {
          if (!activeSkillId) return;
          await updateSkillMutation.mutateAsync({ id: activeSkillId, updates });
        }}
        onAssign={(payload) => assignSkillMutation.mutate(payload)}
      />

      <SkillDiscoveryDrawer
        open={isDiscoverDrawerOpen}
        onClose={() => setIsDiscoverDrawerOpen(false)}
        onSubmit={(payload) => discoverMutation.mutate(payload)}
        loading={discoverMutation.isLoading}
      />

      <SkillFormModal
        open={isCreateModalOpen}
        mode="create"
        onClose={() => setIsCreateModalOpen(false)}
        onSubmit={(payload) => createSkillMutation.mutate(payload)}
        loading={createSkillMutation.isLoading}
      />
    </div>
  );
};

const SkillDetailDrawer: React.FC<{
  open: boolean;
  skill: Skill | null;
  loading: boolean;
  agents: Array<{ id: string; name: string }>;
  activeTab: 'detail' | 'binding';
  onChangeTab: (tab: 'detail' | 'binding') => void;
  bindingAgentId: string;
  onChangeBindingAgentId: (agentId: string) => void;
  skillAgentsData: Array<{ agentId: string; agentName: string }>;
  saving: boolean;
  bindingSaving: boolean;
  onClose: () => void;
  onSave: (updates: Partial<Skill>) => Promise<void>;
  onAssign: (payload: {
    agentId: string;
    skillId: string;
    assignedBy?: string;
  }) => void;
}> = ({
  open,
  skill,
  loading,
  agents,
  activeTab,
  onChangeTab,
  bindingAgentId,
  onChangeBindingAgentId,
  skillAgentsData,
  saving,
  bindingSaving,
  onClose,
  onSave,
  onAssign,
}) => {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState<SkillFormPayload>({
    name: '',
    description: '',
    category: '通用',
    tags: [],
    sourceType: 'manual',
    sourceUrl: '',
    provider: 'system',
    version: '1.0.0',
    status: 'active',
    confidenceScore: 50,
    discoveredBy: '',
    content: '',
    contentType: 'text/markdown',
  });
  const [tagsText, setTagsText] = useState('');
  const [metadataText, setMetadataText] = useState('');

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    window.setTimeout(() => closeButtonRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    if (!skill) return;
    setForm({
      name: skill.name,
      description: skill.description,
      category: skill.category || '通用',
      tags: skill.tags || [],
      sourceType: skill.sourceType,
      sourceUrl: skill.sourceUrl || '',
      provider: skill.provider || 'system',
      version: skill.version || '1.0.0',
      status: skill.status,
      confidenceScore: skill.confidenceScore,
      discoveredBy: skill.discoveredBy || '',
      metadata: skill.metadata || {},
      content: skill.content || '',
      contentType: skill.contentType || 'text/markdown',
    });
    setTagsText((skill.tags || []).join(','));
    setMetadataText(extractMetadataMarkdown(skill.metadata));
    setSaveError('');
  }, [skill?.id, skill]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Skill 详情抽屉">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-full max-w-3xl overflow-y-auto bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">Skill 详情</h3>
          <button ref={closeButtonRef} onClick={onClose} className="rounded p-1 text-gray-500 hover:bg-gray-100" aria-label="关闭详情抽屉">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="mb-4 flex items-center gap-2 border-b border-gray-100 pb-3">
          <button
            onClick={() => onChangeTab('detail')}
            className={`rounded-md px-3 py-1.5 text-sm ${activeTab === 'detail' ? 'bg-primary-50 text-primary-700' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            详情
          </button>
          <button
            onClick={() => onChangeTab('binding')}
            className={`rounded-md px-3 py-1.5 text-sm ${activeTab === 'binding' ? 'bg-primary-50 text-primary-700' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            Agent 绑定
          </button>
        </div>

        {loading || !skill ? (
          <div className="py-12 text-center text-sm text-gray-500">加载详情中...</div>
        ) : activeTab === 'detail' ? (
          <div className="space-y-4">
            {saveError && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{saveError}</p>}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">name</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" placeholder="skill 名称" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">category</label>
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm">
                  {skillCategoryOptions.map((category) => (
                    <option key={category} value={category}>{category}</option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-xs font-medium text-gray-600">description</label>
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" rows={3} placeholder="描述" />
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-xs font-medium text-gray-600">metadata (markdown)</label>
                <textarea
                  value={metadataText}
                  onChange={(e) => setMetadataText(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-xs"
                  rows={6}
                  placeholder="metadata markdown"
                />
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-xs font-medium text-gray-600">content</label>
                <textarea value={form.content || ''} onChange={(e) => setForm({ ...form, content: e.target.value })} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" rows={8} placeholder="Markdown 正文" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">tags</label>
                <input value={tagsText} onChange={(e) => setTagsText(e.target.value)} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" placeholder="tags,comma,separated" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">sourceType</label>
                <select value={form.sourceType} onChange={(e) => setForm({ ...form, sourceType: e.target.value as Skill['sourceType'] })} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm">
                  {sourceOptions.map((source) => (
                    <option key={source} value={source}>{source}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">sourceUrl</label>
                <input value={form.sourceUrl || ''} onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" placeholder="sourceUrl" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">provider</label>
                <input value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" placeholder="provider" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">version</label>
                <input value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" placeholder="version" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">status</label>
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Skill['status'] })} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm">
                  {statusOptions.map((status) => (
                    <option key={status} value={status}>{statusLabelMap[status]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">confidenceScore</label>
                <input type="number" min={0} max={100} value={form.confidenceScore} onChange={(e) => setForm({ ...form, confidenceScore: Number(e.target.value) || 0 })} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" placeholder="confidence" />
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-xs font-medium text-gray-600">discoveredBy</label>
                <input value={form.discoveredBy || ''} onChange={(e) => setForm({ ...form, discoveredBy: e.target.value })} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" placeholder="discoveredBy" />
              </div>
            </div>
            <div className="flex justify-end">
              <button
                onClick={async () => {
                  if (!skill) return;
                  if (!form.name.trim() || !form.description.trim()) {
                    setSaveError('name 和 description 必填');
                    return;
                  }
                  setSaveError('');
                  try {
                    await onSave({
                      ...form,
                      name: form.name.trim(),
                      description: form.description.trim(),
                      category: form.category.trim() || '通用',
                      provider: form.provider.trim() || 'system',
                      version: form.version.trim() || '1.0.0',
                      tags: tagsText.split(',').map((item) => item.trim()).filter(Boolean),
                      metadata: { markdown: metadataText.trim() },
                    });
                  } catch (error) {
                    const message = (error as any)?.response?.data?.message || (error as Error).message || '保存失败，请稍后重试';
                    setSaveError(message);
                  }
                }}
                disabled={saving}
                className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60"
              >
                {saving ? '保存中...' : '保存修改'}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3">
              <select
                value={bindingAgentId}
                onChange={(e) => onChangeBindingAgentId(e.target.value)}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">选择 Agent</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>{agent.name}</option>
                ))}
              </select>
            </div>
            <div className="flex justify-end">
              <button
                onClick={() => {
                  if (!bindingAgentId || !skill) {
                    alert('请选择 Agent');
                    return;
                  }
                  onAssign({
                    agentId: bindingAgentId,
                    skillId: skill.id,
                    assignedBy: 'AgentSkillManager',
                  });
                }}
                disabled={bindingSaving}
                className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60"
              >
                {bindingSaving ? '绑定中...' : '绑定 Agent'}
              </button>
            </div>
            <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
              <p className="mb-2 text-sm font-medium text-gray-700">已绑定 Agent</p>
              {skillAgentsData && skillAgentsData.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {skillAgentsData.map((item) => (
                    <span key={item.agentId} className="rounded bg-primary-50 px-2 py-1 text-xs text-primary-700">
                      {item.agentName}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-500">暂无绑定</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const SkillDiscoveryDrawer: React.FC<{
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: { query: string; maxResults: number; sourceType: Skill['sourceType'] }) => void;
  loading: boolean;
}> = ({ open, onClose, onSubmit, loading }) => {
  const [query, setQuery] = useState('code review');
  const [maxResults, setMaxResults] = useState(5);
  const [sourceType, setSourceType] = useState<Skill['sourceType']>('github');

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Skill 检索抽屉">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-full max-w-md bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">AgentSkillManager 检索</h3>
          <button onClick={onClose} className="rounded p-1 text-gray-500 hover:bg-gray-100">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">检索关键词</label>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              placeholder="例如: security audit"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">最大结果数</label>
            <input
              type="number"
              min={1}
              max={20}
              value={maxResults}
              onChange={(e) => setMaxResults(Number(e.target.value) || 5)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">来源类型</label>
            <select
              value={sourceType}
              onChange={(e) => setSourceType(e.target.value as Skill['sourceType'])}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            >
              {sourceOptions.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </div>
          <button
            onClick={() => onSubmit({ query: query.trim(), maxResults, sourceType })}
            disabled={loading || !query.trim()}
            className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {loading ? '检索中...' : '检索并入库'}
          </button>
        </div>
      </div>
    </div>
  );
};

const SkillFormModal: React.FC<{
  open: boolean;
  mode: 'create';
  onClose: () => void;
  onSubmit: (payload: SkillFormPayload) => void;
  loading: boolean;
}> = ({ open, onClose, onSubmit, loading }) => {
  const [form, setForm] = useState<SkillFormPayload>({
    name: '',
    description: '',
    category: '通用',
    tags: [],
    sourceType: 'manual',
    sourceUrl: '',
    provider: 'system',
    version: '1.0.0',
    status: 'active',
    confidenceScore: 80,
    discoveredBy: 'AgentSkillManager',
    metadata: {},
    content: '',
    contentType: 'text/markdown',
  });
  const [tagsText, setTagsText] = useState('');
  const [metadataText, setMetadataText] = useState('');

  useEffect(() => {
    if (!open) return;
    setForm({
      name: '',
      description: '',
      category: '通用',
      tags: [],
      sourceType: 'manual',
      sourceUrl: '',
      provider: 'system',
      version: '1.0.0',
      status: 'active',
      confidenceScore: 80,
      discoveredBy: 'AgentSkillManager',
      metadata: {},
      content: '',
      contentType: 'text/markdown',
    });
    setTagsText('');
    setMetadataText('');
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="新增 Skill">
      <div className="w-full max-w-2xl rounded-lg bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">新增 Skill</h3>
          <button onClick={onClose} className="rounded p-1 text-gray-500 hover:bg-gray-100">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="rounded-md border border-gray-300 px-3 py-2 text-sm" placeholder="skill 名称" />
          <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="rounded-md border border-gray-300 px-3 py-2 text-sm">
            {skillCategoryOptions.map((category) => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="rounded-md border border-gray-300 px-3 py-2 text-sm md:col-span-2" rows={3} placeholder="描述" />
          <input value={tagsText} onChange={(e) => setTagsText(e.target.value)} className="rounded-md border border-gray-300 px-3 py-2 text-sm" placeholder="tags,comma,separated" />
          <select value={form.sourceType} onChange={(e) => setForm({ ...form, sourceType: e.target.value as Skill['sourceType'] })} className="rounded-md border border-gray-300 px-3 py-2 text-sm">
            {sourceOptions.map((source) => (
              <option key={source} value={source}>{source}</option>
            ))}
          </select>
          <input value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} className="rounded-md border border-gray-300 px-3 py-2 text-sm" placeholder="provider" />
          <input value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} className="rounded-md border border-gray-300 px-3 py-2 text-sm" placeholder="version" />
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Skill['status'] })} className="rounded-md border border-gray-300 px-3 py-2 text-sm">
            {statusOptions.map((status) => (
              <option key={status} value={status}>{statusLabelMap[status]}</option>
            ))}
          </select>
          <input type="number" min={0} max={100} value={form.confidenceScore} onChange={(e) => setForm({ ...form, confidenceScore: Number(e.target.value) || 0 })} className="rounded-md border border-gray-300 px-3 py-2 text-sm" placeholder="confidence" />
          <textarea
            value={metadataText}
            onChange={(e) => setMetadataText(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2 font-mono text-xs md:col-span-2"
            rows={5}
            placeholder="metadata markdown"
          />
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">取消</button>
          <button
            onClick={() => {
              if (!form.name.trim() || !form.description.trim()) {
                alert('name 和 description 必填');
                return;
              }
              onSubmit({
                ...form,
                name: form.name.trim(),
                description: form.description.trim(),
                category: form.category.trim() || '通用',
                provider: form.provider.trim() || 'system',
                version: form.version.trim() || '1.0.0',
                tags: tagsText.split(',').map((item) => item.trim()).filter(Boolean),
                metadata: { markdown: metadataText.trim() },
              });
            }}
            disabled={loading}
            className="rounded-md bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60"
          >
            {loading ? '保存中...' : '创建 Skill'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Skills;
