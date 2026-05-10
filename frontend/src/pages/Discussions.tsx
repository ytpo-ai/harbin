import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from 'react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { PlusIcon, ArrowPathIcon, ChatBubbleLeftRightIcon } from '@heroicons/react/24/outline';
import SpaceCreateModal from '../components/discussion/SpaceCreateModal';
import { agentService } from '../services/agentService';
import { authService, CurrentUser } from '../services/authService';
import { engineeringIntelligenceService } from '../services/engineeringIntelligenceService';
import { incubationProjectService } from '../services/incubationProjectService';
import {
  discussionService,
  DiscussionSpaceCategory,
  DiscussionSpace,
  DiscussionSpaceStatus,
  AddDiscussionParticipantPayload,
} from '../services/discussionService';

const statusLabelMap: Record<DiscussionSpaceStatus, string> = {
  active: '进行中',
  paused: '已暂停',
  archived: '已归档',
};

const categoryLabelMap: Record<DiscussionSpaceCategory, string> = {
  general: '通用',
  industry_observation: '行业观察',
  product_discussion: '产品讨论',
  technical_design: '技术方案',
};

const Discussions: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | DiscussionSpaceStatus>('all');
  const [keyword, setKeyword] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createError, setCreateError] = useState('');

  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const defaultProjectId = searchParams.get('projectId') || '';

  useEffect(() => {
    if (searchParams.get('create') === '1') {
      setCreateOpen(true);
    }
  }, [searchParams]);

  useEffect(() => {
    const loadUser = async () => {
      const user = await authService.getCurrentUser();
      setCurrentUser(user);
    };

    void loadUser();
  }, []);

  const spacesQuery = useQuery(
    ['discussion-spaces', statusFilter],
    () =>
      discussionService.listSpaces({
        status: statusFilter === 'all' ? undefined : statusFilter,
      }),
    {
      staleTime: 20_000,
    },
  );

  const assignableAgentsQuery = useQuery(['discussion-assignable-agents'], () => agentService.getAssignableAgents(), {
    staleTime: 60_000,
  });

  const projectOptionsQuery = useQuery(
    ['incubation-project-options'],
    () => incubationProjectService.list({ status: 'active' }),
    {
      staleTime: 60_000,
    },
  );

  const outlineTemplateOptionsQuery = useQuery(
    ['ei-outline-template-options'],
    () => engineeringIntelligenceService.listOutlineTemplates({ type: 'industry_observation' }),
    {
      staleTime: 60_000,
    },
  );

  const createSpaceMutation = useMutation<
    DiscussionSpace,
    unknown,
    {
      title: string;
      description?: string;
      tags: string[];
      projectId?: string;
      category: DiscussionSpaceCategory;
      industryContext?: string;
      outlineTemplateId?: string;
      initialAgentIds: string[];
    }
  >(
    async (payload) => {
      if (!currentUser?.id) {
        throw new Error('当前用户未登录，无法创建讨论空间');
      }

      const agentMap = new Map((assignableAgentsQuery.data || []).map((agent) => [agent.id, agent]));
      const initialParticipants: AddDiscussionParticipantPayload[] = [];
      for (const agentId of payload.initialAgentIds) {
        const matchedAgent = agentMap.get(agentId);
        if (!matchedAgent) {
          continue;
        }
        initialParticipants.push({
          type: 'ai_agent',
          agentId,
          displayName: matchedAgent.name,
          role: 'on_demand',
          expertise: matchedAgent.description || undefined,
          expertiseTags: matchedAgent.capabilities || [],
        });
      }

      const createdSpace = await discussionService.createSpace({
        title: payload.title,
        description: payload.description,
        category: payload.category,
        industryContext: payload.industryContext,
        tags: payload.tags,
        projectId: payload.projectId,
        creatorId: currentUser.id,
        initialParticipants,
      });

      if (payload.category === 'industry_observation' && payload.outlineTemplateId) {
        try {
          await engineeringIntelligenceService.applyOutlineTemplate(payload.outlineTemplateId, {
            spaceId: createdSpace.id,
            outlineTitle: `${payload.title} 行业观察大纲`,
          });

          const matchedTemplate = (outlineTemplateOptionsQuery.data || []).find((item) => item._id === payload.outlineTemplateId);
          const projectId = String(payload.projectId || '').trim();
          if (matchedTemplate && projectId && Array.isArray(matchedTemplate.suggestedDataSources) && matchedTemplate.suggestedDataSources.length > 0) {
            const storageKey = `ei-data-source-prefill:${projectId}`;
            const raw = window.sessionStorage.getItem(storageKey);
            let existed: Array<Record<string, unknown>> = [];
            if (raw) {
              try {
                existed = JSON.parse(raw) as Array<Record<string, unknown>>;
              } catch {
                existed = [];
              }
            }
            const next = [
              ...existed,
              ...matchedTemplate.suggestedDataSources.map((item, index) => ({
                id: `${payload.outlineTemplateId}-${index}-${Date.now()}`,
                name: item.name,
                sourceType: item.sourceType,
                config: item.config,
                collectFrequency: item.collectFrequency,
                templateId: payload.outlineTemplateId,
                templateName: matchedTemplate.name,
                discussionSpaceId: createdSpace.id,
              })),
            ];
            window.sessionStorage.setItem(storageKey, JSON.stringify(next));
          }
        } catch {
        }
      }

      return createdSpace;
    },
    {
      onSuccess: async (space) => {
        setCreateOpen(false);
        setCreateError('');
        await queryClient.invalidateQueries('discussion-spaces');
        navigate(`/discussions/${space.id}`);
      },
      onError: (error: unknown) => {
        const message =
          typeof error === 'object' && error && 'message' in error
            ? String((error as { message?: string }).message || '创建失败')
            : '创建失败';
        setCreateError(message);
      },
    },
  );

  const archiveSpaceMutation = useMutation(
    async (space: DiscussionSpace) => {
      return discussionService.archiveSpace(space.id, currentUser?.id);
    },
    {
      onSuccess: async () => {
        await queryClient.invalidateQueries('discussion-spaces');
      },
    },
  );

  const unarchiveSpaceMutation = useMutation(
    async (space: DiscussionSpace) => {
      return discussionService.unarchiveSpace(space.id);
    },
    {
      onSuccess: async () => {
        await queryClient.invalidateQueries('discussion-spaces');
      },
    },
  );

  const filteredSpaces = useMemo(() => {
    const list = spacesQuery.data || [];
    if (!keyword.trim()) {
      return list;
    }
    const text = keyword.trim().toLowerCase();
    return list.filter((space) => {
      const fields = [space.title, space.description || '', ...(space.tags || [])].join(' ').toLowerCase();
      return fields.includes(text);
    });
  }, [spacesQuery.data, keyword]);

  const openSpace = (space: DiscussionSpace) => {
    navigate(`/discussions/${space.id}`);
  };

  return (
    <div className="min-h-screen bg-[#ffffff] px-6 py-6 font-['IBM_Plex_Sans','Helvetica_Neue',Arial,sans-serif]">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 border-b border-[#e0e0e0] pb-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-light tracking-tight text-[#161616]">Discussion Space</h1>
              <p className="mt-2 text-sm text-[#525252]">按主题组织讨论、分叉线程，并沉淀结构化知识与文档。</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => spacesQuery.refetch()}
                className="inline-flex items-center gap-1 border border-[#c6c6c6] px-3 py-2 text-sm text-[#262626] hover:bg-[#f4f4f4]"
              >
                <ArrowPathIcon className="h-4 w-4" />
                刷新
              </button>
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="inline-flex items-center gap-1 bg-[#0f62fe] px-4 py-2 text-sm text-white hover:bg-[#0353e9]"
              >
                <PlusIcon className="h-4 w-4" />
                新建讨论空间
              </button>
            </div>
          </div>
        </div>

        <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="border border-[#c6c6c6] bg-[#f4f4f4] p-3">
            <label className="mb-1 block text-xs tracking-wide text-[#6f6f6f]">状态</label>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as 'all' | DiscussionSpaceStatus)}
              className="w-full border-0 border-b-2 border-[#c6c6c6] bg-transparent px-1 py-2 text-sm text-[#161616] outline-none focus:border-[#0f62fe]"
            >
              <option value="all">全部</option>
              <option value="active">进行中</option>
              <option value="paused">已暂停</option>
              <option value="archived">已归档</option>
            </select>
          </div>
          <div className="border border-[#c6c6c6] bg-[#f4f4f4] p-3 md:col-span-2">
            <label className="mb-1 block text-xs tracking-wide text-[#6f6f6f]">搜索</label>
            <input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="按主题、描述、标签检索"
              className="w-full border-0 border-b-2 border-[#c6c6c6] bg-transparent px-1 py-2 text-sm text-[#161616] outline-none focus:border-[#0f62fe]"
            />
          </div>
        </div>

        {spacesQuery.isLoading ? <div className="py-10 text-sm text-[#6f6f6f]">加载讨论空间中...</div> : null}
        {spacesQuery.isError ? <div className="py-10 text-sm text-[#da1e28]">加载失败，请稍后重试</div> : null}

        {!spacesQuery.isLoading && !spacesQuery.isError ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {filteredSpaces.map((space) => (
              <button
                type="button"
                key={space.id}
                onClick={() => openSpace(space)}
                className="group border border-[#c6c6c6] bg-white p-5 text-left transition hover:border-[#0f62fe] hover:bg-[#edf5ff]"
              >
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[#6f6f6f]">{statusLabelMap[space.status]}</span>
                    <span className="bg-[#f4f4f4] px-2 py-0.5 text-[11px] text-[#525252]">{categoryLabelMap[space.category || 'general']}</span>
                  </div>
                  <ChatBubbleLeftRightIcon className="h-4 w-4 text-[#8d8d8d] group-hover:text-[#0f62fe]" />
                </div>
                <div className="line-clamp-2 text-lg font-normal text-[#161616]">{space.title}</div>
                <div className="mt-2 line-clamp-3 min-h-[60px] text-sm leading-6 text-[#525252]">
                  {space.description || '暂无描述'}
                </div>
                <div className="mt-3 flex flex-wrap gap-1">
                  {space.tags?.slice(0, 4).map((tag) => (
                    <span key={tag} className="bg-[#f4f4f4] px-2 py-1 text-xs text-[#525252]">
                      {tag}
                    </span>
                  ))}
                </div>
                <div className="mt-4 border-t border-[#e0e0e0] pt-3 text-xs text-[#6f6f6f]">
                  <div>讨论线 {space.statistics?.totalThreads || 0} · 消息 {space.statistics?.totalMessages || 0} · 知识 {space.statistics?.totalKnowledgeEntries || 0}</div>
                  <div className="mt-2 flex justify-end">
                    {space.status === 'archived' ? (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          unarchiveSpaceMutation.mutate(space);
                        }}
                        disabled={unarchiveSpaceMutation.isLoading}
                        className="border border-[#0f62fe] px-2 py-1 text-xs text-[#0f62fe] hover:bg-[#edf5ff] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        取消归档
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          archiveSpaceMutation.mutate(space);
                        }}
                        disabled={archiveSpaceMutation.isLoading}
                        className="border border-[#a8a8a8] px-2 py-1 text-xs text-[#525252] hover:bg-[#f4f4f4] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        归档
                      </button>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        ) : null}

        {!spacesQuery.isLoading && !spacesQuery.isError && filteredSpaces.length === 0 ? (
          <div className="border border-dashed border-[#c6c6c6] bg-[#f4f4f4] p-10 text-center text-sm text-[#6f6f6f]">
            暂无符合条件的讨论空间
          </div>
        ) : null}
      </div>

      <SpaceCreateModal
        open={createOpen}
        loading={createSpaceMutation.isLoading}
        availableAgents={(assignableAgentsQuery.data || []).map((agent) => ({
          id: agent.id,
          name: agent.name,
          description: agent.description,
        }))}
        agentsLoading={assignableAgentsQuery.isLoading}
        projectOptions={(projectOptionsQuery.data || []).map((project) => ({
          id: project._id,
          name: project.name,
        }))}
        projectsLoading={projectOptionsQuery.isLoading}
        defaultProjectId={defaultProjectId}
        outlineTemplateOptions={(outlineTemplateOptionsQuery.data || []).map((template) => ({
          id: template._id,
          name: template.name,
          description: template.description,
          isSystem: template.isSystem,
        }))}
        outlineTemplatesLoading={outlineTemplateOptionsQuery.isLoading}
        onClose={() => {
          setCreateOpen(false);
          setCreateError('');
        }}
        onSubmit={(payload) => createSpaceMutation.mutateAsync(payload)}
      />

      {createError ? (
        <div className="fixed bottom-4 right-4 border border-[#da1e28] bg-white px-4 py-2 text-sm text-[#da1e28]">
          {createError}
        </div>
      ) : null}
    </div>
  );
};

export default Discussions;
