import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from 'react-query';
import {
  ArrowPathIcon,
  FolderPlusIcon,
  LinkIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { rdConversationService, RdProject } from '../services/rdConversationService';
import { apiKeyService, ApiKey } from '../services/apiKeyService';
import { agentService } from '../services/agentService';
import { Agent } from '../types';
import { useToast } from '../hooks/useToast';
import Toast from '../components/Toast';

const rdManagementService = rdConversationService;
const LOCAL_PAGE_SIZE = 10;

type DrawerTab = 'binding-overview' | 'opencode-binding' | 'github-binding';

function extractProjectId(value: string | Partial<RdProject> | undefined): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return String((value as any)._id || '');
}

function isGithubLikeProvider(provider: string): boolean {
  const value = String(provider || '').trim().toLowerCase();
  if (!value) return false;
  return value.includes('github') || value === 'git' || value === 'gh';
}

function parseGithubRepoFromUrl(input: string): { owner: string; repo: string } | null {
  const url = String(input || '').trim();
  if (!url) return null;

  const httpsMatch = url.match(/^https?:\/\/github\.com\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:[/?#].*)?$/i);
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }

  const sshMatch = url.match(/^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i);
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }

  return null;
}

function extractRequestErrorMessage(error: any): string {
  const candidates = [
    error?.response?.data?.message,
    error?.response?.data?.error,
    error?.message,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  return '操作失败，请稍后重试';
}

const ProjectManagement: React.FC = () => {
  const [localSearch, setLocalSearch] = useState('');
  const [localPage, setLocalPage] = useState(1);
  const [selectedLocalProjectId, setSelectedLocalProjectId] = useState('');

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [localName, setLocalName] = useState('');
  const [localPath, setLocalPath] = useState('');
  const [localDescription, setLocalDescription] = useState('');

  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>('binding-overview');

  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [selectedOpencodeProjectId, setSelectedOpencodeProjectId] = useState('');

  const [githubOwner, setGithubOwner] = useState('');
  const [githubRepo, setGithubRepo] = useState('');
  const [githubRepositoryUrl, setGithubRepositoryUrl] = useState('');
  const [githubBranch, setGithubBranch] = useState('main');
  const [githubApiKeyId, setGithubApiKeyId] = useState('');
  const [githubUrlError, setGithubUrlError] = useState('');
  const { toast, showToast, clearToast } = useToast(4000);

  const {
    data: localProjects = [],
    isLoading: localProjectsLoading,
    error: localProjectsError,
    refetch: refetchLocalProjects,
  } = useQuery<RdProject[]>(
    ['pm-local-projects'],
    () => rdManagementService.getProjects({ sourceType: 'local' }),
    { retry: false },
  );

  const { data: agents = [] } = useQuery<Agent[]>(
    ['pm-agents'],
    () => agentService.getAgents(),
    { retry: false },
  );

  const rdAgents = useMemo(
    () =>
      agents.filter((agent) => {
        const config = agent.config as Record<string, any> | undefined;
        return String(config?.execution?.provider || '').toLowerCase() === 'opencode' && agent.isActive;
      }),
    [agents],
  );

  const {
    data: opencodeProjects = [],
    isLoading: opencodeProjectsLoading,
    error: opencodeProjectsError,
    refetch: refetchOpencodeProjects,
  } = useQuery<RdProject[]>(
    ['pm-opencode-projects', selectedAgentId],
    () =>
      rdManagementService.getProjects({
        sourceType: 'opencode',
        syncedFromAgentId: selectedAgentId || undefined,
      }),
    { retry: false },
  );

  const {
    data: boundOpencodeProjects = [],
    isLoading: boundOpencodeLoading,
    error: boundOpencodeError,
    refetch: refetchBoundOpencode,
  } = useQuery<RdProject[]>(
    ['pm-bound-opencode-projects', selectedLocalProjectId],
    () =>
      rdManagementService.getProjects({
        sourceType: 'opencode',
        bindingLocalProjectId: selectedLocalProjectId,
      }),
    { enabled: Boolean(selectedLocalProjectId), retry: false },
  );

  const { data: allApiKeys = [], error: apiKeysError } = useQuery<ApiKey[]>(
    ['pm-github-api-keys'],
    () => apiKeyService.getAllApiKeys(),
    { retry: false },
  );

  const githubApiKeys = useMemo(
    () => allApiKeys.filter((item) => item.isActive && isGithubLikeProvider(item.provider)),
    [allApiKeys],
  );

  useEffect(() => {
    if (!selectedLocalProjectId && localProjects.length > 0) {
      setSelectedLocalProjectId(localProjects[0]._id);
      return;
    }

    if (selectedLocalProjectId && !localProjects.some((item) => item._id === selectedLocalProjectId)) {
      setSelectedLocalProjectId(localProjects[0]?._id || '');
    }
  }, [localProjects, selectedLocalProjectId]);

  useEffect(() => {
    if (!selectedAgentId && rdAgents.length > 0) {
      setSelectedAgentId(rdAgents[0].id);
    }
  }, [rdAgents, selectedAgentId]);

  const filteredLocalProjects = useMemo(() => {
    const keyword = localSearch.trim().toLowerCase();
    if (!keyword) return localProjects;
    return localProjects.filter((item) => {
      return (
        String(item.name || '').toLowerCase().includes(keyword) ||
        String(item.localPath || '').toLowerCase().includes(keyword)
      );
    });
  }, [localProjects, localSearch]);

  const totalLocalPages = Math.max(1, Math.ceil(filteredLocalProjects.length / LOCAL_PAGE_SIZE));

  useEffect(() => {
    if (localPage > totalLocalPages) {
      setLocalPage(totalLocalPages);
    }
  }, [localPage, totalLocalPages]);

  const pagedLocalProjects = useMemo(() => {
    const start = (localPage - 1) * LOCAL_PAGE_SIZE;
    return filteredLocalProjects.slice(start, start + LOCAL_PAGE_SIZE);
  }, [filteredLocalProjects, localPage]);

  const selectedLocalProject = useMemo(
    () => localProjects.find((item) => item._id === selectedLocalProjectId),
    [localProjects, selectedLocalProjectId],
  );

  const selectedOpencodeProject = useMemo(
    () => opencodeProjects.find((item) => item._id === selectedOpencodeProjectId),
    [opencodeProjects, selectedOpencodeProjectId],
  );

  const boundGithubProject = useMemo(() => {
    if (!selectedLocalProject?.githubBindingId || typeof selectedLocalProject.githubBindingId === 'string') {
      return null;
    }
    return selectedLocalProject.githubBindingId as Partial<RdProject>;
  }, [selectedLocalProject]);

  useEffect(() => {
    if (!isDrawerOpen || !selectedLocalProject) return;
    setGithubOwner(boundGithubProject?.githubOwner || '');
    setGithubRepo(boundGithubProject?.githubRepo || '');
    setGithubRepositoryUrl(boundGithubProject?.repositoryUrl || '');
    setGithubBranch(boundGithubProject?.branch || 'main');
    setGithubApiKeyId(boundGithubProject?.githubApiKeyId || '');
    setGithubUrlError('');
  }, [
    isDrawerOpen,
    selectedLocalProject?._id,
    boundGithubProject?.githubOwner,
    boundGithubProject?.githubRepo,
    boundGithubProject?.repositoryUrl,
    boundGithubProject?.branch,
    boundGithubProject?.githubApiKeyId,
  ]);

  const createLocalProjectMutation = useMutation<RdProject | null>(
    () =>
      rdManagementService.createLocalProject({
        name: localName.trim(),
        localPath: localPath.trim(),
        description: localDescription.trim() || undefined,
      }),
    {
      onSuccess: async (created) => {
        if (!created) return;
        setLocalName('');
        setLocalPath('');
        setLocalDescription('');
        setSelectedLocalProjectId(created._id);
        setIsCreateModalOpen(false);
        showToast('success', '本地项目创建成功');
        await refetchLocalProjects();
      },
      onError: (error) => {
        showToast('error', extractRequestErrorMessage(error));
      },
    },
  );

  const syncAgentProjectsMutation = useMutation(
    () => rdManagementService.syncAgentOpencodeProjects(selectedAgentId),
    {
      onSuccess: async () => {
        showToast('success', 'OpenCode 项目同步完成');
        await refetchOpencodeProjects();
      },
      onError: (error) => {
        showToast('error', extractRequestErrorMessage(error));
      },
    },
  );

  const bindOpencodeMutation = useMutation<RdProject | null>(
    () => {
      if (!selectedLocalProjectId || !selectedOpencodeProject) return Promise.resolve(null);
      return rdManagementService.bindOpencodeProject({
        localProjectId: selectedLocalProjectId,
        projectId: selectedOpencodeProject.opencodeProjectId,
        projectPath: selectedOpencodeProject.opencodeProjectPath,
        endpointRef: selectedOpencodeProject.opencodeEndpointRef,
        agentId: selectedAgentId || selectedOpencodeProject.syncedFromAgentId,
      });
    },
    {
      onSuccess: async () => {
        setSelectedOpencodeProjectId('');
        showToast('success', 'OpenCode 绑定成功');
        await Promise.all([refetchLocalProjects(), refetchOpencodeProjects(), refetchBoundOpencode()]);
      },
      onError: (error) => {
        showToast('error', extractRequestErrorMessage(error));
      },
    },
  );

  const bindGithubMutation = useMutation<RdProject | null>(
    () => {
      if (!selectedLocalProjectId) return Promise.resolve(null);
      return rdManagementService.bindGithubProject({
        localProjectId: selectedLocalProjectId,
        owner: githubOwner.trim(),
        repo: githubRepo.trim(),
        repositoryUrl: githubRepositoryUrl.trim(),
        branch: githubBranch.trim() || 'main',
        githubApiKeyId,
      });
    },
    {
      onSuccess: async () => {
        showToast('success', 'GitHub 绑定已保存');
        await refetchLocalProjects();
      },
      onError: (error) => {
        showToast('error', extractRequestErrorMessage(error));
      },
    },
  );

  const unbindOpencodeMutation = useMutation(
    ({ bindingId }: { bindingId: string }) => {
      if (!selectedLocalProjectId) return Promise.resolve(null);
      return rdManagementService.unbindOpencodeProject(selectedLocalProjectId, {
        opencodeBindingId: bindingId,
      });
    },
    {
      onSuccess: async () => {
        showToast('success', 'OpenCode 解绑成功');
        await Promise.all([refetchLocalProjects(), refetchOpencodeProjects(), refetchBoundOpencode()]);
      },
      onError: (error) => {
        showToast('error', extractRequestErrorMessage(error));
      },
    },
  );

  const unbindGithubMutation = useMutation(
    () => {
      if (!selectedLocalProjectId) return Promise.resolve(null);
      return rdManagementService.unbindGithubProject(selectedLocalProjectId);
    },
    {
      onSuccess: async () => {
        showToast('success', 'GitHub 解绑成功');
        await refetchLocalProjects();
      },
      onError: (error) => {
        showToast('error', extractRequestErrorMessage(error));
      },
    },
  );

  const openDetailDrawer = (projectId: string) => {
    setSelectedLocalProjectId(projectId);
    setDrawerTab('binding-overview');
    setIsDrawerOpen(true);
  };

  const handleGithubRepositoryUrlChange = (value: string) => {
    setGithubRepositoryUrl(value);

    const trimmed = value.trim();
    if (!trimmed) {
      setGithubUrlError('');
      return;
    }

    const parsed = parseGithubRepoFromUrl(trimmed);
    if (!parsed) {
      setGithubUrlError('仓库地址格式不正确，请输入 GitHub HTTPS 或 SSH 地址');
      return;
    }

    setGithubUrlError('');
    setGithubOwner(parsed.owner);
    setGithubRepo(parsed.repo);
  };

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <h1 className="text-lg font-semibold text-gray-900">项目管理</h1>
        <p className="mt-1 text-sm text-gray-600">列表优先管理本地项目，并在详情抽屉中完成 OpenCode/GitHub 绑定。</p>
      </div>

      <section className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={localSearch}
            onChange={(e) => {
              setLocalSearch(e.target.value);
              setLocalPage(1);
            }}
            placeholder="搜索本地项目（名称/路径）"
            className="w-full md:w-[360px] border border-gray-300 rounded px-3 py-2 text-sm"
          />
          <button
            onClick={() => refetchLocalProjects()}
            className="inline-flex items-center gap-1 border border-gray-300 rounded px-3 py-2 text-sm hover:bg-gray-50"
          >
            <ArrowPathIcon className="h-4 w-4" />刷新
          </button>
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="inline-flex items-center gap-1 rounded px-3 py-2 text-sm bg-primary-600 text-white ml-auto"
          >
            <FolderPlusIcon className="h-4 w-4" />新建本地项目
          </button>
        </div>

        <div className="text-xs text-gray-500">共 {filteredLocalProjects.length} 个本地项目</div>

        <div className="border border-gray-200 rounded max-h-[600px] overflow-y-auto">
          {localProjectsLoading ? (
            <p className="text-sm text-gray-500 p-4">加载中...</p>
          ) : localProjectsError ? (
            <p className="text-sm text-red-600 p-4">本地项目加载失败，请刷新重试。</p>
          ) : filteredLocalProjects.length === 0 ? (
            <p className="text-sm text-gray-400 p-4">暂无本地项目，请先新建本地项目。</p>
          ) : (
            pagedLocalProjects.map((project) => {
              const opencodeCount = Array.isArray(project.opencodeBindingIds) ? project.opencodeBindingIds.length : 0;
              const hasGithub = Boolean(project.githubBindingId);
              return (
                <div key={project._id} className="px-4 py-3 border-b border-gray-100">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{project.name}</p>
                      <p className="text-xs text-gray-600 mt-1 break-all">{project.localPath || '-'}</p>
                      {project.description ? <p className="text-xs text-gray-500 mt-1 line-clamp-2">{project.description}</p> : null}
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[11px] text-gray-500">OpenCode: {opencodeCount}</div>
                      <div className="text-[11px] text-gray-500">GitHub: {hasGithub ? '已绑定' : '未绑定'}</div>
                      <button
                        onClick={() => openDetailDrawer(project._id)}
                        className="mt-2 inline-flex items-center gap-1 text-xs border border-gray-300 rounded px-2 py-1 hover:bg-gray-50"
                      >
                        <LinkIcon className="h-3.5 w-3.5" />查看详情
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between text-xs text-gray-600">
          <span>第 {localPage} / {totalLocalPages} 页</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setLocalPage((prev) => Math.max(1, prev - 1))}
              disabled={localPage <= 1}
              className="border border-gray-300 rounded px-2 py-1 disabled:text-gray-400"
            >
              上一页
            </button>
            <button
              onClick={() => setLocalPage((prev) => Math.min(totalLocalPages, prev + 1))}
              disabled={localPage >= totalLocalPages}
              className="border border-gray-300 rounded px-2 py-1 disabled:text-gray-400"
            >
              下一页
            </button>
          </div>
        </div>
      </section>

      {isCreateModalOpen && (
        <div className="fixed inset-0 z-[90]">
          <button className="absolute inset-0 bg-black/40" onClick={() => setIsCreateModalOpen(false)} aria-label="关闭弹窗" />
          <div className="absolute left-1/2 top-1/2 w-[92vw] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl bg-white border border-gray-200 shadow-2xl p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-900">新建本地项目</p>
              <button onClick={() => setIsCreateModalOpen(false)} className="text-gray-500 hover:text-gray-700">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-3 space-y-2">
              <input
                value={localName}
                onChange={(e) => setLocalName(e.target.value)}
                placeholder="项目名称"
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
              />
              <input
                value={localPath}
                onChange={(e) => setLocalPath(e.target.value)}
                placeholder="本地目录，例如 /root/workspace/harbin"
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
              />
              <input
                value={localDescription}
                onChange={(e) => setLocalDescription(e.target.value)}
                placeholder="描述（可选）"
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="border border-gray-300 rounded px-3 py-2 text-sm hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={() => createLocalProjectMutation.mutate()}
                disabled={!localName.trim() || !localPath.trim() || createLocalProjectMutation.isLoading}
                className="rounded px-3 py-2 text-sm bg-primary-600 text-white disabled:bg-gray-300"
              >
                {createLocalProjectMutation.isLoading ? '创建中...' : '确认创建'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isDrawerOpen && selectedLocalProject && (
        <div className="fixed inset-0 z-[95]">
          <button className="absolute inset-0 bg-black/35" onClick={() => setIsDrawerOpen(false)} aria-label="关闭抽屉" />
          <aside className="absolute right-0 top-0 h-full w-full sm:w-[88vw] lg:w-[62vw] bg-white border-l border-gray-200 shadow-2xl flex flex-col">
            <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-gray-900">项目详情</p>
                <p className="text-xs text-gray-500 mt-1">{selectedLocalProject.name} · {selectedLocalProject.localPath || '-'}</p>
              </div>
              <button onClick={() => setIsDrawerOpen(false)} className="text-gray-500 hover:text-gray-700">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="px-4 py-2 border-b border-gray-200 flex flex-wrap gap-2">
              <button
                onClick={() => setDrawerTab('binding-overview')}
                className={`px-3 py-1.5 text-xs rounded ${drawerTab === 'binding-overview' ? 'bg-primary-100 text-primary-700' : 'text-gray-600 hover:bg-gray-100'}`}
              >
                绑定概览
              </button>
              <button
                onClick={() => setDrawerTab('opencode-binding')}
                className={`px-3 py-1.5 text-xs rounded ${drawerTab === 'opencode-binding' ? 'bg-primary-100 text-primary-700' : 'text-gray-600 hover:bg-gray-100'}`}
              >
                OpenCode 绑定
              </button>
              <button
                onClick={() => setDrawerTab('github-binding')}
                className={`px-3 py-1.5 text-xs rounded ${drawerTab === 'github-binding' ? 'bg-primary-100 text-primary-700' : 'text-gray-600 hover:bg-gray-100'}`}
              >
                GitHub 绑定
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {drawerTab === 'binding-overview' && (
                <div className="space-y-4">
                  <div className="border border-gray-200 rounded p-3">
                    <p className="text-xs font-semibold text-gray-700">OpenCode（可多绑定）</p>
                    {boundOpencodeLoading ? (
                      <p className="mt-2 text-sm text-gray-500">加载中...</p>
                    ) : boundOpencodeError ? (
                      <p className="mt-2 text-sm text-red-600">绑定数据加载失败，请稍后重试。</p>
                    ) : boundOpencodeProjects.length === 0 ? (
                      <p className="mt-2 text-sm text-gray-400">暂无绑定</p>
                    ) : (
                      <div className="mt-2 space-y-2">
                        {boundOpencodeProjects.map((item) => (
                          <div key={String(item._id)} className="text-xs border border-gray-200 rounded p-2 bg-gray-50">
                            <p className="font-medium text-gray-800">{item.name || '-'}</p>
                            <p className="mt-1 text-gray-600 break-all">{item.opencodeProjectPath || '-'}</p>
                            <p className="mt-1 text-gray-500">Project ID: {item.opencodeProjectId || '-'}</p>
                            <div className="mt-2">
                              <button
                                onClick={() => {
                                  const bindingId = String(item._id || '');
                                  if (!bindingId) return;
                                  if (!window.confirm('确认解绑该 OpenCode 项目？')) return;
                                  unbindOpencodeMutation.mutate({ bindingId });
                                }}
                                className="text-[11px] border border-red-200 text-red-600 rounded px-2 py-1"
                              >
                                解绑
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="border border-gray-200 rounded p-3">
                    <p className="text-xs font-semibold text-gray-700">GitHub（单绑定）</p>
                    {!boundGithubProject ? (
                      <p className="mt-2 text-sm text-gray-400">暂无绑定</p>
                    ) : (
                      <div className="mt-2 text-xs border border-gray-200 rounded p-2 bg-gray-50">
                        <p className="font-medium text-gray-800">{boundGithubProject.name || '-'}</p>
                        <p className="mt-1 text-gray-600 break-all">{boundGithubProject.repositoryUrl || '-'}</p>
                        <p className="mt-1 text-gray-500">{boundGithubProject.githubOwner || '-'} / {boundGithubProject.githubRepo || '-'}</p>
                        <p className="mt-1 text-gray-500">API Key: {boundGithubProject.githubApiKeyId || '-'}</p>
                        <div className="mt-2">
                          <button
                            onClick={() => {
                              if (!window.confirm('确认解绑 GitHub 仓库？')) return;
                              unbindGithubMutation.mutate();
                            }}
                            className="text-[11px] border border-red-200 text-red-600 rounded px-2 py-1"
                          >
                            解绑
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {drawerTab === 'opencode-binding' && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={selectedAgentId}
                      onChange={(e) => setSelectedAgentId(e.target.value)}
                      className="border border-gray-300 rounded px-2 py-1.5 text-xs min-w-[220px]"
                    >
                      <option value="">选择研发 Agent</option>
                      {rdAgents.map((agent) => (
                        <option key={agent.id} value={agent.id}>{agent.name}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => syncAgentProjectsMutation.mutate()}
                      disabled={!selectedAgentId || syncAgentProjectsMutation.isLoading}
                      className="border border-gray-300 rounded px-3 py-1.5 text-xs hover:bg-gray-50 disabled:text-gray-400"
                    >
                      {syncAgentProjectsMutation.isLoading ? '同步中...' : '同步 Agent OpenCode Projects'}
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
                    <select
                      value={selectedOpencodeProjectId}
                      onChange={(e) => setSelectedOpencodeProjectId(e.target.value)}
                      className="md:col-span-9 border border-gray-300 rounded px-3 py-2 text-sm"
                    >
                      <option value="">选择要绑定的 OpenCode 项目</option>
                      {opencodeProjects.map((item) => (
                        <option key={item._id} value={item._id}>
                          {item.name} | {item.opencodeProjectPath || item.opencodeProjectId || item._id}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => {
                        if (!selectedOpencodeProject) return;

                        const bindingLocal = extractProjectId(selectedOpencodeProject.bindingLocalProjectId as any);
                        if (bindingLocal && bindingLocal !== selectedLocalProjectId) {
                          const shouldRebind = window.confirm('该 OpenCode 项目已绑定其他本地项目，是否改绑到当前本地项目？');
                          if (!shouldRebind) return;
                        }

                        bindOpencodeMutation.mutate();
                      }}
                      disabled={!selectedOpencodeProjectId || bindOpencodeMutation.isLoading}
                      className="md:col-span-3 inline-flex items-center justify-center gap-1 border border-gray-300 rounded px-3 py-2 text-sm hover:bg-gray-50 disabled:text-gray-400"
                    >
                      <LinkIcon className="h-4 w-4" />{bindOpencodeMutation.isLoading ? '绑定中...' : '绑定 OpenCode'}
                    </button>
                  </div>

                  <div className="border border-gray-200 rounded max-h-[420px] overflow-y-auto">
                    {opencodeProjectsLoading ? (
                      <p className="text-sm text-gray-500 p-4">加载中...</p>
                    ) : opencodeProjectsError ? (
                      <p className="text-sm text-red-600 p-4">OpenCode 项目加载失败，请重试。</p>
                    ) : opencodeProjects.length === 0 ? (
                      <p className="text-sm text-gray-400 p-4">暂无 OpenCode 项目，请先选择 Agent 并同步。</p>
                    ) : (
                      opencodeProjects.map((item) => {
                        const bindingId = extractProjectId(item.bindingLocalProjectId as any);
                        const isBound = Boolean(bindingId);
                        const isBoundToCurrent = bindingId === selectedLocalProjectId;
                        return (
                          <div key={item._id} className="px-3 py-2 border-b border-gray-100 text-xs">
                            <p className="font-medium text-gray-800">{item.name}</p>
                            <p className="mt-1 text-gray-600 break-all">{item.opencodeProjectPath || '-'}</p>
                            <p className={`mt-1 ${isBoundToCurrent ? 'text-green-600' : isBound ? 'text-amber-600' : 'text-gray-500'}`}>
                              {isBoundToCurrent ? '已绑定当前本地项目' : isBound ? '已绑定其他本地项目' : '未绑定本地项目'}
                            </p>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {drawerTab === 'github-binding' && (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
                    <input
                      value={githubOwner}
                      onChange={(e) => setGithubOwner(e.target.value)}
                      placeholder="owner"
                      className="md:col-span-3 border border-gray-300 rounded px-3 py-2 text-sm"
                    />
                    <input
                      value={githubRepo}
                      onChange={(e) => setGithubRepo(e.target.value)}
                      placeholder="repo"
                      className="md:col-span-3 border border-gray-300 rounded px-3 py-2 text-sm"
                    />
                    <input
                      value={githubBranch}
                      onChange={(e) => setGithubBranch(e.target.value)}
                      placeholder="branch"
                      className="md:col-span-2 border border-gray-300 rounded px-3 py-2 text-sm"
                    />
                    <select
                      value={githubApiKeyId}
                      onChange={(e) => setGithubApiKeyId(e.target.value)}
                      className="md:col-span-4 border border-gray-300 rounded px-3 py-2 text-sm"
                    >
                      <option value="">选择 GitHub API Key</option>
                      {githubApiKeys.map((item) => (
                        <option key={item.id} value={item.id}>{item.name} ({item.keyMasked})</option>
                      ))}
                    </select>
                    <input
                      value={githubRepositoryUrl}
                      onChange={(e) => handleGithubRepositoryUrlChange(e.target.value)}
                      placeholder="https://github.com/owner/repo"
                      className="md:col-span-9 border border-gray-300 rounded px-3 py-2 text-sm"
                    />
                    <button
                      onClick={() => bindGithubMutation.mutate()}
                      disabled={
                        !githubOwner.trim() ||
                        !githubRepo.trim() ||
                        !githubRepositoryUrl.trim() ||
                        Boolean(githubUrlError) ||
                        !githubApiKeyId ||
                        bindGithubMutation.isLoading
                      }
                      className="md:col-span-3 inline-flex items-center justify-center gap-1 border border-gray-300 rounded px-3 py-2 text-sm hover:bg-gray-50 disabled:text-gray-400"
                    >
                      <LinkIcon className="h-4 w-4" />{bindGithubMutation.isLoading ? '保存中...' : '保存 GitHub 绑定'}
                    </button>
                  </div>

                  {githubUrlError ? <p className="text-xs text-red-600">{githubUrlError}</p> : null}
                  {apiKeysError ? <p className="text-xs text-red-600">API Key 加载失败，请稍后重试。</p> : null}
                  {githubApiKeys.length === 0 ? (
                    <p className="text-xs text-amber-600">当前没有可用的 GitHub API Key，请先在“API密钥”页面新增。</p>
                  ) : null}

                  <p className="text-xs text-gray-500">
                    说明：当前本地项目最多只允许绑定一个 GitHub 仓库；重复保存会覆盖现有绑定。
                  </p>
                </div>
              )}
            </div>
          </aside>
        </div>
      )}

      {toast ? <Toast toast={toast} onClose={clearToast} /> : null}
    </div>
  );
};

export default ProjectManagement;
