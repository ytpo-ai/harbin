import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from 'react-query';
import { PlusIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { skillMarketService } from '../services/skillMarketService';
import { SkillGithubRepo } from '../types';

const AddRepoModal: React.FC<{
  open: boolean;
  onClose: () => void;
  onSubmit: (repoUrl: string) => void;
  loading: boolean;
}> = ({ open, onClose, onSubmit, loading }) => {
  const [repoUrl, setRepoUrl] = useState('');

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">添加 GitHub 仓库</h3>
          <button onClick={onClose} className="rounded p-1 text-gray-500 hover:bg-gray-100">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">GitHub 仓库 URL</label>
          <input
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            placeholder="https://github.com/owner/repo"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && repoUrl.trim()) onSubmit(repoUrl.trim());
            }}
          />
          <p className="mt-1 text-xs text-gray-400">支持格式：https://github.com/owner/repo 或 owner/repo</p>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">取消</button>
          <button
            onClick={() => {
              const val = repoUrl.trim();
              if (!val) return;
              const url = val.includes('github.com') ? val : `https://github.com/${val}`;
              onSubmit(url);
            }}
            disabled={loading || !repoUrl.trim()}
            className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60"
          >
            {loading ? '添加中...' : '确认添加'}
          </button>
        </div>
      </div>
    </div>
  );
};

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

  const [isAddRepoModalOpen, setIsAddRepoModalOpen] = useState(false);

  const [repoFilterPlatformId, setRepoFilterPlatformId] = useState('');
  const [repoFilterStatus, setRepoFilterStatus] = useState('');
  const [repoKeyword, setRepoKeyword] = useState('');
  const [repoPage, setRepoPage] = useState(1);

  const { data: platforms = [] } = useQuery(
    'skill-market-platforms',
    () => skillMarketService.listPlatforms(),
  );

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

  const addRepoMutation = useMutation(
    (repoUrl: string) => skillMarketService.addRepo({ repoUrl }),
    {
      onSuccess: (repo) => {
        setIsAddRepoModalOpen(false);
        alert(`已添加仓库：${repo.fullName}`);
        queryClient.invalidateQueries('skill-market-repos');
      },
    },
  );

  const skipRepoMutation = useMutation(skillMarketService.skipRepo, {
    onSuccess: () => {
      queryClient.invalidateQueries('skill-market-repos');
    },
  });

  const importRepoMutation = useMutation(
    ({ repoId, force }: { repoId: string; force?: boolean }) => skillMarketService.importRepo(repoId, { force }),
    {
      onSuccess: (result) => {
        const total = result.skills.length;
        const names = result.skills.map((s) => s.name).join(', ');
        if (result.created > 0) {
          alert(`导入完成：新增 ${result.created} 个 Skill${result.skipped > 0 ? `，跳过 ${result.skipped} 个已存在` : ''}\n${names}`);
        } else {
          alert(`所有 ${total} 个 Skill 已存在：${names}`);
        }
        queryClient.invalidateQueries('skill-market-repos');
        queryClient.invalidateQueries('skills-paged');
        queryClient.invalidateQueries('skills-all');
      },
    },
  );

  const repos = reposData?.items || [];
  const repoTotal = reposData?.total || 0;
  const repoTotalPages = reposData?.totalPages || 1;

  const canImport = (repo: SkillGithubRepo) => repo.status !== 'skipped';

  return (
    <div className="space-y-6">
      {/* 仓库列表 */}
      <section className="rounded-lg bg-white p-5 shadow">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-medium text-gray-900">GitHub 仓库</h2>
            <p className="text-xs text-gray-500">共 {repoTotal} 条记录</p>
          </div>
          <button
            onClick={() => setIsAddRepoModalOpen(true)}
            className="inline-flex items-center rounded-md border border-green-300 bg-green-50 px-4 py-2 text-sm font-medium text-green-700 hover:bg-green-100"
          >
            <PlusIcon className="mr-2 h-4 w-4" />
            添加仓库
          </button>
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
                  {canImport(repo) && (
                    <button
                      onClick={() => importRepoMutation.mutate({ repoId: repo.id, force: repo.status === 'imported' })}
                      disabled={importRepoMutation.isLoading}
                      className="rounded-md border border-green-200 bg-green-50 px-2 py-1 text-xs text-green-700 hover:bg-green-100 disabled:opacity-60"
                    >
                      {repo.status === 'imported' ? '重新导入' : '导入 Skill'}
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
            <p className="py-8 text-center text-sm text-gray-500">暂无仓库记录，点击右上角「添加仓库」手动添加 GitHub 仓库。</p>
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

      <AddRepoModal
        open={isAddRepoModalOpen}
        onClose={() => setIsAddRepoModalOpen(false)}
        onSubmit={(repoUrl) => addRepoMutation.mutate(repoUrl)}
        loading={addRepoMutation.isLoading}
      />
    </div>
  );
};

export default SkillGithubRepoPanel;
