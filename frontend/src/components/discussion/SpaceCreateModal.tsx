import React, { useEffect, useMemo, useState } from 'react';

type AgentOption = {
  id: string;
  name: string;
  description?: string;
};

type DiscussionSpaceCategory = 'general' | 'industry_observation' | 'product_discussion' | 'technical_design';

type ProjectOption = {
  id: string;
  name: string;
};

type OutlineTemplateOption = {
  id: string;
  name: string;
  description?: string;
  isSystem?: boolean;
};

type SpaceCreateModalProps = {
  open: boolean;
  loading: boolean;
  availableAgents: AgentOption[];
  agentsLoading?: boolean;
  onClose: () => void;
  onSubmit: (payload: {
    title: string;
    description?: string;
    tags: string[];
    projectId?: string;
    category: DiscussionSpaceCategory;
    industryContext?: string;
    outlineTemplateId?: string;
    initialAgentIds: string[];
  }) => Promise<unknown>;
  projectOptions?: ProjectOption[];
  projectsLoading?: boolean;
  defaultProjectId?: string;
  outlineTemplateOptions?: OutlineTemplateOption[];
  outlineTemplatesLoading?: boolean;
};

const categoryOptions: Array<{
  value: DiscussionSpaceCategory;
  label: string;
  description: string;
}> = [
  {
    value: 'general',
    label: '通用讨论',
    description: '自由讨论与任务推进，不触发特殊初始化。',
  },
  {
    value: 'industry_observation',
    label: '行业观察',
    description: '围绕行业脉络、公司、人物和趋势持续沉淀知识。',
  },
  {
    value: 'product_discussion',
    label: '产品讨论',
    description: '用于产品方向评审和功能策略讨论（后续扩展模板）。',
  },
  {
    value: 'technical_design',
    label: '技术方案',
    description: '用于技术评审、架构设计和实现路径讨论（后续扩展模板）。',
  },
];

const SpaceCreateModal: React.FC<SpaceCreateModalProps> = ({
  open,
  loading,
  availableAgents,
  agentsLoading = false,
  projectOptions = [],
  projectsLoading = false,
  defaultProjectId,
  outlineTemplateOptions = [],
  outlineTemplatesLoading = false,
  onClose,
  onSubmit,
}) => {
  const [category, setCategory] = useState<DiscussionSpaceCategory>('general');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [projectId, setProjectId] = useState(defaultProjectId || '');
  const [industryContext, setIndustryContext] = useState('');
  const [outlineTemplateId, setOutlineTemplateId] = useState('');
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [error, setError] = useState('');

  const parsedTags = useMemo(
    () =>
      tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
    [tags],
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    setProjectId(defaultProjectId || '');
  }, [defaultProjectId, open]);

  useEffect(() => {
    if (category !== 'industry_observation' && outlineTemplateId) {
      setOutlineTemplateId('');
    }
  }, [category, outlineTemplateId]);

  const reset = () => {
    setCategory('general');
    setTitle('');
    setDescription('');
    setTags('');
    setProjectId(defaultProjectId || '');
    setIndustryContext('');
    setOutlineTemplateId('');
    setSelectedAgentIds([]);
    setError('');
  };

  const toggleAgent = (agentId: string) => {
    setSelectedAgentIds((previous) => {
      if (previous.includes(agentId)) {
        return previous.filter((id) => id !== agentId);
      }
      return [...previous, agentId];
    });
  };

  const handleClose = () => {
    if (loading) {
      return;
    }
    reset();
    onClose();
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim()) {
      setError('请输入讨论主题');
      return;
    }
    setError('');
    try {
      await onSubmit({
        title: title.trim(),
        description: description.trim() || undefined,
        tags: parsedTags,
        category,
        industryContext: category === 'industry_observation' ? industryContext.trim() || undefined : undefined,
        outlineTemplateId: category === 'industry_observation' ? outlineTemplateId || undefined : undefined,
        projectId: projectId.trim() || undefined,
        initialAgentIds: selectedAgentIds,
      });
      reset();
    } catch (submitError: unknown) {
      const message =
        typeof submitError === 'object' && submitError && 'message' in submitError
          ? String((submitError as { message?: string }).message || '创建失败')
          : '创建失败';
      setError(message);
    }
  };

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-2xl border border-[#c6c6c6] bg-white p-6"
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-xl font-light text-[#161616]">创建讨论空间</h3>
          <button
            type="button"
            onClick={handleClose}
            className="border border-[#c6c6c6] px-3 py-1 text-sm text-[#525252] hover:bg-[#f4f4f4]"
          >
            关闭
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs tracking-wide text-[#6f6f6f]">空间分类</label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {categoryOptions.map((option) => {
                const selected = option.value === category;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setCategory(option.value)}
                    className={`border px-3 py-2 text-left ${selected ? 'border-[#0f62fe] bg-[#edf5ff]' : 'border-[#c6c6c6] bg-[#f4f4f4] hover:border-[#8d8d8d]'}`}
                  >
                    <div className="text-sm text-[#161616]">{option.label}</div>
                    <div className="mt-1 text-xs text-[#6f6f6f]">{option.description}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {category === 'industry_observation' ? (
            <>
              <div>
                <label className="mb-1 block text-xs tracking-wide text-[#6f6f6f]">观察行业（可选）</label>
                <input
                  value={industryContext}
                  onChange={(event) => setIndustryContext(event.target.value)}
                  placeholder="例如：区块链 Web3、新能源、AI"
                  className="w-full border-0 border-b-2 border-[#c6c6c6] bg-[#f4f4f4] px-3 py-2 text-sm text-[#161616] outline-none focus:border-[#0f62fe]"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs tracking-wide text-[#6f6f6f]">大纲模板（可选）</label>
                <select
                  value={outlineTemplateId}
                  onChange={(event) => setOutlineTemplateId(event.target.value)}
                  className="w-full border-0 border-b-2 border-[#c6c6c6] bg-[#f4f4f4] px-3 py-2 text-sm text-[#161616] outline-none focus:border-[#0f62fe]"
                >
                  <option value="">自动生成大纲（不使用模板）</option>
                  {outlineTemplateOptions.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.isSystem ? '[系统] ' : ''}
                      {template.name}
                    </option>
                  ))}
                </select>
                {outlineTemplatesLoading ? <div className="mt-1 text-xs text-[#6f6f6f]">加载模板中...</div> : null}
                {!outlineTemplatesLoading && outlineTemplateId
                  ? (
                      <div className="mt-1 text-xs text-[#6f6f6f]">
                        {outlineTemplateOptions.find((item) => item.id === outlineTemplateId)?.description || '已选择模板'}
                      </div>
                    )
                  : null}
              </div>
            </>
          ) : null}

          <div>
            <label className="mb-1 block text-xs tracking-wide text-[#6f6f6f]">讨论主题</label>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="例如：全球能源公司动态跟踪体系"
              className="w-full border-0 border-b-2 border-[#c6c6c6] bg-[#f4f4f4] px-3 py-2 text-sm text-[#161616] outline-none focus:border-[#0f62fe]"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs tracking-wide text-[#6f6f6f]">描述</label>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              placeholder="简述讨论目标与预期产出"
              className="w-full border-0 border-b-2 border-[#c6c6c6] bg-[#f4f4f4] px-3 py-2 text-sm text-[#161616] outline-none focus:border-[#0f62fe]"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs tracking-wide text-[#6f6f6f]">标签（逗号分隔）</label>
            <input
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="能源, 宏观, 行业观察"
              className="w-full border-0 border-b-2 border-[#c6c6c6] bg-[#f4f4f4] px-3 py-2 text-sm text-[#161616] outline-none focus:border-[#0f62fe]"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs tracking-wide text-[#6f6f6f]">关联孵化项目（可选）</label>
            <select
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              className="w-full border-0 border-b-2 border-[#c6c6c6] bg-[#f4f4f4] px-3 py-2 text-sm text-[#161616] outline-none focus:border-[#0f62fe]"
            >
              <option value="">不关联项目</option>
              {projectOptions.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
            {projectsLoading ? <div className="mt-1 text-xs text-[#6f6f6f]">加载项目列表中...</div> : null}
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="block text-xs tracking-wide text-[#6f6f6f]">初始 Agent（可选）</label>
              <span className="text-xs text-[#6f6f6f]">已选 {selectedAgentIds.length}</span>
            </div>
            <div className="max-h-40 overflow-auto border border-[#c6c6c6] bg-[#f4f4f4] p-2">
              {agentsLoading ? <div className="px-2 py-2 text-xs text-[#6f6f6f]">加载 Agent 中...</div> : null}
              {!agentsLoading && availableAgents.length === 0 ? (
                <div className="px-2 py-2 text-xs text-[#6f6f6f]">暂无可选 Agent</div>
              ) : null}
              {!agentsLoading
                ? availableAgents.map((agent) => (
                    <label
                      key={agent.id}
                      className="mb-1 flex cursor-pointer items-start gap-2 rounded border border-transparent px-2 py-1 hover:border-[#0f62fe] hover:bg-white"
                    >
                      <input
                        type="checkbox"
                        checked={selectedAgentIds.includes(agent.id)}
                        onChange={() => toggleAgent(agent.id)}
                        className="mt-0.5"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-[#161616]">{agent.name}</span>
                        {agent.description ? (
                          <span className="line-clamp-1 block text-xs text-[#6f6f6f]">{agent.description}</span>
                        ) : null}
                      </span>
                    </label>
                  ))
                : null}
            </div>
          </div>

          {error ? <div className="text-sm text-[#da1e28]">{error}</div> : null}
        </div>

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={handleClose}
            disabled={loading}
            className="border border-[#0f62fe] px-4 py-2 text-sm text-[#0f62fe] hover:bg-[#edf5ff] disabled:cursor-not-allowed disabled:opacity-60"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={loading}
            className="bg-[#0f62fe] px-5 py-2 text-sm text-white hover:bg-[#0353e9] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? '创建中...' : '创建空间'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default SpaceCreateModal;
