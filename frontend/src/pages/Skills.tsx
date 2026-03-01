import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from 'react-query';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowPathIcon,
  BookOpenIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  LightBulbIcon,
  PencilSquareIcon,
  PlusIcon,
  TrashIcon,
  WrenchScrewdriverIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { skillService } from '../services/skillService';
import { agentService } from '../services/agentService';
import { Skill, SkillSuggestion } from '../types';

const statusOptions: Array<Skill['status']> = ['active', 'experimental', 'deprecated', 'disabled'];
const sourceOptions: Array<Skill['sourceType']> = ['manual', 'github', 'web', 'internal'];

type SkillFormPayload = {
  name: string;
  description: string;
  category: string;
  tags: string[];
  sourceType: Skill['sourceType'];
  provider: string;
  version: string;
  status: Skill['status'];
  confidenceScore: number;
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
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [suggestionAgentId, setSuggestionAgentId] = useState('');
  const [assignSkillId, setAssignSkillId] = useState('');
  const [proficiencyLevel, setProficiencyLevel] = useState<'beginner' | 'intermediate' | 'advanced' | 'expert'>('beginner');
  const [contextTagsInput, setContextTagsInput] = useState('');

  const [isDiscoverDrawerOpen, setIsDiscoverDrawerOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
  const [highlightedSkillId, setHighlightedSkillId] = useState('');

  const { data: agents = [] } = useQuery('agents', agentService.getAgents);
  const { data: allSkills = [] } = useQuery('skills-all', () => skillService.getSkills());
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

  const { data: agentSkills = [] } = useQuery(
    ['agent-skills', selectedAgentId],
    () => skillService.getAgentSkills(selectedAgentId),
    { enabled: !!selectedAgentId },
  );

  const { data: suggestions = [] } = useQuery(
    ['skill-suggestions', suggestionAgentId],
    () => skillService.getSuggestionsForAgent(suggestionAgentId),
    { enabled: !!suggestionAgentId },
  );

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
      onSuccess: () => {
        queryClient.invalidateQueries('skills-paged');
        queryClient.invalidateQueries('skills-all');
      },
    },
  );

  const deleteSkillMutation = useMutation(skillService.deleteSkill, {
    onSuccess: () => {
      queryClient.invalidateQueries('skills-paged');
      queryClient.invalidateQueries('skills-all');
      if (selectedAgentId) queryClient.invalidateQueries(['agent-skills', selectedAgentId]);
      if (suggestionAgentId) queryClient.invalidateQueries(['skill-suggestions', suggestionAgentId]);
    },
  });

  const assignSkillMutation = useMutation(skillService.assignSkillToAgent, {
    onSuccess: () => {
      if (selectedAgentId) queryClient.invalidateQueries(['agent-skills', selectedAgentId]);
      if (suggestionAgentId) queryClient.invalidateQueries(['skill-suggestions', suggestionAgentId]);
      setAssignSkillId('');
      alert('技能已绑定到 Agent');
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
        if (selectedAgentId) queryClient.invalidateQueries(['agent-skills', selectedAgentId]);
      },
    },
  );

  const rebuildDocsMutation = useMutation(skillService.rebuildDocs, {
    onSuccess: (result) => {
      alert(`文档重建完成：skills=${result.skills}, suggestions=${result.suggestions}`);
    },
  });

  const categoryOptions = useMemo(
    () => Array.from(new Set(allSkills.map((item) => item.category).filter(Boolean))).sort(),
    [allSkills],
  );

  const skillNameMap = useMemo(
    () => new Map(allSkills.map((skill) => [skill.id, skill.name])),
    [allSkills],
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
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  useEffect(() => {
    if (!normalizedSkillsPaged) return;
    if (normalizedSkillsPaged.total > 0 && normalizedSkillsPaged.items.length === 0 && currentPage > 1) {
      setCurrentPage(1);
    }
  }, [normalizedSkillsPaged, currentPage]);

  const pageRangeStart = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const pageRangeEnd = Math.min(currentPage * pageSize, total);

  useEffect(() => {
    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);
    if (categoryFilter) params.set('category', categoryFilter);
    if (searchKeyword.trim()) params.set('search', searchKeyword.trim());
    if (currentPage > 1) params.set('page', String(currentPage));
    if (pageSize !== 10) params.set('pageSize', String(pageSize));
    const next = params.toString();
    if (next !== searchParams.toString()) {
      setSearchParams(params, { replace: true });
    }
  }, [statusFilter, categoryFilter, searchKeyword, currentPage, pageSize, searchParams, setSearchParams]);

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
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setIsDiscoverDrawerOpen(true)}
            className="inline-flex items-center rounded-md border border-blue-300 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100"
          >
            <ArrowPathIcon className="mr-2 h-4 w-4" />
            AgentSkillManager 检索
          </button>
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="inline-flex items-center rounded-md border border-green-300 bg-green-50 px-4 py-2 text-sm font-medium text-green-700 hover:bg-green-100"
          >
            <PlusIcon className="mr-2 h-4 w-4" />
            新增 Skill
          </button>
          <button
            onClick={() => rebuildDocsMutation.mutate()}
            disabled={rebuildDocsMutation.isLoading}
            className="inline-flex items-center rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60"
          >
            <BookOpenIcon className="mr-2 h-4 w-4" />
            {rebuildDocsMutation.isLoading ? '重建中...' : '重建 Skills 文档'}
          </button>
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
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
            >
              <option value="">全部分类</option>
              {categoryOptions.map((category) => (
                <option key={category} value={category}>{category}</option>
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

        <div className="mb-3 text-xs text-gray-500">
          共 {total} 条，当前显示 {pageRangeStart}-{pageRangeEnd}
        </div>

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
                className={`rounded-md border p-3 ${
                  highlightedSkillId === skill.id ? 'border-primary-500 bg-primary-50/50' : 'border-gray-200'
                }`}
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-gray-900">{skill.name}</p>
                      <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{skill.category}</span>
                    </div>
                    <p className="mt-1 text-sm text-gray-600">{skill.description}</p>
                    <p className="mt-1 text-xs text-gray-500">
                      provider={skill.provider} · version={skill.version} · confidence={skill.confidenceScore}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={skill.status}
                      onChange={(e) => updateSkillMutation.mutate({ id: skill.id, updates: { status: e.target.value as Skill['status'] } })}
                      className="rounded-md border border-gray-300 px-2 py-1.5 text-xs"
                    >
                      {statusOptions.map((status) => (
                        <option key={status} value={status}>{status}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => setEditingSkill(skill)}
                      className="rounded-md border border-blue-200 bg-blue-50 p-2 text-blue-600 hover:bg-blue-100"
                      title="编辑"
                    >
                      <PencilSquareIcon className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => {
                        if (window.confirm(`确认删除 skill ${skill.name} ?`)) {
                          deleteSkillMutation.mutate(skill.id);
                        }
                      }}
                      className="rounded-md border border-red-200 bg-red-50 p-2 text-red-600 hover:bg-red-100"
                      title="删除"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {!skillsLoading && total > 0 && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-3">
            <p className="text-xs text-gray-500">
              第 {currentPage}/{totalPages} 页
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setCurrentPage(1)}
                disabled={currentPage === 1}
                className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 disabled:opacity-50"
              >
                首页
              </button>
              <button
                onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
                className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 disabled:opacity-50"
              >
                上一页
              </button>
              <button
                onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages}
                className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 disabled:opacity-50"
              >
                下一页
              </button>
              <button
                onClick={() => setCurrentPage(totalPages)}
                disabled={currentPage === totalPages}
                className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 disabled:opacity-50"
              >
                末页
              </button>
            </div>
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section className="rounded-lg bg-white p-5 shadow">
          <h2 className="mb-4 text-lg font-medium text-gray-900">Agent 技能绑定</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <select
              value={selectedAgentId}
              onChange={(e) => setSelectedAgentId(e.target.value)}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">选择 Agent</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>{agent.name}</option>
              ))}
            </select>
            <select
              value={assignSkillId}
              onChange={(e) => setAssignSkillId(e.target.value)}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">选择 Skill</option>
              {allSkills.map((skill) => (
                <option key={skill.id} value={skill.id}>{skill.name}</option>
              ))}
            </select>
            <select
              value={proficiencyLevel}
              onChange={(e) => setProficiencyLevel(e.target.value as typeof proficiencyLevel)}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="beginner">beginner</option>
              <option value="intermediate">intermediate</option>
              <option value="advanced">advanced</option>
              <option value="expert">expert</option>
            </select>
          </div>
          <button
            onClick={() => {
              if (!selectedAgentId || !assignSkillId) {
                alert('请选择 Agent 和 Skill');
                return;
              }
              assignSkillMutation.mutate({
                agentId: selectedAgentId,
                skillId: assignSkillId,
                proficiencyLevel,
                assignedBy: 'AgentSkillManager',
              });
            }}
            disabled={assignSkillMutation.isLoading}
            className="mt-3 rounded-md bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60"
          >
            {assignSkillMutation.isLoading ? '绑定中...' : '绑定技能'}
          </button>

          <div className="mt-4 space-y-2">
            {selectedAgentId && agentSkills.length === 0 && (
              <p className="text-sm text-gray-500">该 Agent 暂未绑定技能。</p>
            )}
            {agentSkills.map((item) => (
              <div key={item.assignment.id} className="rounded-md border border-gray-200 p-2 text-sm">
                <p className="font-medium text-gray-900">{item.skill?.name || item.assignment.skillId}</p>
                <p className="text-xs text-gray-500">proficiency={item.assignment.proficiencyLevel} · enabled={String(item.assignment.enabled)}</p>
              </div>
            ))}
          </div>
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
                  <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                    {suggestion.priority} · {suggestion.status}
                  </span>
                </div>
                <p className="mt-1 text-xs text-gray-600">{suggestion.reason}</p>
                <p className="mt-1 text-xs text-gray-500">score={suggestion.score}</p>
                {suggestion.status === 'pending' && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      onClick={() => reviewMutation.mutate({ id: suggestion.id, status: 'accepted' })}
                      className="inline-flex items-center rounded border border-green-300 bg-green-50 px-2 py-1 text-xs text-green-700 hover:bg-green-100"
                    >
                      <CheckCircleIcon className="mr-1 h-3.5 w-3.5" /> 接受
                    </button>
                    <button
                      onClick={() => reviewMutation.mutate({ id: suggestion.id, status: 'rejected' })}
                      className="inline-flex items-center rounded border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-700 hover:bg-red-100"
                    >
                      <ExclamationTriangleIcon className="mr-1 h-3.5 w-3.5" /> 拒绝
                    </button>
                    <button
                      onClick={() => reviewMutation.mutate({ id: suggestion.id, status: 'applied' })}
                      className="inline-flex items-center rounded border border-primary-300 bg-primary-50 px-2 py-1 text-xs text-primary-700 hover:bg-primary-100"
                    >
                      立即应用
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>

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

      <SkillFormModal
        open={!!editingSkill}
        mode="edit"
        skill={editingSkill}
        onClose={() => setEditingSkill(null)}
        onSubmit={(payload) => {
          if (!editingSkill) return;
          updateSkillMutation.mutate({ id: editingSkill.id, updates: payload });
          setEditingSkill(null);
        }}
        loading={updateSkillMutation.isLoading}
      />
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

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
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
  mode: 'create' | 'edit';
  skill?: Skill | null;
  onClose: () => void;
  onSubmit: (payload: SkillFormPayload) => void;
  loading: boolean;
}> = ({ open, mode, skill, onClose, onSubmit, loading }) => {
  const [form, setForm] = useState<SkillFormPayload>({
    name: '',
    description: '',
    category: 'general',
    tags: [],
    sourceType: 'manual',
    provider: 'internal',
    version: '1.0.0',
    status: 'active',
    confidenceScore: 80,
  });

  const [tagsText, setTagsText] = useState('');

  React.useEffect(() => {
    if (mode === 'edit' && skill) {
      setForm({
        name: skill.name,
        description: skill.description,
        category: skill.category || 'general',
        tags: skill.tags || [],
        sourceType: skill.sourceType,
        provider: skill.provider,
        version: skill.version,
        status: skill.status,
        confidenceScore: skill.confidenceScore,
      });
      setTagsText((skill.tags || []).join(','));
      return;
    }

    if (mode === 'create') {
      setForm({
        name: '',
        description: '',
        category: 'general',
        tags: [],
        sourceType: 'manual',
        provider: 'internal',
        version: '1.0.0',
        status: 'active',
        confidenceScore: 80,
      });
      setTagsText('');
    }
  }, [mode, skill, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl rounded-lg bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">{mode === 'create' ? '新增 Skill' : '编辑 Skill'}</h3>
          <button onClick={onClose} className="rounded p-1 text-gray-500 hover:bg-gray-100">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            placeholder="skill 名称"
          />
          <input
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            placeholder="分类"
          />
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm md:col-span-2"
            rows={3}
            placeholder="描述"
          />
          <input
            value={tagsText}
            onChange={(e) => setTagsText(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            placeholder="tags,comma,separated"
          />
          <select
            value={form.sourceType}
            onChange={(e) => setForm({ ...form, sourceType: e.target.value as Skill['sourceType'] })}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          >
            {sourceOptions.map((source) => (
              <option key={source} value={source}>{source}</option>
            ))}
          </select>
          <input
            value={form.provider}
            onChange={(e) => setForm({ ...form, provider: e.target.value })}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            placeholder="provider"
          />
          <input
            value={form.version}
            onChange={(e) => setForm({ ...form, version: e.target.value })}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            placeholder="version"
          />
          <select
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value as Skill['status'] })}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          >
            {statusOptions.map((status) => (
              <option key={status} value={status}>{status}</option>
            ))}
          </select>
          <input
            type="number"
            min={0}
            max={100}
            value={form.confidenceScore}
            onChange={(e) => setForm({ ...form, confidenceScore: Number(e.target.value) || 0 })}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            placeholder="confidence"
          />
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
            取消
          </button>
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
                category: form.category.trim() || 'general',
                provider: form.provider.trim() || 'internal',
                version: form.version.trim() || '1.0.0',
                tags: tagsText.split(',').map((item) => item.trim()).filter(Boolean),
              });
            }}
            disabled={loading}
            className="rounded-md bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60"
          >
            {loading ? '保存中...' : mode === 'create' ? '创建 Skill' : '保存修改'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Skills;
