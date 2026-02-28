import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from 'react-query';
import {
  ArrowPathIcon,
  BoltIcon,
  BookOpenIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  LightBulbIcon,
  PlusIcon,
  TrashIcon,
  WrenchScrewdriverIcon,
} from '@heroicons/react/24/outline';
import { skillService } from '../services/skillService';
import { agentService } from '../services/agentService';
import { Skill, SkillSuggestion } from '../types';

const statusOptions: Array<Skill['status']> = ['active', 'experimental', 'deprecated', 'disabled'];

const Skills: React.FC = () => {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [suggestionAgentId, setSuggestionAgentId] = useState('');
  const [assignSkillId, setAssignSkillId] = useState('');
  const [proficiencyLevel, setProficiencyLevel] = useState<'beginner' | 'intermediate' | 'advanced' | 'expert'>('beginner');
  const [contextTagsInput, setContextTagsInput] = useState('');
  const [discoverQuery, setDiscoverQuery] = useState('code review');
  const [discoverMaxResults, setDiscoverMaxResults] = useState(5);

  const [createForm, setCreateForm] = useState({
    name: '',
    description: '',
    category: 'general',
    tags: '',
    sourceType: 'manual' as Skill['sourceType'],
    provider: 'internal',
    version: '1.0.0',
    status: 'active' as Skill['status'],
    confidenceScore: 80,
  });

  const { data: agents = [] } = useQuery('agents', agentService.getAgents);
  const { data: skills = [], isLoading: skillsLoading } = useQuery(
    ['skills', statusFilter, categoryFilter],
    () => skillService.getSkills({ status: statusFilter || undefined, category: categoryFilter || undefined }),
  );

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
      queryClient.invalidateQueries('skills');
      setCreateForm({
        name: '',
        description: '',
        category: 'general',
        tags: '',
        sourceType: 'manual',
        provider: 'internal',
        version: '1.0.0',
        status: 'active',
        confidenceScore: 80,
      });
      setShowCreateForm(false);
    },
  });

  const updateSkillMutation = useMutation(
    ({ id, updates }: { id: string; updates: Partial<Skill> }) => skillService.updateSkill(id, updates),
    { onSuccess: () => queryClient.invalidateQueries('skills') },
  );

  const deleteSkillMutation = useMutation(skillService.deleteSkill, {
    onSuccess: () => {
      queryClient.invalidateQueries('skills');
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
      queryClient.invalidateQueries('skills');
      alert(`检索完成：found=${result.totalFound}, added=${result.added}, updated=${result.updated}`);
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
    () => Array.from(new Set(skills.map((item) => item.category).filter(Boolean))).sort(),
    [skills],
  );

  const handleCreateSkill = (e: React.FormEvent) => {
    e.preventDefault();
    createSkillMutation.mutate({
      name: createForm.name.trim(),
      description: createForm.description.trim(),
      category: createForm.category.trim() || 'general',
      tags: createForm.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
      sourceType: createForm.sourceType,
      provider: createForm.provider.trim() || 'internal',
      version: createForm.version.trim() || '1.0.0',
      status: createForm.status,
      confidenceScore: Number(createForm.confidenceScore),
    });
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
        <button
          onClick={() => rebuildDocsMutation.mutate()}
          disabled={rebuildDocsMutation.isLoading}
          className="inline-flex items-center rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60"
        >
          <BookOpenIcon className="mr-2 h-4 w-4" />
          {rebuildDocsMutation.isLoading ? '重建中...' : '重建 Skills 文档'}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="rounded-lg bg-white p-5 shadow">
          <div className="mb-4 flex items-center">
            <BoltIcon className="mr-2 h-5 w-5 text-blue-600" />
            <h2 className="text-lg font-medium text-gray-900">AgentSkillManager 检索</h2>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <input
              value={discoverQuery}
              onChange={(e) => setDiscoverQuery(e.target.value)}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
              placeholder="检索关键词"
            />
            <input
              type="number"
              min={1}
              max={20}
              value={discoverMaxResults}
              onChange={(e) => setDiscoverMaxResults(Number(e.target.value) || 5)}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
            />
            <button
              onClick={() => discoverMutation.mutate({ query: discoverQuery, maxResults: discoverMaxResults, sourceType: 'github' })}
              disabled={discoverMutation.isLoading || !discoverQuery.trim()}
              className="inline-flex items-center justify-center rounded-md border border-blue-300 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-60"
            >
              <ArrowPathIcon className="mr-2 h-4 w-4" />
              {discoverMutation.isLoading ? '检索中...' : '检索并入库'}
            </button>
          </div>
        </section>

        <section className="rounded-lg bg-white p-5 shadow">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center">
              <PlusIcon className="mr-2 h-5 w-5 text-green-600" />
              <h2 className="text-lg font-medium text-gray-900">新增 Skill</h2>
            </div>
            <button
              onClick={() => setShowCreateForm((v) => !v)}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
            >
              {showCreateForm ? '收起' : '展开'}
            </button>
          </div>
          {showCreateForm ? (
            <form className="grid grid-cols-1 gap-3 md:grid-cols-2" onSubmit={handleCreateSkill}>
              <input
                required
                value={createForm.name}
                onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                placeholder="skill 名称"
              />
              <input
                value={createForm.category}
                onChange={(e) => setCreateForm({ ...createForm, category: e.target.value })}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                placeholder="category"
              />
              <textarea
                required
                value={createForm.description}
                onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm md:col-span-2"
                rows={3}
                placeholder="description"
              />
              <input
                value={createForm.tags}
                onChange={(e) => setCreateForm({ ...createForm, tags: e.target.value })}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                placeholder="tags,comma,separated"
              />
              <select
                value={createForm.status}
                onChange={(e) => setCreateForm({ ...createForm, status: e.target.value as Skill['status'] })}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                {statusOptions.map((status) => (
                  <option key={status} value={status}>{status}</option>
                ))}
              </select>
              <button
                type="submit"
                disabled={createSkillMutation.isLoading}
                className="rounded-md bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-60 md:col-span-2"
              >
                {createSkillMutation.isLoading ? '创建中...' : '创建 Skill'}
              </button>
            </form>
          ) : (
            <p className="text-sm text-gray-500">点击展开后可手动创建内部 skill。</p>
          )}
        </section>
      </div>

      <section className="rounded-lg bg-white p-5 shadow">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center">
            <WrenchScrewdriverIcon className="mr-2 h-5 w-5 text-primary-600" />
            <h2 className="text-lg font-medium text-gray-900">技能库</h2>
          </div>
          <div className="flex flex-wrap gap-2">
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
          </div>
        </div>

        {skillsLoading ? (
          <div className="py-8 text-center text-sm text-gray-500">加载技能中...</div>
        ) : skills.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-500">当前没有技能记录。</div>
        ) : (
          <div className="space-y-3">
            {skills.map((skill) => (
              <div key={skill.id} className="rounded-md border border-gray-200 p-3">
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
              {skills.map((skill) => (
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
                  <p className="text-sm font-medium text-gray-900">skillId={suggestion.skillId}</p>
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
    </div>
  );
};

export default Skills;
