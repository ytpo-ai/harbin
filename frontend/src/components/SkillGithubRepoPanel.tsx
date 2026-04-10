import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from 'react-query';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import {
  skillMarketService,
  IndexTaskState,
  SkillMarketSearchResponse,
} from '../services/skillMarketService';
import { SkillGithubRepo } from '../types';

const repoStatusLabel: Record<SkillGithubRepo['status'], string> = {
  pending: '待导入',
  imported: '已导入',
  skipped: '已忽略',
};

const repoStatusColor: Record<SkillGithubRepo['status'], string> = {
  pending: 'bg-amber-50 text-amber-700',
  imported: 'bg-green-50 text-green-700',
  skipped: 'bg-gray-100 text-gray-500',
};

export const SkillGithubRepoPanel: React.FC = () => {
  const queryClient = useQueryClient();

  const [indexPlatformId, setIndexPlatformId] = useState('');
  const [indexTask, setIndexTask] = useState<IndexTaskState | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  const [repoFilterPlatformId, setRepoFilterPlatformId] = useState('');
  const [repoFilterStatus, setRepoFilterStatus] = useState('');
  const [repoKeyword, setRepoKeyword] = useState('');
  const [repoPage, setRepoPage] = useState(1);

  const [searchKeyword, setSearchKeyword] = useState('');
  const [searchPlatformId, setSearchPlatformId] = useState('');
  const [searchResult, setSearchResult] = useState<SkillMarketSearchResponse | null>(null);

  const { data: platforms = [] } = useQuery(
    'skill-market-platforms',
    () => skillMarketService.listPlatforms(),
  );

  const activePlatforms = platforms.filter((p) => p.status === 'active');

  const { data: reposData, isLoading: reposLoading } = useQuery(
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

  const onIndexDone = useCallback(() => {
    queryClient.invalidateQueries('skill-market-platforms');
    queryClient.invalidateQueries('skill-market-repos');
  }, [queryClient]);

  useEffect(() => {
    return () => {
      if (unsubRef.current) {
        unsubRef.current();
        unsubRef.current = null;
      }
    };
  }, []);

  const startIndex = useCallback(async () => {
    if (!indexPlatformId) return;

    if (unsubRef.current) {
      unsubRef.current();
      unsubRef.current = null;
    }

    try {
      const { taskId } = await skillMarketService.startIndexPlatform(indexPlatformId);

      setIndexTask({
        taskId,
        platformId: indexPlatformId,
        platformName: activePlatforms.find((p) => p.id === indexPlatformId)?.name || '',
        status: 'running',
        total: 0,
        scanned: 0,
        indexed: 0,
        failed: 0,
        message: '正在启动索引任务...',
        startedAt: new Date().toISOString(),
      });

      const unsub = skillMarketService.subscribeIndexTask(taskId, {
        onProgress: (state) => {
          setIndexTask(state);
        },
        onDone: (state) => {
          setIndexTask(state);
          onIndexDone();
          unsubRef.current = null;
        },
        onError: (error) => {
          setIndexTask((prev) => prev ? { ...prev, status: 'error', message: error } : null);
          onIndexDone();
          unsubRef.current = null;
        },
      });

      unsubRef.current = unsub;
    } catch (error) {
      const message = (error as any)?.response?.data?.message || (error as Error).message || '启动索引失败';
      setIndexTask({
        taskId: '',
        platformId: indexPlatformId,
        platformName: '',
        status: 'error',
        total: 0,
        scanned: 0,
        indexed: 0,
        failed: 0,
        message,
        startedAt: new Date().toISOString(),
      });
    }
  }, [indexPlatformId, activePlatforms, onIndexDone]);

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
  const repoTotal = reposData?.total || 0;
  const repoTotalPages = reposData?.totalPages || 1;
  const searchItems = searchResult?.items || [];
  const isIndexing = indexTask?.status === 'running';
  const progressPercent = indexTask && indexTask.total > 0 ? Math.round((indexTask.scanned / indexTask.total) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* 索引市场操作区 */}
      <section className="rounded-lg bg-white p-5 shadow">
        <h2 className="mb-3 text-lg font-medium text-gray-900">索引 Skill 市场</h2>
        <p className="mb-3 text-xs text-gray-500">选择一个已配置的市场平台，执行索引后将自动爬取该平台中的 GitHub 仓库并录入索引库。</p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={indexPlatformId}
            onChange={(e) => setIndexPlatformId(e.target.value)}
            disabled={isIndexing}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm disabled:opacity-60"
          >
            <option value="">-- 选择市场平台 --</option>
            {activePlatforms.map((p) => (
              <option key={p.id} value={p.id}>{p.name}（仓库 {p.repoCount || 0}）</option>
            ))}
          </select>
          <button
            onClick={startIndex}
            disabled={isIndexing || !indexPlatformId}
            className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            <ArrowPathIcon className={`mr-2 h-4 w-4 ${isIndexing ? 'animate-spin' : ''}`} />
            {isIndexing ? '索引中...' : '执行索引'}
          </button>
          {activePlatforms.length === 0 && (
            <span className="text-xs text-gray-500">暂无可用平台，请先在「Skill 市场」Tab 中添加。</span>
          )}
        </div>

        {/* 实时进度区域 */}
        {indexTask && (
          <div className="mt-4 rounded-md border border-gray-200 bg-gray-50 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">
                {indexTask.status === 'running' ? '索引进行中' : indexTask.status === 'done' ? '索引完成' : '索引异常'}
                {indexTask.platformName && ` — ${indexTask.platformName}`}
              </span>
              {indexTask.status !== 'running' && (
                <button
                  onClick={() => setIndexTask(null)}
                  className="text-xs text-gray-500 hover:text-gray-700"
                >
                  关闭
                </button>
              )}
            </div>

            {/* 进度条 */}
            {indexTask.total > 0 && (
              <div className="mb-2">
                <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      indexTask.status === 'error' ? 'bg-red-500' : indexTask.status === 'done' ? 'bg-green-500' : 'bg-blue-500'
                    }`}
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <div className="mt-1 flex justify-between text-xs text-gray-500">
                  <span>{indexTask.scanned}/{indexTask.total}</span>
                  <span>{progressPercent}%</span>
                </div>
              </div>
            )}

            {/* 当前处理仓库 */}
            {indexTask.currentRepo && indexTask.status === 'running' && (
              <p className="mb-1 truncate text-xs text-blue-600">
                {indexTask.currentRepo}
              </p>
            )}

            {/* 状态消息 */}
            <p className={`text-xs ${indexTask.status === 'error' ? 'text-red-600' : 'text-gray-600'}`}>
              {indexTask.message}
            </p>

            {/* 统计 */}
            <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-500">
              <span>成功: {indexTask.indexed}</span>
              <span>失败: {indexTask.failed}</span>
              {indexTask.crawlError && (
                <span className="text-red-500">爬取异常: {indexTask.crawlError}</span>
              )}
            </div>
          </div>
        )}
      </section>

      {/* 仓库列表 */}
      <section className="rounded-lg bg-white p-5 shadow">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-medium text-gray-900">GitHub 仓库索引</h2>
            <p className="text-xs text-gray-500">共 {repoTotal} 条记录</p>
          </div>
        </div>

        <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-4">
          <select
            value={repoFilterPlatformId}
            onChange={(e) => { setRepoFilterPlatformId(e.target.value); setRepoPage(1); }}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="">全部平台</option>
            {platforms.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <select
            value={repoFilterStatus}
            onChange={(e) => { setRepoFilterStatus(e.target.value); setRepoPage(1); }}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="">全部状态</option>
            <option value="pending">待导入</option>
            <option value="imported">已导入</option>
            <option value="skipped">已忽略</option>
          </select>
          <input
            value={repoKeyword}
            onChange={(e) => { setRepoKeyword(e.target.value); setRepoPage(1); }}
            placeholder="搜索仓库名/描述"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          <button
            onClick={() => { setRepoFilterPlatformId(''); setRepoFilterStatus(''); setRepoKeyword(''); setRepoPage(1); }}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
          >
            清空筛选
          </button>
        </div>

        <div className="space-y-2">
          {repos.map((repo) => (
            <div key={repo.id} className="rounded-md border border-gray-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <a href={repo.url} target="_blank" rel="noopener noreferrer" className="font-medium text-blue-600 hover:underline">{repo.fullName}</a>
                    <span className={`rounded px-2 py-0.5 text-xs ${repoStatusColor[repo.status]}`}>{repoStatusLabel[repo.status]}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-gray-500">{repo.description || '暂无描述'}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {repo.status !== 'imported' && (
                    <button
                      onClick={() => importRepoMutation.mutate(repo.id)}
                      disabled={importRepoMutation.isLoading}
                      className="rounded-md border border-green-200 bg-green-50 px-2 py-1 text-xs text-green-700 hover:bg-green-100 disabled:opacity-60"
                    >
                      导入 Skill
                    </button>
                  )}
                  {repo.status !== 'skipped' && repo.status !== 'imported' && (
                    <button
                      onClick={() => skipRepoMutation.mutate(repo.id)}
                      disabled={skipRepoMutation.isLoading}
                      className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 disabled:opacity-60"
                    >
                      忽略
                    </button>
                  )}
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-500">
                <span>Stars: {repo.stars}</span>
                <span>语言: {repo.language || '-'}</span>
                <span>Owner: {repo.owner}</span>
                {(repo.topics || []).length > 0 && (
                  <span>Topics: {repo.topics.join(', ')}</span>
                )}
              </div>
            </div>
          ))}
          {!reposLoading && repos.length === 0 && (
            <p className="py-8 text-center text-sm text-gray-500">暂无仓库记录，请先在上方选择市场平台并执行索引。</p>
          )}
          {reposLoading && <p className="py-4 text-center text-sm text-gray-500">加载中...</p>}
        </div>

        {repoTotalPages > 1 && (
          <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-3">
            <p className="text-xs text-gray-500">第 {reposData?.page || 1}/{repoTotalPages} 页</p>
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

      {/* 关键词检索 */}
      <section className="rounded-lg bg-white p-5 shadow">
        <h2 className="mb-3 text-lg font-medium text-gray-900">市场关键词检索</h2>
        <p className="mb-3 text-xs text-gray-500">输入关键词检索本地已索引仓库，若本地结果不足会自动从 GitHub 补充。</p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            placeholder="输入关键词，如 code-review、security"
            className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          <select
            value={searchPlatformId}
            onChange={(e) => setSearchPlatformId(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="">全部平台</option>
            {platforms.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <button
            onClick={() => {
              if (!searchKeyword.trim()) {
                alert('请输入关键词');
                return;
              }
              searchMarketMutation.mutate({
                keyword: searchKeyword.trim(),
                platformId: searchPlatformId || undefined,
                page: 1,
                pageSize: 10,
              });
            }}
            disabled={searchMarketMutation.isLoading}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {searchMarketMutation.isLoading ? '检索中...' : '检索'}
          </button>
        </div>

        {searchResult && (
          <div className="mt-4 space-y-2">
            <p className="text-xs text-gray-500">
              共 {searchResult.items.length} 条结果
              {searchResult.remoteFetched > 0 && `（其中远程补充 ${searchResult.remoteFetched} 条）`}
            </p>
            {searchItems.map((repo) => (
              <div key={repo.id} className="rounded-md border border-gray-200 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <a href={repo.url} target="_blank" rel="noopener noreferrer" className="font-medium text-blue-600 hover:underline">{repo.fullName}</a>
                      <span className={`rounded px-2 py-0.5 text-xs ${repoStatusColor[repo.status]}`}>{repoStatusLabel[repo.status]}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-gray-500">{repo.description || '暂无描述'}</p>
                  </div>
                  {repo.status !== 'imported' && (
                    <button
                      onClick={() => importRepoMutation.mutate(repo.id)}
                      disabled={importRepoMutation.isLoading}
                      className="rounded-md border border-green-200 bg-green-50 px-2 py-1 text-xs text-green-700 hover:bg-green-100 disabled:opacity-60"
                    >
                      一键导入
                    </button>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap gap-3 text-xs text-gray-500">
                  <span>Stars: {repo.stars}</span>
                  {repo.language && <span>语言: {repo.language}</span>}
                </div>
              </div>
            ))}
            {searchItems.length === 0 && (
              <p className="py-4 text-center text-sm text-gray-500">未找到匹配结果。</p>
            )}
          </div>
        )}
      </section>
    </div>
  );
};

export default SkillGithubRepoPanel;
