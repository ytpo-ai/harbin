import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from 'react-query';
import {
  skillMarketService,
  SkillMarketSearchResponse,
} from '../services/skillMarketService';
import { SkillGithubRepo } from '../types';

const repoStatusLabel: Record<SkillGithubRepo['status'], string> = {
  pending: '待导入',
  imported: '已导入',
  skipped: '已忽略',
};

const formatDateTime = (value?: string) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
};

export const SkillMarketPanel: React.FC = () => {
  const queryClient = useQueryClient();
  const [newPlatform, setNewPlatform] = useState({
    name: '',
    url: '',
    priority: 100,
    description: '',
  });

  const [repoFilterPlatformId, setRepoFilterPlatformId] = useState('');
  const [repoFilterStatus, setRepoFilterStatus] = useState('');
  const [repoKeyword, setRepoKeyword] = useState('');
  const [repoPage, setRepoPage] = useState(1);

  const [marketKeyword, setMarketKeyword] = useState('');
  const [marketPlatformId, setMarketPlatformId] = useState('');
  const [searchResult, setSearchResult] = useState<SkillMarketSearchResponse | null>(null);

  const { data: platforms = [], isLoading: platformsLoading } = useQuery(
    'skill-market-platforms',
    () => skillMarketService.listPlatforms(),
  );

  const {
    data: reposData,
    isLoading: reposLoading,
  } = useQuery(
    ['skill-market-repos', repoFilterPlatformId, repoFilterStatus, repoKeyword, repoPage],
    () =>
      skillMarketService.listRepos({
        platformId: repoFilterPlatformId || undefined,
        status: (repoFilterStatus as SkillGithubRepo['status']) || undefined,
        search: repoKeyword.trim() || undefined,
        page: repoPage,
        pageSize: 10,
      }),
    { keepPreviousData: true },
  );

  const createPlatformMutation = useMutation(skillMarketService.createPlatform, {
    onSuccess: () => {
      setNewPlatform({ name: '', url: '', priority: 100, description: '' });
      queryClient.invalidateQueries('skill-market-platforms');
    },
  });

  const updatePlatformMutation = useMutation(
    ({ id, payload }: { id: string; payload: { status?: 'active' | 'disabled' } }) =>
      skillMarketService.updatePlatform(id, payload),
    {
      onSuccess: () => {
        queryClient.invalidateQueries('skill-market-platforms');
      },
    },
  );

  const indexPlatformMutation = useMutation(skillMarketService.indexPlatform, {
    onSuccess: (result) => {
      alert(`索引完成：scanned=${result.scanned}, indexed=${result.indexed}, failed=${result.failed}`);
      queryClient.invalidateQueries('skill-market-platforms');
      queryClient.invalidateQueries('skill-market-repos');
    },
  });

  const deletePlatformMutation = useMutation(skillMarketService.deletePlatform, {
    onSuccess: (result) => {
      alert(`已删除平台，清理仓库记录 ${result.deletedRepos} 条`);
      queryClient.invalidateQueries('skill-market-platforms');
      queryClient.invalidateQueries('skill-market-repos');
    },
  });

  const skipRepoMutation = useMutation(skillMarketService.skipRepo, {
    onSuccess: () => {
      queryClient.invalidateQueries('skill-market-repos');
    },
  });

  const importRepoMutation = useMutation(skillMarketService.importRepo, {
    onSuccess: (result) => {
      alert(result.created ? `导入成功：${result.skill.name}` : `已存在 Skill：${result.skill.name}`);
      queryClient.invalidateQueries('skill-market-repos');
      queryClient.invalidateQueries('skills-paged');
      queryClient.invalidateQueries('skills-all');
    },
  });

  const searchMarketMutation = useMutation(skillMarketService.searchMarket, {
    onSuccess: (result) => {
      setSearchResult(result);
      if (result.remoteFetched > 0) {
        queryClient.invalidateQueries('skill-market-repos');
      }
    },
  });

  const repos = reposData?.items || [];
  const repoTotalPages = reposData?.totalPages || 1;
  const hasPlatforms = platforms.length > 0;

  const searchItems = useMemo(() => searchResult?.items || [], [searchResult]);

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">平台管理</h3>
          {platformsLoading && <span className="text-xs text-gray-500">加载中...</span>}
        </div>

        <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
          <input
            value={newPlatform.name}
            onChange={(event) => setNewPlatform((prev) => ({ ...prev, name: event.target.value }))}
            placeholder="平台名称"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          <input
            value={newPlatform.url}
            onChange={(event) => setNewPlatform((prev) => ({ ...prev, url: event.target.value }))}
            placeholder="平台 URL"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          <input
            type="number"
            value={newPlatform.priority}
            onChange={(event) => setNewPlatform((prev) => ({ ...prev, priority: Number(event.target.value) || 100 }))}
            placeholder="优先级"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          <button
            onClick={() => {
              if (!newPlatform.name.trim() || !newPlatform.url.trim()) {
                alert('平台名称和 URL 必填');
                return;
              }
              createPlatformMutation.mutate({
                name: newPlatform.name.trim(),
                url: newPlatform.url.trim(),
                priority: newPlatform.priority,
                description: newPlatform.description.trim() || undefined,
              });
            }}
            disabled={createPlatformMutation.isLoading}
            className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {createPlatformMutation.isLoading ? '创建中...' : '添加平台'}
          </button>
          <textarea
            value={newPlatform.description}
            onChange={(event) => setNewPlatform((prev) => ({ ...prev, description: event.target.value }))}
            placeholder="描述（可选）"
            rows={2}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm md:col-span-4"
          />
        </div>

        <div className="mt-3 space-y-2">
          {platforms.map((platform) => (
            <div key={platform.id} className="rounded-md border border-gray-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium text-gray-900">{platform.name}</p>
                  <p className="text-xs text-gray-500">{platform.url}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => indexPlatformMutation.mutate(platform.id)}
                    disabled={indexPlatformMutation.isLoading}
                    className="rounded-md border border-blue-300 bg-blue-50 px-2 py-1 text-xs text-blue-700 hover:bg-blue-100"
                  >
                    立即索引
                  </button>
                  <button
                    onClick={() =>
                      updatePlatformMutation.mutate({
                        id: platform.id,
                        payload: {
                          status: platform.status === 'active' ? 'disabled' : 'active',
                        },
                      })
                    }
                    className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100"
                  >
                    {platform.status === 'active' ? '禁用' : '启用'}
                  </button>
                  <button
                    onClick={() => {
                      if (window.confirm(`确认删除平台 ${platform.name} ?`)) {
                        deletePlatformMutation.mutate(platform.id);
                      }
                    }}
                    className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-600 hover:bg-red-100"
                  >
                    删除
                  </button>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-500">
                <span>优先级: {platform.priority}</span>
                <span>状态: {platform.status === 'active' ? '启用' : '禁用'}</span>
                <span>仓库数: {platform.repoCount || 0}</span>
                <span>最近索引: {formatDateTime(platform.lastIndexedAt)}</span>
              </div>
            </div>
          ))}
          {!hasPlatforms && <p className="py-4 text-center text-sm text-gray-500">暂无平台，请先添加至少一个平台。</p>}
        </div>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">仓库索引列表</h3>
          {reposLoading && <span className="text-xs text-gray-500">加载中...</span>}
        </div>

        <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-4">
          <select
            value={repoFilterPlatformId}
            onChange={(event) => {
              setRepoFilterPlatformId(event.target.value);
              setRepoPage(1);
            }}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="">全部平台</option>
            {platforms.map((platform) => (
              <option key={platform.id} value={platform.id}>{platform.name}</option>
            ))}
          </select>
          <select
            value={repoFilterStatus}
            onChange={(event) => {
              setRepoFilterStatus(event.target.value);
              setRepoPage(1);
            }}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="">全部状态</option>
            <option value="pending">待导入</option>
            <option value="imported">已导入</option>
            <option value="skipped">已忽略</option>
          </select>
          <input
            value={repoKeyword}
            onChange={(event) => {
              setRepoKeyword(event.target.value);
              setRepoPage(1);
            }}
            placeholder="搜索仓库名/描述"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          <button
            onClick={() => {
              setRepoFilterPlatformId('');
              setRepoFilterStatus('');
              setRepoKeyword('');
              setRepoPage(1);
            }}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
          >
            清空筛选
          </button>
        </div>

        <div className="space-y-2">
          {repos.map((repo) => (
            <div key={repo.id} className="rounded-md border border-gray-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium text-gray-900">{repo.fullName}</p>
                  <p className="text-xs text-gray-500">{repo.description || '暂无描述'}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{repoStatusLabel[repo.status]}</span>
                  <button
                    onClick={() => importRepoMutation.mutate(repo.id)}
                    disabled={importRepoMutation.isLoading || repo.status === 'imported'}
                    className="rounded-md border border-green-200 bg-green-50 px-2 py-1 text-xs text-green-700 hover:bg-green-100 disabled:opacity-60"
                  >
                    导入 Skill
                  </button>
                  <button
                    onClick={() => skipRepoMutation.mutate(repo.id)}
                    disabled={skipRepoMutation.isLoading || repo.status === 'skipped'}
                    className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 disabled:opacity-60"
                  >
                    忽略
                  </button>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-500">
                <span>Stars: {repo.stars}</span>
                <span>语言: {repo.language || '-'}</span>
                <span>Owner: {repo.owner}</span>
                <span>Topics: {(repo.topics || []).join(', ') || '-'}</span>
              </div>
            </div>
          ))}
          {!reposLoading && repos.length === 0 && (
            <p className="py-4 text-center text-sm text-gray-500">暂无仓库记录，先触发平台索引。</p>
          )}
        </div>

        {repoTotalPages > 1 && (
          <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-3">
            <p className="text-xs text-gray-500">第 {repoPage}/{repoTotalPages} 页</p>
            <div className="flex gap-2">
              <button
                onClick={() => setRepoPage((prev) => Math.max(1, prev - 1))}
                disabled={repoPage <= 1}
                className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 disabled:opacity-50"
              >
                上一页
              </button>
              <button
                onClick={() => setRepoPage((prev) => Math.min(repoTotalPages, prev + 1))}
                disabled={repoPage >= repoTotalPages}
                className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 disabled:opacity-50"
              >
                下一页
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">市场检索</h3>
          {searchMarketMutation.isLoading && <span className="text-xs text-gray-500">检索中...</span>}
        </div>

        <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
          <input
            value={marketKeyword}
            onChange={(event) => setMarketKeyword(event.target.value)}
            placeholder="输入关键词"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm md:col-span-2"
          />
          <select
            value={marketPlatformId}
            onChange={(event) => setMarketPlatformId(event.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="">全部平台（自动回退）</option>
            {platforms.map((platform) => (
              <option key={platform.id} value={platform.id}>{platform.name}</option>
            ))}
          </select>
          <button
            onClick={() => {
              if (!marketKeyword.trim()) {
                alert('请输入关键词');
                return;
              }
              searchMarketMutation.mutate({
                keyword: marketKeyword.trim(),
                platformId: marketPlatformId || undefined,
                page: 1,
                pageSize: 10,
              });
            }}
            disabled={searchMarketMutation.isLoading}
            className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            开始检索
          </button>
        </div>

        {searchResult && (
          <div className="mt-3 space-y-2">
            <p className="text-xs text-gray-500">共 {searchResult.items.length} 条（远程补充 {searchResult.remoteFetched} 条）</p>
            {searchItems.map((repo) => (
              <div key={repo.id} className="rounded-md border border-gray-200 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium text-gray-900">{repo.fullName}</p>
                    <p className="text-xs text-gray-500">{repo.description || '暂无描述'}</p>
                  </div>
                  <button
                    onClick={() => importRepoMutation.mutate(repo.id)}
                    disabled={importRepoMutation.isLoading || repo.status === 'imported'}
                    className="rounded-md border border-green-200 bg-green-50 px-2 py-1 text-xs text-green-700 hover:bg-green-100 disabled:opacity-60"
                  >
                    一键导入
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

export default SkillMarketPanel;
